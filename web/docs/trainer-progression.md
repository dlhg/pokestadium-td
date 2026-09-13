# Trainer Progression — Design & Implementation Plan

Pokémon you catch and train persist across matches. Before each match you pick a
team of up to six. Pokémon earn XP in battle, level up, evolve, and unlock
higher move tiers. Tiers are still bought with prize money during the match.

## Core rules

| Lasts between matches | Resets every match |
| --- | --- |
| Every Pokémon you own, with its nickname, level, XP, DVs and evolution stage | Prize money, lives, Poké Balls |
| Team of 6 | Which towers are placed, and the tiers bought on each |
| Maps cleared, best round | |

- **Level sets the ceiling; cash buys the climb.** `MoveTier.requiresStage` becomes
  `requiresLevel`. Each match still starts at tier 1.
- **Evolution comes from level, not cash.** It can happen during a match: the tower
  evolves in place and the announcer calls it. The cash evolution track goes away.
- **One tower per Pokémon you own.** Each team member can be placed once. Selling it
  returns it to the bench to be placed again (it pays the deploy cost again, and its
  tiers reset). Two Pikachu towers means catching two Pikachu.
- **Catching mid-match** adds the Pokémon to your collection *and* lets you place it
  in this match as a bonus slot.
- **Defeat keeps XP and catches.** Nothing is lost; losing just means less XP.

## Data model

New module: `web/src/td/progression/`.

### Species (static data, replaces `TowerTemplate`)

```ts
// species.ts
export interface SpeciesDef {
  id: string;                    // base form: 'charmander', not 'charizard'
  forms: SpeciesForm[];          // [Charmander, Charmeleon, Charizard]
  baseStats: StatBlock;          // shared by the evolution line; forms may override
  deployCost: number;
  expYield: number;              // base XP awarded for defeating one as a creep
  lines: MoveLine[];             // same three lines as today
  description: string;
}

export interface SpeciesForm {
  name: string;
  type: PokemonType;
  secondaryType?: PokemonType;
  atLevel: number;               // 0 for the base form
  modelName: string;             // GLB key for PokemonModelFactory.loadAuthenticModel
  createFallbackModel: () => AnimatedPokemon;
  baseStats?: StatBlock;
}

export interface MoveTier {
  moveId: string;
  cost: number;
  requiresLevel?: number;        // replaces requiresStage
}
```

`TOWER_TEMPLATES` turns into `SPECIES`. Evolution levels follow Gen 1, and trade/stone
evolutions get a level instead: Charmander 16/36, Squirtle 16/36, Bulbasaur 16/32,
Abra 16/36, Gastly 25/38, Pikachu → Raichu at 26. Tier 3 of each line unlocks at the
final-evolution level. Tier 2 unlocks at about 10–14.

Every creep species you can catch needs a `SpeciesDef` too: Rattata, Pidgey, Zubat,
Paras, Geodude/Graveler, Machop/Machoke, Ponyta, Oddish, Psyduck, Haunter, Dragonair,
Lapras, Onix. A catch maps the creep to `(speciesId, stage)`, so a caught Haunter is a
Gastly-line Pokémon at stage 1. Species without hand-written move lines fall back to a
generated learnset based on their type. This replaces the ad-hoc templates built in
`StadiumTDGame.unlockCapturedTower`.

### Stats

There is no HP stat, since towers don't take damage. Three Gen 1-style stats, each
mapped to a tower behavior:

| Stat | Effect |
| --- | --- |
| **Attack** | Damage multiplier on every move |
| **Speed** | Attack rate multiplier (shorter cooldowns) |
| **Special** | Status chance and duration multiplier |

```ts
export interface StatBlock { attack: number; speed: number; special: number; }

// Gen 1 formula, no HP/stat exp:  floor((base + dv) * 2 * level / 100) + 5
export function computeStats(species: SpeciesDef, stage: number, level: number, dvs: StatBlock): StatBlock;

// Tower multipliers, normalised against a reference base (100 base, DV 8) at the
// same level and then blended with level. All tuning constants live in one file.
export function towerModifiers(stats: StatBlock, level: number): { damage: number; rate: number; status: number };
```

Aim for about 0.8× at Lv 5 and about 1.5× at Lv 50 on damage. Placement should
still matter more than grinding.

### Owned Pokémon & save

```ts
export interface OwnedPokemon {
  uid: string;
  speciesId: string;
  stage: number;
  nickname: string | null;       // ≤ 10 chars, like Gen 1
  level: number;
  xp: number;                    // total, not progress into the current level
  dvs: StatBlock;                // 0–15 each, rolled at catch
  origin: { kind: 'starter' | 'gift' | 'caught'; mapId?: string; round?: number; ball?: BallType; at: number };
  record: { knockouts: number; damageDealt: number; matches: number };
}

export interface TrainerSave {
  version: 1;
  collection: OwnedPokemon[];
  team: (string | null)[];       // 6 uids
  maps: Record<string, { cleared: boolean; bestRound: number }>;
  pokedex: { seen: string[]; caught: string[] };
  captureLuck: number;           // failed attempts since the last catch
  unlocks: string[];             // e.g. 'exp_all'; empty in v1
}
```

`TrainerStore` (`TrainerStore.ts`) loads and saves to `localStorage` under
`pokestadium-td/save`. Wrap every read and write in try/catch and fall back to a fresh
save. Add a `migrate()` step keyed on `version`. It saves **after every cleared wave
and when a match ends**, so closing the tab loses at most one wave.

The headless screenshot harness always starts with empty storage, so add a
`?save=dev` URL flag that seeds a fixed team at mid levels.

## XP

**XP is paid only when a creep faints**, split among the towers that helped. A leaked
creep pays nothing. Each creep's reward is a fixed pool, so a titan can't be farmed
for damage.

```
pool      = species.expYield * creepLevel / 5 * threatMult   (normal 1, elite 2, titan 5)
share(t)  = contribution(t) / Σ contribution
gain(t)   = pool * share(t) * levelScale(t.level, creepLevel)
```

- **Contribution** is damage actually dealt (overkill excluded) plus, for each status
  landed, 15% of the creep's max HP. Control towers earn a fair share.
- **`levelScale`** uses the Gen 5 scaled-XP formula,
  `((2L_c + 10) / (L_c + L_t + 10))^2.5`. An over-leveled team earns little on easy
  maps, so the anti-grind rule is built in.
- **Wave clear:** every placed tower gets 10% of the wave's total pool. Bench members
  get nothing unless Exp. All is unlocked (see Later).
- **Curve:** medium-fast, `xp(level) = level³`. Soft cap at Lv 50 for now.

**Creep levels** go on `CreepConfig.level`. All maps share one wave list, so the map's
difficulty applies an offset: roughly easy Lv 3–12, medium Lv 12–28, hard Lv 25–45.
Elites get +3 levels and titans +8. A caught Pokémon keeps the level of the creep.

### Attribution plumbing

- Pass `source: Tower` to `resolveMoveHit` and store it on `Projectile`.
- `Creep` keeps `contributors: Map<Tower, number>`. Both `takeDamage` and
  `applyStatus` take the source. Burn/poison damage over time credits whoever applied
  the status.
- `onFaint(creep)` → `Progression.awardKnockout(creep)` → updates `OwnedPokemon.xp`
  on each contributing tower → `Tower.onLevelUp`, which refreshes modifiers, checks
  evolution and flashes the move shop.

## In-match changes

- **`Tower`** is built from an `OwnedPokemon` (plus its `SpeciesDef`) instead of a
  template:
  - `evolutionStage` reads from the owned record.
  - `getUpgradeBlockReason` returns `'needs_level'` with the required level.
  - `evolve()` is triggered by level, not a purchase.
  - `update()` applies the rate modifier to cooldowns.
- **`resolveMoveHit`** applies the damage and status modifiers from the source tower.
- **`StadiumTDGame`:**
  - `loadMap` receives the chosen team.
  - The roster is the team plus this match's catches.
  - A new placement block, `'already_deployed'`.
  - `onEvolveTower` is removed.
  - `finishCapture` creates an `OwnedPokemon`.
- **Announcer** uses nicknames: new `level_up` trigger ("SPARKY GREW TO LV 17!"), and
  `tower_evolve` uses the nickname.

## UI

1. **Starter select** (first launch only): Bulbasaur, Charmander or Squirtle at Lv 5,
   plus a gift Pikachu. Nickname prompt for each.
2. **Team select**: a new step between map select and match start.
   - Six slots on top, collection grid below.
   - Shows the map's threat types, taken from the wave list.
   - Each collection card gets a matchup badge (strong / weak / neutral) from `TypeMatrix`.
3. **Roster during a match**: one card per team member with nickname, Lv, and an XP
   bar. Dimmed while placed.
4. **Tower panel**:
   - The header shows nickname · Lv · XP bar.
   - Locked tier pips say `LV 16`.
   - The evolution track becomes read-only: "EVOLVES AT LV 16".
5. **Nickname prompt** at the capture verdict / `showCaptureTrophy`: "Give a nickname to
   PIDGEY?", with a skip option. Also offered when you get a starter.
6. **Summary screen**, opened from team select or the collection:
   - `RosterModelView` model.
   - The three stats, with DV quality shown as stars.
   - The learnset by line, with unlock levels.
   - Record (KOs, caught where and when), plus a rename button.
7. **Match results**: XP gained per member, level-ups, evolutions, new catches.

## Phases

Each phase leaves the game playable.

1. **Data foundation.**
   - Add `SpeciesDef` (converted from `TOWER_TEMPLATES`), `OwnedPokemon`, `TrainerStore`,
     `computeStats`.
   - `Tower` is built from `OwnedPokemon`.
   - Seed saves own the current six at a fixed level so nothing changes for the player yet.
2. **XP & levels.**
   - Attribution plumbing, knockout XP pool, level-ups and evolution mid-match.
   - `requiresLevel` gating and stat modifiers.
   - Tower panel shows Lv/XP and level locks.
   - Creep levels in `WaveManager`.
3. **Team & ownership.**
   - Team select screen, one tower per Pokémon, starter select.
   - Seed saves move to the starter flow.
4. **Persistent catches.**
   - Species defs for creeps, and `OwnedPokemon` created on capture.
   - Nickname prompt, bonus slot during the match.
   - Capture safety net (trainer's luck, guaranteed early catch).
5. **Collection & presentation.**
   - Summary screen, rename, match results screen, announcer nickname lines.
6. **Tuning.**
   - Adjust XP pool, level offsets, stat multiplier curve and starting team size.

## Capture safety net

A new player starts with two Pokémon and has to catch the rest. Bad luck must
never leave them with empty hands. A ball can only be thrown at a creep that is
weakened enough (`CATCH_HP_FRACTION`, 35% HP), so a ball is only spent on a real attempt.

Catching starts from the target, not the ball. Each catchable creep gets a floating
CATCH tag, and the capture kit's CATCH NOW tray lists them all, even ones off screen.
A tag or chip opens a picker with each ball's count and odds; Q cycles targets and
1–3 throw while the picker is open.
On top of that:

- **Trainer's luck:** a persistent counter in `TrainerSave`. Each failed catch adds
  +12% to the next attempt. It resets to 0 on a success and applies to every ball type.
- **Guaranteed early catch:** while the collection has fewer than 4 Pokémon, the
  **last ball in hand always catches**. The capture sequence still plays in full
  (release meter, wobbles), but the verdict is fixed to success. Titans are the only
  exception.
- **Starting balls:** 5 Poké Balls on the player's first match, then 3 as today.

With both rules, running out of balls always gets you at least one catch. You can
still lose streaks, so catching stays tense.

## Decisions

- **Starting team:** choose Bulbasaur, Charmander or Squirtle at Lv 5, plus a gift
  Pikachu at Lv 5. Everything else is caught.
- **Deploy cost is the same at every level.** Level already raises the ceiling.
- **No bench XP by default.** Later it becomes an unlockable item: **Exp. All**
  (the Gen 1 item) shares a portion of XP with team members that aren't placed.

## Later

- Items bought with prize money that lasts between matches: Exp. All, evolution
  stones, TMs, Rare Candy. Kept out of v1.

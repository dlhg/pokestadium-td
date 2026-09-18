# Cup Rules — Design & Implementation Plan

Each map belongs to a **cup** with a Pokémon Stadium-style entry rule: a Pokémon
can enter only if its level is at or below the cup's entry limit. During the match
it levels up, but no higher than the cup's level cap, and that XP is kept.
Rentals fill team slots when you don't own enough eligible Pokémon.

Status: **phase 1 shipped** (cup data, creep levels, XP cap, catch clamp, map
select). Phases 2–5 are planned. This extends `trainer-progression.md`. Where the
two disagree, this doc wins.

## Why

Levels are saved between matches, but enemies don't get stronger in return. In
`creepLevel()` the map's difficulty only raises creep *level*. That changes the
XP they give and the level they're caught at, but never how hard they fight. And
`hpScale()` is the same on every difficulty. The result is that the player's power
keeps growing with no upper limit, depends on their whole save history, and can't
be balanced against.

Cups put a ceiling on it. A Pokémon's strength during a match is limited by the
cup's level range, so every map has a known worst case to tune for. It's also a
rule Pokémon players already know, so it needs no special explanation. Real
Stadium did the same with the Little, Poké and Prime Cups and their rentals.

Rejected alternatives:

- **Scale enemies to the player's level.** This is the Oblivion problem: when the
  world keeps pace with you, leveling up stops meaning anything.
- **Reset levels every match.** Nothing carries over between matches.
- **Scale every entrant to the cup's level, down as well as up.** Your Charizard
  would appear as a Charmander. That needs explaining and could read as a bug.

## Core rules

| Rule | Detail |
| --- | --- |
| **Entry** | A Pokémon may join the team if `level ≤ cup.entryMax`. There's no minimum, so bringing an underleveled Pokémon is the player's own choice. |
| **Cap** | XP during the match stops at `cup.levelCap`. Gains up to the cap are saved as they are today. |
| **Outgrowing** | Once a Pokémon's level passes `entryMax`, it can't enter that cup again. This is intended: your team moves up the cups. |
| **Chain** | Each cup's `levelCap` falls inside the next cup's entry window, so a Pokémon that maxes out one cup qualifies for the next one. |
| **Rentals** | Empty team slots can be filled from the cup's rental pool. Rentals level up during the match, but that XP isn't saved, they never join the collection, and they can't be caught. |
| **Catches** | A catch keeps the creep's level, clamped to `levelCap`. It can join the match as a guest even if it's above `entryMax`, because it was caught here. |

### Cups

The brackets are built around the Gen 1 evolution levels in `Species.ts`. First
evolutions happen at 16–30, and final ones at 32–50.

| Cup | Maps | Entry | Cap | Creep levels | Win round |
| --- | --- | --- | --- | --- | --- |
| Little | Viridian Gardens, Mt. Moon Pass | ≤ 10 | 20 | 3 → 20 | 40 |
| Poké | Cerulean Crossing, Power Plant | ≤ 22 | 32 | 12 → 32 | 60 |
| Great | Indigo Plateau, Bell Tower | ≤ 34 | 42 | 22 → 42 | 80 |
| Prime | Mt. Silver Crown, Seafoam Islands | ≤ 50 | 50 | 32 → 50 | 80 |

Each cup has two maps. Mt. Moon's long, forgiving route moves down to the Little Cup,
and Power Plant and Bell Tower each move down one cup from their old "hard" label.

**Cups unlock in order.** The Little Cup is always open. Each later cup opens once
any map in the cup below it has been cleared. Unlocks are worked out from
`TrainerSave.maps`, so existing saves unlock whatever their past clears have earned.
There's no new save field.

Elites get +3 levels and titans +8 on top of the creep range, and nothing goes
above `MAX_LEVEL`. At the moment easy creeps reach about Lv 39 by round 40, so
Viridian catches will be much lower level than they are now.

What happens during a match in each cup: in the Little Cup the starters, Pidgey
and Magikarp evolve for the first time. The Poké Cup covers most other first
evolutions. The Great Cup is where middle forms reach their final form. Only the
Prime Cup reaches Rhydon (42) and Dragonite (50).

## Data model

```ts
// Cups.ts — replaces MapDifficulty as the map's progression key
export type CupId = 'little' | 'poke' | 'great' | 'prime';

export interface CupRules {
  id: CupId;
  name: string;               // 'LITTLE CUP'
  entryMax: number;
  levelCap: number;
  creepLevels: [from: number, to: number];
  winRound: number;
}

export const CUPS: Record<CupId, CupRules>;

export interface StadiumMap {
  // difficulty: MapDifficulty   → removed
  cup: CupId;
  ...
}
```

- `WIN_ROUNDS[difficulty]` becomes `CUPS[cup].winRound`. It's used in
  `WaveManager` and in `openingThreatTypes` in `TrainerScreens.ts`.
- `creepLevel(round, cup, threat)` interpolates from `creepLevels[0]` to
  `creepLevels[1]` over rounds 1 → `winRound`. `DIFFICULTY_LEVEL_OFFSET` is removed.
  In freeplay, creep levels stay at the top of the range.
- Creep level still has no effect on combat. HP scaling for each cup belongs to the
  balance-lab work, not this plan.

### Rentals

```ts
// progression/Rentals.ts
export interface RentalDef { speciesId: string; level: number }
export const RENTALS: Record<CupId, RentalDef[]>;   // ~10–14 per cup, level = entryMax − 2

export function createRental(def: RentalDef): OwnedPokemon;
// createPokemon(...) with origin.kind 'rental', fixed DVs of 8, uid prefix 'rental_'
```

No separate battle copy is needed. Today towers hold the saved `OwnedPokemon` and
XP changes it in place. A rental is simply an `OwnedPokemon` that is never added to
`store.data.collection`, so `commit()` never writes it. `MatchProgress.report()`
already skips uids that `store.get()` can't find. Instead, it will list rentals
under a "Rental" tag with the XP they gained that match.

`origin.kind` gains `'rental'`. `migrate()` doesn't need to accept it, because
rentals are never saved. There's no save version bump. Saved `level` and `xp` keep
their meaning.

## Code changes

- **`Stats.ts`**
  - `creepLevel` takes the cup.
  - `DIFFICULTY_LEVEL_OFFSET` is removed.
  - New `isEligible(pokemon, cup)`.
- **`TrainerStore.ts`**
  - `gainXp(pokemon, amount, cap = MAX_LEVEL)`: XP stops at `xpForLevel(cap)`.
  - Everything else stays the same.
- **`MatchProgress.ts`**
  - Constructed with the match's cap, which it passes to `gainXp`.
  - The report includes rentals.
- **`StadiumTDGame.ts`**
  - `loadMap` builds the roster as eligible team members plus the rentals picked for
    this match, instead of `[...this.store.team]` at `:393`.
  - `createCaughtPokemon` clamps the catch level to `levelCap`.
  - Rentals are never offered to the capture or research flows.
- **`WaveManager.ts`**
  - Takes `CupRules` instead of `MapDifficulty`.
  - `winRound` comes from the cup.
- **`Cups.ts`**: `CUPS` and `CUP_ORDER`. It's kept separate from `MapCatalog.ts`
  so that `Stats.ts` doesn't pull in the course data.
- **`MapCatalog.ts`**: `cup` on each map.
- **Wave stage names**: the first ten rounds were labeled "POKE CUP" and "PRIME
  CUP" in the top bar. They're renamed QUALIFIERS and MAIN DRAW so they don't
  clash with the map's cup.
- **`DevPanel.ts`**
  - "Fill with rentals" button.
  - Cup override, for testing any map under any cup's rules.

## UI

1. **Map select** (`StadiumUI.ts:1506`)
   - The EASY/MEDIUM/HARD filter becomes LITTLE/POKÉ/GREAT/PRIME tabs.
   - Each card shows "LV ≤ 10 · CAP 20" in place of the difficulty badge.
   - Locked cups show their maps with a padlock and "Clear a LITTLE CUP map to
     unlock." They can't be selected.
   - A newly unlocked cup gets a "NEW CUP" callout in the match report and a pulse
     on its tab.
2. **Team select** (`TrainerScreens.ts`)
   - A cup rules banner at the top: "LITTLE CUP — Pokémon LV 10 and under. Your
     team can grow to LV 20 this match."
   - Ineligible collection cards are dimmed with "LV 14 — over the limit." They
     stay visible so the player understands why.
   - When a saved team member is ineligible, its slot opens up for this match.
     The saved team itself isn't changed.
   - A **Rentals** tab next to the collection. Rental cards look the same, with a
     RENTAL ribbon.
   - **Outgrow warning**: when a Pokémon is within 2 levels of `entryMax`, its
     card shows "Last runs in LITTLE CUP."
   - Starting with empty slots is allowed. A "Fill with rentals" button fills them.
   - **Veteran notice**: the first time a player opens a cup where nothing they own
     qualifies, a short one-time popup explains the entry rule and points to the
     Rentals tab. Whether it's been shown is remembered in a localStorage key, as
     with the other one-time tips in `StadiumUI.ts`, not in the save.
3. **Match report**
   - "SPARKY outgrew LITTLE CUP" when a Pokémon passes `entryMax`, together with
     the level-up line.
   - "Now eligible for POKÉ CUP" when this is the first Pokémon to qualify.
4. **Tower panel**: at the cap, the XP bar shows "CUP CAP" instead of progress.

## Tests

Add to `test_gameplay_regressions.mjs`:

- Eligibility: `level ≤ entryMax` can enter, above it cannot.
- XP stops at `levelCap`, and evolution still fires below the cap.
- Rentals: they gain XP during the match, a commit leaves them out of the save,
  and they appear in the report.
- `creepLevel` covers each cup's range, with elite/titan bonuses capped at
  `MAX_LEVEL`.
- A catch in a low cup is clamped to `levelCap`.
- The chain: each cup's `levelCap ≤` the next cup's `entryMax`.

Also add an **XP pacing script**, a cheap first piece of the balance lab. It is
headless and assumes every creep is knocked out. For each cup it prints the round at
which a team entering at `entryMax` reaches `levelCap`, and the same for a team
entering 5 levels lower. The target is reaching the cap at about 75–85% of `winRound`.

## Phases

Each phase leaves the game playable.

1. **Cup data and levels.**
   - `CUPS`, `cup` on each map, `creepLevel` by cup, XP cap, catch clamp.
   - Map select labels.
   - No entry enforcement yet.
2. **Entry rules.**
   - Eligibility in team select, ineligible slots opened for the match.
   - Outgrow warning and cup-rules banner.
   - Cup locks by clears in map select, and the "NEW CUP" callout.
3. **Rentals.**
   - `Rentals.ts` pools, Rentals tab, "Fill with rentals".
   - Rentals in the match report, dev panel button.
   - The one-time veteran notice.
4. **Presentation.**
   - Match-report "outgrew" and "now eligible" lines, tower panel "CUP CAP".
   - Update `trainer-progression.md` (core rules table, creep levels) and `AGENTS.md`.
5. **Tuning.**
   - Use the XP pacing script to retune `THREAT_XP`, `WAVE_CLEAR_SHARE` and the
     curve so each cup reaches its cap on schedule.
   - Adjust brackets once playtests have happened.

## Decisions

- **Cups unlock in order.** A cup opens once any map in the cup below it has been
  cleared. The Little Cup is always open.
- **Two maps per cup.** Mt. Moon Pass moves down to the Little Cup, and Power Plant
  and Bell Tower each move down one cup (see the Cups table).
- **Rentals enter 2 levels below `entryMax`.** They're viable, but a well-raised
  Pokémon of your own is a bit better.
- **Veterans get a one-time notice** the first time they open a cup where nothing
  they own qualifies. It points them to the Rentals tab.

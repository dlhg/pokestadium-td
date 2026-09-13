# Tower Roles — Design Plan

Towers today are hard to tell apart. Every species has the same three move lines
(Special / Coverage / Control), all three fire at once, most lines end in Hyper Beam
or Toxic, and a move's delivery type changes only how it looks. In practice range is
the only thing that sets towers apart, so placement rarely matters.

This plan gives every tower a clear job, makes the player commit to one direction per
tower each match, and adds a few moments where the player steps in, without turning
the game into a juggling act.

## Goals

- **Every tower has one clear job**, readable the moment it is placed.
- **Placement matters.** Straightaways, hairpins, water and high ground each favour
  different towers.
- **Choices per match.** Two Pikachus on the same map can play differently.
- **Hands-on at the right moments.** Plan between rounds, watch during normal waves,
  step in for elites and Titans.
- **Little to memorise.** Use rules Pokémon players already know; show everything else.

## Non-goals

- A long list of enemy abilities. Creeps get exactly three traits.
- Constant micromanagement. Signature moves are a bonus, not a chore; ignoring them
  must never lose a round the towers could otherwise hold.
- Changing trainer progression. Levels, XP, evolution and catching stay as described
  in [trainer-progression.md](trainer-progression.md).

## At a glance

| Today | Proposed |
| --- | --- |
| Three move lines fire on separate timers | **One basic attack** that upgrades change |
| Every line can be bought to the top | **Paths with a cap:** two paths at most, only one to tier 3 |
| Tier 3 is a bigger passive attack | **Tier 3 unlocks a signature move** the player triggers, limited by PP |
| Beam, cone and field only look different | **Hit shapes are real:** beams pierce, cones spray, fields ring |
| Creeps are type + HP + speed | **Three creep traits** tied to type: Airborne, Phantom, Armored |
| Same line labels for every species | **Species-specific paths** built around one role |

---

## 1. One basic attack

Each tower has a single **basic attack** that fires on its own, forever. It defines the
tower's role: Pikachu shoots fast bolts, Charmander sprays short-range fire.

Path upgrades **change the basic attack** rather than adding a second or third one:

- how many creeps it hits (chains, pierce, a wider shape)
- what it leaves behind (a status, a lane hazard)
- how fast or hard it hits (rate, damage, *Heavy*)
- an aura around the tower (a slow, a buff to nearby towers)

The tower model plays one recognisable attack, and the player reads its job from it.

## 2. Paths with a cap

Every species has three **paths**, each three tiers deep, with names and themes of its
own (Pikachu: *Storm*, *Static*, *Agility*). The cap:

- **Buy into two paths at most.** Buying into a second path closes the third.
- **Only one path can reach tier 3.** The other stops at tier 2.

Legal builds: `3-2-0`, `3-1-0`, `2-2-0`, `2-1-0` and so on, in any path order.

Unchanged from today: level gates each tier (`requiresLevel`), prize money buys it,
tiers reset every match, and selling refunds 70% of the total spent. Because tiers
already reset every match, **no save migration is needed**.

**Shop panel:** three path columns with tier pips. A closed path is dimmed with a
`PATH CLOSED` label, and the tier that would close it warns first
(`Buying this closes GROWTH`).

## 3. Signature moves and PP

Tier 3 of every path unlocks that path's **signature move**. You don't get a button
until you've fully committed to a path, so the button bar grows slowly with investment.

- **PP, not cooldowns.** Each signature has 1–2 PP. PP refills at the start of every
  round and does not carry over. The decision is "now, or save it for the elite?",
  not watching timers.
- **The signature bar** sits along the bottom of the screen: portrait, move name, PP
  pips, hotkey (`1`–`9` in placement order). Only towers with a tier-3 path appear.
- **Targeting** is one of:
  - `instant`: fires around the tower immediately (most signatures)
  - `aimed`: click a point or direction on the map (a few big ones)
  - `auto`: picks its own target, e.g. the strongest creep on the map
- **Presentation:** the announcer calls it ("PIKACHU, THUNDER!") and the action cam
  cuts in for under a second without pausing the game. A setting turns the cut off.
- **Ignoring it is fine.** Balance normal waves so they can be held without signatures.
  Signatures are for elites, Titans and saving a leak.

## 4. Real hit shapes

`DeliveryType` stops being visual-only. Each shape decides what gets hit:

| Delivery | Hits | Best placement |
| --- | --- | --- |
| `projectile` | The target, plus splash if the move has it. Travels, so it can miss fast creeps. | Anywhere |
| `beam` | Every creep on the line from tower to target, out to full range (pierce). | End of a long straightaway |
| `cone` | Every creep inside an arc facing the target. | Inside a hairpin or bend |
| `field` | Every creep in a ring around the **tower**. | Where the lane loops around a spot |
| `aura` | Constant effect on creeps in range; no targeting. | Choke points |
| `hazard` *(new)* | A patch on the lane that affects creeps that walk through it. | Just before a choke point |

Hazards and auras **never target**. This matters for Phantoms (below).

## 5. Creep traits

Exactly three traits, each tied to a type players already know. A creep's traits come
from its types; there is no separate authoring.

| Trait | Given to | Rule | What beats it |
| --- | --- | --- | --- |
| **Airborne** | Flying (either type slot) | Unaffected by lane hazards and `field` shockwaves. Ground moves already do 0×. | Projectiles, beams, cones |
| **Phantom** | Ghost (either type slot) | Towers can't **target** it. It still takes splash, pierce, cone, hazard and aura damage. | Psychic- and Ghost-type towers (they can target it); any untargeted attack |
| **Armored** | Rock (either type slot) | **Light** hits deal 50%. **Heavy** hits deal full damage. | Heavy moves, fixed damage (Seismic Toss, Night Shade) |

**Heavy** is a flag on a move, shown as a `HEAVY` chip on the tower card. Fixed-damage
moves are always Heavy. Most basic attacks are Light; big tier-3 hits are Heavy.

**Titans resist control.** Moves that stop a creep (sleep, freeze, stun, trap) only slow
a Titan instead, and slows last half as long. Titans keep their existing HP and
presentation.

**Teaching it:**

- A trait badge sits beside the creep's HP bar.
- The first time a trait appears in a save, the announcer calls it out and a one-line
  banner explains it ("PHANTOMS — only Psychic and Ghost towers can aim at them").
- The tower card shows at most three chips: `HEAVY`, `SEES PHANTOMS`, `GROUND ONLY`.

## 6. Status clean-up

Keep the five statuses, but stop them overwriting each other. A creep carries at most
**one damage-over-time** (burn or poison) **and one movement effect** (slow, paralyze,
sleep, stun) at the same time, so a control tower no longer cancels a burn tower.

Two statuses get clearer identities:

- **Sleep** stops the creep until it is hit.
- **Paralyze** slows the creep and it sometimes freezes in place for a moment.

---

## 7. Starter paths

Placeholder costs; tier 3 requires the final-form level, as tier 3 does today.
**Light** unless marked **Heavy**.

### Bulbasaur: the groundskeeper

*Controls the lane with hazards instead of hitting hard.*
**Basic attack:** Vine Whip. `projectile`, short range, fast.

| Path | Tier 1 · $100 | Tier 2 · $220 · Lv 12 | Tier 3 · $400 · Lv 32 |
| --- | --- | --- | --- |
| **Spores** | Every 4th attack drops a **Stun Spore** `hazard` that paralyzes | Patches become **Sleep Powder**: bigger, last longer, put creeps to sleep | **Signature: Spore Carpet** · `instant` · 2 PP. Blankets every lane in range with sleep powder for 4 s |
| **Razor** | Attack becomes **Razor Leaf**: a narrow `cone` | Wider cone, crits deal double | **Signature: SolarBeam** · `aimed` · 1 PP. 1.5 s charge, then a map-length **Heavy** `beam` |
| **Growth** | **Leech Seed**: seeded creeps drain until they faint | When a seeded creep faints, the seed jumps to the nearest creep | **Signature: Growth** · `instant` · 2 PP. Towers in range attack 50% faster for 8 s |

Handles Phantoms without help (hazards don't target). Hazards miss Airborne creeps.

### Charmander: the flamethrower

*Short range, shreds groups. Belongs inside bends.*
**Basic attack:** Ember. `projectile`, may burn.

| Path | Tier 1 · $130 | Tier 2 · $240 · Lv 16 | Tier 3 · $420 · Lv 36 |
| --- | --- | --- | --- |
| **Inferno** | Attack becomes **Flamethrower**: a `cone` | Wider, longer cone; every hit burns | **Signature: Fire Blast** · `aimed` · 1 PP. Huge **Heavy** blast at a point |
| **Wildfire** | Hits leave a burning `hazard` on the lane for 3 s | **Fire Spin**: creeps in the fire are briefly trapped | **Signature: Blaze** · `instant` · 1 PP. Every burning creep on the map takes its remaining burn damage at once |
| **Rage** | **Rage**: each hit on the same target deals more, resetting when the target changes | **Slash**: attacks are **Heavy** and can crit | **Signature: Fly** · `auto` · 2 PP. Charizard dives on the strongest creep on the map for a massive **Heavy** hit |

The Rage path is the Titan killer and the Armored answer. Wildfire hazards miss Airborne creeps.

### Squirtle: the hydrant

*Holds creeps back. Belongs at the end of a straightaway.*
**Basic attack:** Water Gun. `projectile`, slight slow.

| Path | Tier 1 · $120 | Tier 2 · $230 · Lv 16 | Tier 3 · $400 · Lv 36 |
| --- | --- | --- | --- |
| **Pressure** | Attack becomes **BubbleBeam**: a `beam` that pierces 3 creeps | Pierces every creep in the line | **Signature: Hydro Pump** · `aimed` · 1 PP. 3 s sweeping **Heavy** `beam` |
| **Chill** | Hits slow by 30% | Passive `aura`: creeps in range move 25% slower | **Signature: Blizzard** · `instant` · 1 PP. Freezes every creep in range solid for 3 s |
| **Surf** | Attacks send out a small `field` ring | Ring knocks non-Titan creeps back a short distance | **Signature: Surf** · `instant` · 2 PP. A wave rolls back up the lane toward the spawn, pushing creeps back |

The Chill aura touches Phantoms. Surf rings miss Airborne creeps.

### Pikachu: the striker

*Fast single-target damage that learns to chain.*
**Basic attack:** ThunderShock. `projectile`, very fast.

| Path | Tier 1 · $100 | Tier 2 · $210 · Lv 10 | Tier 3 · $380 · Lv 26 |
| --- | --- | --- | --- |
| **Storm** | **Thunderbolt**: hits chain to 2 more creeps | Chains to 4 | **Signature: Thunder** · `aimed` · 2 PP. A **Heavy** strike with big splash anywhere on the map |
| **Static** | Hits may paralyze | Paralysis spreads to creeps next to the target | **Signature: Thunder Wave** · `instant` · 1 PP. Paralyzes every creep in range for 4 s |
| **Agility** | Attacks 25% faster | Attack becomes **Quick Attack** (Normal type) and fires 60% faster | **Signature: Agility** · `instant` · 2 PP. Triple fire rate for 5 s |

Agility tier 2 is the Ground-type answer: Normal hits what Electric can't.
Chains and paralysis spread don't target, so Storm and Static can reach Phantoms.

---

## 8. Roles for the rest of the roster

One line each; full paths come in phase 4. The goal is that no two species share a job.

| Species | Role | Standout |
| --- | --- | --- |
| Abra line | Sniper | Map-wide range, slow single-target; sees Phantoms |
| Gastly line | Trickster | Confuse Ray sends creeps walking backwards; sees Phantoms |
| Geodude line | Bomber | **Heavy** splash; can't hit Airborne |
| Machop line | Brawler | Short range, **Heavy**, Titan damage bonus |
| Onix | Wall | Blocks a stretch of lane until creeps break through |
| Rhyhorn line | Mortar | Slow `aimed` Earthquake at a chosen spot on the lane |
| Voltorb line | Burst | 360° `field` burst; Electrode can Self-Destruct |
| Ponyta line | Spin-up | Fire rate climbs while it keeps firing, drops when idle |
| Scyther | Duelist | Fastest single-target attack in the game |
| Pidgey line | Patroller | Pidgeot flies a loop along the lane |
| Zubat line | Hunter | Seeks out Airborne and fast creeps |
| Oddish line | Poisoner | Poison hazards that stack with other status towers |
| Paras line | Spore trap | Slow but long-lasting sleep hazards |
| Exeggcute line | Scatter | Attacks split into several egg bombs |
| Psyduck line | River guard | Bonus range next to water; Confusion |
| Lapras | Frost aura | Big chill aura; must stand next to water |
| Magikarp line | Late bloomer | Useless until Gyarados, then a rampaging beam |
| Dratini line | Carry | Weak for a long time, strongest tower at full level |
| Rattata line | Utility | Cheap; Super Fang removes a % of HP |

---

## 9. Data model sketch

```ts
// MoveDatabase.ts
export type DeliveryType = 'projectile' | 'beam' | 'cone' | 'field' | 'aura' | 'hazard';

export interface MoveDefinition {
  // …existing fields
  heavy?: boolean;
  chain?: number;           // extra creeps a hit jumps to
  pierce?: number;          // beam: creeps passed through; Infinity for full line
}

// Species.ts
export interface PathTier {
  name: string;             // "Thunderbolt"
  cost: number;
  requiresLevel?: number;
  effects: TierEffect[];    // applied in order on top of the basic attack
  description: string;
}

export type TierEffect =
  | { kind: 'replaceAttack'; moveId: string }
  | { kind: 'modifyAttack'; patch: Partial<MoveDefinition> }
  | { kind: 'rate'; multiplier: number }
  | { kind: 'onHitStatus'; status: StatusEffectType; chance: number; duration: number }
  | { kind: 'hazard'; hazardId: string; everyNthAttack: number }
  | { kind: 'aura'; auraId: string }
  | { kind: 'signature'; signatureId: string };

export interface PathDef {
  id: string;
  label: string;            // "STORM"
  blurb: string;
  tiers: [PathTier, PathTier, PathTier];   // tier 3 carries the signature
}

export interface SignatureMove {
  id: string;
  name: string;
  pp: number;
  targeting: 'instant' | 'aimed' | 'auto';
  heavy?: boolean;
}

export interface SpeciesDef {
  // …existing fields
  basicAttack: string;      // moveId
  paths: [PathDef, PathDef, PathDef];      // replaces `lines`
}

// Creep.ts
export type CreepTrait = 'airborne' | 'phantom' | 'armored';
export function traitsFor(types: PokemonType[]): CreepTrait[];
```

`Tower` keeps `tiers: number[]`, adds `canBuy(path)` for the cap, builds its effective
basic attack by folding tier effects over `basicAttack`, and tracks `pp` per round.

## 10. Rollout

Each phase is playable on its own.

1. **Hit shapes and creep traits.** Real `beam` / `cone` / `field` resolution in
   `MoveDelivery.ts`, traits and badges in `Creep.ts`, Titan control resistance, status
   slots. No species changes. *Check: does placement start to matter?*
2. **Paths and the cap.** New `SpeciesDef` shape, the four starter designs above, shop
   panel with closed paths. Unconverted species run through an adapter that treats
   their old lines as paths with the cap applied.
3. **Signature moves.** Signature bar, PP refill per round, targeting modes, announcer
   lines and action-cam cut.
4. **The rest of the roster.** Full paths for every species from the roles table;
   delete the adapter and retire shared Hyper Beam / Toxic tiers.

## Decisions

Resolved for the first playable build. Each is a constant or a data edit, so
playtesting can move them.

- **Cap:** `3-2-0`. One constant (`SECONDARY_PATH_MAX_TIER`).
- **Tier-3 level gate:** the middle form's level (Bulbasaur/Charmander/Squirtle Lv 16,
  Pikachu Lv 18), so signatures arrive early enough to playtest. Tier 2 is Lv 8.
  This overrides the tier-3 levels in the starter tables above.
- **Round 6:** a few Zubat escorts join the Haunters so a starter team always has
  something to aim at.
- **Round 3:** armor stays at 50% (`ARMOR_LIGHT_MULTIPLIER`); tune after playtesting.
- **PP carry-over:** none.
- **Auto-cast:** not in this build.
- **Water placement:** deferred. Psyduck and Lapras get roles that don't need water.
- **Hotkeys:** `1`–`9` call signatures in bar order, so camera modes moved from
  `1`–`3` to `C` (cycles tactical → stadium → action).
- **Aimed signatures** come in two kinds: `point` (click a spot) and `line` (click a
  direction from the tower). Casting is blocked while paused.
- **Trait callouts:** shown the first time a trait appears in each match, not once per
  save, so there is no save schema change.

## Build checklist

Tick each box as it lands. Each phase ends with `npm run build`,
`npm run test:gameplay`, a screenshot, and a commit.

### Phase 1 · Hit shapes and creep traits

- [x] `MoveDefinition` gains `heavy`, `pierce`, `coneAngle`; mark Heavy moves
- [x] `resolveMoveHit` resolves by shape: projectile (target + splash), beam (line
      to full range), cone (arc), field (ring around the tower), aura (target + splash)
- [x] Beam / cone / field visuals match what they hit
- [x] Creep traits from types: Airborne, Phantom, Armored
- [x] Airborne ignores `field`; Phantom can't be targeted except by Psychic/Ghost
      towers or untargeted shapes; Armored takes 50% from Light hits
- [x] Titans: stops become slows, durations halved
- [x] Status slots: one damage-over-time plus one movement effect; new `sleep` status
      that breaks on direct damage; Sleep Powder and Hypnosis use it
- [x] Trait badges on the HP bar; first-appearance callout each match
- [x] Round 6 escorts
- [x] Regression tests for shapes, traits and status slots

### Phase 2 · Basic attack and paths

- [x] `SpeciesDef.basicAttack` + `paths`; `PathTier.effects` folded over the basic attack
- [x] New move data the starter paths need (BubbleBeam, Rage, Slash, …)
- [x] `Tower` fires one attack; `canBuy` enforces `3-2-0` and level gates
- [x] Effects: replace attack, modify attack, rate, on-hit status, chain, hazard, aura,
      rage stacking
- [x] Lane hazards (`Hazard` entity: patches on the lane, miss Airborne)
- [x] Auras (passive slow, tower buff)
- [x] Bulbasaur, Charmander, Squirtle, Pikachu paths
- [x] Adapter so unconverted species still play (old lines become paths)
- [x] Shop panel: path columns, closed-path state and warning, tower chips
- [x] Placement preview, team/summary screens and dev save read the new shape
- [x] Regression tests for the cap and effect folding

### Phase 3 · Signature moves

- [x] Signature definitions; tier 3 unlocks one per path
- [x] PP per tower, refilled at round start
- [x] Signature bar with portraits, PP pips and hotkeys
- [x] Targeting: instant, aimed (click the map), auto
- [x] Each starter signature's effect
- [x] Announcer call and a short action-cam cut (setting to turn it off)
- [x] Regression tests for PP and refills

### Phase 4 · The rest of the roster

- [ ] Paths for the remaining 19 species from the roles table
- [ ] Remove the adapter and unused legacy moves
- [ ] Update `CLAUDE.md` subsystem notes

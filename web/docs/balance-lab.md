# Balance Lab — Measuring the Species Table

Two headless tools stand behind `Species.ts`:

| Command | What it does |
| --- | --- |
| `npm run test:species` | Validates the species table against everything it references |
| `npm run balance:towers` | Measures what every species is worth, per cup |

Both exist because the table is headed for all 151. At 23 lines a mistake is
visible by reading; at 151 it is not, and 151 independently hand-tuned cost
curves cannot be compared to each other by eye at all. This is the tower half of
the balance lab [cup-rules.md](cup-rules.md) asks for.

## `test:species` — the invariants the types cannot state

It collects every failure rather than stopping at the first, so a new batch of
species produces one complete list of what is wrong with it. It checks:

- **Forms** — base form at level 0, evolution levels strictly increasing and
  under `MAX_LEVEL`, positive base stats, no form name used by two species
  (`FORM_INDEX` maps creeps back by name, so a collision silently sends every
  catch of that creep to the wrong line).
- **Paths and tiers** — three paths of three tiers, unique path ids, costs that
  climb, level gates that never decrease, and a signature on tier 3 and nowhere
  else. A tier 1 may be gated only at one of the species' own evolution levels,
  and then on every path — the Magikarp shape, where the whole species waits for
  Gyarados. Anything else locks a path a player can never open.
- **References** — every move, signature and hazard id resolves, and every legal
  build folds through `buildAttackProfile` without throwing.
- **Dex and models** — every line has a `BASE_DEX` entry, no two forms claim the
  same number, and each number matches that Pokémon's name *in the extracted
  manifest*. `dexNumber()` assumes a line runs in consecutive dex order, which is
  false for several Gen 1 lines (Eevee, the fossils); this check is what catches
  it. Skipped with a notice when the ROM has not been extracted.
- **Creeps** — every name in `EARLY_ROSTER` and `ROSTER` maps onto a species
  form, and fights as the same types it will have once caught. A creep that fails
  this can be fought but never caught.
- **Rentals** — every pool species exists, nothing is listed twice, rentals enter
  at or under the cup's entry limit, and none of them rents at a level where only
  tier 1 is open on all three paths.

It also reports coverage (lines, forms, and how many extracted models still have
no species entry) and orphans — signatures no species unlocks, moves no tower or
signature fires, hazards no tower drops.

## `balance:towers` — the yardstick

One tower is stood beside a straight lane with a pack of creeps on it and run at
60 fps until the pack is down, through the real `buildAttackProfile`,
`rankTargets`, `collectVictims` and `hitDamage`. Hit shapes, pierce, cone width,
chains, armor, the type chart, Rage ramp-up, spin-up, hazard ticks and a
percent-HP bite that shrinks as it works all behave as they do in a match.

**It is a simulation, not a spreadsheet, for a reason.** An instantaneous damage
figure gets Super Fang wrong (its bite is a share of *current* HP), gets Rage
wrong (stacks build over time), and gets spin-up wrong. Time-to-clear gets all
three right for free.

### The assumptions, and why they are what they are

- **The defender panel is taken from the creep roster, not invented.** No single
  type is neutral to everything — an early version measured every tower against a
  Normal creep, which handed Machop a free 2x for being Fighting and made it read
  as 500% of median. Solo damage is now averaged over the six most common type
  lines in `EARLY_ROSTER ∪ ROSTER`, and the pack is dealt from the same six, so
  Airborne, Phantom and Armored traits land at their real frequency.
- **Both a solo target and a pack of six.** Ranking on pack damage alone rewards
  clumping and puts every splash tower on top; ranking on solo alone buries them.
  A species is only flagged when it is out of line at *both* jobs. Beating the
  field at one and trailing at the other is a specialist, which is the design.
- **Level cap, average DVs.** Each cup is measured at `levelCap` with DVs of 8,
  so a species is judged on its base stats rather than on a roll.
- **Crits at their expectation**, so two runs over the same table agree.
- **A run stops when the tower can neither target anything nor burn anything.**
  Otherwise an untargetable creep stretches the clock to the time limit and
  deflates every damage figure for towers that are merely type-locked.

### What it does not model

Pathing and leakage, several towers overlapping, signature moves (PP-limited and
player-triggered), and status effects beyond the damage they do. The `control`
column exists because of that last one: it scores what a tower takes out of the
lane so a controller is not read as a failed damage dealer. A tier 3 whose only
gain is its signature therefore shows as `t3: flat` — pure cost, as far as the
lab can see.

Read the columns as a ranking under one yardstick, not as damage any particular
match will show.

## What it found in the first 23

Run at the time of writing, across all four cups:

- **Strong at both jobs in all four cups:** Scyther, Lapras, Rattata, Gastly,
  Magikarp. Charmander in three, Abra, Dratini and Machop in two.
- **Weak at both jobs in all four cups:** Exeggcute. Rhyhorn in one.
- **Tier 3 adds no measurable damage** for Lapras, Squirtle, Geodude, Rhyhorn,
  Voltorb and Psyduck depending on cup — those tier 3s are carried entirely by
  their signature, which the lab cannot price. Worth confirming that is intended
  before the archetype layer copies the shape 128 more times.
- **Twelve of 23 cannot open a tier 3 inside the Little Cup's level cap**, so
  they field a partial build there. That is the cup doing its job, but it means
  Little Cup balance is really a contest between partial builds.
- **Three hazards (`spore_cloud`, `rock_wall`, `toxic_cloud`) are defined but no
  tower drops them.**

None of these are bugs; they are the questions the table cannot answer about
itself. Settle them at 23 species, because the archetype layer will copy whatever
shape is here across the rest of the Pokédex.

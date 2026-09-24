# Match Length, Hand-Made Finals & Course Titans — Design & Implementation

Matches are about a third as long as they were. Every cup walks its own slice of
the difficulty ladder, the last five rounds of every course are written by hand
for that course, and each final ends on a Titan of its own with one ability.

Status: **phases 1–4 shipped; phase 5 (tuning from playtests) next.** This
extends `cup-rules.md`; where the two disagree on win rounds or starting money,
this doc wins.

## Why

**Matches were too long for a game built on collecting.** Winning a course took
40, 60, 80 or 80 rounds. You progress by catching, leveling and evolving, and
each of those needed a long session across only 8 courses.

**Every cup started at the same difficulty.** `hpScale()`, the switch from
`EARLY_ROSTER` to `ROSTER`, the trait anchors, the Titan schedule and the stage
names all keyed off the absolute round and ignored the cup. Round 1 of the Prime
Cup sent Rattatas at 0.24× HP (labeled Lv 32) against a Lv 45–50 team.

**Money ran out of things to buy by round 12, in every cup.** Measured with
`npm run balance:economy`: income reached ~$6.4k by round 10 and ~$18k by round
20, while fully building a team of six costs about $7.5k. After round ~12 the
only thing left to buy was balls, which is feedback #31 ("too easy") from the
economy side.

**Waves came from a formula, not a design.** They were seeded and repeatable, but
nothing in them was built around a course's lanes or tested anything in
particular, and a course had no ending anyone would remember.

## Decisions

| Question | Decision |
| --- | --- |
| Win rounds | **Little 20, Poké 25, Great 30, Prime 30** |
| Hand-made finals | **One per course** (8), so each can use its course's layout and theme |
| Final length | **The last 5 rounds** of the match |
| After the win | **Freeplay stays.** Procedural, ramping from the cup's peak |
| Course Titans | **A unique Titan per course**, caught like any creep (legendaries included) |
| Titan abilities | **Enemies never touch towers.** A Titan changes itself or the lane |

## Core rules

| Rule | Detail |
| --- | --- |
| **Structure** | Rounds 1 … `winRound − 5` are procedural (QUALIFIERS, then MAIN DRAW). Rounds `winRound − 4` … `winRound` are the course's final (`FINAL 1/5` … `FINAL 5/5`). After that comes FREEPLAY. |
| **Round band** | Each cup has `roundBand: [from, to]`: the rounds of the *original* 40–80-round ladder its round 1 and win round play like (`equivalentRound`). Enemy HP, group counts, group sizes, spawn spacing, pace, the early/mid roster switch and elite frequency are all read off that ladder, so a shorter cup keeps every tuned relationship and just walks a slice of it faster. |
| **Teaching traits** | The trait anchors (rounds 1/3/6) and the lone-scout debut rule apply **only in the Little Cup**. Later cups field every group at full strength. |
| **Titans** | One generic Titan (Gyarados) halfway through the procedural rounds (`midTitanRound`), and the course's own Titan closing the final. Freeplay adds an Onix or Gyarados every 10th round. |
| **Milestones** | Every 10th round and the win round pay out. The 25-round milestone is gone; round 100+ stays for freeplay. |
| **Freeplay** | Keeps walking the ladder one round per round past `to`, plus today's compounding 1.045× per round. |

### Bands, money and XP (`Cups.ts`)

| Cup | Rounds | Band (ladder rounds) | Enemy HP (× round-10) | Starting money | Pay scale | XP scale |
| --- | --- | --- | --- | --- | --- | --- |
| Little | 20 | 1 → 40 | 0.24 → 5.8 | $420 | 0.19 | 2 |
| Poké | 25 | 10 → 60 | 1.0 → 12.2 | $1,500 | 0.085 | 2 |
| Great | 30 | 18 → 80 | 1.9 → 23 | $2,000 | 0.04 | 1.5 |
| Prime | 30 | 22 → 88 | 2.3 → 29 | $2,500 | 0.03 | 1 |

- **Peaks** keep the old win-round HP, so finales don't get easier, only sooner.
  Prime's peak moves up to round 88 of the ladder (29× HP): it used to peak at
  the same HP as the Great Cup while fielding a much stronger team.
- **Starts** sit at about 1/12 of the peak. Tower power comes almost entirely
  from upgrades bought in the match — a Lv 22 tower hits only ~17% harder than
  a Lv 10 one — so a cup can't open at its old mid-ladder HP without a matching
  bank. Starting money grows by cup instead, which also makes a veteran's
  opening a bigger build decision.
- **Pay** climbs with `hp^0.35` (was `hp^0.5`), times the cup's pay scale. Target
  (`balance:economy`): a fully built team of six at the cup's level cap is
  affordable around F3, the final's breather. Measured: round 19 of 20, 24 of
  25, 29 of 30 — money matters for the whole match.
- **XP** per knockout is scaled so a team entering at the limit still caps at
  75–85% of the win round (`balance:xp`). Measured: 80%, 84%, 83%, and Prime's
  Lv 45 entrant at 90%.

These are starting numbers. The real test is playtesting (phase 5).

## The final's shape

Every final uses the same five beats. The content of each belongs to the course.

| Beat | Round | Purpose | Budget |
| --- | --- | --- | --- |
| **Showcase** | F1 | The course's theme at full strength, down its lanes | 100% |
| **Exam** | F2 | Tests one trait or lane trick the course is built around | 110% |
| **Breather** | F3 | Lighter, pays 1.5×, full of catchables: last chance to buy and catch | 60% |
| **Gauntlet** | F4 | Elites with escorts timed to split attention | 125% |
| **Titan** | F5 | The course's Titan, plus an escort | 80% + the Titan |

**Budgets are relative, so finals retune with the bands.** A final is written as
a mix and a timing (`Finals.ts`): which creeps, how many, when (`at`), on which
route (`route`), and how tough relative to each other (`hp`). The game then
scales the crowd so its total HP and pay are the beat's share of a *standard
round* — what a typical procedural round of that round's scaling fields
(`standardRound`). The finale's Titan is 45% of a standard round on its own,
times its own `hp`: about twice a generic mid-match Titan.

**Crowds grow by cup, timing doesn't.** Finals are written at Little Cup size.
Later cups multiply each rank-and-file group (×1.5 / ×1.8 / ×2) and tighten its
spacing to match, so a group lasts exactly as written and timed tricks like two
entrances at once or two trails converging still line up.

### The eight finals

| Course | Cup | Exam (F2) | Titan (F5) |
| --- | --- | --- | --- |
| Viridian Gardens | Little | *Spore Wall*: a slow tanky Paras wall, then a Pidgey pass | **Beedrill** — the Hive Queen |
| Mt. Moon Pass | Little | *Rock Columns*: Armored Geodude and Graveler | **Onix** — the Rock Snake |
| Cerulean Crossing | Poké | *Twin Bridges*: two groups spaced to hold both bridges at once | **Starmie** — the Gem of the Sea |
| Power Plant | Poké | *Both Gates*: Haunters and Electrodes on both entrances at the same moment | **Zapdos** — the Thunderbird |
| Indigo Plateau | Great | *Over the Stairs*: Airborne Golbat and Scyther that hazards and fields can't touch | **Moltres** — the Firebird |
| Bell Tower | Great | *Restless Spirits*: a Phantom wave; tests the player's reveal answer | **Gengar** — the Shadow in the Bell |
| Mt. Silver Crown | Prime | *Converging Trails*: the east group leaves 8 s early so both reach the shared shelf together | **Mewtwo** — the Apex |
| Seafoam Islands | Prime | *Over the Ice*: a Lapras column plus flyers that skip the ice crossings | **Articuno** — the Frostbird |

`npm run test:finals` checks every final (beats in order, one Titan and only in
F5, every creep resolves and is caught as the typing it fights with, routes
exist, breathers pay extra) and prints each round against a standard round.

## Course Titans

Mt. Moon keeps Onix, and Gyarados becomes the mid-match Titan everywhere, so each
course's own Titan is the new thing. Beedrill, Starmie, Zapdos, Moltres, Articuno
and Mewtwo got species lines (Weedle and Staryu lines in full, the legendaries as
single forms), so every one of them can be caught. Legendaries gate tier 3 at Lv
30 (Mewtwo at 40) and deploy for $260–$320.

Titans stand at least 6 units tall on screen (grown up to 2.2× their Pokédex
size): at true scale a Titan Zapdos read as an ordinary creep under a Titan's HP
bar. Onix and Gyarados are already bigger than that.

### Abilities (`TitanAbility.ts`)

**The rule: enemies never touch the player's towers.** "Enemies only walk, towers
only shoot" is clean and learnable; a Titan instead changes itself or the lane,
which tests how the player built and placed rather than how fast they click.

| Titan | Ability | What it does | What it tests |
| --- | --- | --- | --- |
| Beedrill | Call Swarm | Drops 3 Weedle out of the trees beside it every 7 s | Clearing a crowd while focusing a boss |
| Onix | Dig | Underground for 2.6 s: nothing can target or hit it | Coverage along the whole route, not one spot |
| Starmie | Recover | Heals 5%/s after 2.4 s without a hit, spinning | Steady damage over bursts |
| Zapdos | Agility | Turns to lightning and jumps 12 units of lane | Defense in depth; a single choke gets jumped |
| Moltres | Fire Trail | Burning patches in its wake: +35% speed for creeps behind | Killing escorts before they catch its slipstream |
| Gengar | Shadow Fade | 3 s where no tower can aim at it, not even a seer | Hazards, auras and area attacks |
| Articuno | Haze | Wipes every status off itself and creeps within 9 units | A direct counter to stun-lock teams (#32/#37) |
| Mewtwo | Barrier | A shield (20% of its HP) only Heavy hits wear down; nothing gets through. Broken, Mewtwo is open for 8 s, then recovers 10% and raises another | Everything at once |

**One shared presentation, the way signatures got one (#28/#33):** a telegraph —
the Titan's own ROM attack clip, its cry, and a ring on the ground that swells and
strobes faster as it fills — then the cast: an announcer banner ("TITAN ZAPDOS
USED AGILITY!"), the move's name over the Titan, a signature flash and sting, and
an action-cam cut the first time each ability fires in a match (a shake after).
Each ability only adds its own effect, almost all of it reused:

| Ability | Built from |
| --- | --- |
| Agility | `JaggedBeam` (the catch tether, drawn solid so it reads on a pale floor) and `EnergyForm` |
| Shadow Fade | `EnergyForm` at low opacity |
| Fire Trail | Lane patches like `Hazard.ts`, tinted fire |
| Dig | Sinking the body, ground bursts, the `entrance` clip to resurface |
| Call Swarm | Streaks from the sky and ground bursts |
| Recover | Spin, aura sparkles, a ring |
| Haze | An expanding ring and ground burst |
| Barrier | A wireframe shell that flashes on each deflected hit — the one new effect |

`EnergyForm` effects follow the body through the extracted model's async swap
(`BodyForm`), so a model that finishes loading mid-fade doesn't leave the Titan
solid while it's untargetable.

**Mechanics live on `Creep`** so every attack path respects them: `burrowed`
(folded into `untouchable` with `captureLocked`), `untargetable` (checked by
`rankTargets` and dive signatures; fields and auras still land), `barrier`
(`takeDamage` takes a `heavy` flag), `haste`, `heal`, `advance`, `joinAt`, and
`playPose`. A ball closing on a Titan interrupts its ability first, so the
capture's own `EnergyForm` never stacks on a Titan's.

## Tools

| Command | What it checks or measures |
| --- | --- |
| `npm run test:finals` | Every course's final, as above |
| `npm run balance:economy` | Income by round against a full team build, per course |
| `npm run balance:xp` | Now plays each cup's first course, finals included |
| `python3 take_screenshot.py final<N>_<course>[@frames][-hurt]` | A final round mid-play, framed on the Titan; `-hurt` damages and paralyzes everything at 3 s, which is what sets off Recover and Haze |

## Phase 5: tuning, next

- **Playtest the bands.** The ~1/12 starting ratio and starting money are
  reasoned, not measured. Watch the first five rounds of the Poké, Great and
  Prime Cups most closely: that's where a mostly unbuilt team meets the band's
  bottom.
- **Legendaries run hot.** In the balance lab Zapdos and Articuno sit at
  175–260% of median, alongside Lapras and Scyther; Mewtwo at 100–120% solo and
  170–270% against a pack. That's arguably right for a once-per-clear catch, but
  worth watching.
- **Ability numbers** (cooldowns, dash distance, haste, barrier strength) are
  first guesses. Each is a named constant in its class.
- **Mystery rounds** weigh more now that there are fewer procedural rounds.

## Open questions

- **Should a final be retryable?** Losing at F4 replays up to 25 rounds. A "retry
  from F1" checkpoint needs a snapshot of match state that doesn't exist today.
- **Catching legendaries.** A course Titan can be caught every time its final is
  played. Should a legendary be catchable only once per save, or only on a first
  clear?

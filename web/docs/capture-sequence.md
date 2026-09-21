# The Capture Set Piece — Design & Rationale

Covers `td/CaptureSequence.ts` and the two engine pieces built for it,
`engine/EnergyForm.ts` and `engine/JaggedBeam.ts`.

A capture attempt is the single biggest moment in a match and one of the most
frequently seen, which pulls in two directions: it has to feel like an event,
and it has to not wear out its welcome. Everything below is an attempt to buy
more *event* without buying more *seconds*.

## Why it was rebuilt

The original sequence was a game-style catch: the ball flew to a hover point
above the creep, opened there, drew a smooth translucent cone down to it, the
creep shrank in place, and the ball dropped and wobbled. It read fine but it
read generic — nothing in it was specifically a Poké Ball.

The anime's version is a different piece of staging, and a more legible one:

- the ball **hits** the Pokémon and **bounces off** it
  ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9_Ball));
- it opens on that impact, and **freezes mid-air** partway through the rebound;
- the Pokémon **becomes energy** — this is the stated in-fiction reason a
  Pokémon of any size fits in the ball, not a transition flourish
  ([Pokémon Wiki](https://pokemon.fandom.com/wiki/Pok%C3%A9_Ball));
- a ragged beam connects ball to Pokémon and the light is **drawn down it**;
- the shell snaps shut, and it wobbles with the **centre button flashing red**
  for as long as the outcome is undecided
  ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9_Ball)).

The freeze and the beam's jaggedness aren't documented anywhere; they're
authored detail taken from watching the show, not canon we can cite.

We depart from the source in one place, and it is a big one. In the anime the
ball falls to the ground and wobbles there. Here **the ball never touches the
pitch at all**: it stops mid-rebound, and everything after that — the
conversion, the shell shutting, the whole ticking phase, the verdict — happens
at that one point in the air. A catch stops arguing and lifts away; a break
bursts where it hangs.

This took two passes to find, both driven by the same complaint. The first
version dropped the ball before the ticking: it went from a dead stop to ~15
units/second and back to ~1 in under a second, while the camera zoomed and
swung through the same third of a second. The second version moved that fall to
the verdict, on the theory that gravity returning and the answer arriving
should be the same event. That was better and still wrong — it was the fall
itself that read as an intrusion, wherever it was put.

The reason is that this set piece is *about* suspension. The world drops to
1.2% speed at the freeze and never fully recovers before the verdict. A ball
obeying gravity inside that is the one object behaving normally in a stopped
world, and it reads as a glitch rather than as weight. Taking the floor out of
the sequence entirely costs nothing and removes every version of the problem.

## The beat sheet

Each beat's length lives in a `D_*` constant at the top of `CaptureSequence.ts`.
Times are real seconds — `worldTimeScale` slows the rest of the *game*, not the
sequence.

| Beat | Length | What it is |
| --- | --- | --- |
| `aim` | ≤ 3.4s | Release meter. The only beat with a decision in it. |
| `throw` | 0.36s | Flight, aimed at the body's near surface. |
| `strike` | 0.20s | Contact, rebound, shell cracking open. The one fast beat. |
| `hang` | 0.14s | Frozen mid-air; the mouth turns back onto its quarry. |
| `absorb` | 0.44s | Conversion to light, the tether catches, the light is drunk in. |
| `snap` | 0.10s | Halves slam home, still airborne. |
| `hold` | 0.24s | Closed, suspended. Every camera move happens here. |
| `wobble` | 0.7–1.0s each | Swing, snap back, hold still — in mid-air. |
| `verdict` | 1.0–1.3s | Goes still, throws its star, lifts away. Or bursts open. |

A normal-threat successful catch runs ~5.07s end to end, against ~5.15s for the
version this replaced (which was itself a 20–30% trim, playtest round 2 item
18) — so four new beats and it came out *shorter*. The flight was trimmed and
the whole drop beat deleted to pay for them, and the freeze is nearly free
because nothing is moving inside it. `skip()` still jumps to the verdict, since
the outcome is rolled at `release()` and everything after is presentation.

## How hard it is

Two dials, in two files, and they do different jobs.

**The odds** (`captureChance`, `StadiumTDGame.ts`) are what the player earns
before the ball leaves their hand:

| Term | Worth |
| --- | --- |
| base | 0.15 |
| weakening | up to +0.32, and a creep is only catchable under 35% HP |
| ball | +0 poké / +0.17 great / +0.36 ultra |
| status | +0.10, or +0.20 while it is held still (stun, sleep, freeze) |
| rarity | −0.22 elite, −0.46 titan |
| misses since the last catch | −0.05 each (`CAPTURE_MISS_PENALTY_STEP`) |

Clamped to 0.05–0.9, then the release meter's grade is added and re-clamped to
0.04–0.93. Nothing is ever a certainty except the new-trainer safety net
(`shouldGuaranteeCatch`), which never covers titans.

**The meter** (`THREAT_PROFILE`, `CaptureSequence.ts`) is the part the player
plays: a zone width, a sweep speed, and for elite and titan quarry a single
crossing instead of a ping-pong sweep. `perfect` is the middle fifth of the
zone and pays +0.25; `good` pays +0.09; `wide` costs −0.18.

Three passes of playtesting all said the same thing — catching was too easy —
and each pass found the reason somewhere new. The first cut the weaken term,
which was then the dominant free lever. That left the base rate carrying a
whittled-down common creep to better than even money on a Poké Ball alone, so
the base rate came down next, and rarity and the ball tiers were spread
further apart so the ball in hand is a real decision. The last pass was the
meter itself: the zones were wide enough and the sweeps slow enough that
`good` was the floor rather than the reward, which made the odds read-out
decoration. Zones lost about a third of their width, sweeps got faster, and a
wide throw now costs twice what it did.

The dial to reach for depends on the complaint. "I catch everything" is the
odds. "The throw doesn't feel like I did anything" is the meter. Moving both
at once is how this ended up needing three passes.

## Decisions worth keeping

**The world stops, the sequence does not.** `worldTimeScale` bottoms out at
0.012 through `hang`, which is what makes the freeze read as a freeze rather
than as slow motion. The sequence itself keeps running on real time, so its
beats stay the length they say they are.

**Everything is measured in bodies, not metres.** The rebound distance, the
contact offset and the camera framing all scale off `animPokemon.height`. A
fixed rebound that frames beautifully off an Onix leaves a Pidgey a speck at
the far end of the shot; the first pass had exactly that bug.

**Frozen time is hostile to particles.** `ParticleSystem` updates on the scaled
delta, so anything emitted just before the freeze hangs in the air for the
whole beat. A 16-particle white burst became an opaque white blob sitting
between the ball and the Pokémon. Bursts inside these beats are small, fast and
tinted to the ball — a few sparks caught mid-flight read as stopped time.

**An open shell needs something in the gap.** Two halves drifting apart over
empty air look like a broken toy. The halves part less than they used to and a
`mouthGlow` sphere fills the space, so the ball reads as a mouth full of light.

**The button is the tell.** It flashes red from the moment the shell shuts
until the lock. It is the cheapest possible signal that the ball has not
decided yet, and the sequence repaints it every frame from the strike on.

**One thing moves at a time.** Every camera move — both reframes and the orbit
angle — happens during `hold`, while the ball is motionless. A camera cut
during stillness reads as staging; the same cut over a moving subject reads as
a lurch. Once the ticking starts the lens does not move again until the verdict.

**Nothing falls.** After the rebound the ball's Y never changes again until it
lifts away. Worth stating plainly because two earlier passes each had a drop in
them, each with its own bug — the first popped the ball upward at 20
units/second on contact, faster than it had fallen. The bug is gone because the
code is gone.

## The two engine pieces

**`EnergyForm`** swaps each mesh's material *reference* for an unlit stand-in
that burns from the body's own colours to the ball's, and swaps back on
release. It replaces rather than edits because extracted GLB models share one
material set across every clone of a species — `CinemaDim` learned this the
hard way, and `EvolutionSequence` currently gives up and skips its tint
entirely on authentic models. `EnergyForm` does not have to, so evolution could
be moved onto it later.

It is deliberately *not* additive. A model is dozens of overlapping surfaces
and additive blending stacks them into a shapeless glare; the silhouette is the
one thing worth keeping, because the Pokémon has to still be recognisably
itself while it is light.

`CinemaDim` skips any mesh flagged `ENERGY_FORM_FLAG`, since the two would
otherwise fight over the same colour every frame.

**`JaggedBeam`** is a camera-facing ribbon whose centreline is broken into
segments and thrown sideways by a jitter that re-rolls ~26 times a second, so
the bolt strobes between shapes instead of smoothly waving. The tips are pinned
— a bolt that wandered at its ends would look unattached to the things it is
holding. Geometry is allocated once and rewritten in place, because a GC pause
inside a frozen set piece would be plainly visible.

`pointAt(t)` returns a point on the bolt's *current kinked path*, and the
Pokémon's light rides that rather than the straight line between the two ends.
That single detail is most of what makes it look drunk in rather than merely
moved.

## Verification

Per-beat headless stills, each stepping the live sequence to a chosen frame
(`main.ts`, `BEAT_FRAMES`):

```bash
npm run build
python3 take_screenshot.py capture_aim      # release meter
python3 take_screenshot.py capture_strike   # contact and rebound
python3 take_screenshot.py capture_hang     # the freeze
python3 take_screenshot.py capture_beam     # tether and light form
python3 take_screenshot.py capture_snap     # shell shutting
python3 take_screenshot.py capture_suspend  # closed and hanging
python3 take_screenshot.py capture_wobble   # ticking in mid-air (any other capture_* name)
python3 take_screenshot.py capture_lock     # the click, star still on screen
python3 take_screenshot.py capture_break    # the escape and rematerialise
python3 take_screenshot.py capture_gotcha   # verdict
python3 take_screenshot.py capture_trophy   # the card after it
```

The staging sits in the aim window for 90 frames before releasing. That is not
padding: the cinematic camera damps in at ~3/s, so a shot that released
immediately would judge every later beat's framing from a camera still in
transit — which is how the first pass's framing problems hid.

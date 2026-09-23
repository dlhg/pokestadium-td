# Playtest Feedback — Round 2 — 2026-09-16

Second round of raw playtest feedback, captured for triage. Continues the
numbering from `playtest-feedback.md` (round 1, items 1–11). Each item gets
an interview pass with Drew before any change is scoped or implemented.
Status starts at `unreviewed` for all items.

## Implementation order

Decided 2026-09-17, once every item above had been interviewed. Grouped by
risk/scope rather than item number — front-load items where the interview
already pinned down the exact fix, save the two open-ended systems for
last.

1. **Batch 1 — quick, surgical, independent.** #30 pause text, #15
   "creep"→"enemy" sweep, #12 audio defaults + announcer slider, #23
   roster/guest-slot fill, #13 catch-speed exemption, #36 bench→storage
   mid-match. Exact code locations already pinned down during the
   interview; single-file changes, low regression risk.
2. **Batch 2 — self-contained UI features, moderate scope.** #19
   upgrade-visibility tooltip, #21 per-attacker "no effect" popup (extends
   round 1's #6 immunity-popup system), #18/20 catch-anim shorten + skip
   control.
3. **Batch 3 — needs a little design work before coding.** #24/27
   special-move discoverability (tutorial callout + tooltip), #25 floating
   damage numbers, #14 pokeball-vs-Pokémon visual tuning (needs eyeballing
   in the browser, not just code).
4. **Batch 4 — balance pass, bundled since these compound on each other.**
   #16 catch-rate tightening (check the escape-chance formula first), #35
   XP curve slowdown, #31 upgrade costs, #32/37 stun-lock stacking.
5. **Batch 5 — big standalone systems, do last.** #28/33 special-move
   VFX/anim/SFX baseline (own research pass first), #34 Titan specialness
   (own scoping pass across stats/moves/model).

Left parked, not scheduled: #17 (ghost visibility — needs pacing
research), #22 (Dragonair anim — explicitly low value), #38 (PvP
inspiration — backlog).

## 12. Audio bug — still plays at 0%, and 0% was the player's default
Status: done

Research findings:
- `StadiumAudio.ts` `readAudioVolume()`: `Number(localStorage.getItem(...))`
  — when nothing is saved yet (a brand-new player), `getItem` returns
  `null`, and `Number(null)` is `0`, not `NaN`. `Number.isFinite(0)` is
  true, so the fallback never kicks in — new players silently default to
  **0% volume**. This is the literal cause of "0% was my default."
- Separately, `Announcer.ts`'s recorded voice clips play via
  `nativeVoice.volume = 0.9`, hardcoded, completely bypassing the
  music/sfx volume buses in `StadiumAudio.ts`. A player who manually sets
  volume to 0% would still hear announcer barks at 90%. This is the
  literal cause of "still plays at 0%."

Decisions:
- Fix the localStorage-read bug so new players default to full (100%)
  volume instead of silently 0%.
- Give announcer voice its own dedicated volume slider, independent of
  the sfx bus, rather than tying it to sfx or adding a separate on/off
  toggle. This also resolves item 26 (see below) — the slider reaching 0
  serves as "off," no separate toggle needed.

Implementation:
- `readAudioVolume()` now checks `localStorage.getItem(...) === null`
  explicitly before falling back, instead of letting `Number(null)` (which
  is `0`) slip past `Number.isFinite`.
- Added `StadiumAudio.setAnnouncerVolume`/`getAnnouncerVolume`, persisted
  under `pokestadium.announcerVolume` alongside music/sfx.
- `StadiumAnnouncer` gained a `voiceVolume` field and `setVoiceVolume()`;
  `speak()` now uses `this.voiceVolume * 0.9` (keeping the original 0.9
  headroom at full volume) instead of a hardcoded `0.9`, and short-circuits
  entirely when volume is 0. The existing `voiceEnabled` flag (used for
  headless/screenshot capture, unrelated to player settings) is untouched.
- Added a third "ANNOUNCER" slider to the pause screen, wired the same way
  as MUSIC/SFX (`StadiumUI.onAnnouncerVolumeChange` → `StadiumTDGame`),
  and synced it at startup so a saved value takes effect immediately.

## 13. Difficult to catch Rattata before it dies; not obvious that lowering game speed helps
Status: done

Player was on 3x speed.

Research findings:
- `gameSpeed` (`StadiumTDGame.ts`) scales the whole world's `dt`,
  including the window between a creep becoming catchable and dying to
  tower damage — at 3x, that window is 3x shorter in real time.
- The capture QTE's own slow-motion (`CaptureSequence.worldTimeScale`,
  which drops to ~0.04–0.3 during the sequence) is multiplied by
  `gameSpeed` too, so even once a throw is in progress, higher game speed
  makes the QTE itself run faster than intended.

Decisions:
- Exempt catch-window timing from `gameSpeed` scaling — both the
  catchable-to-death window and the QTE's slow-motion beats should run
  close to real-time regardless of the player's speed setting, so
  cranking game speed doesn't quietly shrink the catch window.

Implementation:
- The QTE case was already covered by existing code once its own bug was
  fixed: the `worldTimeScale` comment claimed the capture sequence "runs
  in real time," but `gameSpeed` was still being multiplied into `dt`
  alongside it, contradicting that. No separate fix needed there beyond
  the pre-throw case below — `captureScale` already dominates once a
  throw starts.
- Added a `catchableScale` factor to `StadiumTDGame`'s per-frame `dt`
  calculation: while any creep is catchable and no capture/evolution/
  summon sequence is already running, it cancels `gameSpeed` back out to
  1x (`1 / gameSpeed`), so the real-time length of the catchable-to-death
  window no longer depends on the speed setting. At 1x it's a no-op.
- Verified with `npm run test:gameplay` and `npm run test:maps` (both
  pass) — no existing regression covers this specific case, so this is a
  code-review-level check, not a new automated test.

Follow-up from Drew after playtesting the fix: it's a *global* slowdown
(the whole board dips to 1x, not just the catchable creep), and while he
liked it, he didn't want it forced on every player by default. Added a
player-facing three-state toggle rather than shipping it as fixed
behavior:

- **`CATCH SLOW-MO: OFF / NEW ONLY / ALWAYS`** — a small tab attached to
  the bottom edge of the existing `SPEED` control-group in the live HUD
  (not the pause menu — the pause menu was rejected because a player
  changing their speed setting would have no reason to open Escape and
  discover a compensating toggle exists; living right next to `SPEED`
  means they see it exactly when it's relevant). No spare width next to
  `SPEED`/`CAMERA` in that row, so it hangs underneath instead of
  crowding sideways — a new `.control-group-tab` style, not a third
  `control-group`.
- **OFF** — today's pre-fix behavior, gameSpeed always applies as-is.
- **NEW ONLY** (default) — only triggers for a catchable creep whose
  species isn't in the collection yet (`store.hasSpecies()`, matched via
  the same `speciesForCreepName` lookup the catch flow already uses).
  Chosen as the default over ALWAYS so veteran players speed-running past
  a fifth Rattata don't get slowed down for a catch they don't need.
- **ALWAYS** — the originally-shipped behavior, any catchable creep
  triggers it.
- Persisted to `localStorage` (`pokestadium.catchSlowMo`), same pattern as
  the other pause-menu toggles (signature cuts, summon cinematics, type
  effectiveness). Verified all three states cycle correctly and the tab's
  gold "active" styling drops on OFF, via a live browser check.

## 14. Pokéball prop on the platform stands out more than the small Pokémon (e.g. Rattata)
Status: done

Decisions:
- Tone down the platform's pokéball decoration (smaller, duller
  material) so it doesn't compete with the Pokémon model for attention.
- Also scale up small-bodied species' render scale so they read clearly
  next to towers/props at normal camera distance.
- Both changes ship together — one alone might not fully fix the
  hierarchy problem.

Implementation:
- `Tower.createBasePad()`: the recessed pokéball seal decal shrunk from
  `radius * 0.56` to `radius * 0.4`, and its red/cream materials switched
  from flat, saturated `MeshBasicMaterial` (self-illuminated, so it always
  reads brighter than its lit surroundings) to desaturated, lit
  `MeshStandardMaterial` that shades like the rest of the pad.
- `PokemonScale.ts`: `SIZE_EXPONENT` (the existing, already-documented
  dial for "how much to soften literal Pokédex-height ratios so small
  species stay legible") lowered from 0.75 to 0.62 — no new mechanism,
  just turning an existing one further in the direction its own comment
  already described.
- Verified live: deployed Rattata, toggled the retro CRT filter off for a
  clean look, and confirmed the seal is now a subtle mark rather than the
  focal point, with Rattata reading clearly on the pad.

## 15. "Drain the creep" is unclear; "creep" as a term is unclear
Status: done

Research findings:
- Source is `Species.ts`'s Bulbasaur/Oddish "Leech Seed" tooltip:
  "Hits may plant a seed that drains the creep for 8 s." Mechanically
  it's implemented as a plain poison DoT (`onHitStatus: poison`) — there
  is no actual HP-steal/heal-the-tower effect, unlike the real Pokémon
  move. "Creep" is internal tower-defense jargon (the wave/enemy unit
  type name) leaking into player-facing copy.
- The announcer already uses "invader" for the equivalent concept
  ("AN INVADER BROKE THROUGH!" in `Announcer.ts`), but that word isn't
  used consistently in upgrade-tooltip copy.

Decisions:
- Replace "creep" with "enemy" in player-facing copy — sweep all
  upgrade/tooltip text for the term, not just the one Leech Seed line.
- The "drains" wording mismatch (poison DoT described as a drain/leech
  effect with no actual lifesteal) is noted but **not actioned this
  round** — flagged for a future pass, either reword to plain DoT
  language or give Leech Seed real lifesteal.

Implementation:
- Swept `Species.ts` and `Signatures.ts` (the only files with player-facing
  "creep" text — confirmed by grepping the rest of `src/td`) for every
  `tier(...)`/`def(...)`/`description:` line containing "creep(s)", 93
  lines total, replacing with "enemy"/"enemies" (and "Creeps"→"Enemies" at
  sentence starts). Left untouched: the `Creep` class/type itself, and
  internal variable/parameter names and comments in both files (e.g.
  `creeps: Creep[]`, `function targetable(creep: Creep, ...)`) — those
  aren't player-facing and renaming them risked breaking code for no
  player-visible benefit.
- `npx tsc --noEmit` clean after the sweep.

## 16. Catching is still too easy — catch rate too high
Status: done

Confirmed by a different playtester than round 1's #8 fix (a39d5ae — miss
penalty + QTE variants by rarity), reporting the game feels too easy
*after* that fix shipped. This corroborates the difficulty problem rather
than being stale pre-fix feedback.

Decisions:
- Treat as confirmed and current. Needs a follow-up tightening pass;
  exact lever (base catch-rate formula, bonus stacking, QTE difficulty)
  not yet decided — scope during implementation. Round 1's #8 already
  flagged "needs a code check on current escape-chance formula," which
  is still the right starting point.

Implementation:
- Code check on `captureChance` (`StadiumTDGame.ts`) found the weaken
  term — `(1 - hpFraction) * 0.45` — was the dominant, free lever: any
  `normal`-threat creep whittled down with towers (standard TD play
  before throwing) plus a merely-good release-meter throw already hit
  0.85, and a perfect throw clamped straight to the 0.95 ceiling
  regardless of ball type. Ball choice and status effects only mattered
  on `elite`/`titan` encounters, which carry a rarity penalty.
- Cut the weaken weight to 0.30. Left the base rate, ball bonuses, and
  release-meter bonus untouched — this was the surgical lever, not a
  broad nerf. A weakened normal creep + perfect throw now lands around
  0.83 with a Poké Ball, so Great/Ultra Ball and status effects stay
  differentiating instead of being redundant on top of an already-maxed
  roll. `npx tsc --noEmit` clean.
- Risk to watch in the next playtest round: this could swing the
  complaint from "too easy" to "too grindy" on common encounters —
  no code change made for that yet, revisit if reported.
- Follow-up (third pass, reported again after the above shipped): the
  weaken term was no longer the lever — the **base rate** was, carrying a
  whittled-down common creep past even money on a Poké Ball by itself, and
  the **release meter** was wide and slow enough that `good` was the floor
  rather than the reward. Base 0.28 → 0.15, ball and rarity spreads pulled
  apart, ceiling 0.95 → 0.9 (0.93 after a perfect throw); meter zones cut
  about a third narrower with faster sweeps, `perfect` narrowed to the
  middle fifth of the zone, and a wide throw now costs 0.18 instead of
  0.1. Both dials and their history are documented in
  `docs/capture-sequence.md` ("How hard it is"), with a regression in
  `tools/test_gameplay_regressions.mjs` pinning the odds' shape.

## 17. Can't see Ghost Pokémon without a Ghost/Psychic — but how do you catch the first Ghost then?
Status: interviewed — parked, needs more research

Research findings:
- The game already has a way around this: Pidgey's "Keen Eye"
  (`seePhantoms`) → "Spotter" (`revealAura`, reveals Phantoms for every
  tower in range) and Zubat's "Echolocation" (`seePhantoms`) upgrade
  paths let cheap, non-Ghost/Psychic starters solve this. Neither
  species requires owning a Ghost or Psychic type.
- Not yet confirmed: how early Pidgey/Zubat are actually catchable and
  affordable relative to when players first encounter a Ghost/Phantom
  creep — that pacing question determines whether this is a pure
  discoverability gap or an actual early-game dead end for some builds.

Decisions:
- Parked pending a dedicated pacing check (wave composition / encounter
  timing for Pidgey, Zubat, and the first Ghost-type creep) before
  deciding between a discoverability fix (hint players toward the reveal
  path) and a mechanic change (e.g. lowering the floor further).

## 18. Speed up the catch animation / 20. Should be able to skip to the end of the catch sequence
Status: done

Research findings:
- `SummonSequence.ts` already has a `skip()` method wired to click/Space/
  Escape (`StadiumTDGame.ts` line ~937, UI hint "CLICK · SPACE · ESC TO
  SKIP"). `CaptureSequence.ts` has **no equivalent** — once a throw
  commits, there's currently no way to skip ahead. The player's
  assumption that a skip already exists on the catch screen was
  mistaken; they were likely thinking of the summon/deploy cinematic.

Decisions:
- Shorten the base real-time duration of the capture sequence's timing
  beats (impact/absorb/settle/verdict in `CaptureSequence.ts`) so it's
  faster by default for everyone.
- Add an explicit skip input (mirroring `SummonSequence`'s pattern —
  click/Space once the outcome is essentially locked in, i.e. after the
  QTE release) to jump straight to the verdict.

Implementation:
- Trimmed the beat-timing constants in `CaptureSequence.ts` (impact,
  absorb, drop, lock-pause, wobble period per rarity tier, and both
  verdict-hold durations) roughly 20–30% — e.g. `VERDICT_HOLD_SUCCESS`
  1.9s → 1.3s, `D_IMPACT` 0.55s → 0.45s. A normal-threat successful catch
  now runs ~5.15s end-to-end instead of ~6.7s. `WOBBLE_CLICK` left
  untouched since it's tied to a specific audio/visual sync moment.
- Added `CaptureSequence.skip()`: since the catch's outcome is already
  rolled the instant `release()` fires (before any of the throw/absorb/
  drop/wobble animation plays), skip just fast-forwards `elapsed` to
  `beats.end` — the existing per-frame phase logic in `update()` handles
  the rest naturally, no separate "skipped" flag needed (unlike
  `SummonSequence`, which has real finalization side effects to bypass).
  Guarded to no-op while still `awaitingRelease`, since that's a real
  decision, not an animation.
- Wired click/Space/Escape to `skip()` once release has happened
  (`StadiumTDGame.ts`), same input set as the summon cinematic's skip.
  Added a matching "CLICK · SPACE · ESC TO SKIP" hint (`#cine-skip`) that
  only shows once released.
- Verified live: threw a ball, released, pressed Space once, and the
  sequence jumped straight from "IT SAILS WIDE..." (mid-throw) to the
  caught/broke trophy card in one step.

## 19. Should be able to see all purchased upgrades for a Pokémon
Status: done

Decisions:
- On-demand tooltip/expand on the tower's panel — keep the compact
  default view, add a hover/click-to-expand detail listing every tier
  bought across all upgrade paths (not just the next available one).

Implementation:
- The panel's `tp-line-stats` text only ever shows one tier's effect (the
  next one to buy, or the final one once maxed) — there was nowhere to
  see tier 1's effect once tier 2 was bought over it.
- Added a native `title` tooltip on each path's `.tp-line-meta`, listing
  every tier already purchased on that path ("TIER 1 — Flamethrower: The
  attack becomes a cone of fire.", one per line) — same lightweight
  tooltip mechanism the signature bar already uses elsewhere in this
  file. Only attached when at least one tier is bought; `cursor: help`
  hints it's there.
- Verified via the live DOM: purchased Charmander's Inferno tier 1, and
  `.tp-line-meta[title]` carried the expected summary while the two
  untouched paths had no title attribute.

## 21. Hard to tell which attacker "has no effect" when a creep is hit by multiple towers at once
Status: done

Decisions:
- Per-attacker "NO EFFECT" popup anchored at the attacking tower (or its
  projectile's impact point), not just a generic banner — so it's
  visually obvious which specific attacker is being resisted. Builds on
  round 1's #6 immunity-popup work.

Implementation:
- Found the single shared choke point: `strikeCreeps()` in
  `MoveDelivery.ts`, used by every attack and signature move. Its
  immunity branch (`multiplier <= 0`) called `ctx.popup(centerMass(victim),
  ...)` — always anchored at the creep, which is exactly the ambiguity
  reported: with several towers hitting one creep, a victim-anchored
  popup can't say which attacker whiffed.
- Anchors the popup at the attacking tower instead (a new `towerCallout()`
  helper, mirroring the existing `centerMass()` for creeps) when a
  `source` tower is available, falling back to the creep's position for
  the rare case of a hit with no single source (some AOE effects). Scoped
  to the immunity case only — the opt-in super/not-very-effective popups
  stay anchored at the creep, unchanged.
- `npm run test:gameplay` passes.

## 22. Dragonair's move animation is weird
Status: interviewed — parked (low value/effort ratio)

Player description: the model "wiggles uncontrollably" during the move —
reads as a broken animation-blend or IK issue.

Decisions:
- Parked. Confirmed as a real, specific problem, but judged not worth the
  fix effort relative to other items in this round. Revisit later.

## 23. Player had 5/6 team slots but a mid-match catch only offered "send to storage"
Status: done

Research findings:
- Two unrelated caps exist: the persistent `TEAM_SIZE = 6` roster, and a
  separate `MATCH_GUEST_SLOTS = 3` cap (`TrainerStore.ts`) on how many
  newly-caught Pokémon may join the *current match* beyond the existing
  team. `StadiumUI.showCaptureTrophy()` only offers "ADD TO MATCH" when
  `guestSlotsLeft > 0`; otherwise "SEND TO STORAGE" is the only option,
  regardless of open team slots. The player had roster room (5/6) but hit
  the unrelated, already-full match-guest cap (3/3) — which reads as "no
  roster space" when it isn't the same limit at all.

Decisions:
- If the persistent team has an open slot, let a mid-match catch go
  straight into it directly, instead of being gated by the separate
  match-guest-slot system at all. This removes the confusing case
  entirely rather than just relabeling it.

Implementation:
- `StadiumTDGame.promptCaughtPokemon` now computes `openTeamSlot =
  this.store.team.length < TEAM_SIZE` and passes it into
  `showCaptureTrophy`. When true, `store.add(pokemon, true)` (auto-fills
  the first open team slot, permanent) runs instead of `store.add(pokemon,
  false)` + a guest-slot spend — the catch still joins `this.roster` for
  immediate use this match either way.
- `StadiumUI.showCaptureTrophy` shows a plain "ADD TO TEAM" button and a
  "TEAM: OPEN SLOT" note when a team slot is open, instead of the
  guest-slot language — so a full team is the only time "MATCH GUESTS"
  wording appears at all.
- Verified with `npm run test:gameplay` (passes, including the existing
  roster regression) and `npx tsc --noEmit` (clean).

## 24. Special move trigger row isn't obvious / 27. Don't know what specials do, tooltip should be bigger
Status: done

Decisions:
- One-time tutorial callout the first time a tower earns a
  signature/special: highlights the trigger row and explains what it
  does.
- Expand the existing hover tooltip on the trigger row — bigger text,
  clearer effect description.

Interview follow-up: the only tooltip mechanism anywhere in the codebase
was the native HTML `title` attribute, which can't be resized via CSS at
all — a genuinely bigger tooltip needed a real custom on-hover component,
not a style tweak. Confirmed as worth building.

Implementation:
- Tutorial callout: reused the existing one-time-tip pattern (same as
  round 1's premium-ball tip) — a new `#signature-tip` element, gated on
  a `pokestadium.signatureTipSeen` localStorage flag, shown the first
  time `slots.length > 0`. Positioned dynamically off the signature bar's
  own `getBoundingClientRect()` rather than a fixed offset: the bar
  shares its left-edge column with the capture-kit panel above it, and a
  fixed spot (both above the bar, and later a naive bottom-up placement)
  twice landed on top of it or ran off the viewport bottom before
  settling on "anchored to the bar's right edge, bottom-aligned."
- Custom hover tooltip: a new `#sig-tooltip` element built from scratch
  (position:fixed, repositioned via the hovered button's rect on
  mouseenter/focus), showing the move name, a type badge, the full
  description at 14px (vs. the old title's browser-default size), and
  the caster's name + live PP count. Removed the old `title` attribute
  from the signature buttons so the two tooltip mechanisms don't stack.
- Verified live end-to-end: unlocked a tier-3 signature (Charmeleon's
  Fire Blast), confirmed the tutorial tip fires once and sits clear of
  the capture-kit panel and the viewport edge, and confirmed the hover
  tooltip renders the richer readout correctly.

## 25. Damage numbers from specials — size by value, color by type, communicate effectiveness
Status: done (scoped down)

Decisions:
- Add floating damage numbers for special hits, with font size
  proportional to the damage dealt.
- Color-by-type and distinct effectiveness styling (super-effective/no-
  effect treatment) were **not** selected this round — scoped out for
  now; numbers-sized-by-value is the committed piece.
- One number per creep hit (not consolidated), even for wide-AOE
  signatures that hit many creeps in one cast.

Implementation:
- `HitContext.popup` gained an optional `size` (px) parameter, threaded
  through `StadiumTDGame.spawnCombatPopup` to `StadiumUI.spawnCombatText`,
  which applies it as an inline `font-size` when present.
- `HitExtras` gained a `signature?: boolean` flag; all 5 of
  `Signatures.ts`'s `strikeCreeps(...)` call sites now pass
  `signature: true` (ordinary attacks, which go through
  `resolveMoveHit()` → `strikeCreeps()` without that flag, are
  unaffected — this stays scoped to specials as asked).
- In `strikeCreeps`, a signature hit that deals damage (and isn't an
  immunity, which already has its own "NO EFFECT" popup) spawns a plain
  white floating number at the victim, sized
  `clamp(14 + sqrt(damage) * 1.3, 14, 34)` — a square-root curve so a big
  hit reads as clearly bigger without one huge hit blowing the number off
  the screen.
- Verified live: cast Charmeleon's Fire Blast on a creep and saw a "222"
  floating number appear at the impact point.

## 26. Announcer gets annoying — add option to toggle off
Status: interviewed — folded into item 12

Decisions:
- Superseded by item 12's dedicated announcer volume slider rather than
  a separate binary toggle — see item 12.

## 28. Dislikes the zoom-in when placing a Pokémon / 33. Special attacks need a bigger animation + effect (player likes the zoom)
Status: done

These are two separate camera-zoom events (deploy-placement zoom vs.
special-attack zoom), not one shared mechanism. Clarified: the deploy
zoom stays as-is — no change requested there this round. The real ask is
about item 33: the special-attack zoom currently sets up an expectation
("something big is about to happen") that the move itself doesn't pay
off — no strong animation, effect, or sound sells the moment.

Research findings:
- Every signature effect kind already has its own bespoke particle calls
  (ring/ground-burst/impact/beam) and a shared `cut()` helper that fires
  a camera cut (`triggerActionCam`) or a mild `shake(0.4)` fallback —
  that's the existing "cam zoom" the player likes. But `cut()` never
  called `punchZoom()`, the much stronger camera hit capture verdicts
  already use (`punchZoom(12–14)` vs. nothing for signatures).
- Signatures call `strikeCreeps()` directly, bypassing `resolveMoveHit()`
  — which means they skip its `ctx.audio.playHit(...)` call entirely.
  **Signature casts played no distinct sound at all before this fix.**
  That was likely the single biggest reason they felt flat.
- No full-screen "flash" mechanism exists for live gameplay (unlike the
  capture/evolution cinematics, which pause the game and own the whole
  screen) — signatures fire mid-wave without pausing anything, so the
  right "flash" here is a localized particle/light burst at the cast
  point, not a screen-space white-out.
- Not every effect kind called the shared `cut()` helper — `areaStatus`,
  `allyBoost`, `selfBoost`, `pushWave` had no camera treatment or a
  bare, uncoordinated `ctx.camera.shake(...)` call instead.

Decisions:
- Build one shared universal "special move" VFX/anim/SFX baseline
  (flash, particle burst, screen shake, stinger sound) applied to every
  signature move by default, so all specials get a consistent power-up
  feeling without hand-authoring each one.
- Layer hand-authored, per-species special treatments on top over time;
  where a species has a bespoke treatment, it overrides the baseline
  instead of stacking with it.
- Deploy-placement zoom (item 28) is not being changed this round.

Implementation:
- `Signatures.ts`'s `cut()` helper is now the baseline: camera cut/shake
  (as before) + a real `punchZoom(7)` + a new
  `ParticleSystem.emitSignatureFlash()` (a white-hot burst layered over
  whatever particles the effect already emits, plus a wide white
  shockwave ring) + a new `StadiumAudio.playSignatureCast()` stinger (one
  shared procedurally-synthesized cue, not per-move — matching the
  "universal first" plan; the per-move hand-authored layer is future
  work).
- Extended `cut()` to the combat effect kinds that didn't call it before:
  `areaStatus`, `pushWave`, `cashDot` now go through the same baseline.
  Scoped out on purpose: `allyBoost`, `selfBoost`, `gainMoney`,
  `revealPhantoms` (pure utility/buff signatures, not attacks — a big
  damage-feeling flash+stinger on a support move would read as
  mismatched) and `dropHazard` (a placement/setup action; the actual
  damage happens later via the hazard system, not at cast time). The
  channeled variant of `strikeLine` (a sustained beam ticking every
  0.3s) also keeps its lighter existing treatment rather than repeating
  the full baseline every tick.
- Updated `tools/test_gameplay_regressions.mjs`'s signature-cast test
  mocks (`camera`, `particles`, `hit.audio`) to include the three new
  methods the baseline now calls — without this the tests failed with
  `ctx.camera.punchZoom is not a function`.
- Verified live: unlocked Charmeleon's Fire Blast, cast it on a creep,
  and confirmed the camera visibly punches in, a bright flash/burst
  renders at the impact point alongside the existing fire particles, and
  the "222" damage number and everything else layer together correctly.

## 29. Extraction step missing from README, resulting in procedural fallback assets
Status: done

Follow-up from Drew after the interview pass: the setup pain was worse than
just a missing step. Two things compounded it — (a) `check_stadium_assets.py`
only ever looked at one exact hardcoded path
(`baseroms/us/Pokemon Stadium (USA) (Rev 2).z64`); a ROM under any other
filename wasn't validated at all, just reported as "found nearby, please
rename it" — real friction for a player copy-pasting instructions in a
terminal with a filename full of spaces and parens. (b) the root README
buried the web player's extraction step in one dense paragraph, and
separately still told readers (in the unrelated decomp section further
down) to fetch a Revision 1.0 ROM and to install prerequisites via
Debian/Ubuntu `apt` — noise/confusion for anyone just trying to run the web
game, which needs Revision 2 and no particular OS.

Implementation:
- Added `find_rom()`/`n64_images()` to `tools/stadium_pipeline/rom.py`: it
  checks the recommended path first, then scans `baseroms/`,
  `web/baseroms/`, the repo root, and `web/` for any `.z64`/`.n64`/`.v64`
  file and validates each by content. Filename and exact location no longer
  matter — confirmed by moving the real dump to a throwaway name and
  re-running `check_stadium_assets.py`.
- `check_stadium_assets.py`, `extract_stadium_assets.py`, and
  `extract_stadium_announcer.py` all now resolve the ROM through this
  shared helper instead of each hardcoding the exact path; `--rom` still
  overrides it explicitly.
- Rewrote the root `README.md`: the web-quickstart is now a plain numbered
  list (`cd web && npm install` → `npm run dev`) with the ROM step called
  out as clearly optional and explained in three sentences, not one
  paragraph. The decomp section (Debian/Ubuntu prereqs, the Revision 0
  `baserom.z64` requirement) is now explicitly labeled "unrelated to running
  the web game above — skip this unless..." so a web-only reader has no
  reason to read past the web section at all.
- Updated `web/ROM_ASSETS.md` to describe the same scan-then-validate
  behavior instead of "the pipeline does not search for a ROM."

Decisions:
- Long-term: supporting ROM Revisions 1.0/1.1 in addition to 1.2 (Rev 2) is
  a real ask, but out of scope here — the extraction offsets in `rom.py`
  are hardcoded to bytes verified against an actual Rev 2 dump, so adding
  another revision needs that revision's dump in hand to re-derive its
  layout, not just a code change. Parked as a future, separate effort.

## 30. Pause screen should just say "PAUSED"
Status: done

Research findings:
- Current pause overlay (`StadiumUI.ts` ~1528–1531) shows a kicker
  "MATCH PAUSED" plus a flavor headline "TAKE A BREATHER."

Decisions:
- Simplify to plainly read "PAUSED" — drop the "TAKE A BREATHER" flavor
  text; the kicker/headline should just state the state, not add copy.

Implementation:
- Collapsed the kicker + headline + "The stadium will wait for you." line
  down to a single `<h2 id="pause-title">PAUSED</h2>`. No CSS changes
  needed — neither element had bespoke styling to begin with.

## 31. Make upgrades more expensive (game too easy)
Status: interviewed — not actioned this round

Decisions:
- Not selected as a priority this round (item 35's XP-curve slowdown was
  chosen instead as the leveling/difficulty lever). Left as a raw,
  undecided data point for a future general balance pass — see item 35's
  note about needing a real numbers session eventually.

## 32. Venusaur/Raichu/Alakazam/Golbat/Gengar/Golem team fully stun-locks enemies / 37. Possible to be stun-locking enemies while unable to damage them at all
Status: interviewed — rolled into general balance pass

Considered whether the "stunned but undamageable" case (37) could be a
soft-lock (match never progresses, never ends) and therefore an urgent
bug. Decided otherwise.

Decisions:
- Treat both as part of ongoing crowd-control/difficulty balance work
  (alongside items 16, 35), not as a standalone priority bug. Round 1's
  #7 already patched the Venusaur-specific case; this broader
  multi-source stacking issue (Raichu paralyze + Alakazam
  confuse/sleep, etc.) gets addressed in the same pass.

## 34. Captured Titans don't feel special enough (model, moves, stats)
Status: stats + visual done; signature move deferred

Decisions:
- All three dimensions get attention: stats/power ceiling (stronger base
  stats or a unique passive), a unique signature move/kit not shared
  with the non-Titan counterpart, and visual presentation (unique model
  treatment/scale/aura/entrance).
- Scoping/sequencing across the three not yet decided — needs its own
  planning pass.
- Shipped: a Titan catch now survives capture (it was previously discarded
  the moment `createCaughtPokemon` resolved down to the base species) via a
  generic `variant` tag on `OwnedPokemon` (`progression/Variants.ts`), built
  so a future special catch (e.g. shiny) reuses the same registry and UI
  hooks instead of a new one-off flag. Titans now get guaranteed max DVs
  (perfect stats) and an orange accent — badge, card glow, and 3D rim-light
  tint — on the capture trophy and the roster.
- Deferred: a Titan-exclusive signature move/kit distinct from the
  non-Titan counterpart's moveset is not part of this pass.
- Follow-up: max DVs alone made a titan Onix only ~15% stronger than a
  fresh starter, for $10 more. Titans now carry a power multiplier (1.4x
  damage, 1.15x rate) and a +$160 deploy premium, both on the variant
  entry (`deployCostOf`, `withVariantPower`). See trainer-progression's
  Decisions for why this stays on money rather than a field-points budget.

## 35. Leveling is too fast — would feel more meaningful if slower
Status: done

Decisions:
- Slow down the XP-to-level curve (increase XP required per level and/or
  reduce XP yields) so leveling feels earned. Chosen over raising
  upgrade costs (item 31) as the primary lever for this round; a full
  balance-numbers session is still likely needed eventually, but this is
  the committed starting move.

Implementation:
- Landed as cup rules phase 5 (`docs/cup-rules.md`): `xpForLevel`'s
  exponent (`Stats.ts`) went from a flat `level³` to `level^3.36`, tuned
  via a new pacing script (`npm run balance:xp`) against the target of
  each cup's level cap landing around 75–85% of its win round. Before:
  Little/Poké/Great capped at 57%/50%/38%. After: 85%/85%/74%. `THREAT_XP`
  and `WAVE_CLEAR_SHARE` were left untouched — the curve exponent alone
  disproportionately slows the higher levels each cup's cap sits at,
  which is what closed the gap between cups without a flat multiplier
  overcorrecting Little Cup.

## 36. Want to send a Pokémon from the bench back to storage mid-match
Status: done — already implemented, no code change needed

Decisions:
- Allow it with no restrictions. Bench Pokémon aren't deployed/committed
  to the board, so sending one to storage mid-match is low-risk — just
  add the action.

Implementation:
- Traced the full call chain and found this already works exactly as
  decided: every roster card in the live in-match bench panel
  (`StadiumUI.renderCardDeck`) renders a "STORE" button, gated only on
  `!storageButton.disabled` (which tracks whether that specific Pokémon is
  currently placed as a tower — `StadiumUI.update`, synced every frame).
  `StadiumTDGame.onStoreMember` requires `this.matchActive` to be true and
  the member not `isDeployed`, i.e. it's mid-match-only by construction —
  there was no separate pre/post-match gate to remove. No discoverability
  issue found in the code either (unconditional button, not hidden behind
  a menu). Left as-is; flag to Drew if a live playtest still can't find
  it, since this may be a case of the feedback predating this button's
  addition rather than a real current gap.

## 38. Look into "Devil's Chess" for PvP inspiration
Status: interviewed — parked as backlog

Decisions:
- Logged as a design-research note for a future PvP mode pass. Not
  actionable in this feedback round.

# Playtest Feedback — Round 2 — 2026-09-16

Second round of raw playtest feedback, captured for triage. Continues the
numbering from `playtest-feedback.md` (round 1, items 1–11). Each item gets
an interview pass with Drew before any change is scoped or implemented.
Status starts at `unreviewed` for all items.

## 12. Audio bug — still plays at 0%, and 0% was the player's default
Status: interviewed — ready to implement

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

## 13. Difficult to catch Rattata before it dies; not obvious that lowering game speed helps
Status: interviewed — ready to implement

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

## 14. Pokéball prop on the platform stands out more than the small Pokémon (e.g. Rattata)
Status: interviewed — ready to implement

Decisions:
- Tone down the platform's pokéball decoration (smaller, duller
  material) so it doesn't compete with the Pokémon model for attention.
- Also scale up small-bodied species' render scale so they read clearly
  next to towers/props at normal camera distance.
- Both changes ship together — one alone might not fully fix the
  hierarchy problem.

## 15. "Drain the creep" is unclear; "creep" as a term is unclear
Status: interviewed — ready to implement

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

## 16. Catching is still too easy — catch rate too high
Status: interviewed — confirmed, needs implementation pass

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
Status: interviewed — ready to implement

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

## 19. Should be able to see all purchased upgrades for a Pokémon
Status: interviewed — ready to implement

Decisions:
- On-demand tooltip/expand on the tower's panel — keep the compact
  default view, add a hover/click-to-expand detail listing every tier
  bought across all upgrade paths (not just the next available one).

## 21. Hard to tell which attacker "has no effect" when a creep is hit by multiple towers at once
Status: interviewed — ready to implement

Decisions:
- Per-attacker "NO EFFECT" popup anchored at the attacking tower (or its
  projectile's impact point), not just a generic banner — so it's
  visually obvious which specific attacker is being resisted. Builds on
  round 1's #6 immunity-popup work.

## 22. Dragonair's move animation is weird
Status: interviewed — parked (low value/effort ratio)

Player description: the model "wiggles uncontrollably" during the move —
reads as a broken animation-blend or IK issue.

Decisions:
- Parked. Confirmed as a real, specific problem, but judged not worth the
  fix effort relative to other items in this round. Revisit later.

## 23. Player had 5/6 team slots but a mid-match catch only offered "send to storage"
Status: interviewed — ready to implement

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

## 24. Special move trigger row isn't obvious / 27. Don't know what specials do, tooltip should be bigger
Status: interviewed — ready to implement

Decisions:
- One-time tutorial callout the first time a tower earns a
  signature/special: highlights the trigger row and explains what it
  does.
- Expand the existing hover tooltip on the trigger row — bigger text,
  clearer effect description.

## 25. Damage numbers from specials — size by value, color by type, communicate effectiveness
Status: interviewed — ready to implement (scoped down)

Decisions:
- Add floating damage numbers for special hits, with font size
  proportional to the damage dealt.
- Color-by-type and distinct effectiveness styling (super-effective/no-
  effect treatment) were **not** selected this round — scoped out for
  now; numbers-sized-by-value is the committed piece.

## 26. Announcer gets annoying — add option to toggle off
Status: interviewed — folded into item 12

Decisions:
- Superseded by item 12's dedicated announcer volume slider rather than
  a separate binary toggle — see item 12.

## 28. Dislikes the zoom-in when placing a Pokémon / 33. Special attacks need a bigger animation + effect (player likes the zoom)
Status: interviewed — ready to implement

These are two separate camera-zoom events (deploy-placement zoom vs.
special-attack zoom), not one shared mechanism. Clarified: the deploy
zoom stays as-is — no change requested there this round. The real ask is
about item 33: the special-attack zoom currently sets up an expectation
("something big is about to happen") that the move itself doesn't pay
off — no strong animation, effect, or sound sells the moment.

Research findings: not yet done — needs a look at existing signature/
special-move code and assets before implementation.

Decisions:
- Build one shared universal "special move" VFX/anim/SFX baseline
  (flash, particle burst, screen shake, stinger sound) applied to every
  signature move by default, so all specials get a consistent power-up
  feeling without hand-authoring each one.
- Layer hand-authored, per-species special treatments on top over time;
  where a species has a bespoke treatment, it overrides the baseline
  instead of stacking with it.
- Deploy-placement zoom (item 28) is not being changed this round.

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
Status: interviewed — ready to implement

Research findings:
- Current pause overlay (`StadiumUI.ts` ~1528–1531) shows a kicker
  "MATCH PAUSED" plus a flavor headline "TAKE A BREATHER."

Decisions:
- Simplify to plainly read "PAUSED" — drop the "TAKE A BREATHER" flavor
  text; the kicker/headline should just state the state, not add copy.

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
Status: interviewed — ready to scope

Decisions:
- All three dimensions get attention: stats/power ceiling (stronger base
  stats or a unique passive), a unique signature move/kit not shared
  with the non-Titan counterpart, and visual presentation (unique model
  treatment/scale/aura/entrance).
- Scoping/sequencing across the three not yet decided — needs its own
  planning pass.

## 35. Leveling is too fast — would feel more meaningful if slower
Status: interviewed — ready to implement

Decisions:
- Slow down the XP-to-level curve (increase XP required per level and/or
  reduce XP yields) so leveling feels earned. Chosen over raising
  upgrade costs (item 31) as the primary lever for this round; a full
  balance-numbers session is still likely needed eventually, but this is
  the committed starting move.

## 36. Want to send a Pokémon from the bench back to storage mid-match
Status: interviewed — ready to implement

Decisions:
- Allow it with no restrictions. Bench Pokémon aren't deployed/committed
  to the board, so sending one to storage mid-match is low-risk — just
  add the action.

## 38. Look into "Devil's Chess" for PvP inspiration
Status: interviewed — parked as backlog

Decisions:
- Logged as a design-research note for a future PvP mode pass. Not
  actionable in this feedback round.

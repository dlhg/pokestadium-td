# Playtest Feedback — 2026-09-15

Raw feedback from a playtest session, captured for triage. Each item gets an
interview pass with Drew before any change is scoped or implemented. Status
starts at `unreviewed` for all items.

## 1. Capture opportunity timer is invisible
Status: interviewed — ready to scope

Player has no way to tell how much time is left in a capture opportunity.

Decisions:
- Display as a depleting radial ring around the capture target/QTE UI.
- There is already a fixed-duration timer driving the capture window in
  code; the ring should bind to that existing value rather than introduce a
  new one.

## 2. Selling is confusing — purpose unclear
Status: done (6031bc1)

Unclear what selling a Pokémon is for. Players may think it's about making a
profit. Actual intent: free up a board position so a new/different tower can
be placed there.

Decisions:
- Permanent-loss "Sell" is replaced entirely by a "Recall" action: pulls the
  Pokémon off the board back to the bench/roster, no permanent loss, no
  currency payout.
- Redeploying a recalled Pokémon later costs the same as any normal
  deployment (no free-replace exploit, no extra penalty).
- Concern driving this: a player accidentally selling a Pokémon they like
  and losing it for good feels bad.

Follow-on idea (separate feature, not required for this fix): a "send for
research" sink for duplicate/unwanted Pokémon, so players still get some
value out of Pokémon they don't want on the bench. Needs its own scoping
pass later — not blocking the recall rename/behavior change.

## 3. Roster card price (bottom-right) is ambiguous
Status: done (7972b37)

Doesn't communicate whether the number is the Pokémon's worth (sell value) or
its deployment cost. Confirmed: it's the deployment cost.

Decisions:
- Reposition the number out of the anonymous corner and pair it with a clear
  label (near the placement button, not floating decoratively).
- Rename "Deploy" → "Send Out" throughout (the classic Pokémon-universe term
  for putting a Pokémon into action), to make the cost's context obvious:
  "Send Out — [cost]".
- Verb rename likely touches other UI copy beyond the roster card wherever
  "Deploy" appears — check for other occurrences during implementation.

## 4. Red banner reads too large relative to other UI
Status: done (7964a62 — combined with #6, see note there)

Red banner is at 125% scale and reads too big. Everything else could
probably be bumped up toward that scale instead, or the banner could be made
smaller/less frequent (or both).

Research findings (see `StadiumUI.ts` / `Announcer.ts`):
- This is the general announcer-callout banner, not a single-purpose alert.
  `announcer.trigger()` fires it for ~20 event types: battle_start,
  round_start, super_effective, critical_hit, not_effective, creep_faint,
  boss_spawn/defeat, elite_spawn/defeat, wave_cleared, tower_evolve,
  level_up, capture_throw/success/failed, life_lost, trait_* (once per
  trait/match), game_over, victory.
- Per-hit events (super_effective, critical_hit, not_effective) fire very
  often during combat, making the banner one of the most frequent popups in
  the game — not rare.
- No literal `scale(1.25)`/125% exists in code; measured banner-vs-stat-text
  ratios are ~1.1–1.2x depending on theme layer. "125%" was Drew's
  perceived-size estimate, not a coded value.

Decisions:
- Triage by event importance: only major/rare events (boss_spawn/defeat,
  wave_cleared, victory, game_over, capture results) keep the big banner.
  Per-hit combat events (super_effective, critical_hit, not_effective) get
  downgraded to a small floating text popup instead.
- Bump general UI text scale (stat text/labels) up ~15% to close the
  perceived gap from the other side.

## 5. Roster side panel should be collapsible
Status: done (4d1c38a)

Motivation: free up board space during play (not just decluttering).

Decisions:
- Toggle button/tab on the panel edge; collapsed state shrinks to a thin
  edge strip/tab rather than fully hiding, so it stays discoverable and is
  one click to reopen.
- Recommendation made by Claude and accepted by Drew without further
  discussion — revisit if it feels wrong once built.

## 6. Type-immunity mechanics (e.g. Ghost vs. physical) are unintuitive to non-Pokémon players
Status: done (7964a62 — combined commit with #4)

Implementation note: #4 and #6 share one mechanism (the strikeCreeps
effectiveness branch in MoveDelivery.ts), so they landed as a single
commit rather than two — splitting them would have meant fabricating
an intermediate state that was never actually reviewed. See the commit
message for the full reconciliation between the two decisions:
critical-hit and immunity ("NO EFFECT!") popups are always on;
super-effective/not-very-effective popups and the hover tooltip's
weakness list are gated behind a new "TYPE EFFECTIVENESS INFO"
pause-menu toggle, off by default. The hover-tooltip piece is scoped to
catchable creeps' existing tag tooltips (lists immunities/weaknesses),
not a full board-wide hover system — that would have been a much
bigger lift than the rest of this pass.

Considering a hover/instructional tooltip, but open to other ways to
communicate this info.

Decisions:
- Both in-the-moment feedback (visible "no effect"/immune popup or visual
  effect at the point of impact) AND a hover/tap tooltip on the target
  showing its type(s) and resistances.
- Default scope is hard immunities only (0x damage cases like Ghost vs.
  Normal/Fighting) — the most confusing case for newcomers.
- Full type-effectiveness display (super-effective/resist breakdown) is a
  player-toggleable option, off by default, for players who want deeper
  info without cluttering the default experience.

## 7. Venusaur's Sport/Carpet move is overpowered
Status: done (c13495f)

Can nearly stun-lock enemies. Counterbalance (not working on Grass types) is
insufficient. Idea: only keep it super-effective against types that Grass is
actually super-effective against, and nerf otherwise. Also, the move
increasing catch susceptibility compounds with catching already being too
easy (see #8).

Research findings ("Sport/Carpet" = "Spore Carpet", the tier-3 SPORES
upgrade for the Bulbasaur line):
- `src/td/progression/Species.ts` lines 79-85: tier 1 Stun Spore (hazard
  `stun_spore`, every 4th attack), tier 2 Sleep Powder (lv8, every 3rd
  attack), tier 3 Spore Carpet (lv16, every 2nd attack, unlocks signature
  move `spore_carpet` in `src/td/Signatures.ts` lines 125-126 — puts every
  grounded creep in range to sleep for 4s).
- `src/td/Hazard.ts` lines 33-36: `stun_spore` hazard = radius 2.4, patch
  lifetime 4s, applies 1.6s paralyze. `STATUS_REAPPLY_INTERVAL` is 1.0s
  (line 65) — since 1.6s > 1.0s, paralyze never lapses while a creep stands
  in the patch. This re-application overlap is the actual near-permanent
  stun-lock mechanism.
- The existing "no effect vs Grass" gate (`Hazard.update`, line 103-104;
  same pattern in `MoveDelivery.ts` line 264) only skips a hazard when
  `getCombinedEffectiveness(...) <= 0`. In `TypeMatrix.ts` TYPE_CHART (lines
  44-157), Grass→Grass is 0.5, not 0.0 — no type has a natural 0.0x
  immunity to Grass moves anywhere in the chart. The gate never fires for
  Grass creeps, so this exception is currently dead code and doesn't work.
- Grass's actual super-effective targets (2.0x) per the chart: Water,
  Ground, Rock. Everything else is neutral or resisted (0.5x: Fire, Grass,
  Poison, Flying, Bug, Dragon).
- Catch-bonus linkage (`StadiumTDGame.ts` `captureChance()`, lines 611-619):
  `stun`/`sleep`/`freeze` status grants +0.22 catch chance; any other status
  (including `paralyze`, which is what Stun Spore actually applies) only
  grants +0.12. So Stun Spore's catch-bonus contribution is smaller than
  assumed — Sleep Powder's `sleep` status is the one hitting +0.22.

Decisions:
- Loosen the reapply lock (increase reapply interval and/or shorten
  paralyze duration) so the paralyze window has gaps — ends the
  near-permanent lock regardless of type.
- Full-strength stun/sleep effect only against the types Grass is actually
  super-effective against (Water, Ground, Rock, per the real chart);
  reduced duration/chance against everything else.
- Grass-type creeps get an explicit hard-coded 0-effect override specific to
  this hazard/move (not reliant on the general type chart, since no natural
  0.0x exists there) — changing the shared TYPE_CHART was ruled out to
  avoid affecting all other Grass-type moves game-wide.
- No separate fix needed for the catch-bonus compounding (#8 covers
  catching difficulty generally); the paralyze status was already only
  getting the smaller +0.12 bonus, not the assumed +0.22.

## 8. Catching Pokémon is too easy
Status: interviewed — ready to scope

Missing a throw in the QTE isn't punishing enough. Explore rare QTE variants
tied to rare encounters (e.g. shrinking-circle timing check, WarioWare-style
microgames).

Decisions:
- Missed throws increase escape chance, via a gentle linear ramp per
  consecutive miss (not aggressive/exponential) — small penalty that adds
  up, doesn't punish a single miss too harshly.
- Build a lightweight QTE-variant system so multiple minigame types can be
  swapped in by rarity tier, even if only 1-2 variants ship initially.
- Distinct/harder QTE variants apply to rare/legendary tier encounters only;
  common encounters keep the existing QTE to keep early-game friction low.
- Still needs a code check on current escape-chance formula and existing
  rarity tiers before implementation.

## 9. More items wanted (trainer cards, potions, Poké Flute, Pokédex, etc.)
Status: interviewed — parked as backlog

Look into other items from the Pokémon universe as candidates.

Decisions:
- Potion mechanics need more research before committing (heal HP vs. cure
  status — undecided).
- Not ready to commit to which 1-2 items to prototype yet. Parked as
  backlog; revisit with a dedicated items/economy design pass rather than
  bundled into this feedback round.

## 10. Great/Ultra Ball purchase-window restriction isn't communicated well
Status: done (b0d98da)

Not obvious to new players that Great/Ultra Balls can only be bought
between rounds. The option disappearing mid-round surprises them; the
after-round placeholder button text doesn't sufficiently explain the
mechanic.

Decisions:
- Keep the existing disappear/reappear behavior (not switching to
  always-visible-but-disabled) — just teach it better. This means the
  "proactive greyed UI cue during rounds" idea is superseded by keeping the
  disappear behavior; the one-time tutorial/tooltip is the primary fix.
- Add a one-time tutorial/tooltip the first time this is relevant, so the
  player understands the between-rounds-only window in advance.
- When the buy option reappears at round end, give it an entrance animation
  to draw the eye — subtle squash-and-stretch plus a brief color-gradient
  flash/opacity pulse — instead of just popping into existence.

## 11. Game speed options may need to go above 3x
Status: done (dcc7db6)

Could partly be a symptom of the game being too easy overall rather than a
pure speed/UX issue.

Decisions:
- Add a 4x speed option now regardless of the difficulty-pass work in #7/#8
  — low-risk and useful for fast-forwarding trivial/cleared content either
  way.

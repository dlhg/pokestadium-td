# The Send-Out Set Piece

Covers `td/SummonSequence.ts` and its reuse of `engine/EnergyForm.ts` and
`engine/JaggedBeam.ts`.

## The relationship to capture

Capture and deployment are two directions through the same fictional process:

```text
capture: body -> living light -> ball
send-out: ball -> living light -> body
```

The send-out therefore reverses the capture's central conversion beat, not its
whole timeline. A wobble, verdict, reversed impact, or backwards rebound would
carry the uncertainty and resistance of a catch into a moment that should feel
decisive.

## Beat sheet

| Beat | Length | What it is |
| --- | --- | --- |
| `throw` | 0.62s | The ball arcs in from the player's side of the current camera. |
| `burst` | 0.26s | It stops in mid-air, turns its open mouth toward the pedestal, and casts a jagged tether. |
| `reveal` | 0.90s | A small light-form rides the tether outward, grows to full size, and cools back into the Pokémon's own colours. |
| `ready` | 1.00s | The ball and tether are gone; the cry and hero pose hand control back. |

The whole entrance is 2.78 seconds, slightly shorter than the cylinder reveal
it replaced. As with capture, the sequence runs in real time while
`worldTimeScale` nearly stops ordinary play.

## Staging decisions

The ball releases above, across, and slightly behind the Pokémon rather than
landing on the tower pad. The camera holds its established approach angle when
the ball freezes. The light-form therefore travels toward the lens while the
ball stays out of its silhouette, and the lateral offset gives the tether a
readable diagonal in the low hero shot.

The Pokémon's root follows `JaggedBeam.pointAt()`, so the light travels along
the bolt's visible kinks instead of merely scaling up at its destination.
`EnergyForm` begins fully charged in the ball's blue-white tint and runs toward
the model's original colours before returning its real materials.

The tower stays deployment-locked throughout the entrance. If an authentic GLB
finishes loading during the reveal, the energy treatment transfers to the new
mesh so it cannot pop into the shot fully materialized.

## Verification

```bash
npm run build
python3 take_screenshot.py summon_throw
python3 take_screenshot.py summon_burst
python3 take_screenshot.py summon_reveal
python3 take_screenshot.py summon_materialize
python3 take_screenshot.py summon_ready
```

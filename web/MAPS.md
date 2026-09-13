# Tower-defense courses

The course selector previews the actual route and terrain data. Difficulty tabs
filter five authored courses; each starts with $420 and six lives. The first wave
waits for **Start Match**, allowing time to plan. **Maps** pauses the match while
browsing; **Resume Match** keeps it, and choosing a course starts a fresh match.

| Course | Difficulty | Placement decision |
| --- | --- | --- |
| Viridian Gardens | Easy | A long curling trail lets inside-bend towers cover multiple stretches. |
| Mt. Moon Pass | Medium | Rock ridges occupy the interiors of three switchbacks, leaving small firing pockets. |
| Cerulean Crossing | Medium | An unbuildable river divides two banks; two bridges concentrate passing enemies. |
| Power Plant | Hard | Shorter twin circuits alternate spawns between entrances; shared junctions compete with exit coverage. |
| Indigo Plateau | Hard | Three terraces climb from Victory Road to the League gate. High ground reaches further; stairs slow climbers; the summit is small. |
| Mt. Silver Crown | Hard | Twin trails coil up five elevation bands. A short steep route and a long switchback route trade speed for exposure before looping around the summit. |

## Elevation (Indigo Plateau)

Inspired by the Let's Go Route 2/22/23 terraces, the Mt. Silver ledges and the
Indigo Plateau stair. The story reads bottom to top: Victory Road cave → Route 23
river bridge → brick badge check → stair to the Route 23 terrace (Pokémon Center,
waterfall spring) → stair to the badge-check terrace (torches, Strength boulders
between two parallel lanes) → the grand stair between the Indigo pillars.

- **Build on level ground.** A footprint whose ground varies more than 0.75
  (`MAX_FOOTPRINT_RELIEF`) is `too_steep`. Gentle slopes build; the pad's stone
  footing fills the gap. Cliff faces do not.
- **High ground.** Range is measured across the ground, then extended by 4% per
  unit the tower stands above the target (capped at a 9-unit drop, +36%).
  Placement shows the bonus against the lowest lane.
- **Stairs are choke points.** Climbing slows creeps (`CLIMB_SLOWDOWN`): about
  half pace on a 0.4 grade.
- **Sentinel Rock** is a lone mesa above the entry trail; the **east spur** hangs
  over the first stair; the **summit** holds only a few towers.

## Twin ascent (Mt. Silver Crown)

Mt. Silver expands the plateau idea into two asymmetric climbs. The red trail
takes short, steep stairs while the blue trail runs longer switchbacks; climbing
slowdown makes their travel times closer than their lengths suggest. The routes
exchange the inside and outside edge on each shelf, repeatedly changing which
high-ground positions can cover both.

- **Five elevation bands** rise from the cave floor through the pine shelf,
  doubleback balcony and wind saddle to the frozen crown.
- **The middle shelves are the prize.** Parallel passes come within shared tower
  range, but rock spines and lane clearance prevent building in the obvious
  center pocket.
- **The summit is a loop, not a straight finish.** Both trails pass around the
  crown before meeting beneath the Mt. Silver gate, giving the final towers a
  last crossfire opportunity.

These are original procedural environments in the Stadium arena. The layouts
take inspiration from the readable paths, terrain constraints and bridge
crossings in [BTD6 map screenshots](https://steamcommunity.com/app/960090/screenshots/),
including [Peninsula](https://w.atwiki.jp/btd6/pages/107.html). No BTD6 images or
assets are included in the game.

## Authoring

- `src/td/MapCatalog.ts` owns route control points (optionally `[x, z, y]` to pin a
  stair landing), terrace outlines (`terrain.plateaus`), story decor, obstacle circles, water
  polygons, bridges, palette, difficulty and strategy text.
- `MapTerrain.ts` bakes one height grid: terraces drop away as cliffs outside
  their outline, the arena rim trims everything to zero, and lanes are cut into
  the hillside. Rendering, movement, placement and picking all read it.
- `MapGeometry.ts` samples each route at approximately 0.45 arena units. Those
  same points drive the lane ribbon, menu preview, movement and placement checks.
- `src/stadium/MapScenery.ts` renders terrain and props. Obstacle bases mark their
  exact blocked circle. Water blocks the entire tower footprint; bridge lanes
  remain unbuildable. Obstacles restrict placement, not attacks or line of sight.
- `WaveManager` cycles through every route in a wave. Total enemy counts and
  rewards are unchanged. Target priorities compare distance to the exit, so
  waypoint count does not bias targeting on courses with multiple routes.

## Verification

Run `npm run test:maps` for route continuity, lane collision, obstacle clearance,
bridge coverage and usable placement-space checks, followed by `npm run build`.
After building, capture the selector and individual courses:

```sh
python3 take_screenshot.py map_select
python3 take_screenshot.py map_open-cup
python3 take_screenshot.py map_boulder-circuit
python3 take_screenshot.py map_cerulean-crossing
python3 take_screenshot.py map_power-plant
python3 take_screenshot.py map_indigo-plateau
python3 take_screenshot.py map3d_indigo-plateau    # same course from the stands
python3 take_screenshot.py battle_indigo-plateau   # towers on each tier, climbers on the stairs
python3 take_screenshot.py map_mt-silver-crown
python3 take_screenshot.py map3d_mt-silver-crown
python3 take_screenshot.py battle_mt-silver-crown
```

Course captures use a paused tactical view without the opening announcer banner.
Difficulty labels describe geometry and placement pressure; combat balance can
be tuned separately as the combat system develops.

# Tower-defense courses

The course selector previews the actual route and terrain data. Difficulty tabs
filter four authored courses; each starts with $420 and six lives. The first wave
waits for **Start Match**, allowing time to plan. **Maps** pauses the match while
browsing; **Resume Match** keeps it, and choosing a course starts a fresh match.

| Course | Difficulty | Placement decision |
| --- | --- | --- |
| Viridian Gardens | Easy | A long curling trail lets inside-bend towers cover multiple stretches. |
| Mt. Moon Pass | Medium | Rock ridges occupy the interiors of three switchbacks, leaving small firing pockets. |
| Cerulean Crossing | Medium | An unbuildable river divides two banks; two bridges concentrate passing enemies. |
| Power Plant | Hard | Shorter twin circuits alternate spawns between entrances; shared junctions compete with exit coverage. |

These are original procedural environments in the Stadium arena. The layouts
take inspiration from the readable paths, terrain constraints and bridge
crossings in [BTD6 map screenshots](https://steamcommunity.com/app/960090/screenshots/),
including [Peninsula](https://w.atwiki.jp/btd6/pages/107.html). No BTD6 images or
assets are included in the game.

## Authoring

- `src/td/MapCatalog.ts` owns route control points, obstacle circles, water
  polygons, bridges, palette, difficulty and strategy text.
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
```

Course captures use a paused tactical view without the opening announcer banner.
Difficulty labels describe geometry and placement pressure; combat balance can
be tuned separately as the combat system develops.

# Course Card Art Recipe

This directory holds the high-resolution masters for the course-select scenic
postcards. The canonical runtime derivatives live in `public/ui/map-cards/`.

Use this recipe for every future course so it joins the existing family instead
of becoming an independently art-directed illustration.

## References

Provide exactly two reference images:

1. **Style reference:** `viridian-gardens-v2.png`, the accepted camera, stadium,
   lighting, low-poly finish, simplicity, and contrast target.
2. **Geometry reference:** a current tactical screenshot of the new playable map,
   captured with `python3 take_screenshot.py map_<map-id> 1440x900`.

The geometry reference is authoritative. Screenshots can go stale, so capture it
from the current build rather than reusing an older file without checking it against
`src/td/MapCatalog.ts`.

## Shared generation prompt

Replace every angle-bracketed field. Keep the rest unchanged unless the accepted
family itself is deliberately revised.

```text
Use case: stylized-concept
Asset type: text-free scenic background for a 6:5 course-selection card,
displayed about 250 by 205 pixels

Input images: Image 1 is the approved style reference only: match its elevated
three-quarter camera, indoor stadium framing, exhibition lighting, faceted low-poly
finish, simplicity, and contrast. Image 2 is the authoritative <COURSE NAME>
gameplay-layout reference: ignore its HUD and crowd but preserve its route, terrain,
water, bridges, obstacles, and authored decor.

Primary request: depict <COURSE NAME> as <ONE-SENTENCE VENUE FANTASY>.
Preserve <EXACT ROUTE TOPOLOGY AND ENTRY/EXIT DESCRIPTION>.
Preserve <EXACT TERRACE/WATER/BRIDGE COUNTS AND RELATIVE PLACEMENT>.
Preserve exactly <AUTHORED OBSTACLE COUNTS BY VISUAL TYPE>, in the same relative
positions as Image 2. Preserve <AUTHORED DECOR THAT MUST READ AT CARD SIZE>.
Do not add other <LIST THE OBJECT CLASSES THAT WOULD LOOK LIKE GAMEPLAY>.

Style/medium: late-1990s low-poly console sports-broadcast environment, broad
faceted geometry, simple readable silhouettes, restrained low-resolution detail,
graphic rather than painterly

Composition/framing: match Image 1's elevated three-quarter near-orthographic
overview; keep the playable course readable after a 6:5 crop; the route silhouette
and defining terrain feature must survive at 256 pixels wide

Lighting/mood: <COURSE-SPECIFIC LIGHTING>, presented inside a dark cobalt stadium
with restrained warm tournament spotlights

Color palette: <MAPCATALOG PALETTE IN PLAIN LANGUAGE>, deep navy stadium shadows,
restrained tournament gold

Constraints: gameplay geometry, relative placement, and exact obstacle counts must
follow Image 2; no words, letters, numbers, readable signs, logos, UI, frames,
buttons, characters, creatures, Pokémon, trainers, watermark, photorealism,
unrelated structures, extra scenic obstacles, or giant Poké Ball motif
```

Generate one course per image-generation call. Do not ask for several distinct
courses in one output.

## Geometry checklist

Before generating, copy these facts directly from `MapCatalog.ts` into the prompt:

- number of routes, where each enters and exits, and its recognizable silhouette;
- number and order of terraces or storeys;
- water regions and bridge count;
- exact counts for trees, pines, rocks, generators, pillars, and other obstacles;
- caves, arches, waterfalls, torches, pools, and other authored decor;
- explicit exclusions for tempting but absent landmarks.

This checklist exists because a visually attractive card with a fountain, building,
or extra rock is still wrong if the object is absent from the playable course.

## Cleanup edit prompt

If the first result has the right style but invented or omitted props, edit it rather
than regenerating the whole composition:

```text
Use case: precise-object-edit
Asset type: scenic background for a 6:5 course-selection card

Input images: Image 1 is the edit target and establishes the accepted camera, crop,
stadium, lighting, route, terrain, and low-poly style. Image 2 is the authoritative
gameplay-layout reference; ignore its HUD and crowd but use its obstacle placement
and counts.

Primary request: correct only <THE SPECIFIC GEOMETRY OR PROP ERROR> so the postcard
faithfully represents the current <COURSE NAME> map.

Required changes: <EXACT REMOVALS, ADDITIONS, COUNTS, AND REPLACEMENT SURFACES>.

Invariants: preserve Image 1's camera, crop, stadium bowl, route, terrain, lighting,
palette, and late-1990s low-poly sports-broadcast finish.

Constraints: change only the specified error; do not add or move anything else; no
words, letters, numbers, signs, logos, UI, frames, characters, creatures, Pokémon,
trainers, watermark, photorealism, or invented landmarks.
```

Make one targeted change per edit pass. Recount every authored obstacle afterward.

## Promotion and processing

Save the accepted master here as `<map-name>-vN.png`. Never overwrite a prior
accepted master while exploring.

The accepted cards use a centered 6:5 crop, an area downsample to 256×213, and
five-bit-equivalent RGB snapping. The command used for the current set is:

```bash
ffmpeg -y -loglevel error \
  -i art-source/ui/map-cards/<map-name>-vN.png \
  -vf "crop=ih*6/5:ih,scale=256:213:flags=area,lutrgb=r='floor(val/8)*8':g='floor(val/8)*8':b='floor(val/8)*8'" \
  public/ui/map-cards/<map-name>.png
```

Then add the runtime path to `CARD_ART` in `src/td/MapPreview.ts`, build, run the map
tests, and inspect the entire course-select screen. The scenic card is presentation;
the live SVG diagram remains the authoritative route view on hover and focus.

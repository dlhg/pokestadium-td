# Generated Art & Texture Plan

PokéStadium TD already has a strong presentation language: dark cobalt and
indigo molded panels, cream shells, tournament-gold accents, chunky broadcast
type, low-poly models, and a CRT finish. Generated art should close the gaps
between the strongest screens and the flatter ones without creating a second,
unrelated art style.

The working rule is:

> Generated imagery supplies **place, ceremony, and material**. The game itself
> supplies **information, typography, icons, and Pokémon**.

This is a production plan, not a commitment to replace every procedural surface.
Each phase has a small proof-of-concept and a stop/go review before it expands.

## Goals

- Make courses feel like distinct destinations before and during a match.
- Give progression and match conclusions more ceremony.
- Bring the relatively flat 3D course materials closer to the tactile HUD.
- Keep every new asset recognizably part of the existing Stadium broadcast skin.
- Build a repeatable generation, processing, integration, and review workflow.

## Non-goals

- Replacing functional CSS/SVG controls with raster images.
- Generating Pokémon portraits; the real in-game models remain the source of truth.
- Baking names, labels, logos, buttons, or other readable text into images.
- Making the environments photorealistic or adding dense modern-game detail.
- Redesigning the title screen, which is already the presentation benchmark.
- Shipping original ROM-derived art or imitating a specific official asset.

## Existing visual baseline

The new work should be judged against these existing assets and screens:

- `public/ui/title-screen-bg.png`: lighting, atmosphere, and overall polish target.
- `public/ui/course-select-stadium.jpg`: shared pre-match environment.
- `public/ui/indigo-quilt.png`, `cobalt-plastic.png`, and `cream-plastic.png`:
  tactile material family for the interface.
- `public/ui/types/*.jpg`: precedent for restrained generated art beneath live UI.
- `screenshot_title_screen.png`, `screenshot_map_select.png`,
  `screenshot_team_select.png`, and `screenshot_ui_detail.png`: composition and
  legibility references.

The title screen, type-art roster cards, and molded panel skin should not drift to
accommodate new imagery. New imagery adapts to them.

## Art direction

### Shared characteristics

- Late-1990s low-poly console sports broadcast.
- Broad faceted forms and simple silhouettes that survive heavy downsampling.
- Deep navy/cobalt shadows, warm cream structure, selective tournament gold, and
  small red accents.
- A dark value range with one controlled pool of light; UI copy must remain the
  brightest layer.
- Slight texture grain, restrained dithering, and approximately five-bit color
  after processing.
- Graphic, readable environmental storytelling rather than painterly detail.
- No text, watermark, UI furniture, Pokémon, trainers, or franchise logos.

### Asset invariants

- Course art uses one consistent elevated three-quarter camera family.
- Important course landmarks remain recognizable, but generated art never promises
  route geometry that the playable map does not have.
- Decorative backplates reserve calm negative space for their live UI content.
- Tileable textures contain no directional lighting or large unique landmark.
- The same cobalt/gold broadcast frame surrounds every cup and venue; identity is a
  secondary layer, not a new skin.

## Priority order

### P0 — Course-card proof of concept

The map cards are the best first target. They are prominent, isolated, reversible,
and currently the clearest gap between the rich stadium frame and flat schematic
content.

Build one vertical slice for **Viridian Gardens**:

1. Capture or select a clean in-game view of the course as a geometry reference.
2. Generate one text-free scenic postcard using that view as a reference, with the
   shared camera, palette, and lighting rules above.
3. Bake it down to a 6:5 card image at roughly 256 by 213 texels, five bits per RGB
   channel, and display it with `image-rendering: pixelated`.
4. Preserve the existing `MapPreview.ts` route drawing as an information layer:
   either a compact inset or a focus/hover overlay. Do not sacrifice route clarity.
5. Put the changed card beside the untouched cards and capture the complete course
   select. Judge the system in context, not the image by itself.

If Viridian works, repeat the slice for **Power Plant**. Those two courses are
deliberately opposite: organic/daylit versus industrial/electric. If they feel like
one family without feeling interchangeable, the direction is robust enough to
expand.

#### P0 acceptance criteria

- The player can still understand the route before choosing the course.
- The art reads at actual card size; details that only work enlarged do not count.
- Viridian and Power Plant share camera, contrast, texture scale, and finishing.
- The generated scene does not contradict a major route, landmark, or elevation.
- Locked-card grayscale treatment remains legible.
- The card is visually richer but does not compete with the course name or lock state.
- The complete screen still reads as Pokémon Stadium rather than a modern card grid.

### P1 — Remaining course postcards

After P0 is accepted, author one scenic card for every course. Use the accepted
Viridian or Power Plant result as the style reference for each later generation.
Every asset still gets its own prompt and generation pass.

Suggested venue hooks:

| Course | Visual hook |
| --- | --- |
| Viridian Gardens | Garden switchbacks, round trees, warm exhibition lights |
| Mt. Moon Pass | Layered stone hairpins, moonlit mauve rock faces |
| Cerulean Crossing | Divided green banks, two bridges, cool river reflections |
| Power Plant | Twin circuits, reactor glow, enamel and hazard markings |
| Indigo Plateau | League ascent, terraces, waterfalls, distant gate |
| Bell Tower | Nested lacquered storeys, forest haze, warm lantern light |
| Mt. Silver Crown | Paired climbing trails, icy shelves, severe summit light |
| Seafoam Islands | Cold channels, broken ice, cavernous blue depth |

Keep route-specific detail grounded in `MapCatalog.ts`; do not let image generation
invent the course design.

### P2 — Venue material kits

Give the playable maps low-resolution material variation that matches their card
art. Prefer small reusable families over unique textures for every object:

- ground and path surface;
- cliff/edge surface;
- one structural material such as stone, lacquered wood, or painted metal;
- one sparse decal sheet for cracks, petals, frost, grates, or maintenance marks;
- one text-free jumbotron or hanging-banner background.

Start with Viridian and Power Plant again. Material textures should normally bake to
64–128 texels per tile; decals may be 128–256 with transparency. Broad geometry,
vertex color, and lighting remain responsible for the scene. Texture contributes
grain and history, not photorealism.

Use scenic card art as direction, not as literal texture source. Verify seams,
repetition, mip behavior, and contrast in tactical, stadium, and action cameras.

### P3 — Match-result ceremony

Add quiet, text-free backplates behind the existing reports:

- **Victory:** illuminated presentation dais, trophy silhouette, crowd-camera flashes,
  restrained confetti, warm gold focus.
- **Defeat:** empty pitch, dim scoreboard glow, receding spotlights, muted red focus.

The live report remains intact above the art. Keep the image dark enough that names,
XP, tags, and action buttons retain their current contrast. Motion, if any, should
come from CSS light sweeps or particles rather than an animated raster asset.

### P4 — Cup identity

Create a restrained identity kit for Little, Poké, Great, and Prime Cups:

- one embossed repeating motif;
- one text-free crest or medal centerpiece;
- one transition/results backplate;
- a controlled accent palette derived from the existing cup colors.

Apply cup identity as a tint, watermark, or secondary plate within the existing
cobalt/cream/gold system. Do not create four unrelated interface themes.

### P5 — Pokémon showcase bays

If the earlier phases succeed, replace the generic radial stages used by starter,
gift, summary, and registration screens with a small family of abstract broadcast
showcase chambers. Continue placing the real 3D model over the image. Avoid bespoke
art for every species; a type- or role-based family is the upper limit that remains
maintainable.

This is lower priority because the existing stages are clean, legible, and already
use the correct models.

## Keep code-native

The following stay CSS, SVG, canvas, or real-time 3D:

- buttons, tabs, shells, focus states, meters, and progress bars;
- type badges, Poké Ball indicators, locks, arrows, and input prompts;
- names, cup rules, prices, move descriptions, and other text;
- map route geometry and strategic overlays;
- Pokémon and tower portraits, which should render from the actual models;
- cinematic flashes, particles, vignettes, and camera motion.

Generated images are poor sources of exact symbols and repeated text, and rasterizing
those elements would weaken responsive sizing and accessibility.

## Asset workflow

### 1. Reference

Before generating a course or screen asset, capture the current implementation and
label each input explicitly:

- **geometry reference:** the playable map or UI that the art must not contradict;
- **style reference:** the accepted title/card art that controls finish and palette;
- **composition reference:** the exact UI crop the asset must serve.

### 2. Generate

Use the built-in image-generation workflow by default. Generate one distinct asset per
call. Start with one draft, review it at card or screen size, and make only one targeted
change per iteration.

The canonical reusable course-card prompt, cleanup-edit prompt, geometry checklist,
and processing command live beside the masters in
[`art-source/ui/map-cards/README.md`](../art-source/ui/map-cards/README.md). Its shared
generation scaffold is:

```text
Use case: stylized-concept
Asset type: 6:5 course-select scenic postcard behind a live route overlay
Primary request: depict <course and its authored landmarks>
Input images: Image 1 is the geometry reference; Image 2 is the style reference
Style/medium: late-1990s low-poly console sports-broadcast environment,
faceted forms, compressed texture detail, graphic rather than painterly
Composition/framing: elevated three-quarter overview, central playable space clear,
simple silhouettes that survive reduction to approximately 256 px wide
Lighting/mood: dramatic stadium presentation with one controlled light focus
Color palette: deep cobalt/navy shadows, course palette, restrained tournament gold
Constraints: preserve the referenced course identity and major landmarks; no text,
logos, UI, characters, Pokémon, trainers, watermark, or photorealism
```

For tileable textures, explicitly request a seamless, evenly lit orthographic material
sample with no large landmark and no baked shadow direction.

### 3. Store and process

- Preserve accepted high-resolution sources under the non-runtime `art-source/ui/`
  tree in a named subdirectory such as `map-cards/`, `textures/`, or `results/`.
- Put runtime-ready derivatives under matching `public/ui/` directories.
- Use lowercase kebab-case names: `viridian-gardens.png`,
  `power-plant-ground.png`, `result-victory.png`.
- Never overwrite an accepted source while exploring; use `-v2`, `-v3`, and promote
  only after review.
- Run `tools/pixelate_ui_art.py` for downsampling and five-bit RGB quantization.
- Keep high-resolution opaque source art in JPEG or PNG as appropriate. The existing
  `pixelate_ui_art.py` path emits RGBA PNG, so processed runtime derivatives use PNG;
  preserve real alpha for decals.
- Keep runtime assets near their display resolution; the CRT pass should not be fed
  unnecessarily large smooth images.

High-resolution sources stay outside `public/` so Vite does not copy them into the
production bundle. Existing legacy sources under `public/ui/source/` can move to
`art-source/ui/` in a separate cleanup; do not add new large masters there.

### 4. Integrate

- Layer live UI over the image; never flatten the assembled screen into one bitmap.
- Use a consistent color wash or gradient over scenic assets so their value range is
  stable even when generations vary.
- Keep route previews and accessibility labels in the DOM.
- Provide a CSS fallback color/gradient so a missing image does not break the screen.
- Lazy-load later phases if their cumulative asset weight becomes material.

### 5. Verify

For every integrated visual asset:

1. Run `npm run build`.
2. Run the relevant headless tests (`npm run test:maps` for course work and
   `npm run test:gameplay` for match presentation).
3. Run `python3 take_screenshot.py`.
4. Inspect the complete screen at 1280×720 and 1440p, plus the narrow responsive
   layout if it is affected.
5. Check normal, hover/focus, selected, and locked/disabled states.
6. Check the asset with CRT effects enabled and disabled.
7. Compare against the previous screenshot and retain it until the direction is
   accepted.

## Stop/go checkpoints

Do not generate a full set before answering these questions:

1. **After Viridian:** Does scenic art improve the card without hiding strategy?
2. **After Power Plant:** Can the art direction span very different venues?
3. **After two material kits:** Does added texture improve the 3D maps at normal
   camera distance, or only in close-up screenshots?
4. **After one result backplate:** Does ceremony improve without reducing report
   legibility?
5. **After one cup kit:** Is cup identity noticeable without fragmenting the global
   interface skin?

A failed checkpoint means revise or stop that branch. Existing procedural art remains
a valid fallback.

## Recommended first task

Start with **one Viridian Gardens map-card prototype**, not a full asset batch.

It has the best risk/reward profile: the surface area is small, the before/after is
easy to judge, integration does not touch gameplay, and its simple green garden forms
will immediately reveal whether generated art survives the N64 processing pass. Use an
in-game Viridian view as the geometry reference, integrate the result behind the real
route overlay, and review the entire course-select screenshot.

Only after that card is accepted should Power Plant be generated as the style-range
test. This keeps image-generation usage low and prevents an unproven look from being
multiplied across the whole game.

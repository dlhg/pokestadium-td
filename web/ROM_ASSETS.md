# Local Pokémon Stadium assets

The web game can use models and arena geometry extracted locally from a
player-supplied Pokémon Stadium ROM. No ROM data or generated Nintendo assets
belong in version control or distributable builds.

## Supported ROM

Only Pokémon Stadium (USA) Revision 2 is accepted:

- Size: `33,554,432` bytes
- MD5: `6dc6820cef755fc1253d06df45c9bd2a`
- SHA-1: `0d3b1d740c6ee6da6923550bf24ad827262fd8c0`
- Recommended local path: `baseroms/us/Pokemon Stadium (USA) (Rev 2).z64` —
  but the filename doesn't matter (see below); any `.z64`/`.n64`/`.v64`
  dropped anywhere under `baseroms/` is found and checked automatically.

"Rev 2" is a dump-preservation label (No-Intro/Redump style) for a later
cartridge printing of the same US release. The game never displays this
number to a player, but it isn't arbitrary either: it's the same value as
the byte at offset `0x3F` of the ROM's own N64 header (`0x02` for this
image), which is Nintendo's internal cartridge revision field. Different
revisions can differ byte-for-byte, and this pipeline's extraction offsets
(`tools/stadium_pipeline/rom.py`) are hardcoded to this one printing, so any
other revision — including the pret decomp's own default target, USA
Revision 0 (see `AGENTS.md`) — is rejected rather than guessed at. Don't run
the decomp's `make init` against this image (it expects Revision 0's
different layout, at its own `baseroms/us/baserom.z64` convention).

Watch out for one unrelated naming collision if you go looking for a copy:
some ROM sites also list a `Pokemon Stadium (USA) (Rev A) (Kiosk Demo)`. That
"Rev A" is *not* another name for one of the numbered Rev 0/1/2 home-release
revisions above — it's a different product entirely (a store kiosk demo
cart) with its own, separate version history. Only a numbered `Rev 2` dump
matching the hashes above will work here.

### How the file is found and checked

`find_rom()` in `tools/stadium_pipeline/rom.py` looks in the recommended
spot first, then scans `baseroms/`, `web/baseroms/`, the repo root, and
`web/` for any `.z64`/`.n64`/`.v64` file. Every image it finds is validated
by *contents*, not name or location — a ROM dropped in with any filename
passes or fails the same way, and the first one that validates is used. In
order, validation is:

1. **Header magic bytes** at offset 0 identify the on-disk byte order and
   normalize `.v64` (byte-swapped) and `.n64` (word-reversed) dumps to
   native `.z64` big-endian layout. Anything else raises `not an N64 ROM`.
2. **Exact size**: must be `33,554,432` bytes.
3. **Exact MD5** of the normalized bytes: must equal
   `6dc6820cef755fc1253d06df45c9bd2a`.

Any mismatch raises a `ValueError` naming the size/MD5 it found and the
size/MD5 it expected. Pass `--rom` to any of the pipeline scripts to point
at a specific file instead of auto-detecting.

`npm run dev` and `npm run build` run
`tools/check_stadium_assets.py --extract-if-missing` first. With a valid ROM
and no extracted models (or models from a different ROM), it runs the full
extraction below automatically, once, in about a minute. Otherwise it prints
why the game will fall back to procedural models: no ROM found anywhere
nearby, a ROM whose contents aren't Rev 2, or a failed extraction. In the
browser, the model loader logs the fallback reason to the console.

## Vertical slice

From `web/`, run:

```sh
npm run extract:stadium
```

This validates all three Rev 2 archives, exports all 151 Pokémon plus the 64
post-Pokédex prop, trophy, minigame, and cinematic slots as textured, skinned
GLBs with their original 30 fps skeletal clips, writes a data-derived
animation-role and move manifest, exports the 15 original 20×20 type badges
from the common menu UI bank, and converts member 7 of `stadium_models`
(Brock's Gym Leader Castle room) to the compact `SNA2` browser cache.

Output lives under `web/public/generated/stadium/` and is gitignored. The game
loads it lazily. If the manifest, a species, or the arena cache is absent, the
existing procedural art remains the explicit fallback.

For a quick Pikachu-only extraction smoke test:

```sh
python3 tools/extract_stadium_assets.py --only-pikachu
```

Smoke-test output is isolated under
`web/public/generated/stadium/smoke/pikachu/`, so it cannot replace the full
manifest used by the game.

Use `--validate-only` to inspect archive counts, bounds, compression wrappers,
and representative identities without writing derived assets.

### Asset viewer

After extraction, start the normal development server and open:

```text
http://localhost:3004/asset-viewer.html
```

The viewer lists every exported Pokémon and extra model. It supports search,
group filters, orbit/pan/zoom, animation selection, playback and scrubbing,
speed and loop controls, turntable mode, wireframe mode, and archive metadata.
Choose a model to put its slug in the URL, making a particular asset easy to
bookmark or share with another local development session. Extra-slot names are
research labels where an identity is visually clear; unidentified slots retain
their archive number.

## Verified Rev 2 layout

| Data | Offset | Members |
| --- | ---: | ---: |
| Battle portraits | `0x535260` | 54 |
| Stadium models | `0x56FF10` | 18 |
| Pokémon models | `0x919000` | 215 |
| Per-species battle data | `0x70E6B0` | 151 fixed-stride tables |
| Battle-data pointer table | `0x76910` (`0x80075D10` VRAM) | 151 pointers |

Validation requires bounded archive records and `PERS-SZP` wrappers, performs
Yay0 decompression, confirms member 24 identifies itself as species 25
(Pikachu), checks that its battle table only references exported clips, and
converts the mapped Brock stage as a relocatable `FRAGMENT`.

## Current fidelity and next stages

- Pokémon texture flipbook animation (blinks, dizzy eyes, and similar state)
  is preserved in source metadata but is not yet driven by Three.js.
- Tower attacks resolve their move name through the extracted per-species move
  table and play that Stadium skeletal clip. Idle, entrance, hit, and faint
  roles come from the extracted context slots rather than clip-name guesses.
- The arena uses original room geometry, textures, UVs, material grouping, and
  vertex-light approximation. The creep path and tower pedestals remain
  authored tower-defense overlays on the native floor.
- `npm run dev`, `npm run build`, and `npm run extract:stadium` automatically
  check for a locally generated announcer pack. If it is absent and the
  supported ROM is present, they extract the original 823 MORT announcer clips
  into `web/public/generated/stadium/audio/announcer/`. The first extraction
  fetches and compiles a pinned, MIT-licensed MORT decoder into an ignored
  local cache; it never downloads game data. A missing ROM or unavailable
  decoder leaves the browser speech fallback in place instead of failing the
  web build.

  Original menu/move SFX and sequence music use a separate N64 bank renderer;
  they remain procedural until that decoder and the cue map are implemented.

- The same commands also check for locally generated Pokémon icon portraits.
  If absent and the ROM is present, `tools/extract_stadium_icons.py` slices
  149 of the 151 species portraits out of the uncompressed icon table at ROM
  offset `0x820000` (documented in `yamls/us/rom.yaml`) into
  `web/public/generated/stadium/icons/{dex}.png`. The table has no in-ROM
  index of which icon is which species; the order was recovered by hand (see
  the script's docstring) and two slots — Ivysaur and Venusaur — never
  decoded to a recognizable sprite, so the roster info card falls back to no
  portrait for those two forms. A missing ROM just leaves the portrait off.

The tower-defense layer uses a separately authored perimeter route over the
native room. Build pads are selected deterministically with at least 4.7 arena
units of lane clearance and 5.4 units between pad centers. Enemy definitions
support both Gen 1 defending types; their multipliers are combined for 0×,
0.25×, 0.5×, 1×, 2×, and 4× matchups.

## Attribution and research sources

The model pipeline is adapted from the `model_extract/pipeline` exporter in
Dramaless Shape v1.6.4. The arena conversion follows StadiumBattleFX's native
arena implementation. Both projects build on format knowledge from
pret/pokestadium. See `tools/stadium_pipeline/NOTICE.md` for licensing details.

- https://github.com/pret/pokestadium
- https://github.com/artyrambles/DRAMALESS_SHAPE/tree/v1.6.4/model_extract
- https://github.com/anxiousintrovert/StadiumBattleFX

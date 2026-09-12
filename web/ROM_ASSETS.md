# Local Pokémon Stadium assets

The web game can use models and arena geometry extracted locally from a
player-supplied Pokémon Stadium ROM. No ROM data or generated Nintendo assets
belong in version control or distributable builds.

## Supported ROM

Only Pokémon Stadium (USA) Revision 2 is accepted:

- Size: `33,554,432` bytes
- MD5: `6dc6820cef755fc1253d06df45c9bd2a`
- SHA-1: `0d3b1d740c6ee6da6923550bf24ad827262fd8c0`
- Default local path: `baseroms/us/Pokemon Stadium (USA) (Rev 2).z64`

The pret decompilation's ordinary `make init` path targets USA Revision 0.
Do not rename this image to `baserom.z64` or run its fixed-offset extraction.

## Vertical slice

From `web/`, run:

```sh
npm run extract:stadium
```

This validates all three Rev 2 archives, exports all 151 Pokémon as textured,
skinned GLBs with the original 30 fps skeletal clips, writes a data-derived
animation-role and move manifest, and converts member 7 of `stadium_models`
(Brock's Gym Leader Castle room) to the compact `SNA2` browser cache.

Output lives under `web/public/generated/stadium/` and is gitignored. The game
loads it lazily. If the manifest, a species, or the arena cache is absent, the
existing procedural art remains the explicit fallback. The older files under
`web/public/models/` came from a third-party model service; they are not
Pokémon Stadium assets and the authentic loader no longer reads them.

For a quick Pikachu-only extraction smoke test:

```sh
python3 tools/extract_stadium_assets.py --only-pikachu
```

Use `--validate-only` to inspect archive counts, bounds, compression wrappers,
and representative identities without writing derived assets.

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

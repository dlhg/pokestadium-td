#!/usr/bin/env python3
"""Slice the Pokémon icon sprites out of the player's Rev 2 ROM.

No game data is downloaded or committed. Icons are the small portraits the
roster info card shows next to a tower's stats. Missing prerequisites are
non-fatal so the popup just omits the portrait.

`yamls/us/rom.yaml` documents the source table as "a multi bin asset array
of 152 uncompressed icons of the pokemon (last ID is Substitute Doll)" at
ROM offset 0x820000, running up to the next segment at 0x898000. Icons are
packed back to back with no fixed stride -- each is a 40px-wide RGBA16
strip trimmed to its own height, separated by fully-transparent rows. There
is no in-ROM index of which icon is which Pokémon, so the order below was
recovered by slicing every icon and identifying it by eye against the
species it visibly is. It reads, in order: Charmander's line, then every
remaining species in National Dex order, wrapping from Mew back around to
Bulbasaur at the very end -- except for one icon-sized gap in the 80s (in
among Magnemite/Farfetch'd/Doduo) that never resolved to a recognizable
15th species, and the last two dex-order slots after Bulbasaur, which
decode as empty/garbled data rather than Ivysaur and Venusaur. Both gaps
are left unmapped rather than guessed at.
"""
from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'web/tools/stadium_pipeline'))
from rom import Rom, find_rom  # noqa: E402
import fragment  # noqa: E402

OUTPUT = ROOT / 'web/public/generated/stadium/icons'
ICON_TABLE = 0x820000
ICON_TABLE_END = 0x898000  # start of the next rom.yaml segment (late_assets_3)
ICON_WIDTH = 40
RAW_GROUP_COUNT = 153  # 151 Pokémon + one unidentified icon + one trailing pad
NUM_POKEMON = 151


def slice_rows(data: bytes) -> list[tuple[int, int]]:
    """Row ranges of every non-transparent run in the icon strip, in file order."""
    row_bytes = ICON_WIDTH * 2

    def row_is_blank(row: int) -> bool:
        chunk = data[row * row_bytes:(row + 1) * row_bytes]
        return not any(struct.unpack_from('>H', chunk, i)[0] & 1 for i in range(0, len(chunk), 2))

    rows = len(data) // row_bytes
    groups: list[tuple[int, int]] = []
    start = None
    for row in range(rows):
        blank = row_is_blank(row)
        if not blank and start is None:
            start = row
        elif blank and start is not None:
            groups.append((start, row))
            start = None
    if start is not None:
        groups.append((start, rows))
    return groups


def icon_index_for_dex(dex: int) -> int | None:
    """Where a National Dex number's icon sits among the sliced groups, or
    None if that slot never decoded to a recognizable sprite (see module
    docstring: Ivysaur, Venusaur, and one unidentified icon in the 80s)."""
    if dex == 1:
        return 149  # Bulbasaur, wrapped around after Mew
    if dex in (2, 3):
        return None  # Ivysaur, Venusaur: their expected slots decode empty
    if 4 <= dex <= 81:
        return dex - 4
    if 82 <= dex <= 151:
        return dex - 3  # one icon-sized gap after Magnemite absorbs the shift
    return None


def render_png(data: bytes, group: tuple[int, int]) -> bytes:
    row_bytes = ICON_WIDTH * 2
    start, end = group
    height = end - start
    raw = data[start * row_bytes:end * row_bytes]
    rgba = bytearray()
    for i in range(0, len(raw), 2):
        rgba.extend(fragment.rgba5551(struct.unpack_from('>H', raw, i)[0]))
    return fragment.png(ICON_WIDTH, height, bytes(rgba))


def extract(rom_path: Path) -> int:
    rom = Rom(rom_path)
    data = rom.data[ICON_TABLE:ICON_TABLE_END]
    groups = slice_rows(data)
    if len(groups) != RAW_GROUP_COUNT:
        raise ValueError(f'expected {RAW_GROUP_COUNT} icon groups, found {len(groups)}')

    with tempfile.TemporaryDirectory(prefix='stadium-icons-') as temporary:
        staging = Path(temporary) / 'icons'
        staging.mkdir()
        written = 0
        for dex in range(1, NUM_POKEMON + 1):
            index = icon_index_for_dex(dex)
            if index is None:
                continue
            (staging / f'{dex:03d}.png').write_bytes(render_png(data, groups[index]))
            written += 1
        (staging / 'manifest.json').write_text(json.dumps({
            'version': 1, 'romMd5': rom.md5, 'tableOffset': hex(ICON_TABLE),
            'numPokemon': NUM_POKEMON, 'iconsWritten': written,
        }, indent=2) + '\n')
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(OUTPUT, ignore_errors=True)
        staging.replace(OUTPUT)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--if-missing', action='store_true')
    args = parser.parse_args()
    if (OUTPUT / 'manifest.json').is_file() and args.if_missing:
        return 0
    rom_path = find_rom()
    if rom_path is None:
        print('Stadium icons: no local ROM found; roster cards fall back to no portrait.')
        return 0
    try:
        written = extract(rom_path)
        print(f'Stadium icons: extracted {written}/{NUM_POKEMON} species portraits locally.')
    except (OSError, ValueError) as error:
        print(f'Stadium icons: {error}; roster cards fall back to no portrait.', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

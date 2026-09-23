#!/usr/bin/env python3
"""Build capture-reaction crowd atlases from the generated 4x4 source sheets.

Each source sheet has four spectators in rows and their front, left, back and
right-three-quarter views in columns. The output packs all twenty spectators
into one 20 x 4 texture, keeping each reaction to one sampler rather than five.

Usage:
    /path/to/python web/tools/build_crowd_tension_atlases.py
"""
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "crowd" / "source"
DESTINATION = ROOT / "public" / "crowd"
ATLAS_SIZE = (4000, 800)
COLS, ROWS = 20, 4
ALPHA_THRESHOLD = 32
PADDING = 3


def bounds(index: int, count: int, length: int) -> tuple[int, int]:
    return round(index * length / count), round((index + 1) * length / count)


def crop_character(sheet: Image.Image, row: int, column: int) -> Image.Image:
    width, height = sheet.size
    left, right = bounds(column, 4, width)
    top, bottom = bounds(row, 4, height)
    cell = sheet.crop((left, top, right, bottom))
    alpha = np.asarray(cell.getchannel("A")) > ALPHA_THRESHOLD
    ys, xs = np.where(alpha)
    if not len(xs):
        raise ValueError(f"empty source cell at row {row}, column {column}")
    x0, x1 = max(0, xs.min() - PADDING), min(cell.width, xs.max() + PADDING + 1)
    y0, y1 = max(0, ys.min() - PADDING), min(cell.height, ys.max() + PADDING + 1)
    return cell.crop((x0, y0, x1, y1))


def paste_fit(atlas: Image.Image, art: Image.Image, column: int, row: int) -> None:
    left, right = bounds(column, COLS, ATLAS_SIZE[0])
    top, bottom = bounds(row, ROWS, ATLAS_SIZE[1])
    cell_width, cell_height = right - left, bottom - top
    # Keep the drawing's proportions, and reserve a small transparent gutter so
    # nearest-filter sampling cannot pick up a neighbour at a card edge.
    scale = min((cell_width - 8) / art.width, (cell_height - 4) / art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    art = art.resize(size, Image.Resampling.LANCZOS)
    x = left + (cell_width - art.width) // 2
    y = bottom - art.height
    atlas.alpha_composite(art, (x, y))


def build(sources: list[Path], destination: Path) -> None:
    atlas = Image.new("RGBA", ATLAS_SIZE)
    for atlas_set, source in enumerate(sources):
        sheet = Image.open(source).convert("RGBA")
        for character in range(4):
            for view in range(4):
                paste_fit(atlas, crop_character(sheet, character, view), atlas_set * 4 + view, character)
    # A few generated sheets retain an isolated one-pixel strip at a source
    # cell's top edge. It is not character art and becomes conspicuous in the
    # tightly-packed stadium cards. The real heads begin below this gutter.
    pixels = atlas.load()
    for row in range(ROWS):
        top, _ = bounds(row, ROWS, ATLAS_SIZE[1])
        for y in range(top, top + 5):
            for x in range(ATLAS_SIZE[0]):
                pixels[x, y] = (0, 0, 0, 0)
    atlas.save(destination)
    print(f"{len(sources)} source sheets -> {destination.name}")


def main() -> int:
    for reaction in ("tension", "disappointment"):
        sources = sorted(SOURCE.glob(f"{reaction}-crowd-??-sheet.png"))
        if len(sources) != 5:
            raise SystemExit(f"Expected five {reaction} source sheets under {SOURCE}; found {len(sources)}")
        build(sources, DESTINATION / f"turnaround-crowd-{reaction}.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

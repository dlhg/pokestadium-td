#!/usr/bin/env python3
"""Erase cutout-sheet seam slivers at the top of each crowd turnaround-atlas
character cell (web/public/crowd/turnaround-crowd-*.png).

Normal atlases are 8-col x 4-row grids; the combined tension and disappointment
atlases are 20-col x 4-row grids (see the layout comments in StadiumArena.ts).
Every grid row is an independently cut-out sub-image, so its top edge can carry
a thin sliver of the row above it that leaked in during packing.

Detection, per pixel column within a grid cell (excluding a margin near the
cell's left/right edges, where unrelated neighbour-cell bleed lives and the
render shader already insets past it): find the first run of non-transparent
pixels touching the row's own top edge. If it's followed by a real gap of
fully-transparent rows before the actual character artwork resumes, that run
is the seam artifact -- clear it and everything above it.

Usage:
    web/tools/fix_crowd_atlas_seams.py [--dry-run] [PNG ...]

With no PNG arguments, processes web/public/crowd/turnaround-crowd-*.png in
place. --dry-run reports what would change without writing anything.
"""
import argparse
import pathlib
import sys

import numpy as np
from PIL import Image

ALPHA_THRESHOLD = 16       # ignore near-invisible antialiasing noise
SEARCH_FRAC = 0.35         # fraction of row height to search within
MIN_GAP = 5                # rows of full transparency required after the run
MAX_TOP_OFFSET = 2         # the sliver must be attached to the row's own top edge;
                           # a run that starts further down is real artwork detail
                           # (e.g. a notch between hair spikes), not sheet bleed
EDGE_MARGIN = 8            # skip pixels this close to a cell's left/right edge

DEFAULT_GLOB = "turnaround-crowd-*.png"
DEFAULT_DIR = pathlib.Path(__file__).resolve().parents[1] / "public" / "crowd"


def find_clear_bound(col_alpha: np.ndarray) -> int:
    """Return the exclusive row index up to which `col_alpha` should be
    cleared, or 0 if no seam sliver is detected."""
    is_opaque = col_alpha > ALPHA_THRESHOLD
    nz = np.flatnonzero(is_opaque)
    if len(nz) == 0:
        return 0
    i0 = nz[0]
    if i0 > MAX_TOP_OFFSET:
        return 0  # doesn't touch the row's top edge -> not sheet bleed
    run_end = i0
    while run_end < len(is_opaque) and is_opaque[run_end]:
        run_end += 1
    after = is_opaque[run_end:run_end + MIN_GAP]
    if len(after) < MIN_GAP or after.any():
        return 0  # no gap -> run merges into real content, leave it alone
    return run_end


def process_atlas(path: pathlib.Path, cols: int = 8, rows: int = 4):
    """Returns (fixed_image, changed, per_row_counts)."""
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    h, w = arr.shape[:2]
    ch, cw = h / rows, w / cols
    per_row = {}
    changed = False
    for row in range(rows):
        y0, y1 = int(round(row * ch)), int(round((row + 1) * ch))
        band_h = max(1, int(round((y1 - y0) * SEARCH_FRAC)))
        band = arr[y0:y0 + band_h, :, 3]
        for col in range(cols):
            x0 = int(round(col * cw)) + EDGE_MARGIN
            x1 = int(round((col + 1) * cw)) - EDGE_MARGIN
            for x in range(x0, x1):
                bound = find_clear_bound(band[:, x])
                if bound > 0:
                    arr[y0:y0 + bound, x, :] = 0
                    changed = True
                    per_row.setdefault(row, []).append(bound)
    return Image.fromarray(arr, "RGBA"), changed, per_row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", help="Atlas PNGs to fix (default: all crowd atlases)")
    parser.add_argument("--dry-run", action="store_true", help="Report without writing")
    parser.add_argument("--cols", type=int, help="Atlas column count (default: infer 20 for reaction atlases, otherwise 8)")
    parser.add_argument("--rows", type=int, default=4, help="Atlas row count (default: 4)")
    args = parser.parse_args()

    paths = [pathlib.Path(p) for p in args.paths] or sorted(DEFAULT_DIR.glob(DEFAULT_GLOB))
    if not paths:
        print(f"No atlases found under {DEFAULT_DIR}", file=sys.stderr)
        return 1

    for path in paths:
        cols = args.cols or (20 if path.stem in {"turnaround-crowd-tension", "turnaround-crowd-disappointment"} else 8)
        fixed, changed, per_row = process_atlas(path, cols, args.rows)
        summary = ", ".join(
            f"row{r}: {len(v)} cols, max {max(v)}px" for r, v in sorted(per_row.items())
        )
        if not changed:
            print(f"{path}: no seams found")
            continue
        print(f"{path}: {summary}{' (dry run)' if args.dry_run else ''}")
        if not args.dry_run:
            fixed.save(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

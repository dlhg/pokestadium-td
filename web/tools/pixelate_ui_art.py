#!/usr/bin/env python3
"""Bake a high-resolution UI image down to an N64-sized texel grid.

The title screen's Pokemon Stadium logo is the ROM's own model, textured with
32x32 texels and sampled with NearestFilter, so it lands on screen at roughly
two and a half display pixels per texel. Art authored at full resolution (the
Tower Defense wordmark) reads as smooth next to it. Resampling the source to a
matching texel count and letting the browser blow it back up with
`image-rendering: pixelated` puts both titles on the same grid.

Downsampling happens on premultiplied colour so the transparent surround does
not bleed dark fringes into the edge texels.

Usage:
    web/tools/pixelate_ui_art.py public/ui/source/tower-defense-wordmark.png \
        --width 288 --out public/ui/tower-defense-wordmark.png
"""
import argparse
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]


def pixelate(source: Image.Image, width: int) -> Image.Image:
    height = max(1, round(source.height * width / source.width))
    rgba = np.asarray(source.convert("RGBA"), dtype=np.float64) / 255.0
    alpha = rgba[..., 3:4]
    premultiplied = np.concatenate([rgba[..., :3] * alpha, alpha], axis=2)

    resized = np.asarray(
        Image.fromarray((premultiplied * 255.0 + 0.5).astype(np.uint8), "RGBA").resize(
            (width, height), Image.BOX
        ),
        dtype=np.float64,
    ) / 255.0

    out_alpha = resized[..., 3:4]
    colour = np.divide(resized[..., :3], out_alpha, out=np.zeros_like(resized[..., :3]), where=out_alpha > 0)
    flat = np.concatenate([np.clip(colour, 0.0, 1.0), out_alpha], axis=2)
    return Image.fromarray((flat * 255.0 + 0.5).astype(np.uint8), "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--width", type=int, required=True, help="texel columns in the baked image")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()

    source_path = args.source if args.source.is_absolute() else ROOT / args.source
    out_path = args.out if args.out.is_absolute() else ROOT / args.out

    baked = pixelate(Image.open(source_path), args.width)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    baked.save(out_path, optimize=True)
    print(f"{source_path.name} -> {out_path} ({baked.width}x{baked.height})")


if __name__ == "__main__":
    main()

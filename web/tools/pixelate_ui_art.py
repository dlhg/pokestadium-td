#!/usr/bin/env python3
"""Bake a high-resolution UI image down to the Pokemon Stadium logo's look.

The title screen's logo is the ROM's own model, textured with 32x32 texels and
sampled with NearestFilter, so it lands on screen at roughly two and a half
display pixels per texel out of a 5-bit-per-channel palette. Art authored at
full resolution (the Tower Defense wordmark) reads as smooth and over-bright
beside it. Three passes close the gap:

  --tint      pivot the red family onto the logo's own shade, anchored so the
              bevel highlights and the blue outline keep their relationship
  --width     resample to a matching texel count, which the browser blows back
              up via `image-rendering: pixelated`
  --bits      quantise to the channel grid the ROM's textures sit on

Downsampling happens on premultiplied colour so the transparent surround does
not bleed dark fringes into the edge texels. Alpha stays 8-bit: the logo's
silhouette is polygon geometry the renderer antialiases, not a 1-bit cutout, so
a soft edge is the closer match.

Usage:
    web/tools/pixelate_ui_art.py public/ui/source/tower-defense-wordmark.png \
        --width 288 --tint 831234:4c0310 --bits 5 \
        --out public/ui/tower-defense-wordmark.png
"""
import argparse
import colorsys
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]

# How far round the wheel a hue can sit from the source and still count as the
# colour being pivoted. The wordmark's steel-blue outline is ~130 degrees off
# and has to come through untouched.
TINT_HUE_FULL = 40.0
TINT_HUE_FALLOFF = 75.0
# Below this saturation a pixel is a near-white bevel highlight, which reads as
# light rather than as colour and stays put.
TINT_SAT_FLOOR = 0.08
TINT_SAT_FULL = 0.25


def parse_colour(text: str) -> tuple[float, float, float]:
    value = text.lstrip("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError(f"expected a six-digit hex colour, got {text!r}")
    return tuple(int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def parse_tint(text: str) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    if ":" not in text:
        raise argparse.ArgumentTypeError("expected FROM:TO, e.g. 831234:4c0310")
    source, target = text.split(":", 1)
    return parse_colour(source), parse_colour(target)


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def anchored(values: np.ndarray, source: float, target: float) -> np.ndarray:
    """Remap 0..1 so `source` lands on `target`, holding both ends in place.

    A plain multiply would crush the highlights into the new, darker body
    colour. Pivoting instead keeps the bevel's run up towards white and the
    shadow's run down towards black, and only moves where the art sits.
    """
    if source <= 0.0:
        return np.full_like(values, target)
    below = values * (target / source)
    if source >= 1.0:
        return below
    above = target + (values - source) * (1.0 - target) / (1.0 - source)
    return np.where(values <= source, below, above)


def rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    delta = maximum - minimum
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    hue = np.zeros_like(maximum)
    safe = np.where(delta == 0.0, 1.0, delta)
    hue = np.where(maximum == r, ((g - b) / safe) % 6.0, hue)
    hue = np.where(maximum == g, ((b - r) / safe) + 2.0, hue)
    hue = np.where(maximum == b, ((r - g) / safe) + 4.0, hue)
    hue = np.where(delta == 0.0, 0.0, hue * 60.0)

    saturation = np.where(maximum == 0.0, 0.0, delta / np.where(maximum == 0.0, 1.0, maximum))
    return np.stack([hue, saturation, maximum], axis=2)


def hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    h, s, v = hsv[..., 0] / 60.0 % 6.0, hsv[..., 1], hsv[..., 2]
    i = np.floor(h).astype(int)
    f = h - i
    p, q, t = v * (1.0 - s), v * (1.0 - s * f), v * (1.0 - s * (1.0 - f))
    options = np.stack(
        [
            np.stack([v, t, p], axis=2),
            np.stack([q, v, p], axis=2),
            np.stack([p, v, t], axis=2),
            np.stack([p, q, v], axis=2),
            np.stack([t, p, v], axis=2),
            np.stack([v, p, q], axis=2),
        ]
    )
    return np.take_along_axis(options, i[None, ..., None] % 6, axis=0)[0]


def tint(rgba: np.ndarray, source: tuple[float, ...], target: tuple[float, ...]) -> np.ndarray:
    """Pivot the pixels sharing `source`'s hue family onto `target`."""
    src_h, src_s, src_v = colorsys.rgb_to_hsv(*source)
    dst_h, dst_s, dst_v = colorsys.rgb_to_hsv(*target)
    src_h, dst_h = src_h * 360.0, dst_h * 360.0

    hsv = rgb_to_hsv(rgba[..., :3])
    distance = np.abs((hsv[..., 0] - src_h + 180.0) % 360.0 - 180.0)
    weight = (1.0 - smoothstep(TINT_HUE_FULL, TINT_HUE_FALLOFF, distance)) * smoothstep(
        TINT_SAT_FLOOR, TINT_SAT_FULL, hsv[..., 1]
    )

    shift = (dst_h - src_h + 180.0) % 360.0 - 180.0
    shifted = np.stack(
        [
            (hsv[..., 0] + shift * weight) % 360.0,
            hsv[..., 1] + (anchored(hsv[..., 1], src_s, dst_s) - hsv[..., 1]) * weight,
            hsv[..., 2] + (anchored(hsv[..., 2], src_v, dst_v) - hsv[..., 2]) * weight,
        ],
        axis=2,
    )
    return np.concatenate([np.clip(hsv_to_rgb(shifted), 0.0, 1.0), rgba[..., 3:]], axis=2)


def pixelate(rgba: np.ndarray, width: int) -> np.ndarray:
    height = max(1, round(rgba.shape[0] * width / rgba.shape[1]))
    alpha = rgba[..., 3:4]
    premultiplied = np.concatenate([rgba[..., :3] * alpha, alpha], axis=2)

    resized = (
        np.asarray(
            Image.fromarray((premultiplied * 255.0 + 0.5).astype(np.uint8), "RGBA").resize(
                (width, height), Image.BOX
            ),
            dtype=np.float64,
        )
        / 255.0
    )

    out_alpha = resized[..., 3:4]
    colour = np.divide(
        resized[..., :3], out_alpha, out=np.zeros_like(resized[..., :3]), where=out_alpha > 0
    )
    return np.concatenate([np.clip(colour, 0.0, 1.0), out_alpha], axis=2)


def quantise(rgba: np.ndarray, bits: int) -> np.ndarray:
    """Snap colour to a `bits`-per-channel grid, alpha untouched."""
    levels = (1 << bits) - 1
    snapped = np.round(rgba[..., :3] * levels) / levels
    return np.concatenate([snapped, rgba[..., 3:]], axis=2)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--width", type=int, required=True, help="texel columns in the baked image")
    parser.add_argument(
        "--tint",
        type=parse_tint,
        metavar="FROM:TO",
        help="pivot the hue family around FROM onto TO, both six-digit hex",
    )
    parser.add_argument(
        "--bits",
        type=int,
        default=0,
        metavar="N",
        help="quantise colour to N bits per channel (5 matches the ROM's RGBA5551 textures)",
    )
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()

    source_path = args.source if args.source.is_absolute() else ROOT / args.source
    out_path = args.out if args.out.is_absolute() else ROOT / args.out

    rgba = np.asarray(Image.open(source_path).convert("RGBA"), dtype=np.float64) / 255.0
    if args.tint:
        rgba = tint(rgba, *args.tint)
    rgba = pixelate(rgba, args.width)
    if args.bits:
        rgba = quantise(rgba, args.bits)

    baked = Image.fromarray((rgba * 255.0 + 0.5).astype(np.uint8), "RGBA")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    baked.save(out_path, optimize=True)
    print(f"{source_path.name} -> {out_path} ({baked.width}x{baked.height})")


if __name__ == "__main__":
    main()

"""Image operations for the OpenGameArt asset pipeline.

Every operation here is deterministic: the same input bytes, manifest entry and
Pillow version must produce the same PNG. That is what makes `build.py --check`
meaningful - it fails when a shipped sprite no longer matches its lock entry.

Alpha handling is deliberate. Resampling happens in premultiplied alpha
(PIL ``RGBa``) because resampling straight RGBA lets transparent pixels bleed
their colour into the silhouette, which shows up as a dark halo over grass.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

# Pixels fainter than this are treated as empty when cropping. Sources with a
# soft shadow layer fade out over several pixels; without the cut, the crop box
# grows by a handful of invisible rows and the base line drifts.
ALPHA_FLOOR = 14

# The luminance match is deliberately capped: a very dark source sprite (some
# OpenGameArt packs are lit for their own engine) would otherwise be pushed to a
# washed-out brightness and lose all contrast.
LUM_MIN = 0.45
LUM_MAX = 2.60


def load_rgba(path: Path) -> Image.Image:
    """Load an image as RGBA, flattened onto transparency."""
    return Image.open(path).convert("RGBA")


def alpha_bbox(im: Image.Image, floor: int = ALPHA_FLOOR) -> tuple[int, int, int, int]:
    """Bounding box of pixels at or above ``floor`` alpha. Raises when empty."""
    mask = im.getchannel("A").point(lambda v: 255 if v >= floor else 0)
    box = mask.getbbox()
    if box is None:
        raise ValueError("image has no pixels above the alpha floor")
    return box


def crop_to_alpha(im: Image.Image, floor: int = ALPHA_FLOOR) -> Image.Image:
    """Crop away transparent margins, keeping every visible edge pixel."""
    return im.crop(alpha_bbox(im, floor))


def luminance(im: Image.Image, floor: int = 200) -> float:
    """Mean Rec.709 luminance of the solid part of a sprite."""
    a = np.asarray(im).astype(np.float32)
    solid = a[:, :, 3] >= floor
    if not solid.any():
        raise ValueError("image has no solid pixels")
    rgb = a[:, :, :3][solid]
    return float((rgb[:, 0] * 0.2126 + rgb[:, 1] * 0.7152 + rgb[:, 2] * 0.0722).mean())


def match_luminance(im: Image.Image, target: float) -> tuple[Image.Image, float]:
    """Scale RGB so the sprite's mean luminance matches ``target``.

    A single multiplicative gain keeps hue and saturation relations intact,
    which is the least invasive way to fit a pack lit for another engine into
    the client's unlit palette. The gain is clamped and reported so an asset
    that needed an extreme correction shows up in the report instead of
    silently shipping a flat sprite.
    """
    current = luminance(im)
    gain = target / current if current > 0 else 1.0
    gain = max(LUM_MIN, min(LUM_MAX, gain))
    a = np.asarray(im).astype(np.float32)
    a[:, :, :3] = np.clip(a[:, :, :3] * gain, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA"), gain


def apply_gain(im: Image.Image, gains: list[float] | tuple[float, float, float]) -> Image.Image:
    """Multiply each RGB channel by its own gain, then clamp.

    A per-channel gain is the least invasive way to move an off-palette pack
    towards the client's palette: it lifts saturation (or cools/warms a sprite)
    without touching geometry, alpha or the luminance match that runs after it.
    """
    if len(gains) != 3:
        raise ValueError(f"gain needs three channels, got {len(gains)}")
    a = np.asarray(im).astype(np.float32)
    for channel, gain in enumerate(gains):
        a[:, :, channel] = np.clip(a[:, :, channel] * float(gain), 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def split_sheet(
    im: Image.Image,
    min_area: int = 300,
    floor: int = ALPHA_FLOOR,
    drop_edge: bool = True
) -> list[Image.Image]:
    """Split a sprite sheet into separate sprites by connected alpha regions.

    The sheet packs a whole pack of plants/rocks into one upload, so a target
    that wants one of them has to cut it out first. Components are sorted by
    descending area and then by position, which makes an ``index`` stable for a
    given source: re-running the build on the same bytes always picks the same
    sprite. Fragments touching the sheet border are dropped unless
    ``drop_edge`` is false, because those are sprites clipped by the upload.

    Four-connectivity is deliberate: diagonal-only touches are separate plants,
    and merging them would fuse two decor sprites into one wide blob.
    """
    alpha = np.asarray(im.convert("RGBA"))[:, :, 3] >= floor
    height, width = alpha.shape
    seen = np.zeros((height, width), dtype=bool)
    found: list[tuple[int, int, int, int, int]] = []

    for start_y in range(height):
        for start_x in range(width):
            if not alpha[start_y, start_x] or seen[start_y, start_x]:
                continue
            stack = [(start_y, start_x)]
            seen[start_y, start_x] = True
            min_y = max_y = start_y
            min_x = max_x = start_x
            count = 0
            while stack:
                y, x = stack.pop()
                count += 1
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and alpha[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if count < min_area:
                continue
            if drop_edge and (min_y == 0 or min_x == 0 or max_y == height - 1 or max_x == width - 1):
                continue
            found.append((min_y, max_y + 1, min_x, max_x + 1, count))

    found.sort(key=lambda box: (-box[4], box[0], box[2]))
    return [im.crop((min_x, min_y, max_x, max_y)) for min_y, max_y, min_x, max_x, _ in found]


def resize(im: Image.Image, size: tuple[int, int], resample: str) -> Image.Image:
    """Resample in premultiplied alpha, so edges stay clean."""
    filters = {
        "nearest": Image.Resampling.NEAREST,
        "bilinear": Image.Resampling.BILINEAR,
        "lanczos": Image.Resampling.LANCZOS
    }
    if resample not in filters:
        raise ValueError(f"unknown resample filter: {resample}")
    pre = im.convert("RGBa")
    return pre.resize(size, filters[resample]).convert("RGBA")


def fit(art: Image.Image, canvas: tuple[int, int]) -> tuple[Image.Image, float]:
    """Scale an alpha-cropped sprite to fit the canvas, keeping its ratio.

    Returns the resized sprite and the applied factor, so the build report can
    flag a source that had to be blown up (a soft result) instead of downscaled.
    """
    width, height = canvas
    scale = min(width / art.width, height / art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    return resize(art, size, "lanczos"), scale


def place(art: Image.Image, canvas: tuple[int, int], anchor: str) -> Image.Image:
    """Composite ``art`` into a transparent canvas of ``canvas`` size."""
    width, height = canvas
    if anchor not in {"bottom-center", "center"}:
        raise ValueError(f"unknown anchor: {anchor}")
    sheet = Image.new("RGBA", canvas, (0, 0, 0, 0))
    x = (width - art.width) // 2
    y = height - art.height if anchor == "bottom-center" else (height - art.height) // 2
    sheet.paste(art, (x, y), art)
    return sheet


def top_inset(im: Image.Image, floor: int = ALPHA_FLOOR) -> int:
    """Rows between the canvas top and the first visible sprite pixel."""
    return alpha_bbox(im, floor)[1]


def bottom_inset(im: Image.Image, floor: int = ALPHA_FLOOR) -> int:
    """Rows between the last visible sprite pixel and the canvas bottom."""
    return im.height - alpha_bbox(im, floor)[3]

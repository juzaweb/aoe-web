"""Generate the project's 9-slice UI chrome (frames, fills, buttons, slots).

The kit replaces the flat CSS gradients in `apps/client/src/index.css` with
carved-walnut and aged-brass textures. Everything is drawn procedurally with
Pillow + numpy, so the output is reproducible from this file alone: no AI
service, no third-party art, no network.

Each frame is a 9-slice image whose border ring is exactly `slice` pixels wide.
The CSS renders it with `border-image-width` larger than `border-width`, which
paints the ring inward without changing the element's box model. That is what
keeps the 156 px dock geometry intact. The centre of every frame is transparent;
a separate tiled fill PNG shows through, so large panels never stretch a small
centre slice into a blur.

Usage:
    python scripts/generate_ui_assets.py            # write PNGs + ui.lock.json
    python scripts/generate_ui_assets.py --check    # verify shipped bytes + CSS
    python scripts/generate_ui_assets.py --preview  # write scripts/out preview
    python scripts/generate_ui_assets.py --only panel_frame,button_idle
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import tempfile
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "apps/client/public/assets/ui"
LOCK = ROOT / "scripts/assets/ui.lock.json"
CSS = ROOT / "apps/client/src/index.css"
PREVIEW_DIR = ROOT / "scripts/out"

# Supersampling factor. Every frame is drawn at 4x and downscaled with LANCZOS;
# the 8 px panel ring is then sampled from a 32 px source ring, which is where
# the bevel and rivet detail comes from.
S = 4
UI_VERSION = 1

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

INK = (8, 6, 4)
BRASS_DARK = (66, 44, 18)
BRASS_MID = (120, 82, 36)
BRASS_LIGHT = (190, 150, 80)
BRASS_HI = (222, 190, 130)
WOOD_DARK = (52, 36, 24)
WOOD_MID = (96, 66, 44)
WOOD_LIGHT = (138, 96, 64)
IRON_DARK = (58, 54, 48)
IRON_MID = (107, 98, 87)
IRON_LIGHT = (207, 196, 176)
CRIMSON_DARK = (74, 20, 16)
CRIMSON_MID = (138, 43, 34)
CRIMSON_LIGHT = (224, 120, 96)
GOLD_DARK = (185, 130, 42)
GOLD_MID = (217, 164, 65)
GOLD_LIGHT = (240, 208, 144)

# Cross-section of a frame, from the outer edge (0.0) to the inner edge (1.0).
# The dark groove between the two brass bands is what reads as a carved frame
# rather than a single painted line.
PANEL_STOPS = [
    (0.00, INK),
    (0.04, BRASS_LIGHT),
    (0.12, BRASS_MID),
    (0.18, WOOD_LIGHT),
    (0.40, WOOD_MID),
    (0.55, WOOD_DARK),
    (0.62, BRASS_LIGHT),
    (0.70, BRASS_DARK),
    (0.80, WOOD_DARK),
    (0.92, INK),
    (1.00, INK),
]

MODAL_STOPS = [
    (0.00, INK),
    (0.02, BRASS_HI),
    (0.06, BRASS_LIGHT),
    (0.14, BRASS_MID),
    (0.20, WOOD_LIGHT),
    (0.42, WOOD_MID),
    (0.56, WOOD_DARK),
    (0.62, BRASS_LIGHT),
    (0.72, BRASS_DARK),
    (0.82, WOOD_DARK),
    (0.92, INK),
    (1.00, INK),
]

TOOLTIP_STOPS = [
    (0.00, INK),
    (0.06, BRASS_LIGHT),
    (0.30, BRASS_MID),
    (0.38, WOOD_MID),
    (0.55, WOOD_DARK),
    (0.62, BRASS_LIGHT),
    (0.76, BRASS_DARK),
    (0.88, INK),
    (1.00, INK),
]

CHIP_STOPS = [
    (0.00, INK),
    (0.08, BRASS_LIGHT),
    (0.35, BRASS_MID),
    (0.44, WOOD_MID),
    (0.60, WOOD_DARK),
    (0.66, BRASS_LIGHT),
    (0.80, BRASS_DARK),
    (0.92, INK),
    (1.00, INK),
]

BUTTON_STOPS = [
    (0.00, INK),
    (0.07, BRASS_LIGHT),
    (0.30, BRASS_MID),
    (0.38, WOOD_LIGHT),
    (0.55, WOOD_MID),
    (0.62, BRASS_LIGHT),
    (0.75, BRASS_DARK),
    (0.86, INK),
    (1.00, INK),
]

BUTTON_PRESSED_STOPS = [
    (0.00, INK),
    (0.10, BRASS_DARK),
    (0.30, WOOD_DARK),
    (0.50, WOOD_MID),
    (0.62, BRASS_DARK),
    (0.80, INK),
    (1.00, INK),
]

SLOT_STOPS = [
    (0.00, INK),
    (0.08, IRON_DARK),
    (0.30, WOOD_DARK),
    (0.50, WOOD_MID),
    (0.62, BRASS_DARK),
    (0.80, INK),
    (1.00, INK),
]

DANGER_STOPS = [
    (0.00, INK),
    (0.06, CRIMSON_LIGHT),
    (0.30, CRIMSON_MID),
    (0.38, WOOD_MID),
    (0.55, WOOD_DARK),
    (0.62, CRIMSON_LIGHT),
    (0.76, CRIMSON_DARK),
    (0.90, INK),
    (1.00, INK),
]

PRIMARY_STOPS = [
    (0.00, INK),
    (0.06, GOLD_LIGHT),
    (0.30, GOLD_MID),
    (0.38, GOLD_DARK),
    (0.55, GOLD_MID),
    (0.62, GOLD_LIGHT),
    (0.76, GOLD_DARK),
    (0.90, INK),
    (1.00, INK),
]

# ---------------------------------------------------------------------------
# Asset specs
# ---------------------------------------------------------------------------

FRAME_SPECS = {
    "panel_frame": {"size": 128, "ring": 32, "slice": 32, "borderWidthPx": 8, "stops": PANEL_STOPS, "corner": "bracket"},
    "modal_frame": {"size": 192, "ring": 48, "slice": 48, "borderWidthPx": 12, "stops": MODAL_STOPS, "corner": "scroll"},
    "tooltip_frame": {"size": 96, "ring": 24, "slice": 24, "borderWidthPx": 6, "stops": TOOLTIP_STOPS, "corner": "rivets"},
    "chip_frame": {"size": 48, "ring": 12, "slice": 12, "borderWidthPx": 3, "stops": CHIP_STOPS, "corner": "rivets"},
}

BUTTON_SPECS = {
    "button_idle": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 1.00},
    "button_hover": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 1.14},
    "button_pressed": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_PRESSED_STOPS, "corner": "rivets", "tone": 0.86},
    "button_disabled": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 0.58, "desaturate": True},
    "button_active": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 1.20, "goldLine": True},
    "button_danger_idle": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": DANGER_STOPS, "corner": "rivets", "tone": 1.00},
    "button_danger_hover": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": DANGER_STOPS, "corner": "rivets", "tone": 1.14},
    "button_danger_pressed": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": DANGER_STOPS, "corner": "rivets", "tone": 0.86},
    "button_primary_idle": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": PRIMARY_STOPS, "corner": "rivets", "tone": 1.00},
    "button_primary_hover": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": PRIMARY_STOPS, "corner": "rivets", "tone": 1.10},
    "button_primary_pressed": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 3, "stops": PRIMARY_STOPS, "corner": "rivets", "tone": 0.86},
}

SLOT_SPECS = {
    "slot_idle": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 1.00},
    "slot_hover": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 1.12},
    "slot_active": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 1.22, "goldLine": True},
    "slot_disabled": {"size": 64, "ring": 16, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 0.58, "desaturate": True},
}

FILL_SPECS = {
    "panel_fill": {"size": 64, "kind": "wood", "dark": (26, 17, 11), "mid": (44, 30, 20), "light": (62, 42, 28)},
    "modal_fill": {"size": 128, "kind": "wood", "dark": (18, 12, 8), "mid": (30, 20, 13), "light": (44, 30, 20)},
    "inset_fill": {"size": 32, "kind": "stone", "dark": (12, 10, 8), "mid": (24, 20, 15), "light": (40, 33, 26)},
    "button_fill": {"size": 32, "kind": "wood", "dark": (38, 28, 21), "mid": (56, 42, 31), "light": (76, 58, 42)},
    "primary_fill": {"size": 32, "kind": "gold"},
    "backdrop": {"size": 256, "kind": "stone", "dark": (4, 3, 2), "mid": (8, 6, 4), "light": (14, 11, 8)},
}

ASSET_SPECS = {**FRAME_SPECS, **BUTTON_SPECS, **SLOT_SPECS, **FILL_SPECS}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def seed_for(name: str) -> int:
    """Stable per-asset seed, so a re-run reproduces the same grain."""
    return int(hashlib.sha256(name.encode("utf-8")).hexdigest()[:8], 16)


def smoothstep(t: np.ndarray) -> np.ndarray:
    return t * t * (3.0 - 2.0 * t)


def tileable_noise(
    width: int,
    height: int,
    cells_x: int,
    cells_y: int,
    seed: int,
    octaves: int = 3,
) -> np.ndarray:
    """Bilinear value noise on a wrapping grid.

    Sampling with modulo indices makes the left edge continue into the right
    edge, which is what lets a 32-64 px fill tile repeat without a seam.
    """
    rng = np.random.default_rng(seed)
    total = np.zeros((height, width), dtype=np.float64)
    amplitude = 1.0
    norm = 0.0

    for octave in range(octaves):
        cx = max(1, cells_x * (2 ** octave))
        cy = max(1, cells_y * (2 ** octave))
        grid = rng.random((cy, cx))

        u = (np.arange(width, dtype=np.float64) + 0.5) / width * cx
        v = (np.arange(height, dtype=np.float64) + 0.5) / height * cy
        x0 = np.floor(u).astype(np.int64)
        y0 = np.floor(v).astype(np.int64)
        fx = smoothstep(u - x0)
        fy = smoothstep(v - y0)

        xa = x0 % cx
        xb = (x0 + 1) % cx
        ya = y0 % cy
        yb = (y0 + 1) % cy

        g00 = grid[np.ix_(ya, xa)]
        g10 = grid[np.ix_(ya, xb)]
        g01 = grid[np.ix_(yb, xa)]
        g11 = grid[np.ix_(yb, xb)]

        top = g00 * (1.0 - fx)[None, :] + g10 * fx[None, :]
        bottom = g01 * (1.0 - fx)[None, :] + g11 * fx[None, :]
        total += amplitude * (top * (1.0 - fy)[:, None] + bottom * fy[:, None])
        norm += amplitude
        amplitude *= 0.5

    return total / norm


def ramp(t: np.ndarray, stops: Iterable[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    """Piecewise-linear colour ramp; `t` is clipped to [0, 1]."""
    stops = list(stops)
    positions = np.array([stop[0] for stop in stops], dtype=np.float64)
    colors = np.array([stop[1] for stop in stops], dtype=np.float64)
    clipped = np.clip(t, 0.0, 1.0)
    out = np.empty(clipped.shape + (3,), dtype=np.float64)
    for channel in range(3):
        out[..., channel] = np.interp(clipped, positions, colors[:, channel])
    return out


def apply_tone(colors: np.ndarray, tone: float) -> np.ndarray:
    if tone >= 1.0:
        return np.clip(colors + (255.0 - colors) * (tone - 1.0) * 0.55, 0.0, 255.0)
    return np.clip(colors * tone, 0.0, 255.0)


def desaturate(colors: np.ndarray, amount: float = 0.72) -> np.ndarray:
    lum = (
        0.2126 * colors[..., 0]
        + 0.7152 * colors[..., 1]
        + 0.0722 * colors[..., 2]
    )[..., None]
    return colors * (1.0 - amount) + lum * amount


def tint(color: tuple[int, int, int], tone: float) -> tuple[int, int, int]:
    arr = apply_tone(np.array([[color]], dtype=np.float64), tone)[0, 0]
    return tuple(int(round(value)) for value in arr)


# ---------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------


def wood_texture(
    size: int,
    seed: int,
    dark: tuple[int, int, int],
    mid: tuple[int, int, int],
    light: tuple[int, int, int],
    cells_x: int = 2,
    cells_y: int = 10,
    grain: int = 9,
) -> Image.Image:
    noise = tileable_noise(size, size, cells_x, cells_y, seed, octaves=3)
    y = np.arange(size, dtype=np.float64)[:, None]
    line = 0.5 + 0.5 * np.sin(2.0 * math.pi * (y / size * grain) + 2.2 * noise)
    t = np.clip(0.55 * noise + 0.18 * line, 0.0, 1.0)
    rgb = ramp(t, [(0.0, dark), (0.5, mid), (1.0, light)]).astype(np.uint8)
    return Image.fromarray(rgb, "RGB").convert("RGBA")


def stone_texture(
    size: int,
    seed: int,
    dark: tuple[int, int, int],
    mid: tuple[int, int, int],
    light: tuple[int, int, int],
) -> Image.Image:
    broad = tileable_noise(size, size, 3, 3, seed, octaves=4)
    fine = tileable_noise(size, size, 7, 7, seed + 17, octaves=2)
    t = np.clip(0.70 * broad + 0.22 * fine, 0.0, 1.0)
    rgb = ramp(t, [(0.0, dark), (0.55, mid), (1.0, light)]).astype(np.uint8)
    return Image.fromarray(rgb, "RGB").convert("RGBA")


def gold_texture(size: int, seed: int) -> Image.Image:
    broad = tileable_noise(size, size, 4, 4, seed, octaves=2)
    fine = tileable_noise(size, size, 8, 8, seed + 3, octaves=2)
    t = np.clip(0.55 + 0.35 * (broad - 0.5) + 0.10 * (fine - 0.5), 0.0, 1.0)
    rgb = ramp(t, [(0.0, GOLD_DARK), (0.5, GOLD_MID), (1.0, GOLD_LIGHT)]).astype(np.uint8)
    return Image.fromarray(rgb, "RGB").convert("RGBA")


# ---------------------------------------------------------------------------
# Frame rendering
# ---------------------------------------------------------------------------


def _corner_overlay(
    width: int,
    ring: int,
    corner: str,
    tone: float,
) -> Image.Image:
    """Draw one top-left ornament, then flip it into the other three corners.

    Ornaments are clipped to the `ring x ring` corner square, so the edge strips
    stay perfectly uniform and `border-image-repeat: stretch` cannot smear them.
    """
    corner_img = Image.new("RGBA", (ring, ring), (0, 0, 0, 0))
    draw = ImageDraw.Draw(corner_img)

    margin = max(1, int(ring * 0.10))
    length = max(2, int(ring * 0.68))
    thick = max(2, int(ring * 0.14))
    brass = tint(BRASS_LIGHT, tone)
    brass_hi = tint(BRASS_HI, tone)
    brass_dark = tint(BRASS_DARK, tone)
    iron = tint(IRON_LIGHT, tone)

    if corner in ("bracket", "scroll"):
        draw.rectangle(
            [margin, margin, margin + length, margin + thick],
            fill=brass,
            outline=INK,
            width=max(1, S // 2),
        )
        draw.rectangle(
            [margin, margin, margin + thick, margin + length],
            fill=brass,
            outline=INK,
            width=max(1, S // 2),
        )
        draw.line(
            [margin + S, margin + S, margin + length - S, margin + S],
            fill=brass_hi,
            width=max(1, S // 2),
        )
        draw.line(
            [margin + S, margin + S, margin + S, margin + length - S],
            fill=brass_hi,
            width=max(1, S // 2),
        )
        draw.line(
            [margin + thick, margin + thick, margin + length, margin + thick],
            fill=brass_dark,
            width=max(1, S // 2),
        )
        draw.line(
            [margin + thick, margin + thick, margin + thick, margin + length],
            fill=brass_dark,
            width=max(1, S // 2),
        )

        rivet_x = margin + thick + int(ring * 0.10)
        rivet_y = rivet_x
        radius = max(2, int(ring * 0.080))
        draw.ellipse(
            [rivet_x - radius, rivet_y - radius, rivet_x + radius, rivet_y + radius],
            fill=iron,
            outline=INK,
            width=max(1, S // 2),
        )

        if corner == "scroll":
            arc_box = [
                int(ring * 0.16),
                int(ring * 0.16),
                int(ring * 0.62),
                int(ring * 0.62),
            ]
            draw.arc(arc_box, start=180, end=270, fill=brass_hi, width=max(2, S))
            dot_x = int(ring * 0.58)
            dot_y = int(ring * 0.16)
            dot_r = max(1, int(ring * 0.025))
            draw.ellipse(
                [dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
                fill=brass_hi,
            )

    elif corner in ("rivets", "screws"):
        radius = max(2, int(ring * (0.180 if corner == "rivets" else 0.140)))
        positions = [
            (margin + radius, margin + radius),
            (ring - margin - radius, margin + radius),
            (margin + radius, ring - margin - radius),
            (ring - margin - radius, ring - margin - radius),
        ]
        for cx, cy in positions:
            draw.ellipse(
                [cx - radius, cy - radius, cx + radius, cy + radius],
                fill=iron,
                outline=INK,
                width=max(1, S // 2),
            )
            draw.line(
                [cx - radius // 2, cy, cx + radius // 2, cy],
                fill=tint(IRON_DARK, tone),
                width=max(1, S // 2),
            )

    return corner_img


def render_frame(
    size: int,
    ring: int,
    stops: list[tuple[float, tuple[int, int, int]]],
    corner: str,
    tone: float = 1.0,
    desaturate_colors: bool = False,
    gold_line: bool = False,
) -> Image.Image:
    """Draw one 9-slice frame with a transparent centre."""
    width = size * S
    ring_px = ring * S

    ys, xs = np.mgrid[0:width, 0:width]
    distance = np.minimum(
        np.minimum(xs, ys),
        np.minimum(width - 1 - xs, width - 1 - ys),
    )
    ring_mask = distance < ring_px
    t = np.clip(distance / max(1, ring_px), 0.0, 1.0)

    colors = ramp(t, stops)
    if desaturate_colors:
        colors = desaturate(colors)
    colors = apply_tone(colors, tone)

    pixels = np.zeros((width, width, 4), dtype=np.uint8)
    pixels[..., :3] = colors.astype(np.uint8)
    pixels[..., 3] = np.where(ring_mask, 255, 0)
    frame = Image.fromarray(pixels, "RGBA")

    ornament = _corner_overlay(width, ring_px, corner, tone)
    corner_mask = np.zeros((width, width), dtype=bool)
    corner_mask[:ring_px, :ring_px] = True
    corner_mask[:ring_px, -ring_px:] = True
    corner_mask[-ring_px:, :ring_px] = True
    corner_mask[-ring_px:, -ring_px:] = True

    variants = [
        (ornament, (0, 0)),
        (ornament.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (width - ring_px, 0)),
        (ornament.transpose(Image.Transpose.FLIP_TOP_BOTTOM), (0, width - ring_px)),
        (ornament.transpose(Image.Transpose.ROTATE_180), (width - ring_px, width - ring_px)),
    ]
    overlay = Image.new("RGBA", (width, width), (0, 0, 0, 0))
    for piece, position in variants:
        overlay.alpha_composite(piece, dest=position)

    overlay_pixels = np.array(overlay)
    overlay_pixels[..., 3] = np.where(corner_mask, overlay_pixels[..., 3], 0)
    overlay = Image.fromarray(overlay_pixels, "RGBA")
    frame = Image.alpha_composite(frame, overlay)

    if gold_line:
        inset = int(ring_px * 0.80)
        draw = ImageDraw.Draw(frame)
        draw.rectangle(
            [inset, inset, width - 1 - inset, width - 1 - inset],
            outline=tint(GOLD_LIGHT, tone),
            width=max(1, S),
        )

    return frame.resize((size, size), Image.Resampling.LANCZOS)


# ---------------------------------------------------------------------------
# Asset builders
# ---------------------------------------------------------------------------


def build_assets() -> dict[str, Image.Image]:
    assets: dict[str, Image.Image] = {}

    for name, spec in FRAME_SPECS.items():
        assets[name] = render_frame(
            size=spec["size"],
            ring=spec["ring"],
            stops=spec["stops"],
            corner=spec["corner"],
            tone=1.0,
        )

    for name, spec in BUTTON_SPECS.items():
        assets[name] = render_frame(
            size=spec["size"],
            ring=spec["ring"],
            stops=spec["stops"],
            corner=spec["corner"],
            tone=spec.get("tone", 1.0),
            desaturate_colors=spec.get("desaturate", False),
            gold_line=spec.get("goldLine", False),
        )

    for name, spec in SLOT_SPECS.items():
        assets[name] = render_frame(
            size=spec["size"],
            ring=spec["ring"],
            stops=spec["stops"],
            corner=spec["corner"],
            tone=spec.get("tone", 1.0),
            desaturate_colors=spec.get("desaturate", False),
            gold_line=spec.get("goldLine", False),
        )

    for name, spec in FILL_SPECS.items():
        seed = seed_for(name)
        if spec["kind"] == "wood":
            assets[name] = wood_texture(
                spec["size"],
                seed,
                spec["dark"],
                spec["mid"],
                spec["light"],
            )
        elif spec["kind"] == "stone":
            assets[name] = stone_texture(
                spec["size"],
                seed,
                spec["dark"],
                spec["mid"],
                spec["light"],
            )
        elif spec["kind"] == "gold":
            assets[name] = gold_texture(spec["size"], seed)
        else:  # pragma: no cover - spec typo guard
            raise ValueError(f"unknown fill kind {spec['kind']!r}")

    return assets


# ---------------------------------------------------------------------------
# Metrics + lock
# ---------------------------------------------------------------------------


def luminance(rgb: np.ndarray) -> np.ndarray:
    channel = rgb.astype(np.float64) / 255.0
    linear = np.where(
        channel <= 0.04045,
        channel / 12.92,
        ((channel + 0.055) / 1.055) ** 2.4,
    )
    return 0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]


def frame_metrics(image: Image.Image, spec: dict) -> dict:
    arr = np.asarray(image.convert("RGBA"))
    height, width = arr.shape[:2]
    ring = spec["ring"]
    ring_mask = np.zeros((height, width), dtype=bool)
    ring_mask[:ring, :] = True
    ring_mask[-ring:, :] = True
    ring_mask[:, :ring] = True
    ring_mask[:, -ring:] = True

    ys, xs = np.mgrid[0:height, 0:width]
    distance = np.minimum(
        np.minimum(xs, ys),
        np.minimum(width - 1 - xs, height - 1 - ys),
    )

    # The outermost row/column is antialiased by the downscale; the core ring
    # is what has to be opaque so the fill tile cannot leak through it.
    core_mask = ring_mask & (distance > 1) & (distance < ring - 1)
    ring_min_alpha = int(arr[..., 3][core_mask].min())

    # Edge strips must be uniform along their length; otherwise `stretch`
    # smears the ornament instead of just extending a bevel. The std is per
    # channel and across positions, not across R/G/B.
    strips = [
        arr[0:ring, ring:width - ring, :3],
        arr[height - ring:height, ring:width - ring, :3],
        arr[ring:height - ring, 0:ring, :3],
        arr[ring:height - ring, width - ring:width, :3],
    ]
    edge_std_max = 0.0
    for strip in strips:
        if strip.size == 0:
            continue
        if strip.shape[0] == ring and strip.shape[1] != ring:
            means = strip.mean(axis=0)
        else:
            means = strip.mean(axis=1)
        edge_std_max = max(edge_std_max, float(means.std(axis=0).max()))

    return {
        "file": f"{spec['name']}.png" if "name" in spec else None,
        "width": width,
        "height": height,
        "slice": spec["slice"],
        "borderWidthPx": spec["borderWidthPx"],
        "ringMinAlpha": ring_min_alpha,
        "edgeStdMax": round(edge_std_max, 3),
        "pixelSha256": hashlib.sha256(arr.tobytes()).hexdigest(),
    }


def fill_metrics(image: Image.Image) -> dict:
    arr = np.asarray(image.convert("RGBA"))
    height, width = arr.shape[:2]
    rgb = arr[..., :3].reshape(-1, 3)
    order = np.argsort(luminance(rgb))
    p1 = rgb[order[max(0, int(0.01 * (len(order) - 1)))]]
    p99 = rgb[order[min(len(order) - 1, int(0.99 * (len(order) - 1)))]]
    mean = rgb.mean(axis=0)

    edge_diff = 0
    for first, last in (
        (arr[:, 0, :3], arr[:, -1, :3]),
        (arr[0, :, :3], arr[-1, :, :3]),
    ):
        edge_diff = max(edge_diff, int(np.abs(first.astype(np.int16) - last.astype(np.int16)).max()))

    return {
        "file": None,
        "width": width,
        "height": height,
        "tile": True,
        "p1Rgb": [int(value) for value in p1],
        "p99Rgb": [int(value) for value in p99],
        "meanRgb": [int(round(value)) for value in mean],
        "edgeDiff": edge_diff,
        "pixelSha256": hashlib.sha256(arr.tobytes()).hexdigest(),
    }


def entry_for(name: str, image: Image.Image) -> dict:
    spec = ASSET_SPECS[name]
    if "slice" in spec:
        entry = frame_metrics(image, spec)
    else:
        entry = fill_metrics(image)
    entry["file"] = f"{name}.png"
    return entry


def build_lock(entries: dict[str, dict]) -> dict:
    return {"version": UI_VERSION, "assets": entries}


# ---------------------------------------------------------------------------
# Write / check
# ---------------------------------------------------------------------------


def write_assets(names: set[str] | None = None) -> dict[str, dict]:
    assets = build_assets()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: dict[str, dict] = {}

    for name, image in assets.items():
        if names is not None and name not in names:
            continue
        image.save(OUT_DIR / f"{name}.png", "PNG", optimize=True)
        entries[name] = entry_for(name, image)

    if names is None:
        for path in OUT_DIR.glob("*.png"):
            if path.stem not in assets:
                path.unlink()

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(
        json.dumps(build_lock(entries), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    total = sum((OUT_DIR / entry["file"]).stat().st_size for entry in entries.values())
    print(f"wrote {len(entries)} assets ({total / 1024:.1f} KiB) to {OUT_DIR.relative_to(ROOT)}")
    print(f"wrote {LOCK.relative_to(ROOT)}")
    return entries


def _compare(expected: dict, actual: dict, name: str) -> list[str]:
    problems: list[str] = []
    for key, value in expected.items():
        if key == "file":
            continue
        if actual.get(key) != value:
            problems.append(f"{name}: {key} is {actual.get(key)!r}, lock has {value!r}")
    return problems


def check_assets() -> None:
    if not LOCK.exists():
        raise SystemExit(f"missing {LOCK.relative_to(ROOT)}; run the generator first")

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    problems: list[str] = []

    if lock.get("version") != UI_VERSION:
        problems.append(f"lock version {lock.get('version')!r} != {UI_VERSION}")

    assets = build_assets()
    expected_names = set(assets)
    locked_names = set(lock.get("assets", {}))
    if expected_names != locked_names:
        missing = sorted(expected_names - locked_names)
        extra = sorted(locked_names - expected_names)
        if missing:
            problems.append(f"lock is missing: {', '.join(missing)}")
        if extra:
            problems.append(f"lock has unknown assets: {', '.join(extra)}")

    shipped_names = {path.stem for path in OUT_DIR.glob("*.png")}
    if shipped_names != expected_names:
        missing = sorted(expected_names - shipped_names)
        extra = sorted(shipped_names - expected_names)
        if missing:
            problems.append(f"shipped files missing: {', '.join(missing)}")
        if extra:
            problems.append(f"shipped files not in the kit: {', '.join(extra)}")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        for name, image in assets.items():
            rendered_path = temp_path / f"{name}.png"
            image.save(rendered_path, "PNG", optimize=True)
            rendered_entry = entry_for(name, image)
            problems.extend(_compare(lock["assets"].get(name, {}), rendered_entry, name))

            shipped_path = OUT_DIR / f"{name}.png"
            if shipped_path.exists():
                with Image.open(shipped_path) as shipped:
                    shipped_entry = entry_for(name, shipped.convert("RGBA"))
                problems.extend(_compare(lock["assets"].get(name, {}), shipped_entry, f"shipped {name}"))

    css = CSS.read_text(encoding="utf-8")
    versions = {
        int(match)
        for match in re.findall(r"/assets/ui/[a-z0-9_]+\.png\?v=(\d+)", css)
    }
    if versions != {lock.get("version")}:
        problems.append(
            f"index.css cache-busting versions {sorted(versions)} != lock version {lock.get('version')!r}"
        )

    referenced = set(re.findall(r"/assets/ui/([a-z0-9_]+)\.png", css))
    if referenced != expected_names:
        missing = sorted(expected_names - referenced)
        extra = sorted(referenced - expected_names)
        if missing:
            problems.append(f"index.css does not reference: {', '.join(missing)}")
        if extra:
            problems.append(f"index.css references unknown assets: {', '.join(extra)}")

    if problems:
        print("UI asset check FAILED")
        for problem in problems:
            print("  -", problem)
        raise SystemExit(1)

    print(
        f"UI asset check OK: {len(expected_names)} assets, "
        f"version {lock.get('version')}, {sum((OUT_DIR / f'{name}.png').stat().st_size for name in expected_names) / 1024:.1f} KiB"
    )


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


def _font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def write_contact_sheet(assets: dict[str, Image.Image]) -> Path:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (1500, 1100), (12, 9, 7, 255))
    draw = ImageDraw.Draw(sheet)
    font = _font(16)
    small = _font(12)

    draw.text((24, 20), "Chien Quoc UI chrome - contact sheet", font=font, fill=(240, 208, 144, 255))
    draw.text((24, 44), "frames are shown over their fill tile; button/slot states are separate files", font=small, fill=(180, 170, 150, 255))

    cursor_x, cursor_y = 24, 80
    max_height = 0

    for name, image in assets.items():
        if name.endswith("_fill") or name == "backdrop":
            continue
        if image.width > 220:
            scale = 220 / image.width
            preview = image.resize((220, max(1, int(image.height * scale))), Image.Resampling.NEAREST)
        else:
            preview = image.resize((image.width * 2, image.height * 2), Image.Resampling.NEAREST)

        fill_name = "panel_fill"
        if name.startswith("button_primary"):
            fill_name = "primary_fill"
        elif name.startswith("button_"):
            fill_name = "button_fill"
        elif name.startswith("slot_") or name in ("tooltip_frame", "chip_frame"):
            fill_name = "inset_fill"

        fill = assets[fill_name].resize(preview.size, Image.Resampling.NEAREST)
        composited = Image.alpha_composite(fill, preview)

        if cursor_x + preview.width + 24 > sheet.width:
            cursor_x = 24
            cursor_y += max_height + 42
            max_height = 0

        sheet.alpha_composite(composited, dest=(cursor_x, cursor_y))
        draw.text((cursor_x, cursor_y + preview.height + 4), name, font=small, fill=(210, 200, 180, 255))
        cursor_x += preview.width + 24
        max_height = max(max_height, preview.height)

    path = PREVIEW_DIR / "ui_contact_sheet.png"
    sheet.convert("RGB").save(path, "PNG", optimize=True)
    return path


def write_preview(assets: dict[str, Image.Image]) -> Path:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    base = "../../apps/client/public/assets/ui"

    def frame_div(name: str, width: int, height: int, fill: str, slice_: int, border: int) -> str:
        return (
            f'<div class="frame" style="width:{width}px;height:{height}px;'
            f'border-image:url(\'{base}/{name}.png\') {slice_} / {border}px stretch;'
            f'background-image:url(\'{base}/{fill}.png\');'
            f'background-size:{"64" if fill in ("panel_fill",) else "32"}px;">'
            f'<span>{name} {width}x{height}</span></div>'
        )

    frame_rows = []
    for width, height in ((48, 48), (156, 156), (320, 180), (448, 260)):
        frame_rows.append(frame_div("panel_frame", width, height, "panel_fill", 32, 8))
    modal_rows = [
        frame_div("modal_frame", 448, 260, "modal_fill", 48, 12),
        frame_div("modal_frame", 320, 200, "modal_fill", 48, 12),
    ]

    button_states = ["idle", "hover", "pressed", "disabled", "active"]
    button_rows = "".join(
        f'<div class="key" style="border-image:url(\'{base}/button_{state}.png\') 16 / 3px stretch;'
        f'background-image:url(\'{base}/button_fill.png\');background-size:32px;"><span>{state}</span></div>'
        for state in button_states
    )
    danger_rows = "".join(
        f'<div class="key danger" style="border-image:url(\'{base}/button_danger_{state}.png\') 16 / 3px stretch;'
        f'background-image:url(\'{base}/button_fill.png\');background-size:32px;"><span>{state}</span></div>'
        for state in ("idle", "hover", "pressed")
    )
    primary_rows = "".join(
        f'<div class="key primary" style="border-image:url(\'{base}/button_primary_{state}.png\') 16 / 3px stretch;'
        f'background-image:url(\'{base}/primary_fill.png\');background-size:32px;"><span>{state}</span></div>'
        for state in ("idle", "hover", "pressed")
    )
    slot_rows = "".join(
        f'<div class="key slot" style="border-image:url(\'{base}/slot_{state}.png\') 16 / 4px stretch;'
        f'background-image:url(\'{base}/inset_fill.png\');background-size:32px;"><span>{state}</span></div>'
        for state in ("idle", "hover", "active", "disabled")
    )

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Chien Quoc UI chrome preview</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{
    margin: 0; padding: 24px; background: #050403; color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background-image: url('{base}/backdrop.png'); background-size: 256px;
  }}
  h1 {{ font-size: 18px; color: #f0d090; margin: 0 0 4px; }}
  h2 {{ font-size: 13px; color: #d9a441; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: .08em; }}
  p {{ margin: 0 0 14px; color: #94a3b8; font-size: 12px; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }}
  .frame {{
    position: relative; display: flex; align-items: center; justify-content: center;
    box-sizing: border-box; border: 2px solid transparent;
    color: #e2e8f0; font-size: 11px; text-align: center;
  }}
  .frame span, .key span {{ pointer-events: none; }}
  .key {{
    display: flex; align-items: center; justify-content: center;
    width: 48px; height: 48px; box-sizing: border-box;
    border: 1px solid transparent; color: #fef3c7; font-size: 10px;
  }}
  .key.danger {{ color: #fecaca; }}
  .key.primary {{ color: #0f172a; }}
  .key.slot {{ width: 38px; height: 38px; color: #fef3c7; }}
  .chip {{
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 64px; height: 24px; padding: 0 8px; box-sizing: border-box;
    border: 1px solid transparent; color: #e2e8f0; font-size: 11px;
    border-image: url('{base}/chip_frame.png') 12 / 3px stretch;
    background-image: url('{base}/inset_fill.png'); background-size: 32px;
  }}
  .tooltip {{
    width: 220px; padding: 8px; box-sizing: border-box;
    border: 1px solid transparent; color: #e2e8f0; font-size: 11px;
    border-image: url('{base}/tooltip_frame.png') 24 / 6px stretch;
    background-image: url('{base}/inset_fill.png'); background-size: 32px;
  }}
  .backdrop {{
    width: 100%; max-width: 520px; height: 180px; box-sizing: border-box;
    border: 1px solid #3b2a16; color: #94a3b8; font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    background-image: radial-gradient(ellipse at 50% 38%, rgba(120,80,30,.20), transparent 62%), url('{base}/backdrop.png');
    background-size: 100% 100%, 256px 256px; background-repeat: no-repeat, repeat;
  }}
</style>
</head>
<body>
  <h1>Chien Quoc UI chrome</h1>
  <p>Procedural 9-slice kit, version {UI_VERSION}. Frames use border-image-width larger than border-width so the box model does not move.</p>

  <h2>Panel frame (8 px inward)</h2>
  <div class="row">{''.join(frame_rows)}</div>

  <h2>Modal frame (12 px inward)</h2>
  <div class="row">{''.join(modal_rows)}</div>

  <h2>Buttons</h2>
  <div class="row">{button_rows}</div>
  <div class="row">{danger_rows}</div>
  <div class="row">{primary_rows}</div>

  <h2>Command slots</h2>
  <div class="row">{slot_rows}</div>

  <h2>Chip + tooltip</h2>
  <div class="row"><span class="chip">wood 1234</span><span class="chip">food 999</span>
    <div class="tooltip">A tooltip on the inset stone fill. 11 px text must stay readable.</div>
  </div>

  <h2>Backdrop</h2>
  <div class="row"><div class="backdrop">modal / auth backdrop texture</div></div>
</body>
</html>
"""
    path = PREVIEW_DIR / "ui-preview.html"
    path.write_text(html, encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify shipped assets and index.css")
    parser.add_argument("--preview", action="store_true", help="write scripts/out/ui-preview.html + contact sheet")
    parser.add_argument("--only", metavar="NAMES", help="comma-separated asset names for a partial write")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.check:
        check_assets()
        return

    names = None
    if args.only:
        names = {name.strip() for name in args.only.split(",") if name.strip()}
        unknown = names - set(ASSET_SPECS)
        if unknown:
            raise SystemExit(f"unknown assets: {', '.join(sorted(unknown))}")

    write_assets(names)

    if args.preview:
        assets = build_assets()
        preview = write_preview(assets)
        sheet = write_contact_sheet(assets)
        print(f"preview: {preview.relative_to(ROOT)}")
        print(f"contact sheet: {sheet.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())

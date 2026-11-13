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
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ui_preview import write_contact_sheet, write_preview  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "apps/client/public/assets/ui"
LOCK = ROOT / "scripts/assets/ui.lock.json"
CSS = ROOT / "apps/client/src/index.css"

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
    "panel_frame": {"size": 128, "slice": 32, "borderWidthPx": 8, "stops": PANEL_STOPS, "corner": "bracket"},
    "modal_frame": {"size": 192, "slice": 48, "borderWidthPx": 12, "stops": MODAL_STOPS, "corner": "scroll"},
    "tooltip_frame": {"size": 96, "slice": 24, "borderWidthPx": 6, "stops": TOOLTIP_STOPS, "corner": "rivets"},
    "chip_frame": {"size": 48, "slice": 12, "borderWidthPx": 3, "stops": CHIP_STOPS, "corner": "rivets"},
}

BUTTON_SPECS = {
    "button_idle": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 1.00},
    "button_hover": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 1.14},
    "button_pressed": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_PRESSED_STOPS, "corner": "rivets", "tone": 0.86},
    "button_disabled": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 0.58, "desaturate": True},
    "button_active": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": BUTTON_STOPS, "corner": "rivets", "tone": 1.20, "goldLine": True},
    "button_danger_idle": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": DANGER_STOPS, "corner": "rivets", "tone": 1.00},
    "button_danger_hover": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": DANGER_STOPS, "corner": "rivets", "tone": 1.14},
    "button_danger_pressed": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": DANGER_STOPS, "corner": "rivets", "tone": 0.86},
    "button_primary_idle": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": PRIMARY_STOPS, "corner": "rivets", "tone": 1.00},
    "button_primary_hover": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": PRIMARY_STOPS, "corner": "rivets", "tone": 1.10},
    "button_primary_pressed": {"size": 64, "slice": 16, "borderWidthPx": 3, "stops": PRIMARY_STOPS, "corner": "rivets", "tone": 0.86},
}

SLOT_SPECS = {
    "slot_idle": {"size": 64, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 1.00},
    "slot_hover": {"size": 64, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 1.12},
    "slot_active": {"size": 64, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 1.22, "goldLine": True},
    "slot_disabled": {"size": 64, "slice": 16, "borderWidthPx": 4, "stops": SLOT_STOPS, "corner": "screws", "tone": 0.58, "desaturate": True},
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
    """Brighten above 1.0 by mixing toward white, darken below 1.0 by scaling.

    Two regimes rather than one multiplier: scaling past white clips the brass
    highlights first, which flattened the `hover` and `active` looks into the
    idle one. Mixing keeps the bevel readable while the face still lifts.
    """
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


# One 9-slice frame is drawn per entry; the ornament that fills its corners is
# the only thing the four styles differ in, and `scroll`/`screws` are decorated
# variants of `bracket`/`rivets` rather than separate shapes.
BRACKET_CORNERS = {"bracket", "scroll"}
RIVET_CORNERS = {"rivets", "screws"}
RIVET_RADIUS = {"rivets": 0.18, "screws": 0.14}


def _corner_overlay(
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

    if corner in BRACKET_CORNERS:
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

    elif corner in RIVET_CORNERS:
        radius = max(2, int(ring * RIVET_RADIUS[corner]))
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
    slice_px: int,
    stops: list[tuple[float, tuple[int, int, int]]],
    corner: str,
    tone: float = 1.0,
    desaturate_colors: bool = False,
    gold_line: bool = False,
) -> Image.Image:
    """Draw one 9-slice frame with a transparent centre.

    `slice_px` is the `border-image-slice` this file ships with, which is also
    the ring thickness: the ring has to fill the slice exactly, or the CSS
    slice would cut into the transparent centre.
    """
    width = size * S
    ring_px = slice_px * S

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

    ornament = _corner_overlay(ring_px, corner, tone)
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

    for name, spec in ASSET_SPECS.items():
        seed = seed_for(name)
        if "slice" in spec:
            assets[name] = render_frame(
                size=spec["size"],
                slice_px=spec["slice"],
                stops=spec["stops"],
                corner=spec["corner"],
                tone=spec.get("tone", 1.0),
                desaturate_colors=spec.get("desaturate", False),
                gold_line=spec.get("goldLine", False),
            )
        elif spec["kind"] == "wood":
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
    ring = spec["slice"]
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
    # smears the ornament instead of just extending a bevel. Each strip is
    # averaged across its width and the standard deviation is taken along its
    # length, per channel - not across R/G/B, which would only measure hue.
    strips = [
        arr[0:ring, ring:width - ring, :3],  # top: average rows, vary x
        arr[height - ring:height, ring:width - ring, :3],  # bottom
        arr[ring:height - ring, 0:ring, :3],  # left: average columns, vary y
        arr[ring:height - ring, width - ring:width, :3],  # right
    ]
    edge_std_max = 0.0
    for index, strip in enumerate(strips):
        if strip.size == 0:
            continue
        across_rows = index < 2
        means = strip.mean(axis=0 if across_rows else 1)
        edge_std_max = max(edge_std_max, float(means.std(axis=0).max()))

    return {
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
    entry = frame_metrics(image, spec) if "slice" in spec else fill_metrics(image)
    entry["file"] = f"{name}.png"
    return entry


def build_lock(entries: dict[str, dict]) -> dict:
    return {"version": UI_VERSION, "assets": entries}


# ---------------------------------------------------------------------------
# Write / check
# ---------------------------------------------------------------------------


def write_assets(assets: dict[str, Image.Image], names: set[str] | None = None) -> dict[str, dict]:
    """Write the PNGs and the lock, optionally for a subset of the kit.

    A partial run merges into the existing lock instead of replacing it: the
    other entries still describe files this run did not touch, and dropping them
    would make `--check` report the whole kit as unrecorded.
    """
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    selected = {name: image for name, image in assets.items() if names is None or name in names}
    entries = {name: entry_for(name, image) for name, image in selected.items()}

    for name, image in selected.items():
        image.save(OUT_DIR / f"{name}.png", "PNG", optimize=True)

    if names is None:
        for path in OUT_DIR.glob("*.png"):
            if path.stem not in assets:
                path.unlink()
        merged = entries
    else:
        existing = json.loads(LOCK.read_text(encoding="utf-8")).get("assets", {}) if LOCK.exists() else {}
        merged = {**existing, **entries}

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(
        json.dumps(build_lock(merged), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    total = sum((OUT_DIR / f"{name}.png").stat().st_size for name in selected)
    print(f"wrote {len(selected)} assets ({total / 1024:.1f} KiB) to {OUT_DIR.relative_to(ROOT)}")
    print(f"wrote {LOCK.relative_to(ROOT)} ({len(merged)} entries)")
    return entries


def _compare(expected: dict, actual: dict, name: str) -> list[str]:
    if set(expected) != set(actual):
        missing = sorted(set(actual) - set(expected))
        stale = sorted(set(expected) - set(actual))
        return [
            f"{name}: lock is missing {', '.join(missing)}"
            if missing
            else f"{name}: lock has unknown fields {', '.join(stale)}"
        ]
    return [
        f"{name}: {key} is {actual[key]!r}, lock has {value!r}"
        for key, value in expected.items()
        if actual[key] != value
    ]


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

    # Compare metrics, not bytes: the lock pins decoded pixels, so a Pillow
    # upgrade that re-encodes the same image keeps passing. Nothing is written
    # to disk - the shipped file is decoded separately below, so a hand edit is
    # caught even when it decodes to the same metrics as a fresh render.
    for name, image in assets.items():
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

    assets = build_assets()
    write_assets(assets, names)

    if args.preview:
        preview = write_preview(assets, ASSET_SPECS, UI_VERSION)
        sheet = write_contact_sheet(assets, ASSET_SPECS)
        print(f"preview: {preview.relative_to(ROOT)}")
        print(f"contact sheet: {sheet.relative_to(ROOT)}")
        print("serve from the repo root and open /scripts/out/ui-preview.html")
        print(f"  python3 -m http.server 8899 --bind 127.0.0.1")


if __name__ == "__main__":
    sys.exit(main())

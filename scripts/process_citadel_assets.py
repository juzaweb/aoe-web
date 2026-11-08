#!/usr/bin/env python3
"""Turn the generated citadel textures into the client's floor, wall and gate PNGs.

Usage:
    python scripts/process_citadel_assets.py ^
        --floor scripts/out/citadel/floor.png ^
        --wall  scripts/out/citadel/wall_b.png

    python scripts/process_citadel_assets.py --check     # CI gate, no sources
    python scripts/process_citadel_assets.py --preview   # compose a proof sheet

The two sources are project-original generated art (see
`scripts/generate_citadel_assets.py`), so they are not in
`scripts/assets/manifest.json` and carry no third-party licence. `--check`
re-measures the shipped files instead of comparing a hash, so the art can be
regenerated without rewriting a lock.

Why the floor and the wall are built from a texture instead of a generated
sprite:

* the floor is 128x64 and repeats on every one of the 15x15 interior tiles, so
  a generated diamond would need to tile exactly. A flat texture squashed into
  the iso diamond and clipped with a joint line is seamless by construction.
* the wall block is 128x154 and repeats along every wall run. Its two faces and
  its cap have fixed screen-space corners (the same ones `CitadelLayer` used to
  draw with Graphics), so the texture is mapped onto those faces, shaded per
  face and stroked at the cap, which keeps the block tiling exactly like the
  procedural art did.

Why the gate is assembled rather than generated:

The gate has to put a 3-tile (192 px) walkable opening at the middle of a 6-tile
wall front. A generated gatehouse does not respect those proportions: the model
draws its own idea of a gatehouse, and its arch came out at ~9% of the sprite
width, which is a 38 px doorway at the size that fits the citadel. The gate is
therefore assembled from the same generated stone as the wall, with a real
arched hole at the tile coordinates the server uses. The result is two PNGs:
`gate.png` (the structure, passage open) and `gate_door.png` (an iron
portcullis already skewed to the arch, which `CitadelLayer` raises when a unit
walks in).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "apps" / "client" / "public" / "assets"

TILE_W = 128
TILE_H = 64

FLOOR_REL = Path("citadel") / "floor.png"
FLOOR_SIZE = (TILE_W, TILE_H)
# Mean luminance of the shipped `citadel_floor` (0x7b7f88), so the stone reads
# at the same brightness as the grass and the old procedural apron.
FLOOR_LUM = 134.0
FLOOR_EDGE_LUM = 104.0

WALL_REL = Path("citadel") / "wall.png"
WALL_RISE = 90
WALL_BASE_CENTER_Y = 32 + WALL_RISE
WALL_SIZE = (TILE_W, WALL_BASE_CENTER_Y + 32)  # 128x154
CAP_INSET = 12
WALL_LEFT_LUM = 105.0
WALL_RIGHT_LUM = 80.0
WALL_CAP_LUM = 150.0
WALL_OUTLINE = (0x3A, 0x3F, 0x47)
# The 1024px source has ~80px blocks. Mapped straight onto a 64px-wide face they
# turn into 5px noise, so only a quarter of the sheet is used: same stone, but
# each block lands at a readable 16-20px.
WALL_TEXTURE_CROP = 360
# The generated stone is slightly warm; the client's old wall was a cool
# blue-grey (0x5b606a), so the channels are nudged back before luminance match.
STONE_GAIN = (0.96, 1.0, 1.07)

# --- Gate geometry ---------------------------------------------------------
#
# The gate canvas is anchored on the middle gate tile. Everything below is in
# canvas pixels, so the numbers can be checked against the layout by eye:
# 1 tile = 64 px along iso x and 32 px along iso y.
GATE_REL = Path("citadel") / "gate.png"
GATE_DOOR_REL = Path("citadel") / "gate_door.png"
GATE_CANVAS = (512, 500)
GATE_ANCHOR = (256, 340)
# The sprite is placed on the middle gate tile centre, but the front face's foot
# sits on the *front corner* of that tile's diamond, 32 px below the centre —
# the same row the wall block's base ends on. Without this the gate floats one
# half-tile above the wall run.
GATE_ORIGIN = (0.5, (GATE_ANCHOR[1] - 32) / GATE_CANVAS[1])
# 3 tiles of wall front on each side of the middle gate tile.
GATE_HALF_SPAN = 192
GATE_WALL_H = 150
# One tile of thickness, screen-space, towards -x (the back of the wall).
GATE_THICK = (-64, -32)
# The walkable opening is 3 tiles wide: +-96 px along iso y from the anchor.
GATE_OPEN_HALF = 96
GATE_ARCH_SPRING = 62
GATE_ARCH_RADIUS = 34
GATE_FRONT_LUM = 108.0
GATE_SIDE_LUM = 84.0
GATE_CAP_LUM = 150.0
GATE_PASSAGE_TOP = (0x0B, 0x0D, 0x10)
GATE_PASSAGE_BOTTOM = (0x1C, 0x20, 0x26)
GATE_ARCH_RING = (0x9A, 0x9F, 0xA8)
GATE_IRON = (0x2B, 0x2F, 0x36)
GATE_IRON_HIGHLIGHT = (0x4A, 0x50, 0x5A)

GATE_MIN_ALPHA = 8
GATE_MIN_BLOB = 6

# --- Town Center terrace ---------------------------------------------------
#
# The Town Center stands on a raised palace-like terrace instead of sitting flat
# on the citadel floor: a 6x6-tile podium with coursed retaining faces, a stone
# balustrade along the front rim and a wide flight of steps on the south-east
# face, directly under the building's gatehouse. `CitadelLayer` draws the PNG
# under the building and `EntityRenderer` lifts the building art by `TC_RISE`, so
# the sprite's base lands on the terrace rather than sinking into it.
TC_PLATFORM_REL = Path("citadel") / "tc_platform.png"
TC_PLATFORM_TILES = (6, 6)
TC_RISE = 112
TC_STEPS = 7
TC_STEP_RUN = 16
TC_STEP_RISE = TC_RISE // TC_STEPS
# The gatehouse is on the south-east face, so the flight is a straight run on
# that rim rather than a symmetric stair at the front corner. `TC_STAIR_CENTER`
# is the fraction along the south-east rim measured from the front vertex, and
# `TC_STAIR_HALF` is half the stair width in screen pixels along that rim.
TC_STAIR_CENTER = 0.32
TC_STAIR_HALF = 120
TC_TOP_HALF_W = (TC_PLATFORM_TILES[0] + TC_PLATFORM_TILES[1]) * TILE_W // 4
TC_TOP_HALF_H = (TC_PLATFORM_TILES[0] + TC_PLATFORM_TILES[1]) * TILE_H // 4
TC_CANVAS_PAD = 8
# Texture row that sits on the platform's top-centre; `CitadelLayer` uses the
# same ratio as the image origin, so the anchor is shared, not re-derived.
TC_ANCHOR = (TC_TOP_HALF_W + TC_CANVAS_PAD, TC_TOP_HALF_H + TC_CANVAS_PAD)
# Extent below the anchor: whichever is lower, the platform foot plus its
# contact shadow or the foot of the stair flight on the south-east rim.
_TC_EDGE_LENGTH = float(np.hypot(TC_TOP_HALF_W, TC_TOP_HALF_H))
_TC_OUT_Y = TILE_H / float(np.hypot(TILE_W, TILE_H))
_TC_STAIR_START_Y = (
    TC_TOP_HALF_H
    - TC_TOP_HALF_H * TC_STAIR_CENTER
    + TC_STAIR_HALF * (TC_TOP_HALF_H / _TC_EDGE_LENGTH)
)
_TC_STAIR_BOTTOM_Y = _TC_STAIR_START_Y + TC_STEPS * (TC_STEP_RUN * _TC_OUT_Y + TC_STEP_RISE)
_TC_PLATFORM_BOTTOM_Y = TC_TOP_HALF_H + TC_RISE + 14
TC_CANVAS = (
    TC_TOP_HALF_W * 2 + TC_CANVAS_PAD * 2,
    TC_ANCHOR[1] + int(np.ceil(max(_TC_STAIR_BOTTOM_Y, _TC_PLATFORM_BOTTOM_Y))) + TC_CANVAS_PAD,
)
TC_LEFT_LUM = 108.0
TC_RIGHT_LUM = 84.0
TC_TOP_LUM = 144.0
TC_STEP_LUM = 150.0

LUM_WEIGHTS = (0.299, 0.587, 0.114)


def luminance(rgb: np.ndarray) -> np.ndarray:
    return (
        rgb[..., 0] * LUM_WEIGHTS[0]
        + rgb[..., 1] * LUM_WEIGHTS[1]
        + rgb[..., 2] * LUM_WEIGHTS[2]
    )


def load_rgba(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)


def resize_rgb(rgb: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """LANCZOS resize of an RGB array (no alpha to premultiply)."""
    image = Image.fromarray(rgb.astype(np.uint8), mode="RGB")
    return np.asarray(image.resize(size, Image.LANCZOS), dtype=np.uint8)


def resize_premultiplied(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    rgb = rgba[..., :3].astype(np.float64)
    alpha = rgba[..., 3].astype(np.float64) / 255.0
    premultiplied = rgb * alpha[..., None]

    def resize(channel: np.ndarray) -> np.ndarray:
        image = Image.fromarray(channel.astype(np.float32), mode="F")
        return np.asarray(image.resize(size, Image.LANCZOS), dtype=np.float64)

    out_alpha = np.clip(resize(alpha), 0.0, 1.0)
    scaled = np.stack([resize(premultiplied[..., i]) for i in range(3)], axis=-1)
    safe = np.maximum(out_alpha, 1e-6)[..., None]
    out_rgb = np.clip(np.where(out_alpha[..., None] > 1e-6, scaled / safe, 0.0), 0.0, 255.0)
    result = np.zeros((size[1], size[0], 4), dtype=np.uint8)
    result[..., :3] = np.rint(out_rgb).astype(np.uint8)
    result[..., 3] = np.rint(out_alpha * 255.0).astype(np.uint8)
    return result


def bleed_rgb(rgba: np.ndarray, passes: int = 2) -> np.ndarray:
    """Copy edge colour into transparent pixels to avoid dark bilinear fringes."""
    out = rgba.astype(np.float64)
    known = out[..., 3] > 0
    height, width = known.shape
    for _ in range(passes):
        acc = np.zeros((height, width, 3), dtype=np.float64)
        count = np.zeros((height, width), dtype=np.float64)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src_rgb = np.zeros_like(acc)
            src_known = np.zeros((height, width), dtype=bool)
            dst_y = slice(max(0, dy), height + min(0, dy))
            dst_x = slice(max(0, dx), width + min(0, dx))
            src_y = slice(max(0, -dy), height + min(0, -dy))
            src_x = slice(max(0, -dx), width + min(0, -dx))
            src_rgb[dst_y, dst_x] = out[src_y, src_x, :3]
            src_known[dst_y, dst_x] = known[src_y, src_x]
            acc += src_rgb * src_known[..., None]
            count += src_known
        fill = (~known) & (count > 0)
        out[..., :3][fill] = (acc / np.maximum(count, 1.0)[..., None])[fill]
        known = known | fill
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def clean_alpha(alpha: np.ndarray, min_alpha: int, min_blob: int) -> np.ndarray:
    cleaned = np.where(alpha < min_alpha, 0, alpha).astype(np.uint8)
    return cleaned


def polygon_mask(
    size: tuple[int, int], points: list[tuple[float, float]], ss: int = 4
) -> np.ndarray:
    width, height = size
    mask = Image.new("L", (width * ss, height * ss), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(x * ss, y * ss) for x, y in points], fill=255)
    return np.asarray(mask.resize(size, Image.LANCZOS), dtype=np.float64) / 255.0


def stroke_mask(
    size: tuple[int, int],
    points: list[tuple[float, float]],
    width_px: float,
    ss: int = 4,
    closed: bool = True,
) -> np.ndarray:
    width, height = size
    mask = Image.new("L", (width * ss, height * ss), 0)
    draw = ImageDraw.Draw(mask)
    scaled = [(x * ss, y * ss) for x, y in points]
    if closed:
        scaled = scaled + [scaled[0]]
    draw.line(scaled, fill=255, width=max(1, round(width_px * ss)), joint="curve")
    return np.asarray(mask.resize(size, Image.LANCZOS), dtype=np.float64) / 255.0


def map_parallelogram(
    source: np.ndarray,
    canvas_size: tuple[int, int],
    origin: tuple[float, float],
    along: tuple[float, float],
    up: tuple[float, float],
) -> np.ndarray:
    """Map `source` onto the parallelogram origin / origin+along / origin+up."""
    ox, oy = origin
    ux, uy = along
    vx, vy = up
    determinant = ux * vy - uy * vx
    if abs(determinant) < 1e-6:
        raise ValueError("degenerate parallelogram")
    inv_a = vy / determinant
    inv_b = -vx / determinant
    inv_c = -uy / determinant
    inv_d = ux / determinant
    src_h, src_w = source.shape[:2]
    data = (
        inv_a * src_w,
        inv_b * src_w,
        (-inv_a * ox - inv_b * oy) * src_w,
        inv_c * src_h,
        inv_d * src_h,
        (-inv_c * ox - inv_d * oy) * src_h,
    )
    image = Image.fromarray(source.astype(np.uint8), mode="RGB")
    return np.asarray(image.transform(canvas_size, Image.AFFINE, data, resample=Image.BICUBIC), dtype=np.float64)


def shade_region(rgb: np.ndarray, mask: np.ndarray, target_lum: float) -> np.ndarray:
    """Multiply one region so its opaque mean luminance lands on `target_lum`."""
    weight = mask > 0.01
    if not weight.any():
        return rgb
    current = float(luminance(rgb[weight]).mean())
    gain = target_lum / max(current, 1e-6)
    return np.clip(rgb * gain, 0.0, 255.0)


def blend_polygon(
    rgb: np.ndarray,
    alpha: np.ndarray,
    points: list[tuple[float, float]],
    layer: np.ndarray,
    target_lum: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Composite a textured layer through a polygon."""
    mask = polygon_mask((rgb.shape[1], rgb.shape[0]), points)
    shaded = shade_region(layer, mask, target_lum)
    rgb[:] = rgb * (1.0 - mask[..., None]) + shaded * mask[..., None]
    alpha[:] = np.maximum(alpha, mask)
    return rgb, alpha


def add_outline(
    rgb: np.ndarray,
    points: list[tuple[float, float]],
    width_px: float,
    closed: bool = True,
    colour: tuple[int, int, int] = WALL_OUTLINE,
) -> None:
    mask = stroke_mask((rgb.shape[1], rgb.shape[0]), points, width_px, closed=closed)
    rgb[:] = rgb * (1.0 - mask[..., None]) + np.array(colour, dtype=np.float64) * mask[..., None]


# ---------------------------------------------------------------------------
# Floor
# ---------------------------------------------------------------------------

FLOOR_DIAMOND = [(64, 0), (128, 32), (64, 64), (0, 32)]


def build_floor(source: Path, out_root: Path) -> dict:
    rgba = load_rgba(source)
    texture = resize_rgb(rgba[..., :3], FLOOR_SIZE).astype(np.float64)
    texture = np.clip(texture * np.array(STONE_GAIN), 0.0, 255.0)

    mask = polygon_mask(FLOOR_SIZE, FLOOR_DIAMOND)
    body = shade_region(texture, mask, FLOOR_LUM)

    # A soft joint along the diamond rim reads as the cut edge of a flagstone
    # and hides the seam where one tile meets the next.
    rim = stroke_mask(FLOOR_SIZE, FLOOR_DIAMOND, 2.0)
    body = np.where(rim[..., None] > 0, body * (FLOOR_EDGE_LUM / max(FLOOR_LUM, 1.0)), body)

    canvas = np.zeros((FLOOR_SIZE[1], FLOOR_SIZE[0], 4), dtype=np.uint8)
    canvas[..., :3] = np.clip(np.rint(body), 0, 255).astype(np.uint8)
    canvas[..., 3] = np.rint(mask * 255.0).astype(np.uint8)
    canvas = bleed_rgb(canvas)

    target = out_root / FLOOR_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)
    return {"name": target.name, "size": FLOOR_SIZE, "meanLum": measure_mean_lum(canvas)}


# ---------------------------------------------------------------------------
# Wall
# ---------------------------------------------------------------------------

BASE_Y = WALL_BASE_CENTER_Y
TOP_Y = BASE_Y - WALL_RISE
WALL_LEFT = [(0, BASE_Y), (64, BASE_Y + 32), (64, TOP_Y + 32 - CAP_INSET), (CAP_INSET, TOP_Y)]
WALL_RIGHT = [
    (64, BASE_Y + 32),
    (128, BASE_Y),
    (128 - CAP_INSET, TOP_Y),
    (64, TOP_Y + 32 - CAP_INSET),
]
WALL_CAP = [(64, TOP_Y - 32 + CAP_INSET), (128 - CAP_INSET, TOP_Y), (64, TOP_Y + 32 - CAP_INSET), (CAP_INSET, TOP_Y)]


def center_crop(rgb: np.ndarray, size: int) -> np.ndarray:
    height, width = rgb.shape[:2]
    side = min(size, height, width)
    x0 = (width - side) // 2
    y0 = (height - side) // 2
    return rgb[y0 : y0 + side, x0 : x0 + side]


def load_stone(path: Path, crop: int) -> np.ndarray:
    rgba = load_rgba(path)
    texture = center_crop(rgba[..., :3], crop).astype(np.float64)
    return np.clip(texture * np.array(STONE_GAIN), 0.0, 255.0)


def load_stone_rect(path: Path, width: int, height: int) -> np.ndarray:
    """Centre crop with a chosen aspect, so a long face keeps square stones."""
    rgba = load_rgba(path)
    rgb = rgba[..., :3].astype(np.float64)
    source_h, source_w = rgb.shape[:2]
    width = min(width, source_w)
    height = min(height, source_h)
    x0 = (source_w - width) // 2
    y0 = (source_h - height) // 2
    texture = rgb[y0 : y0 + height, x0 : x0 + width]
    return np.clip(texture * np.array(STONE_GAIN), 0.0, 255.0)


def build_wall(source: Path, out_root: Path, cap_source: Path | None = None) -> dict:
    texture = load_stone(source, WALL_TEXTURE_CROP)
    # The cap is a horizontal plane, so it uses the floor texture (a top-down
    # stone surface) rather than the wall elevation: mapping the elevation onto
    # the cap reads as gravel, not as a walkway on top of the wall.
    cap_texture = load_stone(cap_source, 512) if cap_source is not None else texture

    left_mask = polygon_mask(WALL_SIZE, WALL_LEFT)
    right_mask = polygon_mask(WALL_SIZE, WALL_RIGHT)
    cap_mask = polygon_mask(WALL_SIZE, WALL_CAP)
    body_mask = np.clip(left_mask + right_mask + cap_mask, 0.0, 1.0)

    # Each face gets its own affine projection, so the courses run along the
    # wall instead of across the screen. Faces are shaded by target luminance,
    # which is what makes a flat texture read as a block.
    left = map_parallelogram(texture, WALL_SIZE, (0, BASE_Y), (64, 32), (0, -WALL_RISE))
    right = map_parallelogram(texture, WALL_SIZE, (64, BASE_Y + 32), (64, -32), (0, -WALL_RISE))
    cap = map_parallelogram(cap_texture, WALL_SIZE, (CAP_INSET, TOP_Y), (64, 20), (64, -20))

    canvas_rgb = np.zeros((WALL_SIZE[1], WALL_SIZE[0], 3), dtype=np.float64)
    for layer, layer_mask, target_lum in (
        (left, left_mask, WALL_LEFT_LUM),
        (right, right_mask, WALL_RIGHT_LUM),
        (cap, cap_mask, WALL_CAP_LUM),
    ):
        shaded = shade_region(layer, layer_mask, target_lum)
        weight = layer_mask[..., None]
        canvas_rgb = canvas_rgb * (1.0 - weight) + shaded * weight

    # Cap edge and the ground-contact line keep the block readable from above.
    add_outline(canvas_rgb, WALL_CAP, 1.2)
    add_outline(canvas_rgb, [(0, BASE_Y), (64, BASE_Y + 32), (128, BASE_Y)], 1.2, closed=False)

    canvas = np.zeros((WALL_SIZE[1], WALL_SIZE[0], 4), dtype=np.uint8)
    canvas[..., :3] = np.clip(np.rint(canvas_rgb), 0, 255).astype(np.uint8)
    canvas[..., 3] = np.rint(body_mask * 255.0).astype(np.uint8)
    canvas = bleed_rgb(canvas)

    target = out_root / WALL_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)
    return {"name": target.name, "size": WALL_SIZE, "meanLum": measure_mean_lum(canvas)}


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------


def gate_points() -> dict:
    """Every corner of the gatehouse, in canvas pixels."""
    ax, ay = GATE_ANCHOR
    a_b = (ax + GATE_HALF_SPAN, ay - GATE_HALF_SPAN / 2)
    b_b = (ax - GATE_HALF_SPAN, ay + GATE_HALF_SPAN / 2)
    a_t = (a_b[0], a_b[1] - GATE_WALL_H)
    b_t = (b_b[0], b_b[1] - GATE_WALL_H)
    a_bt = (a_t[0] + GATE_THICK[0], a_t[1] + GATE_THICK[1])
    b_bt = (b_t[0] + GATE_THICK[0], b_t[1] + GATE_THICK[1])
    a_bb = (a_b[0] + GATE_THICK[0], a_b[1] + GATE_THICK[1])
    b_bb = (b_b[0] + GATE_THICK[0], b_b[1] + GATE_THICK[1])
    p0 = (ax + GATE_OPEN_HALF, ay - GATE_OPEN_HALF / 2)
    p1 = (ax - GATE_OPEN_HALF, ay + GATE_OPEN_HALF / 2)

    def opening_height(u: float) -> float:
        arc = max(0.0, 1.0 - (2 * u - 1) ** 2)
        return GATE_ARCH_SPRING + GATE_ARCH_RADIUS * arc ** 0.5

    def opening_point(u: float, lifted: bool = True) -> tuple[float, float]:
        x = p0[0] + u * (p1[0] - p0[0])
        y = p0[1] + u * (p1[1] - p0[1])
        return (x, y - opening_height(u)) if lifted else (x, y)

    arch = [opening_point(u) for u in np.linspace(1.0, 0.0, 33)]
    hole = [p0, p1] + arch
    return {
        "a_b": a_b,
        "b_b": b_b,
        "a_t": a_t,
        "b_t": b_t,
        "a_bt": a_bt,
        "b_bt": b_bt,
        "a_bb": a_bb,
        "b_bb": b_bb,
        "p0": p0,
        "p1": p1,
        "hole": hole,
        "opening_point": opening_point,
    }


def draw_iso_box(
    rgb: np.ndarray,
    alpha: np.ndarray,
    center: tuple[float, float],
    half_w: float,
    half_h: float,
    height: float,
    texture: np.ndarray,
    cap_texture: np.ndarray,
    front_lum: float,
    side_lum: float,
    cap_lum: float,
    outline_width: float = 1.1,
) -> None:
    cx, cy = center
    north = (cx, cy - half_h)
    east = (cx + half_w, cy)
    south = (cx, cy + half_h)
    west = (cx - half_w, cy)
    up = (0.0, -height)

    def top(point: tuple[float, float]) -> tuple[float, float]:
        return (point[0], point[1] - height)

    # Side face (+y, faces down-left).
    side = map_parallelogram(texture, (rgb.shape[1], rgb.shape[0]), south, (west[0] - south[0], west[1] - south[1]), up)
    _, alpha = blend_polygon(rgb, alpha, [south, west, top(west), top(south)], side, side_lum)

    # Front face (+x, faces down-right).
    front = map_parallelogram(texture, (rgb.shape[1], rgb.shape[0]), south, (east[0] - south[0], east[1] - south[1]), up)
    _, alpha = blend_polygon(rgb, alpha, [south, east, top(east), top(south)], front, front_lum)

    # Cap, a horizontal plane, so it takes the floor texture.
    cap = map_parallelogram(
        cap_texture,
        (rgb.shape[1], rgb.shape[0]),
        top(south),
        (east[0] - south[0], east[1] - south[1]),
        (west[0] - south[0], west[1] - south[1]),
    )
    _, alpha = blend_polygon(rgb, alpha, [top(north), top(east), top(south), top(west)], cap, cap_lum)

    add_outline(rgb, [top(north), top(east), top(south), top(west)], outline_width)
    add_outline(rgb, [south, east, top(east), top(south)], outline_width, closed=False)


def build_gate(wall_source: Path, floor_source: Path, out_root: Path) -> list[dict]:
    texture = load_stone(wall_source, WALL_TEXTURE_CROP)
    # The long front face is ~2:1 on screen; a square crop would squash its
    # stones into horizontal streaks.
    front_texture = load_stone_rect(wall_source, 720, 360)
    cap_texture = load_stone(floor_source, 512)
    size = GATE_CANVAS
    points = gate_points()

    rgb = np.zeros((size[1], size[0], 3), dtype=np.float64)
    alpha = np.zeros((size[1], size[0]), dtype=np.float64)

    a_b, b_b = points["a_b"], points["b_b"]
    a_t, b_t = points["a_t"], points["b_t"]
    a_bt, b_bt = points["a_bt"], points["b_bt"]
    b_bb = points["b_bb"]

    # Main wall: long front face, top cap, visible +y end face.
    front = map_parallelogram(front_texture, size, a_b, (b_b[0] - a_b[0], b_b[1] - a_b[1]), (0, -GATE_WALL_H))
    _, alpha = blend_polygon(rgb, alpha, [a_b, b_b, b_t, a_t], front, GATE_FRONT_LUM)

    cap = map_parallelogram(cap_texture, size, a_t, (a_bt[0] - a_t[0], a_bt[1] - a_t[1]), (b_bt[0] - a_bt[0], b_bt[1] - a_bt[1]))
    _, alpha = blend_polygon(rgb, alpha, [a_t, a_bt, b_bt, b_t], cap, GATE_CAP_LUM)

    end = map_parallelogram(texture, size, b_b, (b_bb[0] - b_b[0], b_bb[1] - b_b[1]), (0, -GATE_WALL_H))
    _, alpha = blend_polygon(rgb, alpha, [b_b, b_bb, b_bt, b_t], end, GATE_SIDE_LUM)

    add_outline(rgb, [a_t, a_bt, b_bt, b_t], 1.2)
    add_outline(rgb, [b_b, b_bb, b_bt, b_t], 1.1)
    add_outline(rgb, [a_b, b_b, b_t], 1.1, closed=False)
    add_outline(rgb, [a_b, a_t], 1.1, closed=False)

    # The arched opening: a dark stone passage painted into the front face, with
    # the arch ring picked out in stone so it reads at a glance.
    hole = points["hole"]
    hole_mask = polygon_mask(size, hole)
    ys, xs = np.nonzero(hole_mask > 0)
    top_y = float(ys.min()) if len(ys) else 0.0
    bottom_y = float(ys.max()) if len(ys) else 1.0
    span = max(1.0, bottom_y - top_y)
    vertical = np.clip((np.arange(size[1])[:, None] - top_y) / span, 0.0, 1.0)
    vertical = np.repeat(vertical, size[0], axis=1)
    # Dark masonry inside the tunnel, not a flat black hole: the front face of
    # the citadel keeps reading as stone when the portcullis is up.
    passage = map_parallelogram(
        texture,
        size,
        (xs.min(), top_y),
        (xs.max() - xs.min() + 1, 0),
        (0, span),
    )
    passage = shade_region(passage, hole_mask, 46.0)
    fog = 0.55 + 0.45 * vertical
    passage *= fog[..., None]
    # Darker at the jambs, so the passage reads as recessed.
    horizontal = np.abs(np.linspace(-1.0, 1.0, size[0]))[None, :]
    passage *= (1.0 - 0.3 * horizontal[..., None])
    rgb = rgb * (1.0 - hole_mask[..., None]) + passage * hole_mask[..., None]

    # Sill: the citadel floor showing through the bottom of the passage, so the
    # opening reads as a walkway rather than a black hole.
    sill = [
        (points["p0"][0], points["p0"][1] - 16),
        (points["p1"][0], points["p1"][1] - 16),
        points["p1"],
        points["p0"],
    ]
    sill_texture = map_parallelogram(
        cap_texture,
        size,
        sill[3],
        (sill[2][0] - sill[3][0], sill[2][1] - sill[3][1]),
        (0, -16),
    )
    _, alpha = blend_polygon(rgb, alpha, sill, sill_texture, 74.0)

    # Voussoir band: a light stone ring around the opening with a dark joint, so
    # the arch reads as built stone instead of a cut-out.
    band = stroke_mask(size, hole, 8.0)
    rgb = rgb * (1.0 - band[..., None]) + np.array((0x93, 0x97, 0xA0), dtype=np.float64) * band[..., None]
    add_outline(rgb, hole, 1.0, colour=(0x3A, 0x3F, 0x47))

    # Crenellations along the front top edge.
    for index in range(5):
        t = (index + 0.5) / 5
        base = (a_t[0] + t * (b_t[0] - a_t[0]) - 32, a_t[1] + t * (b_t[1] - a_t[1]) - 16)
        draw_iso_box(
            rgb, alpha, base, 44, 22, 30, texture, cap_texture,
            GATE_FRONT_LUM, GATE_SIDE_LUM, GATE_CAP_LUM, outline_width=1.0
        )

    # Flanking towers, sitting right at the edges of the opening so they frame
    # the gate instead of standing far out on the wall like a bridge pier.
    tower_height = 210
    for sign in (1, -1):
        base = (GATE_ANCHOR[0] - sign * 128, GATE_ANCHOR[1] + sign * 64)
        draw_iso_box(
            rgb, alpha, base, 72, 36, tower_height, texture, cap_texture,
            GATE_FRONT_LUM, GATE_SIDE_LUM, GATE_CAP_LUM
        )
        # Three merlons on the tower's front edges.
        for spot in ((0, 36), (58, 24), (-58, 24)):
            merlon = (base[0] + spot[0], base[1] + spot[1] - tower_height)
            draw_iso_box(
                rgb, alpha, merlon, 28, 14, 26, texture, cap_texture,
                GATE_FRONT_LUM, GATE_SIDE_LUM, GATE_CAP_LUM, outline_width=0.9
            )

    canvas = np.zeros((size[1], size[0], 4), dtype=np.uint8)
    canvas[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    canvas[..., 3] = np.rint(np.clip(alpha, 0.0, 1.0) * 255.0).astype(np.uint8)
    canvas = bleed_rgb(canvas)

    target = out_root / GATE_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)

    door = build_gate_door(points)
    door_target = out_root / GATE_DOOR_REL
    Image.fromarray(door, mode="RGBA").save(door_target, "PNG", optimize=True)

    return [
        {
            "name": target.name,
            "size": size,
            "meanLum": measure_mean_lum(canvas),
            "doorBox": door_bbox(points),
        },
        {"name": door_target.name, "size": (door.shape[1], door.shape[0]), "meanLum": measure_mean_lum(door)},
    ]


def door_bbox(points: dict) -> tuple[int, int, int, int]:
    hole = points["hole"]
    xs = [x for x, _ in hole]
    ys = [y for _, y in hole]
    return (int(np.floor(min(xs))), int(np.floor(min(ys))), int(np.ceil(max(xs))), int(np.ceil(max(ys))))


def build_gate_door(points: dict) -> np.ndarray:
    """An iron portcullis already skewed into the arch, on its own canvas."""
    x0, y0, x1, y1 = door_bbox(points)
    width, height = x1 - x0, y1 - y0
    door = np.zeros((height, width, 4), dtype=np.float64)

    hole = [(x - x0, y - y0) for x, y in points["hole"]]
    hole_mask = polygon_mask((width, height), hole)

    # Bars follow the opening: each one runs from the (slanted) sill up to the
    # arch, so the grid leans with the isometric face.
    opening_point = points["opening_point"]

    def local(point: tuple[float, float]) -> tuple[float, float]:
        return (point[0] - x0, point[1] - y0)

    bars = Image.new("L", (width * 4, height * 4), 0)
    draw = ImageDraw.Draw(bars)
    count = 13
    for index in range(count):
        u = (index + 0.5) / count
        sill = local(opening_point(u, lifted=False))
        arch = local(opening_point(u, lifted=True))
        draw.line(
            [(sill[0] * 4, sill[1] * 4), (arch[0] * 4, arch[1] * 4)],
            fill=255,
            width=4 * 4,
        )
    beam = Image.new("L", (width * 4, height * 4), 0)
    beam_draw = ImageDraw.Draw(beam)
    for fraction in (0.16, 0.52, 0.88):
        line = []
        for index in range(25):
            u = index / 24
            base = opening_point(u, lifted=False)
            point = (base[0], base[1] - GATE_ARCH_SPRING * fraction - GATE_ARCH_RADIUS * fraction)
            line.append((local(point)[0] * 4, local(point)[1] * 4))
        beam_draw.line(line, fill=255, width=5 * 4)

    def down(mask_image: Image.Image) -> np.ndarray:
        return np.asarray(mask_image.resize((width, height), Image.LANCZOS), dtype=np.float64) / 255.0

    bar_mask = down(bars) * hole_mask
    beam_mask = down(beam) * hole_mask

    door[..., :3] = np.array(GATE_IRON, dtype=np.float64)
    door[..., :3] = door[..., :3] * (1.0 - bar_mask[..., None]) + np.array(GATE_IRON_HIGHLIGHT, dtype=np.float64) * bar_mask[..., None]
    door[..., :3] = door[..., :3] * (1.0 - beam_mask[..., None]) + np.array(GATE_IRON_HIGHLIGHT, dtype=np.float64) * beam_mask[..., None]
    door[..., 3] = hole_mask * 255.0

    canvas = np.clip(np.rint(door), 0, 255).astype(np.uint8)
    return bleed_rgb(canvas)


# ---------------------------------------------------------------------------
# Town Center terrace
# ---------------------------------------------------------------------------


def _normalise(vector: tuple[float, float]) -> tuple[float, float]:
    length = float(np.hypot(vector[0], vector[1]))
    return (vector[0] / length, vector[1] / length)


def build_tc_platform(wall_source: Path, out_root: Path) -> dict:
    """A raised stone terrace for the Town Center, with front steps.

    The top is tiled from the floor diamond written by `build_floor`, so the
    terrace reads as the same pavement as the citadel. The two south-facing
    retaining faces use the wall stone at the same per-face brightness as the
    curtain wall, and the staircase descends from the south-east rim to the
    floor under the gatehouse.
    """
    width, height = TC_CANVAS
    cx, cy = TC_ANCHOR

    wall_texture = load_stone(wall_source, WALL_TEXTURE_CROP)

    canvas_rgb = np.zeros((height, width, 3), dtype=np.float64)
    canvas_alpha = np.zeros((height, width), dtype=np.float64)

    # --- paved top -------------------------------------------------------
    top_diamond = [
        (cx, cy - TC_TOP_HALF_H),
        (cx + TC_TOP_HALF_W, cy),
        (cx, cy + TC_TOP_HALF_H),
        (cx - TC_TOP_HALF_W, cy),
    ]
    top_mask = polygon_mask((width, height), top_diamond)

    tile = Image.open(out_root / FLOOR_REL).convert("RGBA")
    tiles_x, tiles_y = TC_PLATFORM_TILES
    top_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # An even row and column count leaves a diamond-shaped notch at each corner
    # of the terrace (the outermost tile tips only meet at a point). The grid is
    # therefore padded generously: the mask clips the top face, and the same
    # pavement doubles as the 1:1 source for the stair treads below the edge.
    for j in range(-10, tiles_y + 10):
        for i in range(-10, tiles_x + 10):
            gx = i - (tiles_x - 1) / 2
            gy = j - (tiles_y - 1) / 2
            sx = cx + (gx - gy) * TILE_W / 2
            sy = cy + (gx + gy) * TILE_H / 2
            top_layer.alpha_composite(tile, (round(sx - tile.width / 2), round(sy - tile.height / 2)))

    top = np.asarray(top_layer, dtype=np.float64)
    top[..., :3] = shade_region(top[..., :3], top_mask, TC_TOP_LUM)
    top[..., 3] = top_mask
    canvas_rgb = top[..., :3].copy()
    canvas_alpha = top[..., 3].copy()

    # --- retaining faces -------------------------------------------------
    half_w, half_h = TC_TOP_HALF_W, TC_TOP_HALF_H
    front = (cx, cy + half_h)
    left = (cx - half_w, cy)
    right = (cx + half_w, cy)
    left_ground = (left[0], left[1] + TC_RISE)
    right_ground = (right[0], right[1] + TC_RISE)
    front_ground = (front[0], front[1] + TC_RISE)

    # The `up` vector matches the face height, so the wall stone is only
    # moderately compressed and reads as coursed blocks instead of boulders.
    sw_layer = map_parallelogram(
        wall_texture, (width, height), left, (half_w, half_h), (0, TC_RISE)
    )
    se_layer = map_parallelogram(
        wall_texture, (width, height), front, (half_w, -half_h), (0, TC_RISE)
    )
    blend_polygon(canvas_rgb, canvas_alpha, [left, front, front_ground, left_ground], sw_layer, TC_LEFT_LUM)
    blend_polygon(canvas_rgb, canvas_alpha, [front, right, right_ground, front_ground], se_layer, TC_RIGHT_LUM)

    # A darker plinth course along the foot, like the base moulding of a palace
    # terrace; it makes the retaining wall read as built rather than extruded.
    plinth = [
        left_ground,
        front_ground,
        right_ground,
        (right_ground[0], right_ground[1] - 16),
        (front_ground[0], front_ground[1] - 16),
        (left_ground[0], left_ground[1] - 16),
    ]
    plinth_mask = polygon_mask((width, height), plinth)
    canvas_rgb[:] = canvas_rgb * (1.0 - plinth_mask[..., None] * 0.42) + np.array(
        [58.0, 62.0, 69.0], dtype=np.float64
    ) * plinth_mask[..., None] * 0.42
    add_outline(canvas_rgb, plinth[:3], 1.0, closed=False, colour=(46, 50, 58))

    # A soft contact shadow outside the foot of the terrace grounds it against
    # the floor; without it a low rise reads as a painted outline.
    shadow = [
        left_ground,
        front_ground,
        right_ground,
        (right_ground[0], right_ground[1] + 14),
        (front_ground[0], front_ground[1] + 14),
        (left_ground[0], left_ground[1] + 14),
    ]
    shadow_mask = polygon_mask((width, height), shadow) * 0.34
    canvas_rgb[:] = canvas_rgb * (1.0 - shadow_mask[..., None]) + np.array(
        [22.0, 26.0, 32.0], dtype=np.float64
    ) * shadow_mask[..., None]
    canvas_alpha[:] = np.maximum(canvas_alpha, shadow_mask)

    # --- front steps -----------------------------------------------------
    # A straight flight on the south-east rim, centred under the gatehouse. The
    # treads reuse the tiled top layer: it is already on the horizontal iso
    # plane, so the flagstones stay 1:1 instead of being re-projected.
    edge_dir = _normalise((right[0] - front[0], right[1] - front[1]))
    edge_length = float(np.hypot(right[0] - front[0], right[1] - front[1]))
    # Outward normal of the SE face: moving one tile in +gridX projects to screen
    # (+64, +32), which normalises to the same (2, 1) diagonal.
    out_dir = _normalise((TILE_W, TILE_H))

    stair_center = (
        front[0] + edge_dir[0] * edge_length * TC_STAIR_CENTER,
        front[1] + edge_dir[1] * edge_length * TC_STAIR_CENTER,
    )
    stair_start = (
        stair_center[0] - edge_dir[0] * TC_STAIR_HALF,
        stair_center[1] - edge_dir[1] * TC_STAIR_HALF,
    )
    stair_end = (
        stair_center[0] + edge_dir[0] * TC_STAIR_HALF,
        stair_center[1] + edge_dir[1] * TC_STAIR_HALF,
    )

    tread_source = top[..., :3]
    riser_color = np.array([96.0, 100.0, 108.0], dtype=np.float64)

    def shifted(point: tuple[float, float], distance: float, drop: float) -> tuple[float, float]:
        return (point[0] + out_dir[0] * distance, point[1] + out_dir[1] * distance + drop)

    for step in range(TC_STEPS):
        inner_start = shifted(stair_start, step * TC_STEP_RUN, step * TC_STEP_RISE)
        inner_end = shifted(stair_end, step * TC_STEP_RUN, step * TC_STEP_RISE)
        outer_start = shifted(inner_start, TC_STEP_RUN, 0)
        outer_end = shifted(inner_end, TC_STEP_RUN, 0)

        # The lower steps sit slightly darker so the flight reads as depth.
        lum = TC_STEP_LUM - step * 3.0
        blend_polygon(
            canvas_rgb,
            canvas_alpha,
            [inner_start, inner_end, outer_end, outer_start],
            tread_source,
            lum,
        )
        # A bright nose along the outer edge separates one step from the riser.
        add_outline(canvas_rgb, [outer_start, outer_end], 1.2, closed=False, colour=(168, 174, 182))

        drop_start = (outer_start[0], outer_start[1] + TC_STEP_RISE)
        drop_end = (outer_end[0], outer_end[1] + TC_STEP_RISE)
        riser = [outer_start, outer_end, drop_end, drop_start]
        mask = polygon_mask((width, height), riser)
        canvas_rgb[:] = canvas_rgb * (1.0 - mask[..., None]) + riser_color * mask[..., None]
        canvas_alpha[:] = np.maximum(canvas_alpha, mask)
        add_outline(canvas_rgb, riser, 0.8, colour=(48, 52, 60))
        # Two joints per riser keep the stone courses from reading as one band.
        for fraction in (0.34, 0.68):
            joint_x = outer_start[0] + (outer_end[0] - outer_start[0]) * fraction
            joint_y = outer_start[1] + (outer_end[1] - outer_start[1]) * fraction
            add_outline(
                canvas_rgb,
                [(joint_x, joint_y), (joint_x, joint_y + TC_STEP_RISE)],
                0.7,
                closed=False,
                colour=(66, 70, 78),
            )

        add_outline(canvas_rgb, [inner_start, inner_end], 1.0, closed=False, colour=WALL_OUTLINE)

    # Solid stringer on the viewer-facing side of the flight: without it the
    # left ends of the treads show as a row of open slabs.
    flight_out = TC_STEPS * TC_STEP_RUN
    cheek_end = (
        stair_start[0] + out_dir[0] * flight_out,
        stair_start[1] + out_dir[1] * flight_out + TC_RISE,
    )
    cheek = [stair_start, cheek_end, (stair_start[0], stair_start[1] + TC_RISE)]
    cheek_layer = map_parallelogram(
        wall_texture,
        (width, height),
        stair_start,
        (out_dir[0] * flight_out, out_dir[1] * flight_out),
        (0, TC_RISE),
    )
    blend_polygon(canvas_rgb, canvas_alpha, cheek, cheek_layer, 118.0)
    add_outline(canvas_rgb, cheek, 1.2)
    for fraction in (0.33, 0.66):
        add_outline(
            canvas_rgb,
            [
                (stair_start[0], stair_start[1] + TC_RISE * fraction),
                (
                    stair_start[0] + out_dir[0] * flight_out * fraction,
                    stair_start[1] + (out_dir[1] * flight_out + TC_RISE) * fraction,
                ),
            ],
            0.7,
            closed=False,
            colour=(104, 108, 115),
        )

    # --- balustrade -------------------------------------------------------
    # A low stone rail follows the terrace rim on either side of the stair
    # opening. It is what sells the height at gameplay zoom, where a plain 1.75
    # tile retaining wall can read as a shadow.
    rail_height = 22
    rail_face = np.array([176.0, 180.0, 186.0], dtype=np.float64)
    post_gap = 30

    def draw_rail(start: tuple[float, float], end: tuple[float, float]) -> None:
        ax, ay = start
        bx, by = end
        top_a = (ax, ay - rail_height)
        top_b = (bx, by - rail_height)
        quad = [start, end, top_b, top_a]
        mask = polygon_mask((width, height), quad)
        canvas_rgb[:] = canvas_rgb * (1.0 - mask[..., None]) + rail_face * mask[..., None]
        canvas_alpha[:] = np.maximum(canvas_alpha, mask)

        add_outline(canvas_rgb, quad, 1.0, colour=(92, 97, 106))
        add_outline(canvas_rgb, [top_a, top_b], 1.4, closed=False, colour=(214, 217, 222))
        add_outline(canvas_rgb, [start, end], 1.2, closed=False, colour=(70, 75, 84))

        length = float(np.hypot(bx - ax, by - ay))
        count = max(2, int(length / post_gap))
        for index in range(count + 1):
            f = index / count
            px = ax + (bx - ax) * f
            py = ay + (by - ay) * f
            add_outline(
                canvas_rgb,
                [(px, py), (px, py - rail_height - 3)],
                2.0,
                closed=False,
                colour=(150, 154, 162),
            )

    draw_rail(left, front)
    draw_rail(front, stair_start)
    draw_rail(stair_end, right)
    # The stringer's sloped handrail, so the flight reads as one built stair
    # rather than a stack of treads leaning on the terrace.
    draw_rail(stair_start, cheek_end)

    # --- edges -----------------------------------------------------------
    # Only the front rim is stroked: the back edges sit behind the building and
    # a full diamond outline read as stray rails drawn on the floor. The stair
    # opening is left unstroked so the flight meets the terrace cleanly.
    add_outline(canvas_rgb, [left, front, stair_start], 1.2, closed=False)
    add_outline(canvas_rgb, [stair_end, right], 1.2, closed=False)
    add_outline(canvas_rgb, [left_ground, front_ground, right_ground], 1.2, closed=False)

    canvas = np.zeros((height, width, 4), dtype=np.uint8)
    canvas[..., :3] = np.clip(np.rint(canvas_rgb), 0, 255).astype(np.uint8)
    canvas[..., 3] = np.rint(canvas_alpha * 255.0).astype(np.uint8)
    canvas = bleed_rgb(canvas)

    target = out_root / TC_PLATFORM_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)
    return {"name": target.name, "size": TC_CANVAS, "meanLum": measure_mean_lum(canvas)}


# ---------------------------------------------------------------------------
# Measurement / check
# ---------------------------------------------------------------------------


def measure_mean_lum(rgba: np.ndarray) -> float:
    opaque = rgba[..., 3] > 0
    if not opaque.any():
        return 0.0
    return float(luminance(rgba[..., :3].astype(np.float64))[opaque].mean())


def measure(path: Path) -> dict:
    rgba = load_rgba(path)
    alpha = rgba[..., 3]
    ys, xs = np.nonzero(alpha > 0)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else None
    return {
        "size": (rgba.shape[1], rgba.shape[0]),
        "meanLum": measure_mean_lum(rgba),
        "bbox": box,
        "opaque": float((alpha > 0).mean()),
        "corners": [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])],
    }


def check(out_root: Path) -> int:
    failures: list[str] = []

    def expect(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    def measure_path(rel: Path) -> dict:
        path = out_root / rel
        expect(path.exists(), f"missing {rel}")
        return measure(path) if path.exists() else {}

    floor = measure_path(FLOOR_REL)
    if floor:
        expect(floor["size"] == FLOOR_SIZE, f"floor size {floor['size']} != {FLOOR_SIZE}")
        expect(124.0 <= floor["meanLum"] <= 142.0, f"floor lum {floor['meanLum']:.1f} outside 124-142")
        expect(all(corner == 0 for corner in floor["corners"]), "floor diamond has an opaque corner")
        expect(floor["opaque"] > 0.45, f"floor covers only {floor['opaque']:.2f} of the canvas")

    wall = measure_path(WALL_REL)
    if wall:
        expect(wall["size"] == WALL_SIZE, f"wall size {wall['size']} != {WALL_SIZE}")
        expect(92.0 <= wall["meanLum"] <= 130.0, f"wall lum {wall['meanLum']:.1f} outside 92-130")
        expect(wall["bbox"] is not None and wall["bbox"][3] == WALL_SIZE[1], "wall base is not on the last row")
        expect(wall["opaque"] > 0.55, f"wall covers only {wall['opaque']:.2f} of the canvas")

    gate = measure_path(GATE_REL)
    if gate:
        expect(gate["size"] == GATE_CANVAS, f"gate size {gate['size']} != {GATE_CANVAS}")
        expect(gate["bbox"] is not None, "gate has no opaque pixels")
        if gate["bbox"]:
            x0, y0, x1, y1 = gate["bbox"]
            expect(x0 >= 0 and x1 <= GATE_CANVAS[0], "gate art spills out of the canvas")
            expect(y0 > 0, "gate art touches the canvas top")
            expect(GATE_CANVAS[1] - y1 <= 80, "gate art is floating above the canvas bottom")

    door = measure_path(GATE_DOOR_REL)
    if door:
        expected = door_bbox(gate_points())
        expect(
            door["size"] == (expected[2] - expected[0], expected[3] - expected[1]),
            f"gate door {door['size']} != {(expected[2] - expected[0], expected[3] - expected[1])}",
        )
        expect(door["opaque"] > 0.5, f"gate door covers only {door['opaque']:.2f} of its canvas")

    tc = measure_path(TC_PLATFORM_REL)
    if tc:
        expect(tc["size"] == TC_CANVAS, f"tc platform size {tc['size']} != {TC_CANVAS}")
        expect(96.0 <= tc["meanLum"] <= 148.0, f"tc platform lum {tc['meanLum']:.1f} outside 96-148")
        expect(tc["bbox"] is not None, "tc platform has no opaque pixels")
        expect(tc["opaque"] > 0.2, f"tc platform covers only {tc['opaque']:.2f} of its canvas")
        if tc["bbox"]:
            x0, y0, x1, y1 = tc["bbox"]
            expect(x0 >= 0 and x1 <= TC_CANVAS[0], "tc platform art spills out of the canvas")
            expect(y0 <= TC_CANVAS_PAD + 2, "tc platform top is not at the canvas top")
            expect(TC_CANVAS[1] - y1 <= TC_CANVAS_PAD + 4, "tc platform steps float above the canvas bottom")

    if failures:
        print("FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("OK: citadel floor, wall, gate and Town Center terrace match the shipping contract")
    return 0


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


def preview(out_root: Path) -> int:
    """Compose a 17x17 citadel on grass so the three pieces can be eyeballed."""
    size = 17
    gate_start = 7
    origin_x = origin_y = 0

    floor = Image.open(out_root / FLOOR_REL).convert("RGBA")
    wall = Image.open(out_root / WALL_REL).convert("RGBA")
    gate = Image.open(out_root / GATE_REL).convert("RGBA")
    grass = Image.open(out_root / "terrain" / "grass.png").convert("RGBA")

    def screen(gx: float, gy: float) -> tuple[float, float]:
        return ((gx - gy) * TILE_W / 2, (gx + gy) * TILE_H / 2)

    margin = 620
    tiles = [(x, y) for x in range(size) for y in range(size)]
    xs = [screen(origin_x + x, origin_y + y)[0] for x, y in tiles]
    ys = [screen(origin_x + x, origin_y + y)[1] for x, y in tiles]
    width = int(max(xs) - min(xs) + margin)
    height = int(max(ys) - min(ys) + margin)
    ox, oy = -min(xs) + margin // 2, -min(ys) + margin // 3
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    def blit(image: Image.Image, cx: float, cy: float, origin_y_ratio: float = 0.5) -> None:
        left = round(cx + ox - image.width / 2)
        top = round(cy + oy - image.height * origin_y_ratio)
        canvas.alpha_composite(image, (left, top))

    for x, y in tiles:
        sx, sy = screen(origin_x + x, origin_y + y)
        blit(grass, sx, sy)

    for y in range(1, size - 1):
        for x in range(1, size - 1):
            sx, sy = screen(origin_x + x, origin_y + y)
            blit(floor, sx, sy)

    gate_tiles = {(origin_x + size - 1, origin_y + gate_start + i) for i in range(3)}
    # The gate sprite draws the six tiles of wall it covers.
    covered = {(origin_x + size - 1, origin_y + gate_start + 1 + i) for i in range(-3, 4)}

    draws: list[tuple[float, Image.Image, float, float, float]] = []
    for x in range(size):
        for y in range(size):
            if x not in (0, size - 1) and y not in (0, size - 1):
                continue
            if (origin_x + x, origin_y + y) in gate_tiles:
                continue
            if (origin_x + x, origin_y + y) in covered:
                continue
            sx, sy = screen(origin_x + x, origin_y + y)
            draws.append((x + y, wall, sx, sy, WALL_BASE_CENTER_Y / WALL_SIZE[1]))

    mid_y = gate_start + 1
    gx, gy = screen(origin_x + size - 1, origin_y + mid_y)
    draws.append((size - 1 + mid_y + 0.5, gate, gx, gy, GATE_ORIGIN[1]))

    for _, image, sx, sy, ratio in sorted(draws, key=lambda item: item[0]):
        blit(image, sx, sy, ratio)

    # The portcullis ships as its own texture so the client can raise it. The
    # proof sheet shows the shut state, which is the harder one to get right.
    door = Image.open(out_root / GATE_DOOR_REL).convert("RGBA")
    bx0, by0, _, _ = door_bbox(gate_points())
    left = round(gx + ox - GATE_ANCHOR[0] + bx0)
    top = round(gy + oy - GATE_ORIGIN[1] * GATE_CANVAS[1] + by0)
    canvas.alpha_composite(door, (left, top))

    # Town Center on its terrace: the proof sheet shows the plinth and the
    # building lifted by the same rise, which is the part a size change breaks.
    platform_path = out_root / TC_PLATFORM_REL
    tc_path = out_root / "buildings" / "town_center.png"
    if platform_path.exists() and tc_path.exists():
        platform = Image.open(platform_path).convert("RGBA")
        tc_art = Image.open(tc_path).convert("RGBA")
        tc_x, tc_y = 5, 5
        tc_center = screen(origin_x + tc_x + 2 - 0.5, origin_y + tc_y + 3 - 0.5)
        blit(platform, tc_center[0], tc_center[1] - TC_RISE, TC_ANCHOR[1] / TC_CANVAS[1])
        # `SHEET_OFFSET_Y.TOWN_CENTER` is -130; the terrace lifts both the
        # platform and the art by TC_RISE.
        blit(tc_art, tc_center[0], tc_center[1] - TC_RISE - 130)

    out = ROOT / "scripts" / "out" / "citadel" / "preview.png"
    canvas.save(out)
    print(f"preview written to {out} ({width}x{height})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--floor", type=Path, help="generated floor texture")
    parser.add_argument("--wall", type=Path, help="generated wall texture")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="asset root (default: %(default)s)")
    parser.add_argument("--check", action="store_true", help="validate shipped files")
    parser.add_argument("--preview", action="store_true", help="compose a proof sheet")
    args = parser.parse_args(argv)

    if args.check:
        return check(args.out)
    if args.preview:
        return preview(args.out)
    if not args.floor or not args.wall:
        parser.error("--floor and --wall are required unless --check/--preview is used")

    results = [
        build_floor(args.floor, args.out),
        build_wall(args.wall, args.out, cap_source=args.floor),
        *build_gate(args.wall, args.floor, args.out),
        build_tc_platform(args.wall, args.out),
    ]
    for result in results:
        print(f"  {result['name']:<14} {result['size'][0]}x{result['size'][1]} lum {result['meanLum']:.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

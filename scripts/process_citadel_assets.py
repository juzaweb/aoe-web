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
* the wall block is 128x184 and repeats along every wall run. Its two faces and
  its cap have fixed screen-space corners (the same ones `CitadelLayer` used to
  draw with Graphics), so the texture is mapped onto those faces, shaded per
  face and stroked at the cap, which keeps the block tiling exactly like the
  procedural art did. The shipped PNG was raised from 90 to 120 px of wall rise
  by `scripts/rework_citadel_wall_height.py`, which preserves the cap rows.

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

# Mirrors `packages/shared/src/utils/citadel.ts`. Duplicated (not imported) on
# purpose: this script is offline tooling and must not depend on a Node/tsserver
# build to draw a proof sheet.
CITADEL_WIDTH = 26
CITADEL_HEIGHT = 26
CITADEL_GATE_WIDTH = 3
CITADEL_TC_OFFSET_X = 5
CITADEL_TC_OFFSET_Y = 10
FLOOR_VARIANT_SEED = 0x1F2E3D4C

FLOOR_REL = Path("citadel") / "floor.png"
# Two extra textures, picked per tile by `citadelFloorVariants.ts`. 225 identical
# diamonds read as one flat plate; three hashed variants break that up without
# the server replicating a single byte.
FLOOR_VARIANT_RELS = (
    FLOOR_REL,
    Path("citadel") / "floor_1.png",
    Path("citadel") / "floor_2.png",
)
FLOOR_SIZE = (TILE_W, TILE_H)
# Mean luminance of the shipped `citadel_floor` (0x7b7f88), so the stone reads
# at the same brightness as the grass and the old procedural apron.
FLOOR_LUM = 134.0
# Rim was 104.0: against a 134 body it read as a dark grid, which is what the
# wall's cap outline was doing too. 112 keeps the flagstone edge without the grid.
FLOOR_EDGE_LUM = 112.0

WALL_REL = Path("citadel") / "wall.png"
WALL_RISE = 120
WALL_BASE_CENTER_Y = 32 + WALL_RISE
WALL_SIZE = (TILE_W, WALL_BASE_CENTER_Y + 32)  # 128x184
CAP_INSET = 12
WALL_LEFT_LUM = 105.0
WALL_RIGHT_LUM = 80.0
WALL_CAP_LUM = 150.0
# Shipped wall brightness band, checked by `wall_failures`. A wall outside it
# stops matching the floor apron in the same frame, so it is a contract, not a
# preference.
WALL_LUM_RANGE = (92.0, 130.0)
WALL_MIN_OPAQUE = 0.55
WALL_OUTLINE = (0x3A, 0x3F, 0x47)
# Merlons standing on the far (rear) edges of the cap. 9 px keeps every parapet
# pixel inside the 12 px headroom above `TOP_Y`, so a wall run never paints over
# the tile behind it; `check` asserts nothing reaches `y < 2`.
MERLON_H = 9
MERLON_HALF = 13.0
MERLON_T = (0.32, 0.78)
MERLON_MIN_Y = 2
# Ambient occlusion replaces the 1.2 px near-black cap outline. A dark ring
# around every cap turned a wall run into a row of tombstones: it read as a gap
# between blocks instead of a joint. 0.30 keeps the core at lum >= 70.
AO_STRENGTH = 0.30
AO_WIDTH = 1.4
# The 1024px source has ~80px blocks. Mapped straight onto a 64px-wide face they
# turn into 5px noise, so only a quarter of the sheet is used: same stone, but
# each block lands at a readable 16-20px.
WALL_TEXTURE_CROP = 360
# The stone sheet is 1264-1456 px wide and lands on a 64 px face. Averaging 4x4
# blocks is the missing mip level; without it the grain aliases into speckle.
TEXTURE_MIP = 4
# The generated stone is a cool blue-grey; the house and barracks the citadel has
# to sit beside are warm (chroma 23-24), so the channels are pulled warm before
# the luminance match. Tuned by measuring the shipped block: this gain puts the
# wall at chroma 21.9 with mean RGB (114, 105, 92), i.e. the same red-over-blue
# offset the house carries (93, 86, 70). Anything bluer and it reads as concrete;
# anything warmer and it turns terracotta (chroma 47 at 0.86 blue).
STONE_GAIN = (1.10, 1.0, 0.88)
# Chroma floor per sprite, in the 0-255 max-minus-min channel range. Measured on
# the pre-rework files: floor 4.3, wall 11.5, gate 3.5, against house 23.2 and
# barracks 24.0. The citadel has to read as the same stone family as those.
CHROMA_MIN = {"floor": 10.0, "wall": 16.0, "gate": 12.0}

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
# Warm passage instead of near-black: a flat #0b0d10 hole is what made the gate
# read as "grey box with a black hole". The floor still sees stone through it.
GATE_PASSAGE_TOP = (0x2A, 0x26, 0x20)
GATE_PASSAGE_BOTTOM = (0x3C, 0x36, 0x2C)
GATE_ARCH_RING = (0xC6, 0xB4, 0x96)
GATE_RING_JOINT = (0x6B, 0x5F, 0x4D)
# Voussoir band thickness, up from 8 px: at 8 the ring was thinner than the joint
# line it was framed by, so the arch still read as a cut-out.
GATE_RING_WIDTH = 13.0
GATE_IRON = (0x2B, 0x2F, 0x36)
GATE_IRON_HIGHLIGHT = (0x6C, 0x72, 0x7C)

GATE_MIN_ALPHA = 8
GATE_MIN_BLOB = 6

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

def apply_ao(
    rgb: np.ndarray,
    points: list[tuple[float, float]],
    width_px: float = AO_WIDTH,
    strength: float = AO_STRENGTH,
    closed: bool = True,
) -> None:
    """Darken a band just inside an edge by `strength`, instead of outlining it.

    The wall used to stroke every cap with a 1.2 px `WALL_OUTLINE` (lum ~62)
    against a cap face at lum 150. That is a 2.4x contrast step exactly where two
    blocks meet, so a wall run read as separate tombstones with a gap between
    them. Multiplying by (1 - strength) keeps the joint legible while the cap
    stays at lum >= 70, which is the level the floor apron sits at.
    """
    mask = stroke_mask((rgb.shape[1], rgb.shape[0]), points, width_px, closed=closed)
    rgb *= (1.0 - mask[..., None] * strength)

def mortar_lines(
    rgb: np.ndarray,
    start: tuple[float, float],
    end: tuple[float, float],
    rise: float,
    fractions: tuple[float, ...] = (0.34, 0.68),
    colour: tuple[int, int, int] = (0x77, 0x6C, 0x59),
    width_px: float = 1.0,
) -> None:
    """Fixed masonry courses along a wall face.

    The source texture is pre-blurred so its joints survive the 5x downsample onto
    a 64 px face; the cost is that the joint contrast itself is gone. These two
    lines put it back at a fixed, measured brightness, which is also what keeps
    the wall's chroma stable between texture exports.
    """
    size = (rgb.shape[1], rgb.shape[0])
    mask = np.zeros((size[1], size[0]), dtype=np.float64)
    for fraction in fractions:
        offset = rise * fraction
        mask = np.maximum(
            mask,
            stroke_mask(
                size,
                [
                    (start[0], start[1] - offset),
                    (end[0], end[1] - offset),
                ],
                width_px,
                closed=False,
            ),
        )
    rgb[:] = rgb * (1.0 - mask[..., None]) + np.array(colour, dtype=np.float64) * mask[..., None]


# ---------------------------------------------------------------------------
# Floor
# ---------------------------------------------------------------------------

FLOOR_DIAMOND = [(64, 0), (128, 32), (64, 64), (0, 32)]

# Per-variant dressing. Variant 0 is the plain flagstone; 1 adds a chip scar in
# one quadrant, 2 lets moss creep out of the joints. Every blob stays clear of
# the rim stroke, so all three still tile into the same diamond grid.
FLOOR_VARIANTS = (
    {"moss": 0.0, "scar": 0.0, "warm": 0.0},
    {"moss": 0.0, "scar": 0.55, "warm": 0.008},
    {"moss": 0.5, "scar": 0.0, "warm": -0.006},
)
MOSS_RGB = (0x5C, 0x6B, 0x3C)
SCAR_RGB = (0x8A, 0x84, 0x78)

def _blob_mask(
    size: tuple[int, int], centre: tuple[float, float], radius: float, seed: int
) -> np.ndarray:
    """Soft irregular disc, deterministic for a given seed."""
    width, height = size
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float64)
    rng = np.random.default_rng(seed)
    wobble = 0.72 + 0.28 * np.sin(xs / (3.0 + rng.random() * 4.0) + seed)
    distance = np.hypot(xs - centre[0], (ys - centre[1]) * 1.6) / max(radius, 1e-6)
    return np.clip((1.0 - distance * wobble) * 2.2, 0.0, 1.0)


def build_floor(
    source: Path, out_root: Path, variant: int = 0, rel: Path | None = None
) -> dict:
    """Draw one floor diamond.

    `variant` indexes `FLOOR_VARIANTS`; `rel` overrides the output path, so
    `floor.png`, `floor_1.png` and `floor_2.png` all come out of this function
    with no duplicated geometry.
    """
    if not 0 <= variant < len(FLOOR_VARIANTS):
        raise ValueError(f"unknown floor variant {variant}")
    spec = FLOOR_VARIANTS[variant]
    rgba = load_rgba(source)
    texture = resize_rgb(rgba[..., :3], FLOOR_SIZE).astype(np.float64)
    texture = np.clip(texture * np.array(STONE_GAIN), 0.0, 255.0)
    if spec["warm"]:
        texture *= np.array(
            [1.0 + spec["warm"] * 3.0, 1.0 + spec["warm"] * 1.2, 1.0 - spec["warm"] * 2.0]
        )

    mask = polygon_mask(FLOOR_SIZE, FLOOR_DIAMOND)
    body = shade_region(texture, mask, FLOOR_LUM)

    if spec["scar"]:
        scar = _blob_mask(FLOOR_SIZE, (78.0, 34.0), 15.0, 17 + variant) * spec["scar"]
        body = body * (1.0 - scar[..., None]) + np.array(SCAR_RGB, dtype=np.float64) * scar[..., None]
    if spec["moss"]:
        moss = _blob_mask(FLOOR_SIZE, (44.0, 30.0), 17.0, 29 + variant) * spec["moss"]
        # Moss only takes where the flagstone is bright, i.e. on the surface and
        # not in the joint, so it never lifts the rim above the body.
        moss = moss * np.clip((body.max(axis=-1, keepdims=True) - 60.0) / 80.0, 0.35, 1.0)[..., 0]
        body = body * (1.0 - moss[..., None]) + np.array(MOSS_RGB, dtype=np.float64) * moss[..., None]

    # A soft joint along the diamond rim reads as the cut edge of a flagstone
    # and hides the seam where one tile meets the next.
    rim = stroke_mask(FLOOR_SIZE, FLOOR_DIAMOND, 2.0)
    body = np.where(rim[..., None] > 0, body * (FLOOR_EDGE_LUM / max(FLOOR_LUM, 1.0)), body)

    canvas = np.zeros((FLOOR_SIZE[1], FLOOR_SIZE[0], 4), dtype=np.uint8)
    canvas[..., :3] = np.clip(np.rint(body), 0, 255).astype(np.uint8)
    canvas[..., 3] = np.rint(mask * 255.0).astype(np.uint8)
    canvas = bleed_rgb(canvas)

    target = out_root / (rel if rel is not None else FLOOR_VARIANT_RELS[variant])
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)
    return {
        "name": target.name,
        "size": FLOOR_SIZE,
        "meanLum": measure_mean_lum(canvas),
        "chroma": float(measure_chroma(canvas)),
    }


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

def box_mip(rgb: np.ndarray, factor: int = TEXTURE_MIP) -> np.ndarray:
    """Average `factor` x `factor` blocks: a real mip level for the sprite.

    A 1264-1456 px stone sheet mapped onto a 64 px face aliases into speckle. The
    pipeline used to answer that with a Gaussian, which erased the mortar joints
    and left the wall at chroma 11.5 -- plastic concrete beside a painted house at
    23.2. A box filter destroys the same aliasing (it *is* the average) while
    keeping the joint adjacency, and the joints are then rebuilt at a fixed
    brightness by `mortar_lines`.
    """
    if factor <= 1 or rgb.shape[0] <= factor or rgb.shape[1] <= factor:
        return rgb
    height, width = rgb.shape[:2]
    return np.asarray(
        Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB").resize(
            (max(1, width // factor), max(1, height // factor)), Image.Resampling.BOX
        ),
        dtype=np.float64,
    )

def _resize_square(rgb: np.ndarray, size: int) -> np.ndarray:
    return np.asarray(
        Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB").resize(
            (size, size), Image.Resampling.BICUBIC
        ),
        dtype=np.float64,
    )


def load_stone(path: Path, crop: int) -> np.ndarray:
    rgba = load_rgba(path)
    texture = box_mip(center_crop(rgba[..., :3].astype(np.float64), crop * TEXTURE_MIP))
    if texture.shape[0] != crop:
        texture = _resize_square(texture, crop)
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


def build_wall(
    source: Path,
    out_root: Path,
    cap_source: Path | None = None,
    rel: Path = WALL_REL,
    parapet: bool = True,
) -> dict:
    """Draw the wall block.

    ``rel`` is the output path relative to ``out_root``, so a variant such as
    ``citadel/wall_v2.png`` can be built next to the shipped ``wall.png``
    without editing the module constants. ``parapet`` adds the merlon row on the
    far half of the cap.

    The block is a 1x1 tile with a fixed silhouette: two faces plus a cap lifted
    `WALL_RISE` above the base, capped at `CAP_INSET`. A battlements row sits on
    the cap rather than extending it, so `WALL_SIZE` (and therefore
    `CitadelLayer`'s origin) is untouched.
    """
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

    # Masonry courses at a fixed brightness. The texture arrives pre-blurred (it
    # has to be, to survive the 5x downsample), so the joints are rebuilt here
    # instead of being left to whatever survived the resize.
    mortar_lines(canvas_rgb, (0, BASE_Y), (64, BASE_Y + 32), WALL_RISE)
    mortar_lines(canvas_rgb, (64, BASE_Y + 32), (128, BASE_Y), WALL_RISE, fractions=(0.5,))

    # AO instead of an outline. A 1.2 px near-black ring around every cap is what
    # made a wall run look like a row of separate tombstones with gaps between
    # them; multiplying the cap edge keeps the joint without the gap.
    apply_ao(canvas_rgb, WALL_CAP)
    add_outline(
        canvas_rgb,
        [(0, BASE_Y), (64, BASE_Y + 32), (128, BASE_Y)],
        1.2,
        closed=False,
        colour=(0x5A, 0x51, 0x42),
    )

    if parapet:
        body_mask = np.clip(body_mask + _add_parapet(canvas_rgb, cap_texture), 0.0, 1.0)

    canvas = np.zeros((WALL_SIZE[1], WALL_SIZE[0], 4), dtype=np.uint8)
    canvas[..., :3] = np.clip(np.rint(canvas_rgb), 0, 255).astype(np.uint8)
    canvas[..., 3] = np.rint(body_mask * 255.0).astype(np.uint8)
    canvas = bleed_rgb(canvas)

    target = out_root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)
    return {
        "name": target.name,
        "size": WALL_SIZE,
        "meanLum": measure_mean_lum(canvas),
        "chroma": float(measure_chroma(canvas)),
    }


def _add_parapet(
    canvas_rgb: np.ndarray, cap_texture: np.ndarray
) -> np.ndarray:
    """A low merlon row on the two far cap edges; returns the mask it covers.

    Two blocks side by side have to read as one battlement line, so the merlons
    sit at a fixed pitch along each edge: a wall run repeats the same block, so
    the row is continuous by construction. Height is `MERLON_H` above the far
    edge, whose highest vertex is `y 12`, so the topmost merlon pixel lands at
    `y 3` — inside the 12 px headroom, never over the tile behind.

    The caller ORs the returned mask into the block's alpha: the merlons stand
    above the cap polygon, so without that they ate cut off.
    """
    size = (canvas_rgb.shape[1], canvas_rgb.shape[0])
    far_left = (CAP_INSET, TOP_Y)
    apex = (64.0, TOP_Y - 32 + CAP_INSET)
    far_right = (128 - CAP_INSET, TOP_Y)
    covered = np.zeros((size[1], size[0]), dtype=np.float64)
    cap_depth = 3.0

    for start, end in ((far_left, apex), (apex, far_right)):
        edge_x, edge_y = end[0] - start[0], end[1] - start[1]
        edge_length = float(np.hypot(edge_x, edge_y))
        ux, uy = edge_x / edge_length, edge_y / edge_length
        for t in MERLON_T:
            cx = start[0] + t * edge_x
            cy = start[1] + t * edge_y
            p0 = (cx - ux * MERLON_HALF, cy - uy * MERLON_HALF)
            p1 = (cx + ux * MERLON_HALF, cy + uy * MERLON_HALF)
            up = (0.0, -MERLON_H)
            top0 = (p0[0] + up[0], p0[1] + up[1])
            top1 = (p1[0] + up[0], p1[1] + up[1])

            front = map_parallelogram(cap_texture, size, p0, (p1[0] - p0[0], p1[1] - p0[1]), up)
            face_mask = polygon_mask(size, [p0, p1, top1, top0])
            shaded = shade_region(front, face_mask, WALL_CAP_LUM - 26.0)
            canvas_rgb[:] = canvas_rgb * (1.0 - face_mask[..., None]) + shaded * face_mask[..., None]
            covered = np.maximum(covered, face_mask)

            top = [top0, top1, (top1[0], top1[1] + cap_depth), (top0[0], top0[1] + cap_depth)]
            top_face = map_parallelogram(cap_texture, size, top0, (top1[0] - top0[0], top1[1] - top0[1]), (0.0, cap_depth))
            top_mask = polygon_mask(size, top)
            shaded_top = shade_region(top_face, top_mask, WALL_CAP_LUM + 6.0)
            canvas_rgb[:] = canvas_rgb * (1.0 - top_mask[..., None]) + shaded_top * top_mask[..., None]
            covered = np.maximum(covered, top_mask)
            apply_ao(canvas_rgb, top, width_px=1.0, strength=0.22)
    # The polygon rasteriser leaves a sub-percent ringing tail a few rows above
    # the highest vertex, which would put opaque pixels on canvas row 0 and break
    # the headroom contract. A hard cut at half coverage costs nothing visually
    # (the tail is 2 px wide at most) and makes the contract hold by construction.
    return np.where(covered >= 0.5, 1.0, 0.0)


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

    # AO along the base of the front face and the inner corner of the visible end
    # face: without it the gatehouse sat on the floor with no contact shadow and
    # read as a slab pasted onto the map.
    apply_ao(rgb, [a_b, b_b, b_t, a_t], width_px=10.0, strength=0.18, closed=False)
    apply_ao(rgb, [a_b, a_t], width_px=7.0, strength=0.16, closed=False)
    apply_ao(rgb, [b_t, b_bt], width_px=6.0, strength=0.20, closed=False)

    # The arched opening: a warm stone passage painted into the front face, with
    # the arch ring picked out in stone so it reads at a glance.
    hole = points["hole"]
    hole_mask = polygon_mask(size, hole)
    ys, xs = np.nonzero(hole_mask > 0)
    top_y = float(ys.min()) if len(ys) else 0.0
    bottom_y = float(ys.max()) if len(ys) else 1.0
    span = max(1.0, bottom_y - top_y)
    vertical = np.clip((np.arange(size[1])[:, None] - top_y) / span, 0.0, 1.0)
    vertical = np.repeat(vertical, size[0], axis=1)
    # Stone, not a hole: the passage keeps the masonry texture and is tinted with
    # a warm gradient. A near-black fill (#0b0d10 before this) is what made the
    # gate read as a grey box with a hole in it.
    passage = map_parallelogram(
        texture,
        size,
        (xs.min(), top_y),
        (xs.max() - xs.min() + 1, 0),
        (0, span),
    )
    warm_top = np.array(GATE_PASSAGE_TOP, dtype=np.float64)[None, None, :]
    warm_bottom = np.array(GATE_PASSAGE_BOTTOM, dtype=np.float64)[None, None, :]
    warm = warm_top * (1.0 - vertical[..., None]) + warm_bottom * vertical[..., None]
    # 0.62 keeps a trace of the stone grain instead of a flat paint bucket.
    passage = passage * 0.38 + warm * 0.62
    # Darker at the jambs, so the passage reads as recessed.
    horizontal = np.abs(np.linspace(-1.0, 1.0, size[0]))[None, :]
    passage *= (1.0 - 0.16 * horizontal[..., None])
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

    # Voussoir band: a light stone ring around the opening, a dark joint on its
    # outer edge and a highlight inside it, so the arch reads as built stone
    # instead of a cut-out. 13 px instead of 8: at 8 the ring was thinner than
    # the joint drawn around it and disappeared at play zoom.
    band = stroke_mask(size, hole, GATE_RING_WIDTH)
    rgb = rgb * (1.0 - band[..., None]) + np.array(GATE_ARCH_RING, dtype=np.float64) * band[..., None]
    add_outline(rgb, hole, 1.0, colour=GATE_RING_JOINT)
    add_outline(rgb, hole, 2.2, closed=True, colour=GATE_RING_JOINT)
    # Inner highlight just inside the intrados, then AO under the outer joint.
    inner = stroke_mask(size, hole, 3.0)
    rgb = rgb * (1.0 - inner[..., None] * 0.35) + np.array((0xE4, 0xD6, 0xBE), dtype=np.float64) * inner[..., None] * 0.35
    outer = [
        (x + 0.0, y + 0.0) for x, y in hole
    ]
    apply_ao(rgb, outer, width_px=GATE_RING_WIDTH + 4.0, strength=0.12)

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
            "chroma": float(measure_chroma(canvas)),
            "doorBox": door_bbox(points),
        },
        {
            "name": door_target.name,
            "size": (door.shape[1], door.shape[0]),
            "meanLum": measure_mean_lum(door),
            "chroma": float(measure_chroma(door)),
        },
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
# Measurement / check
# ---------------------------------------------------------------------------


def measure_mean_lum(rgba: np.ndarray) -> float:
    opaque = rgba[..., 3] > 0
    if not opaque.any():
        return 0.0
    return float(luminance(rgba[..., :3].astype(np.float64))[opaque].mean())


def measure_chroma(rgba: np.ndarray) -> float:
    """Mean max-minus-min channel over the solid pixels.

    The citadel shipped at chroma 3.5-11.5 while the house sat at 23.2, which is
    why it read as concrete dropped into a painted map. Measured on `alpha > 16`
    so the antialiased rim, grey by definition, does not drag the average down.
    """
    solid = rgba[..., 3] > 16
    if not solid.any():
        return 0.0
    rgb = rgba[..., :3].astype(np.float64)[solid]
    return float((rgb.max(axis=1) - rgb.min(axis=1)).mean())


def measure(path: Path) -> dict:
    rgba = load_rgba(path)
    alpha = rgba[..., 3]
    ys, xs = np.nonzero(alpha > 0)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else None
    return {
        "size": (rgba.shape[1], rgba.shape[0]),
        "meanLum": measure_mean_lum(rgba),
        "chroma": measure_chroma(rgba),
        "bbox": box,
        "opaque": float((alpha > 0).mean()),
        "corners": [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])],
        # Top row of opaque art. The merlon row is the only thing above the cap,
        # so this is what proves the parapet stayed inside `WALL_SIZE`.
        "topRow": box[1] if box else None,
    }


def wall_failures(measured: dict) -> list[str]:
    """Every contract breach of a wall block, so `check` and the variant builder
    validate against the same numbers."""
    failures: list[str] = []
    if measured["size"] != WALL_SIZE:
        failures.append(f"wall size {measured['size']} != {WALL_SIZE}")
    low, high = WALL_LUM_RANGE
    if not low <= measured["meanLum"] <= high:
        failures.append(f"wall lum {measured['meanLum']:.1f} outside {low:.0f}-{high:.0f}")
    if measured["bbox"] is None or measured["bbox"][3] != WALL_SIZE[1]:
        failures.append("wall base is not on the last row")
    if measured["opaque"] <= WALL_MIN_OPAQUE:
        failures.append(f"wall covers only {measured['opaque']:.2f} of the canvas")
    wall_chroma = CHROMA_MIN["wall"]
    if measured["chroma"] < wall_chroma:
        failures.append(f"wall chroma {measured['chroma']:.1f} below {wall_chroma:.0f}")
    top = measured.get("topRow")
    if top is not None and top < MERLON_MIN_Y:
        failures.append(f"wall art starts on row {top}, above the {MERLON_MIN_Y} px headroom")
    return failures


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
        expect(
            floor["chroma"] >= CHROMA_MIN["floor"],
            f"floor chroma {floor['chroma']:.1f} below {CHROMA_MIN['floor']:.0f}",
        )

    # The two extra diamonds share the base contract: same canvas, same corners,
    # same brightness band. Only the dressing differs, so a variant that breaks
    # the diamond geometry would show up as a seam between tiles.
    for variant_index, rel in enumerate(FLOOR_VARIANT_RELS[1:], start=1):
        variant = measure_path(rel)
        if not variant:
            continue
        expect(variant["size"] == FLOOR_SIZE, f"{rel.name} size {variant['size']} != {FLOOR_SIZE}")
        expect(
            118.0 <= variant["meanLum"] <= 148.0,
            f"{rel.name} lum {variant['meanLum']:.1f} outside 118-148",
        )
        expect(
            all(corner == 0 for corner in variant["corners"]),
            f"{rel.name} diamond has an opaque corner",
        )
        expect(
            variant["opaque"] > 0.45,
            f"{rel.name} covers only {variant['opaque']:.2f} of the canvas",
        )
        expect(
            variant["chroma"] >= CHROMA_MIN["floor"],
            f"{rel.name} chroma {variant['chroma']:.1f} below {CHROMA_MIN['floor']:.0f}",
        )

    wall = measure_path(WALL_REL)
    if wall:
        failures.extend(wall_failures(wall))

    gate = measure_path(GATE_REL)
    if gate:
        expect(gate["size"] == GATE_CANVAS, f"gate size {gate['size']} != {GATE_CANVAS}")
        expect(gate["bbox"] is not None, "gate has no opaque pixels")
        if gate["bbox"]:
            x0, y0, x1, y1 = gate["bbox"]
            expect(x0 >= 0 and x1 <= GATE_CANVAS[0], "gate art spills out of the canvas")
            expect(y0 > 0, "gate art touches the canvas top")
            expect(GATE_CANVAS[1] - y1 <= 80, "gate art is floating above the canvas bottom")
        expect(
            gate["chroma"] >= CHROMA_MIN["gate"],
            f"gate chroma {gate['chroma']:.1f} below {CHROMA_MIN['gate']:.0f}",
        )

    door = measure_path(GATE_DOOR_REL)
    if door:
        expected = door_bbox(gate_points())
        expect(
            door["size"] == (expected[2] - expected[0], expected[3] - expected[1]),
            f"gate door {door['size']} != {(expected[2] - expected[0], expected[3] - expected[1])}",
        )
        expect(door["opaque"] > 0.5, f"gate door covers only {door['opaque']:.2f} of its canvas")

    if failures:
        print("FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("OK: citadel floor, wall and gate match the shipping contract")
    return 0


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def floor_variant_at(grid_x: int, grid_y: int) -> int:
    """Mirror of `citadelFloorVariants.floorVariantAt` for the proof sheet.

    Same 32-bit integer hash `visualVariation.hash2` uses, so the sheet shows the
    variant distribution the client actually draws. Kept in Python because the
    proof sheet must run without a Node build; if the two ever disagree the test
    in `citadelFloorVariants.test.ts` is the contract, and this function only
    affects a dev image.
    """
    h = (grid_x * 374761393) ^ (grid_y * 668265263) ^ (FLOOR_VARIANT_SEED * 1442695041)
    h &= 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return int((h & 0xFFFFFFFF) / 4294967296 * 3) % 3



def preview(out_root: Path) -> int:
    """Compose a full citadel on grass so the pieces can be eyeballed together.

    The compound is `CITADEL_WIDTH` x `CITADEL_HEIGHT` (26x26) with the gate in
    the middle of the east wall, matching `packages/shared/src/utils/citadel.ts`.
    The Town Center is composited in its real slot, because the whole point of
    the rework is that the keep, the wall run and the courtyard floor read as one
    building — a proof sheet with an empty courtyard cannot show that.
    """
    size = 26
    gate_start = (size - CITADEL_GATE_WIDTH) // 2
    origin_x = origin_y = 0

    floor_images = [
        Image.open(out_root / rel).convert("RGBA") for rel in FLOOR_VARIANT_RELS
    ]
    wall = Image.open(out_root / WALL_REL).convert("RGBA")
    gate = Image.open(out_root / GATE_REL).convert("RGBA")
    grass = Image.open(out_root / "terrain" / "grass.png").convert("RGBA")
    town_center = Image.open(out_root / "buildings" / "town_center.png").convert("RGBA")

    def screen(gx: float, gy: float) -> tuple[float, float]:
        return ((gx - gy) * TILE_W / 2, (gx + gy) * TILE_H / 2)

    margin = 700
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
            blit(floor_images[floor_variant_at(origin_x + x, origin_y + y)], sx, sy)

    # The keep first: it is taller than the wall and has to sit behind the run.
    tc_x = origin_x + CITADEL_TC_OFFSET_X + 2
    tc_y = origin_y + CITADEL_TC_OFFSET_Y + 3
    tcx, tcy = screen(tc_x, tc_y)
    blit(town_center, tcx, tcy, 1.0)

    gate_tiles = {(origin_x + size - 1, origin_y + gate_start + i) for i in range(CITADEL_GATE_WIDTH)}
    # The gate sprite draws the six tiles of wall it covers.
    covered = {
        (origin_x + size - 1, origin_y + gate_start + 1 + i) for i in range(-3, 4)
    }

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

    out = ROOT / "scripts" / "out" / "citadel" / "preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
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

    results = []
    for variant in range(len(FLOOR_VARIANT_RELS)):
        results.append(build_floor(args.floor, args.out, variant=variant))
    results.append(build_wall(args.wall, args.out, cap_source=args.floor))
    results.extend(build_gate(args.wall, args.floor, args.out))
    for result in results:
        chroma = result.get("chroma")
        chroma_text = f" chroma {chroma:.1f}" if chroma is not None else ""
        print(
            f"  {result['name']:<14} {result['size'][0]}x{result['size'][1]} "
            f"lum {result['meanLum']:.1f}{chroma_text}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

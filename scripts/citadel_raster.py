"""Raster primitives for the citadel asset scripts.

Anti-aliased mask painting, isometric parallelogram projection and per-region
luminance shading -- the drawing vocabulary `process_citadel_assets.py` builds
the floor, wall and gatehouse from. Kept apart from the art assembly so the
geometry constants and the shapes they describe stay in one readable file.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

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
    return np.asarray(
        image.transform(canvas_size, Image.AFFINE, data, resample=Image.BICUBIC),
        dtype=np.float64,
    )


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
    colour: tuple[int, int, int] = (0x3A, 0x3F, 0x47),
) -> None:
    mask = stroke_mask((rgb.shape[1], rgb.shape[0]), points, width_px, closed=closed)
    rgb[:] = rgb * (1.0 - mask[..., None]) + np.array(colour, dtype=np.float64) * mask[..., None]


def apply_ao(
    rgb: np.ndarray,
    points: list[tuple[float, float]],
    width_px: float = 1.4,
    strength: float = 0.30,
    closed: bool = True,
) -> None:
    """Darken a band just inside an edge by `strength`, instead of outlining it.

    The wall used to stroke every cap with a 1.2 px near-black outline (lum ~62)
    against a cap face at lum 150. That is a 2.4x contrast step exactly where two
    blocks meet, so a wall run read as separate tombstones with a gap between
    them. Multiplying by (1 - strength) keeps the joint legible while the cap
    stays at lum >= 70, the level the floor apron sits at.
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

    The source texture is box-mipped so its grain survives the 5x downsample onto
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
                [(start[0], start[1] - offset), (end[0], end[1] - offset)],
                width_px,
                closed=False,
            ),
        )
    rgb[:] = rgb * (1.0 - mask[..., None]) + np.array(colour, dtype=np.float64) * mask[..., None]

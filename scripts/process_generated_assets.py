#!/usr/bin/env python3
"""Turn the AI-generated gate and dirt-road textures into the client's sprites.

Usage:
    python scripts/process_generated_assets.py \\
        --gate /path/to/cong.png \\
        --road /path/to/duong.png \\
        --out apps/client/public/assets

    python scripts/process_generated_assets.py --check   # CI gate, no sources

Both PNGs are project-original art, not third-party downloads: they are not in
`scripts/assets/manifest.json` and therefore not in `assets.lock.json`, because
there is no upstream URL or license to pin. `--check` is what keeps them honest:
it re-measures the shipped files instead of comparing a hash, so the art can be
regenerated without rewriting a lock.

Gate (`buildings/portal.png`):
    alpha bbox -> resize to height 356 (premultiplied LANCZOS) -> paste into a
    320x360 canvas, bottom row on the last row and centred horizontally -> spread
    the edge colour into the transparent pixels so bilinear sampling cannot pull
    the black padding into the silhouette. The art keeps its own brightness; no
    tint, shadow or glow is added.

Roads (`terrain/road_stamp{,_1,_2,_3}.png`):
    four 480x240 windows -> 120x60 -> per-crop luminance gain to 150 -> soft
    elliptical alpha. The crops are pure ground texture: a stamp overlaps its
    neighbours by roughly 80%, so any rock or footprint in the source would
    repeat across the whole road.

Requires Pillow and numpy. numpy is only used for the resampling maths and the
alpha measurements; the shipped images stay plain PNGs.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "apps" / "client" / "public" / "assets"

GATE_REL = Path("buildings") / "portal.png"
GATE_CANVAS = (320, 360)
GATE_ART_HEIGHT = 356
GATE_LUM_RANGE = (80.0, 92.0)
# Measured on the shipped gate: the doorway is a clear rectangle about 66x186
# inside the 320x360 canvas. The threshold leaves a margin for LANCZOS erosion
# while still failing if the arch is blocked or filled.
GATE_DOORWAY_MIN = (60, 170)  # width, height
GATE_BOTTOM_FOOT_MAX = 64  # opaque pixels allowed on the last row
GATE_MAIN_COMPONENT_SHARE = 0.995
# LANCZOS rings around hard alpha edges; the residue is a 1-4/255 haze that reads
# as dust at 4x zoom. Drop it, and blobs too small to be part of the silhouette.
GATE_MIN_ALPHA = 8
GATE_MIN_BLOB = 4

ROAD_NAMES = (
    "road_stamp.png",
    "road_stamp_1.png",
    "road_stamp_2.png",
    "road_stamp_3.png",
)
ROAD_SIZE = (120, 60)
ROAD_MEAN = 150.0
ROAD_MEAN_TOL = 3.0
ROAD_MIN_CONTRAST = 60.0  # p95 - p5
ROAD_MIN_P5 = 70.0  # rejected by shifting the window, never by stretching
ROAD_FEATHER = 0.12
ROAD_SHIFT = 120
ROAD_MAX_SHIFTS = 3
# 2:1 windows measured on the source; the road pass below shifts a window right
# when its shadows push p5 under ROAD_MIN_P5.
ROAD_BOXES = (
    (120, 300, 600, 540),
    (1100, 200, 1580, 440),
    (1700, 700, 2180, 940),
    (600, 1000, 1080, 1240),
)

LUM_WEIGHTS = (0.299, 0.587, 0.114)


def luminance(rgb: np.ndarray) -> np.ndarray:
    """ITU-R 601 luminance, the same weighting `PIL.Image.convert('L')` uses."""
    return (
        rgb[..., 0] * LUM_WEIGHTS[0]
        + rgb[..., 1] * LUM_WEIGHTS[1]
        + rgb[..., 2] * LUM_WEIGHTS[2]
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rgba(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)


def resize_premultiplied(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """LANCZOS resize in premultiplied space.

    Resizing straight alpha darkens the outer edge because the fully transparent
    pixels around the art are black; premultiplying and dividing back keeps the
    fringe the colour of the art instead of a dark halo.
    """
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


def alpha_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """Half-open (x0, y0, x1, y1) around every pixel with alpha > 0."""
    ys, xs = np.nonzero(alpha)
    if len(xs) == 0:
        raise SystemExit("source has no opaque pixels")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def label_alpha(alpha: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """4-connected labels for every pixel with alpha > 0, plus each blob's size."""
    mask = alpha > 0
    height, width = mask.shape
    labels = np.full(mask.shape, -1, dtype=np.int32)
    sizes: list[int] = []
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or labels[y, x] >= 0:
                continue
            label = len(sizes)
            stack = [(y, x)]
            labels[y, x] = label
            size = 0
            while stack:
                cy, cx = stack.pop()
                size += 1
                if cy > 0 and mask[cy - 1, cx] and labels[cy - 1, cx] < 0:
                    labels[cy - 1, cx] = label
                    stack.append((cy - 1, cx))
                if cy + 1 < height and mask[cy + 1, cx] and labels[cy + 1, cx] < 0:
                    labels[cy + 1, cx] = label
                    stack.append((cy + 1, cx))
                if cx > 0 and mask[cy, cx - 1] and labels[cy, cx - 1] < 0:
                    labels[cy, cx - 1] = label
                    stack.append((cy, cx - 1))
                if cx + 1 < width and mask[cy, cx + 1] and labels[cy, cx + 1] < 0:
                    labels[cy, cx + 1] = label
                    stack.append((cy, cx + 1))
            sizes.append(size)
    return labels, sizes


def main_component_share(alpha: np.ndarray) -> float:
    """Fraction of opaque pixels that belong to the largest 4-connected blob."""
    labels, sizes = label_alpha(alpha)
    total = sum(sizes)
    return max(sizes) / total if total else 0.0


def clean_alpha(alpha: np.ndarray) -> np.ndarray:
    """Drop resize ringing and blobs too small to be part of the silhouette."""
    cleaned = np.where(alpha < GATE_MIN_ALPHA, 0, alpha).astype(np.uint8)
    labels, sizes = label_alpha(cleaned)
    keep = np.array([size >= GATE_MIN_BLOB for size in sizes], dtype=bool)
    if keep.size == 0:
        return cleaned
    keep_mask = np.where(labels >= 0, keep[np.maximum(labels, 0)], False)
    cleaned[~keep_mask] = 0
    return cleaned


def bleed_rgb(rgba: np.ndarray, passes: int = 2) -> np.ndarray:
    """Copy edge colour into fully transparent pixels.

    A straight-alpha PNG is filtered with its RGB even where alpha is 0. LANCZOS
    and the premultiplied divide leave near-black values there, so bilinear
    sampling would blend them into the silhouette as a dark rim. Each pass copies
    the average of the known neighbours outward, which is enough to cover the
    one-texel footprint of the renderer's filter.
    """
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


def largest_clear_rect(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """Largest all-transparent rectangle, as (width, height, x, y) in the array.

    Used as a structural check on the gate: the doorway has to stay open, so the
    biggest empty rectangle must still be hundreds of pixels tall and reach the
    bottom row where the road walks through it.
    """
    empty = alpha == 0
    height, width = empty.shape
    heights = np.zeros(width, dtype=np.int64)
    best = (0, 0, 0, 0)
    for y in range(height):
        heights = (heights + 1) * empty[y]
        stack: list[tuple[int, int]] = []
        for x in range(width + 1):
            current = int(heights[x]) if x < width else 0
            start = x
            while stack and stack[-1][1] > current:
                left, bar = stack.pop()
                if bar * (x - left) > best[0] * best[1]:
                    best = (x - left, bar, left, y - bar + 1)
                start = left
            if not stack or stack[-1][1] < current:
                stack.append((start, current))
    return best


def measure_gate(rgba: np.ndarray) -> dict:
    alpha = rgba[..., 3]
    lum = luminance(rgba[..., :3].astype(np.float64))
    opaque = alpha > 0
    if not opaque.any():
        raise ValueError("gate has no opaque pixels")
    rows = np.nonzero(opaque.any(axis=1))[0]
    cols = np.nonzero(opaque.any(axis=0))[0]
    # Search only inside the artwork's columns: the transparent gutters either
    # side of a narrow sprite are taller than the doorway and would win the
    # rectangle search, turning the check into a false pass.
    art_left, art_right = int(cols.min()), int(cols.max()) + 1
    rect_w, rect_h, rect_x, rect_y = largest_clear_rect(alpha[:, art_left:art_right])
    rect_x += art_left
    last_row = int(rows.max())
    bottom_row_opaque = int(opaque[last_row].sum())
    return {
        "size": (rgba.shape[1], rgba.shape[0]),
        "topInset": int(rows.min()),
        "bottomInset": int(rgba.shape[0] - 1 - last_row),
        "artWidth": int(cols.max() - cols.min() + 1),
        "artCenterX": float((int(cols.min()) + int(cols.max()) + 1) / 2),
        "meanLum": float(lum[opaque].mean()),
        "p5": float(np.percentile(lum[opaque], 5)),
        "p95": float(np.percentile(lum[opaque], 95)),
        "doorway": (rect_w, rect_h, rect_x, rect_y),
        # Same tolerance as the bottom inset: a three-row pad is still "on the
        # ground", because the art would be pasted that many rows above the edge.
        "doorwayToBottom": rect_y + rect_h >= rgba.shape[0] - 3,
        "bottomRowOpaque": bottom_row_opaque,
        "mainShare": main_component_share(alpha),
    }


def measure_road(rgba: np.ndarray) -> dict:
    alpha = rgba[..., 3]
    lum = luminance(rgba[..., :3].astype(np.float64))
    corners = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
    return {
        "size": (rgba.shape[1], rgba.shape[0]),
        "meanLum": float(lum.mean()),
        "p5": float(np.percentile(lum, 5)),
        "p95": float(np.percentile(lum, 95)),
        "corners": corners,
        "centerAlpha": int(alpha[alpha.shape[0] // 2, alpha.shape[1] // 2]),
    }


def format_gate(name: str, metrics: dict, digest: str) -> str:
    width, height = metrics["size"]
    rect_w, rect_h, rect_x, rect_y = metrics["doorway"]
    return (
        f"  {name:<18} {width}x{height}  lum {metrics['meanLum']:5.1f}"
        f"  p5-p95 {metrics['p5']:5.1f}-{metrics['p95']:5.1f}  sha256 {digest[:12]}\n"
        f"  {'':<18} topInset {metrics['topInset']}  bottomInset {metrics['bottomInset']}"
        f"  artWidth {metrics['artWidth']}  doorway {rect_w}x{rect_h}"
        f" at ({rect_x},{rect_y}) toBottom {metrics['doorwayToBottom']}"
    )


def format_road(name: str, metrics: dict, digest: str) -> str:
    width, height = metrics["size"]
    return (
        f"  {name:<18} {width}x{height}  lum {metrics['meanLum']:5.1f}"
        f"  p5-p95 {metrics['p5']:5.1f}-{metrics['p95']:5.1f}  sha256 {digest[:12]}"
    )


def report(gate: dict | None, roads: list[dict]) -> str:
    sections = []
    if gate:
        sections.append("gate\n" + format_gate(gate["name"], gate["metrics"], gate["digest"]))
    if roads:
        sections.append(
            "roads\n" + "\n".join(format_road(r["name"], r["metrics"], r["digest"]) for r in roads)
        )
    return "\n".join(sections)


def build_gate(source: Path, out_root: Path) -> dict:
    rgba = load_rgba(source)
    x0, y0, x1, y1 = alpha_bbox(rgba[..., 3])
    crop = rgba[y0:y1, x0:x1]
    art_height = GATE_ART_HEIGHT
    art_width = max(1, round(crop.shape[1] * art_height / crop.shape[0]))
    art = resize_premultiplied(crop, (art_width, art_height))
    art[..., 3] = clean_alpha(art[..., 3])

    canvas_w, canvas_h = GATE_CANVAS
    if art_width > canvas_w or art_height > canvas_h:
        raise SystemExit(f"gate art {art_width}x{art_height} does not fit {GATE_CANVAS}")

    canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
    left = (canvas_w - art_width) // 2
    top = canvas_h - art_height
    canvas[top : top + art_height, left : left + art_width] = art
    canvas = bleed_rgb(canvas)

    target = out_root / GATE_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, mode="RGBA").save(target, "PNG", optimize=True)
    return {"name": GATE_REL.name, "metrics": measure_gate(canvas), "digest": sha256(target)}


def road_alpha() -> np.ndarray:
    """Soft ellipse covering the canvas; corners end at alpha 0."""
    width, height = ROAD_SIZE
    xs, ys = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    distance = np.abs(xs - width / 2) / (width / 2) + np.abs(ys - height / 2) / (
        height / 2
    )
    return np.clip((1.0 - distance) / ROAD_FEATHER, 0.0, 1.0)


def pick_road_box(rgb: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Shift the window right until its shadows no longer crush p5.

    Contrast is never stretched to hit ROAD_MIN_P5: a dark pebble field would
    turn into noise. `ROAD_MAX_SHIFTS` bounds the search so a texture with no
    clean window still produces a crop (the best of the tried ones).
    """
    source_height, source_width = rgb.shape[:2]
    best = None
    for shift in range(ROAD_MAX_SHIFTS + 1):
        candidate = (box[0] + shift * ROAD_SHIFT, box[1], box[2] + shift * ROAD_SHIFT, box[3])
        if candidate[2] > source_width or candidate[3] > source_height:
            break
        crop = rgb[candidate[1] : candidate[3], candidate[0] : candidate[2]]
        small = np.asarray(
            Image.fromarray(crop).resize(ROAD_SIZE, Image.LANCZOS), dtype=np.float64
        )
        p5 = float(np.percentile(luminance(small), 5))
        if best is None or p5 > best[1]:
            best = (candidate, p5)
        if p5 >= ROAD_MIN_P5:
            return candidate
    if best is None:
        raise SystemExit(f"source is smaller than the {ROAD_BOXES[0]} window")
    return best[0]


def build_road(source: Path, out_root: Path) -> list[dict]:
    rgb = np.asarray(Image.open(source).convert("RGB"), dtype=np.uint8)
    alpha = road_alpha()
    results = []
    for name, box in zip(ROAD_NAMES, ROAD_BOXES, strict=True):
        x0, y0, x1, y1 = pick_road_box(rgb, box)
        crop = rgb[y0:y1, x0:x1]
        small = np.asarray(
            Image.fromarray(crop).resize(ROAD_SIZE, Image.LANCZOS), dtype=np.float64
        )
        gain = ROAD_MEAN / max(float(luminance(small).mean()), 1e-6)
        small = np.clip(small * gain, 0.0, 255.0)

        rgba = np.zeros((ROAD_SIZE[1], ROAD_SIZE[0], 4), dtype=np.uint8)
        rgba[..., :3] = np.rint(small).astype(np.uint8)
        rgba[..., 3] = np.rint(alpha * 255.0).astype(np.uint8)

        target = out_root / "terrain" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgba, mode="RGBA").save(target, "PNG", optimize=True)
        results.append(
            {
                "name": name,
                "metrics": measure_road(rgba),
                "digest": sha256(target),
                "box": (x0, y0, x1, y1),
                "gain": gain,
            }
        )
    return results


def check(out_root: Path) -> int:
    failures: list[str] = []

    def expect(condition: bool, message: str) -> None:
        if not condition:
            failures.append(message)

    def measure(path: Path, measure_fn) -> dict | None:
        """Read and measure one shipped PNG; a corrupt file is a failed check."""
        try:
            return measure_fn(load_rgba(path))
        except (OSError, ValueError) as error:
            failures.append(f"{path.name}: {error}")
            return None

    gate_path = out_root / GATE_REL
    gate = None
    if not gate_path.exists():
        failures.append(f"missing {GATE_REL}")
    elif (metrics := measure(gate_path, measure_gate)) is not None:
        gate = {"name": GATE_REL.name, "metrics": metrics, "digest": sha256(gate_path)}
        expect(metrics["size"] == GATE_CANVAS, f"gate canvas {metrics['size']} != {GATE_CANVAS}")
        expect(metrics["bottomInset"] <= 3, f"gate bottomInset {metrics['bottomInset']} > 3")
        expected_top = GATE_CANVAS[1] - GATE_ART_HEIGHT
        expect(
            metrics["topInset"] == expected_top,
            f"gate topInset {metrics['topInset']} != {expected_top}; HP_BAR_Y.PORTAL assumes it",
        )
        center_error = abs(metrics["artCenterX"] - GATE_CANVAS[0] / 2)
        expect(center_error <= 4, f"gate art is {center_error:.1f} px off the canvas centre")
        low, high = GATE_LUM_RANGE
        expect(low <= metrics["meanLum"] <= high, f"gate lum {metrics['meanLum']:.1f} outside {low}-{high}")
        rect_w, rect_h = metrics["doorway"][0], metrics["doorway"][1]
        expect(
            rect_w >= GATE_DOORWAY_MIN[0] and rect_h >= GATE_DOORWAY_MIN[1],
            f"gate doorway {rect_w}x{rect_h} smaller than {GATE_DOORWAY_MIN[0]}x{GATE_DOORWAY_MIN[1]}",
        )
        expect(metrics["doorwayToBottom"], "gate doorway does not reach the bottom row")
        expect(
            metrics["bottomRowOpaque"] <= GATE_BOTTOM_FOOT_MAX,
            f"gate has {metrics['bottomRowOpaque']} opaque pixels on the last row"
            f" (only the front pillar foot may touch the ground)",
        )
        expect(
            metrics["mainShare"] >= GATE_MAIN_COMPONENT_SHARE,
            f"gate alpha is fragmented ({metrics['mainShare']:.3f} in the largest blob)",
        )

    roads = []
    for name in ROAD_NAMES:
        path = out_root / "terrain" / name
        if not path.exists():
            failures.append(f"missing terrain/{name}")
            continue
        metrics = measure(path, measure_road)
        if metrics is not None:
            roads.append({"name": name, "metrics": metrics, "digest": sha256(path)})

    for road in roads:
        metrics = road["metrics"]
        name = road["name"]
        expect(metrics["size"] == ROAD_SIZE, f"{name} canvas {metrics['size']} != {ROAD_SIZE}")
        expect(all(corner == 0 for corner in metrics["corners"]), f"{name} has an opaque corner")
        expect(
            abs(metrics["meanLum"] - ROAD_MEAN) <= ROAD_MEAN_TOL,
            f"{name} lum {metrics['meanLum']:.1f} outside {ROAD_MEAN:.0f}+-{ROAD_MEAN_TOL:.0f}",
        )
        contrast = metrics["p95"] - metrics["p5"]
        expect(contrast >= ROAD_MIN_CONTRAST, f"{name} contrast {contrast:.1f} < {ROAD_MIN_CONTRAST}")
        expect(metrics["centerAlpha"] == 255, f"{name} is transparent at its centre")

    digests = {road["digest"] for road in roads}
    expect(len(digests) == len(roads), "road stamps are not four distinct files")

    summary = report(gate, roads)
    if summary:
        print(summary)

    if failures:
        print("\nFAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("\nOK: gate and four road stamps match the shipping contract")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gate", type=Path, help="generated gate PNG (alpha cutout)")
    parser.add_argument("--road", type=Path, help="generated dirt ground texture (no alpha)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="asset root (default: %(default)s)")
    parser.add_argument("--check", action="store_true", help="validate the shipped files, no sources needed")
    args = parser.parse_args(argv)

    if args.check:
        return check(args.out)

    if not args.gate or not args.road:
        parser.error("--gate and --road are required unless --check is used")

    gate = build_gate(args.gate, args.out)
    roads = build_road(args.road, args.out)

    print(report(gate, roads))
    for road in roads:
        print(f"  {road['name']:<18} from {road['box']} gain {road['gain']:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

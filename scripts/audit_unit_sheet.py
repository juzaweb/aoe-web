"""Audit an assembled unit action sheet and report suspicious direction rows.

A sheet is laid out as ``frames`` columns by ``8`` direction rows. The generation
model does not always draw exactly one figure per panel, so a row can end up with
duplicated poses, a cropped limb, or four near-identical frames. This script
measures each row so a bad direction can be regenerated instead of shipping a
sheet that looks frozen or jittery in game.

Metrics per row:
``motion``  mean silhouette difference between consecutive frames (0..1).
``fill``    mean foreground coverage of a frame (0..1).
``peak``    height of the tallest frame divided by the row height.
``drift``   absolute difference in frame x-centres, normalised (0..1).

Rows are flagged when motion is far below or above the median, or when the fill
varies wildly between frames (a sign of a cropped or doubled figure).

Usage:
    python scripts/audit_unit_sheet.py apps/client/public/assets/units/actions/spearman_attack.png
    python scripts/audit_unit_sheet.py <sheet> --frames 4 --alpha 24
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

from PIL import Image

ALPHA_THRESHOLD = 24
# Row order must match the sheet layout written by
# ``scripts/generate_unit_actions.py`` and read by ``unitDirections.ts``:
# compass-from-east, clockwise. Any other order mislabels every report line.
DIRECTIONS = ("E", "SE", "S", "SW", "W", "NW", "N", "NE")


def load_frames(path: Path, frames: int, rows: int, alpha: int) -> list[list[Image.Image]]:
    sheet = Image.open(path).convert("RGBA")
    width, height = sheet.size
    frame_w = width // frames
    frame_h = height // rows
    if width % frames or height % rows:
        raise SystemExit(f"sheet {width}x{height} is not divisible by {frames}x{rows}")

    grid: list[list[Image.Image]] = []
    for row in range(rows):
        cells = []
        for col in range(frames):
            box = (col * frame_w, row * frame_h, (col + 1) * frame_w, (row + 1) * frame_h)
            cells.append(sheet.crop(box))
        grid.append(cells)
    return grid


def mask_of(image: Image.Image, alpha: int) -> Image.Image:
    return image.getchannel("A").point(lambda value: 255 if value >= alpha else 0)


def silhouettes(cells: list[Image.Image], alpha: int) -> list[Image.Image]:
    return [mask_of(cell, alpha) for cell in cells]


def diff_ratio(mask_a: Image.Image, mask_b: Image.Image, band: tuple[float, float] = (0.0, 1.0)) -> float:
    """Fraction of pixels whose foreground state changed between two masks.

    ``band`` restricts the comparison to a vertical slice of the frame, given as
    fractions of the height. Comparing only the leg band is what separates a real
    walk (legs swap) from a body bobbing in place.
    """
    width, height = mask_a.size
    top = int(height * band[0])
    bottom = max(top + 1, int(height * band[1]))
    a = mask_a.tobytes()
    b = mask_b.tobytes()
    changed = 0
    counted = 0
    for y in range(top, bottom):
        row_start = y * width
        row_end = row_start + width
        for x, yv in zip(a[row_start:row_end], b[row_start:row_end]):
            counted += 1
            if (x >= 128) != (yv >= 128):
                changed += 1
    if not counted:
        return 0.0
    return changed / counted


def fill_ratio(mask: Image.Image) -> float:
    histogram = mask.histogram()
    foreground = sum(histogram[128:])
    width, height = mask.size
    return foreground / (width * height)


def column_span_x(mask: Image.Image) -> float | None:
    """Horizontal centre of mass of the foreground, in pixels."""
    width, height = mask.size
    data = mask.tobytes()
    total = 0
    weighted = 0
    for y in range(height):
        row = data[y * width : (y + 1) * width]
        for x, value in enumerate(row):
            if value >= 128:
                total += 1
                weighted += x
    if not total:
        return None
    return weighted / total


def edge_clip_ratio(mask: Image.Image, margin: int = 1) -> float:
    """Share of foreground pixels sitting on the left, right or top border.

    A horizontal centre-of-mass jump is normal for a thrust: the weapon extends
    and the silhouette grows. What is not normal is a pose touching the panel
    border, because the crop cut part of the figure away. The bottom border is
    excluded — feet legitimately stand on the ground line.
    """
    width, height = mask.size
    data = mask.tobytes()
    if width <= margin * 2 or height <= margin * 2:
        return 0.0
    total = sum(1 for value in data if value >= 128)
    if not total:
        return 0.0
    border = 0
    for y in range(margin):
        row = data[y * width : (y + 1) * width]
        border += sum(1 for value in row if value >= 128)
    for y in range(margin, height):
        row = data[y * width : (y + 1) * width]
        border += sum(1 for value in row[:margin] if value >= 128)
        border += sum(1 for value in row[width - margin :] if value >= 128)
    return border / total


def bbox_height_ratio(mask: Image.Image) -> float:
    box = mask.getbbox()
    if not box:
        return 0.0
    return (box[3] - box[1]) / mask.size[1]


def analyse_row(cells: list[Image.Image], alpha: int) -> dict[str, float | None]:
    masks = silhouettes(cells, alpha)
    motions = [diff_ratio(masks[i], masks[i + 1]) for i in range(len(masks) - 1)]
    leg_motions = [diff_ratio(masks[i], masks[i + 1], (0.6, 1.0)) for i in range(len(masks) - 1)]
    fills = [fill_ratio(m) for m in masks]
    heights = [bbox_height_ratio(m) for m in masks]
    centres = [column_span_x(m) for m in masks]
    clips = [edge_clip_ratio(m) for m in masks]
    known = [c for c in centres if c is not None]
    drift = 0.0
    if len(known) > 1:
        widths = [m.size[0] for m in masks]
        drift = (max(known) - min(known)) / widths[0]
    return {
        "motion": statistics.fmean(motions) if motions else None,
        "motion_min": min(motions) if motions else None,
        "leg": statistics.fmean(leg_motions) if leg_motions else None,
        "leg_min": min(leg_motions) if leg_motions else None,
        "fill": statistics.fmean(fills) if fills else None,
        "fill_spread": (max(fills) - min(fills)) if fills else None,
        "height": statistics.fmean(heights) if heights else None,
        "drift": drift,
        "clip": max(clips) if clips else 0.0,
    }


def row_detail(cells: list[Image.Image], alpha: int) -> str:
    """Per-frame bounding box, fill and centre, to see where a cut went wrong."""
    lines = []
    for index, cell in enumerate(cells):
        mask = mask_of(cell, alpha)
        centre = column_span_x(mask)
        centre_text = f"{centre:.1f}" if centre is not None else "none"
        lines.append(
            f"      frame {index}: bbox {mask.getbbox()} fill {fill_ratio(mask):.3f} centre {centre_text}"
        )
    return "\n".join(lines)


def audit(path: Path, frames: int, alpha: int, detail: list[str] | None = None) -> dict:
    rows = len(DIRECTIONS)
    grid = load_frames(path, frames, rows, alpha)
    report: dict = {"sheet": str(path), "size": list(Image.open(path).size), "rows": {}, "detail": {}}
    stats = {}
    for index, direction in enumerate(DIRECTIONS):
        stats[direction] = analyse_row(grid[index], alpha)
        report["rows"][direction] = stats[direction]

    motions = [s["motion"] for s in stats.values() if s["motion"] is not None]
    fills = [s["fill"] for s in stats.values() if s["fill"] is not None]
    median_motion = statistics.median(motions) if motions else 0.0
    median_fill = statistics.median(fills) if fills else 0.0

    issues: list[str] = []
    for direction, values in stats.items():
        motion = values["motion"] or 0.0
        fill = values["fill"] or 0.0
        spread = values["fill_spread"] or 0.0
        drift = values["drift"] or 0.0
        # A frozen row animates less than a third of its siblings; a chaotic row
        # more than twice as much, which usually means a cut landed on a limb.
        if motions and motion < median_motion * 0.35:
            issues.append(f"{direction}: motion {motion:.3f} is far below median {median_motion:.3f}")
        if motions and motion > median_motion * 2.2:
            issues.append(f"{direction}: motion {motion:.3f} is far above median {median_motion:.3f}")
        if median_fill and abs(fill - median_fill) > median_fill * 0.45:
            issues.append(f"{direction}: fill {fill:.3f} differs from median {median_fill:.3f}")
        leg = values["leg"] or 0.0
        if leg < 0.02:
            issues.append(f"{direction}: legs barely move ({leg * 100:.1f}% of the leg band changes)")
        if spread > 0.25:
            issues.append(f"{direction}: frame fill spread {spread:.3f} suggests a cropped figure")
        # A pose touching the panel border means the crop removed part of the
        # figure (usually a spear tip). Drift alone is normal for a thrust.
        clip = values["clip"] or 0.0
        if clip > 0.015:
            issues.append(f"{direction}: {clip * 100:.1f}% of the figure touches the panel border")

    for direction in detail or []:
        report["detail"][direction] = row_detail(grid[DIRECTIONS.index(direction)], alpha)

    report["median"] = {"motion": median_motion, "fill": median_fill}
    report["issues"] = issues
    report["verdict"] = "ok" if not issues else "review"
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path, nargs="+", help="assembled sheet PNG(s)")
    parser.add_argument("--frames", type=int, default=4)
    parser.add_argument("--alpha", type=int, default=ALPHA_THRESHOLD)
    parser.add_argument(
        "--detail",
        nargs="*",
        default=[],
        choices=DIRECTIONS,
        help="print per-frame bounding boxes for these directions",
    )
    parser.add_argument("--json", type=Path, help="write the full report here")
    args = parser.parse_args()

    reports = [audit(path, args.frames, args.alpha, args.detail) for path in args.sheet]
    for report in reports:
        print(f"\n{report['sheet']}  {report['size'][0]}x{report['size'][1]}")
        print(f"  median motion {report['median']['motion']:.3f}  fill {report['median']['fill']:.3f}")
        for direction, values in report["rows"].items():
            motion = values["motion"] or 0.0
            fill = values["fill"] or 0.0
            drift = values["drift"] or 0.0
            height = values["height"] or 0.0
            clip = values["clip"] or 0.0
            leg = values["leg"] or 0.0
            print(
                f"  {direction:<2} motion {motion:.3f}  leg {leg:.3f}  fill {fill:.3f}  h {height:.2f}"
                f"  drift {drift:.3f}  clip {clip:.3f}"
            )
        if report["issues"]:
            print(f"  verdict: review ({len(report['issues'])} issue(s))")
            for issue in report["issues"]:
                print(f"    - {issue}")
        else:
            print("  verdict: ok")
        for direction, detail_lines in report["detail"].items():
            print(f"  {direction} per-frame:")
            print(detail_lines)

    if args.json:
        args.json.write_text(json.dumps(reports, indent=2), encoding="utf-8")
        print(f"\nreport written to {args.json}")
    return 0 if all(r["verdict"] == "ok" for r in reports) else 1


if __name__ == "__main__":
    sys.exit(main())

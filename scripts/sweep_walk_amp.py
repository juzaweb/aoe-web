"""Sweep the stride strength of the procedural walk and report measurable quality.

For each amplitude the sheet is rebuilt in memory and scored on:

``leg``   mean change of the leg band between consecutive frames (motion).
``swap``  change between the two contact frames (frame 1 and frame 3), which is
          what distinguishes a left step from a right step.
``spread`` widest frame-to-frame fill difference; large values mean the stride is
          distorting the figure rather than displacing it.
``clip``  share of the figure touching the panel border.

Run from the repo root:
    python scripts/sweep_walk_amp.py SPEARMAN
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_unit_sheet import ALPHA_THRESHOLD, DIRECTIONS, analyse_row, edge_clip_ratio  # noqa: E402
from build_walk_from_idle import FRAME_SIZE, build_row, load_row  # noqa: E402
from PIL import Image  # noqa: E402

FRAMES = 4
ACTIONS_DIR = Path(__file__).resolve().parent.parent / "apps" / "client" / "public" / "assets" / "units" / "actions"


def measure(unit: str, amp: float) -> dict[str, float]:
    frame_size = FRAME_SIZE[unit.upper()]
    idle = Image.open(ACTIONS_DIR / f"{unit.lower()}_idle.png").convert("RGBA")
    rows: list[list[Image.Image]] = []
    for index, direction in enumerate(DIRECTIONS):
        base = load_row(idle, index, frame_size)
        rows.append(build_row(base, direction, amp))

    legs = []
    swaps = []
    spreads = []
    clips = []
    for cells in rows:
        stats = analyse_row(cells, ALPHA_THRESHOLD)
        legs.append(stats["leg"] or 0.0)
        spreads.append(stats["fill_spread"] or 0.0)
        masks = [cell.getchannel("A").point([0] * ALPHA_THRESHOLD + [255] * (256 - ALPHA_THRESHOLD)) for cell in cells]
        from audit_unit_sheet import diff_ratio

        swaps.append(diff_ratio(masks[0], masks[2], (0.6, 1.0)))
        clips.append(max(edge_clip_ratio(mask) for mask in masks))

    return {
        "leg": sum(legs) / len(legs),
        "swap": sum(swaps) / len(swaps),
        "spread": max(spreads),
        "clip": max(clips),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unit", nargs="?", default="SPEARMAN")
    parser.add_argument("--amps", type=float, nargs="*", default=[0.09, 0.12, 0.15, 0.18, 0.22, 0.26])
    args = parser.parse_args()

    print(f"{args.unit}: sweep stride amplitude (share of figure height)")
    print("  amp    leg    swap   spread  clip")
    for amp in args.amps:
        stats = measure(args.unit, amp)
        print(
            f"  {amp:.2f}  {stats['leg']:.3f}  {stats['swap']:.3f}  {stats['spread']:.3f}  {stats['clip']:.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

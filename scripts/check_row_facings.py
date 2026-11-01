"""Measure how different the eight direction rows of a sheet actually are.

The image model is asked for one facing per row, but it sometimes returns the
same frontal pose eight times. That would make every downstream animation
meaningless, so check it directly: rows that face different compass directions
must differ in silhouette, and opposite rows (E vs W, S vs N) must differ more
than neighbouring rows that share a quadrant.

    python scripts/check_row_facings.py apps/client/public/assets/units/actions/spearman_idle.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_unit_sheet import ALPHA_THRESHOLD, DIRECTIONS, diff_ratio, mask_of  # noqa: E402
from PIL import Image  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path)
    parser.add_argument("--frames", type=int, default=4)
    parser.add_argument("--alpha", type=int, default=ALPHA_THRESHOLD)
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    width, height = sheet.size
    frame_w = width // args.frames
    frame_h = height // len(DIRECTIONS)

    firsts = []
    for index in range(len(DIRECTIONS)):
        cell = sheet.crop((0, index * frame_h, frame_w, (index + 1) * frame_h))
        firsts.append(mask_of(cell, args.alpha))

    print(f"{args.sheet.name}: first-frame silhouette difference between rows")
    print("      " + "".join(f"{name:>7}" for name in DIRECTIONS))
    for row, name in enumerate(DIRECTIONS):
        line = f"  {name:<3} "
        for col in range(len(DIRECTIONS)):
            line += "      -" if row == col else f"{diff_ratio(firsts[row], firsts[col]):7.3f}"
        print(line)

    identical = 0
    for row in range(len(DIRECTIONS)):
        for col in range(row + 1, len(DIRECTIONS)):
            if diff_ratio(firsts[row], firsts[col]) < 0.01:
                identical += 1
                print(f"  near-identical pair: {DIRECTIONS[row]} vs {DIRECTIONS[col]}")
    print(f"  near-identical pairs (below 1%): {identical}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

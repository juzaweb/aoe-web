#!/usr/bin/env python3
"""Raise the shipped citadel wall and build the stair flight texture.

The original 1024px stone sources are not kept in the repository, so this
script reworks the shipped `citadel/wall.png` instead:

* the cap diamond (rows 0..52) is preserved pixel-for-pixel;
* the two face bands are stretched from 90px to 120px of rise.

`citadel/stairs.png` is a 256x260 flight anchored on the bottom tile centre.
Its top edge lands on the wall cap: the anchor is (128, 220), the run advances
64px right and the treads climb 88px, which is the wall rise (120) minus the
32px the top tile already sits lower in the isometric projection.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "client" / "public" / "assets" / "citadel"
WALL = ASSETS / "wall.png"
STAIRS = ASSETS / "stairs.png"

OLD_RISE = 90
NEW_RISE = 120
CAP_ROWS = 52
OLD_HEIGHT = 32 + OLD_RISE + 32
NEW_HEIGHT = 32 + NEW_RISE + 32

STAIRS_SIZE = (256, 260)
STAIRS_ANCHOR = (128, 220)
STAIRS_TOP = (192, 132)
STEP_COUNT = 8


def stretch_wall() -> None:
    source = Image.open(WALL).convert("RGBA")
    if source.size == (128, NEW_HEIGHT):
        print(f"wall already {source.width}x{source.height}")
        return
    if source.size != (128, OLD_HEIGHT):
        raise SystemExit(
            f"{WALL} is {source.width}x{source.height}, expected 128x{OLD_HEIGHT}"
        )

    cap = source.crop((0, 0, 128, CAP_ROWS))
    faces = source.crop((0, CAP_ROWS, 128, OLD_HEIGHT))
    face_height = NEW_HEIGHT - CAP_ROWS
    faces = faces.resize((128, face_height), Image.LANCZOS)

    canvas = Image.new("RGBA", (128, NEW_HEIGHT), (0, 0, 0, 0))
    canvas.alpha_composite(cap, (0, 0))
    canvas.alpha_composite(faces, (0, CAP_ROWS))
    canvas.save(WALL, "PNG", optimize=True)
    print(f"wall {canvas.width}x{canvas.height}")


def _sample_colours() -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    rgba = np.asarray(Image.open(WALL).convert("RGBA"), dtype=np.float32)
    rgb = rgba[..., :3]
    alpha = rgba[..., 3] > 8
    if not alpha.any():
        return (150, 150, 150), (105, 105, 105), (80, 80, 80)

    cap = rgb[20:48][alpha[20:48]]
    left = rgb[80:140, 0:48][alpha[80:140, 0:48]]
    right = rgb[80:140, 80:128][alpha[80:140, 80:128]]

    def mean(values: np.ndarray, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
        if values.size == 0:
            return fallback
        return tuple(int(round(v)) for v in values.mean(axis=0))

    return mean(cap, (150, 150, 150)), mean(left, (105, 105, 105)), mean(right, (80, 80, 80))


def build_stairs() -> None:
    cap, left, right = _sample_colours()
    width, height = STAIRS_SIZE
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    ax, ay = STAIRS_ANCHOR
    tx, ty = STAIRS_TOP
    step_dx = (tx - ax) / STEP_COUNT
    step_dy = (ty - ay) / STEP_COUNT

    for index in range(STEP_COUNT):
        x = ax + step_dx * index
        y = ay + step_dy * index
        # Tread: a slanted parallelogram, one tile wide in screen space.
        tread = [
            (x - 58, y),
            (x + 58, y - 20),
            (x + 58, y - 8),
            (x - 58, y + 12),
        ]
        riser = [
            (x - 58, y + 12),
            (x + 58, y - 8),
            (x + 58, y + 2),
            (x - 58, y + 22),
        ]
        draw.polygon(tread, fill=(*cap, 255))
        draw.polygon(riser, fill=(*left, 255))
        # Dark joints keep each step readable after the sprite is scaled down.
        draw.line([tread[0], tread[1]], fill=(*right, 255), width=3)
        draw.line([tread[3], tread[2]], fill=(35, 39, 46, 255), width=3)
        draw.line([tread[1], tread[2]], fill=(35, 39, 46, 255), width=2)

    # Front and side faces tie the flight to the wall block base.
    draw.polygon(
        [(ax - 58, ay + 12), (ax + 58, ay - 8), (ax + 58, ay + 24), (ax - 58, ay + 44)],
        fill=(*right, 255),
    )
    draw.polygon(
        [(ax - 58, ay + 44), (ax + 58, ay + 24), (ax + 58, ay + 30), (ax - 58, ay + 50)],
        fill=(*left, 255),
    )

    canvas.save(STAIRS, "PNG", optimize=True)
    print(f"stairs {width}x{height}")


def main() -> int:
    stretch_wall()
    build_stairs()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

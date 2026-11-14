"""Derive a unit's portrait from the directional art it actually renders with.

The dock slot, the selection strip and the entity panel all draw
``apps/client/public/assets/units/<unit>_idle.png`` (see ``unitThumbnail`` in
``commandPages.ts``). Those files were painted by an earlier art pass and were
never refreshed when the units themselves were redrawn, so a portrait could show
a character the player never sees on the ground: the villager's was a
conical-hat farmer with a hoe while the unit is the pack's blue-tunic peasant.

This script closes that gap by construction: it takes the front (S) facing idle
pose out of ``assets/units/actions/<unit>_idle.png`` - the same sheet the
renderer plays - trims the empty canvas around it, and fits it into the square
portrait the UI expects.

Usage:
    python scripts/build_unit_portrait.py villager
    python scripts/build_unit_portrait.py villager spearman --size 128
"""

from __future__ import annotations

import argparse

from PIL import Image, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSET_DIR = ROOT / "apps" / "client" / "public" / "assets" / "units"
ACTION_DIR = ASSET_DIR / "actions"

# Cell geometry of each directional sheet. Mirrors `UNIT_ART` in
# apps/client/src/game/render/unitArt.ts: a cell size the renderer disagrees with
# silently slices poses out of the neighbouring direction, so keep them in step.
CELLS = {
    "villager": (148, 130),
    "spearman": (192, 168),
    "archer": (192, 168),
    "cavalry": (224, 224),
}

# Row 2 is south (towards the viewer) in the east-first, clockwise sheet order -
# `DEFAULT_DIRECTION_INDEX` in unitDirections.ts, the facing a unit is drawn with
# before it moves anywhere.
FRONT_ROW = 2
FRONT_FRAME = 0

# How much of the portrait the figure fills, and how far its feet sit above the
# bottom edge. The portrait is shown at 28-40 px, so the margins exist to keep a
# raised arm or a spear tip inside the frame rather than to frame the pose.
FIGURE_FILL = 0.92
BOTTOM_MARGIN_PX = 4


def front_pose(unit: str) -> Image.Image:
    """The front-facing idle pose of `unit`, trimmed to its own silhouette."""
    cell_width, cell_height = CELLS[unit]
    sheet_path = ACTION_DIR / f"{unit}_idle.png"
    with Image.open(sheet_path) as sheet:
        frame = sheet.convert("RGBA").crop(
            (
                FRONT_FRAME * cell_width,
                FRONT_ROW * cell_height,
                (FRONT_FRAME + 1) * cell_width,
                (FRONT_ROW + 1) * cell_height,
            )
        )
    box = frame.split()[-1].getbbox()
    if box is None:
        raise SystemExit(f"{sheet_path} has an empty front idle cell; nothing to crop")
    return frame.crop(box)


def build_portrait(unit: str, size: int) -> Path:
    """Write the square portrait for `unit` and return its path."""
    pose = front_pose(unit)
    # One box for both axes: a mounted unit is wider than it is tall, and the
    # figure must fit whichever limit it hits first instead of being cut off.
    limit = round(size * FIGURE_FILL)
    scale = min(limit / pose.width, limit / pose.height)
    scaled = pose.resize(
        (max(1, round(pose.width * scale)), max(1, round(pose.height * scale))),
        Image.Resampling.LANCZOS,
    )
    # The idle frames are ~90 px tall; filling a 128 px portrait is a mild
    # upscale, so a light sharpen keeps the sprite from looking washed out at
    # the 40 px the entity panel draws it at.
    scaled = scaled.filter(ImageFilter.UnsharpMask(radius=1.0, percent=45, threshold=2))

    portrait = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    portrait.alpha_composite(
        scaled,
        ((size - scaled.width) // 2, size - BOTTOM_MARGIN_PX - scaled.height),
    )

    out_path = ASSET_DIR / f"{unit}_idle.png"
    portrait.save(out_path, "PNG", optimize=True)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("units", nargs="+", choices=sorted(CELLS), help="unit type(s) to rebuild")
    parser.add_argument("--size", type=int, default=128, help="square portrait size in px")
    args = parser.parse_args()

    for unit in args.units:
        path = build_portrait(unit, args.size)
        print(f"{unit}: {path.relative_to(ROOT)} ({args.size}x{args.size})")


if __name__ == "__main__":
    main()

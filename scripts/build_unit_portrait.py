"""Derive a unit's portrait from the directional art it actually renders with.

The dock slot, the selection strip and the entity panel all draw
``apps/client/public/assets/units/<unit>_idle.png`` (see ``unitThumbnail`` in
``components/unitThumbnails.ts``). Those files were painted by an earlier art
pass and were never refreshed when the units themselves were redrawn, so a
portrait could show a character the player never sees on the ground: the
villager's was a conical-hat farmer with a hoe while the unit is the pack's
blue-tunic peasant.

This script closes that gap by construction: it takes a pose out of
``assets/units/actions/<unit>_idle.png`` - the sheet the renderer plays - trims
the empty canvas around it, and fits it into the square portrait the UI expects.
The pose it used and the hashes of both files go into
``scripts/assets/unit_portraits.lock.json``, which
``apps/client/src/game/render/unitPortraits.test.ts`` checks on every test run.
That test is what makes the portraits stay in step: redraw a sheet without
rebuilding, and it fails naming the unit and the command to rerun.

A portrait is also pinned as a legacy sprite in ``scripts/assets/assets.lock.json``
(that pipeline does not build it), so finish a rebuild with
``python scripts/assets/build.py --legacy`` or its ``--check`` gate fails on the
edited file.

Usage:
    python scripts/build_unit_portrait.py villager
    python scripts/build_unit_portrait.py villager spearman archer cavalry
    python scripts/build_unit_portrait.py --check      # verify shipped files
"""

from __future__ import annotations

import argparse
import hashlib
import json

from PIL import Image, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSET_DIR = ROOT / "apps" / "client" / "public" / "assets" / "units"
ACTION_DIR = ASSET_DIR / "actions"
LOCK = ROOT / "scripts" / "assets" / "unit_portraits.lock.json"

# Cell geometry of each directional sheet. Mirrors `UNIT_ART` in
# apps/client/src/game/render/unitArt.ts: a cell size the renderer disagrees with
# silently slices poses out of the neighbouring direction. The lock records this
# table per unit and `unitPortraits.test.ts` compares it against the art config
# the renderer reads, so the mirror cannot drift unnoticed.
CELLS = {
    "villager": (148, 130),
    "spearman": (192, 168),
    "archer": (192, 168),
    "cavalry": (224, 224),
    "catapult": (224, 208),
}

# Row 2 is south (towards the viewer) in the east-first, clockwise sheet order -
# `DEFAULT_DIRECTION_INDEX` in unitDirections.ts, the facing a unit is drawn with
# before it moves anywhere. Frame 0 is the start of the idle cycle, the pose a
# unit stands in.
DEFAULT_POSE_ROW = 2
POSE_FRAME = 0

# Exceptions to the front pose, per unit. A horse seen head-on is a shield, a
# spear and two knees stacked into one silhouette: at the 28 px the train button
# draws, nothing about it says "mounted". The three-quarter profile keeps the
# mount's length legible, which is the whole reason the portrait exists.
POSE_ROW = {
    "cavalry": 1,  # south-east
    # The catapult is a long machine, not a person: front-on it collapses to a
    # narrow box with the arm edge-on, while the east profile shows the frame,
    # wheels and raised arm in one silhouette.
    "catapult": 0,  # east
}

# How much of the portrait the figure fills, and how far its feet sit above the
# bottom edge. The portrait is shown at 28-40 px, so the margins exist to keep a
# raised arm or a spear tip inside the frame rather than to frame the pose.
FIGURE_FILL = 0.92
BOTTOM_MARGIN_PX = 4
DEFAULT_SIZE = 128


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def idle_pose(unit: str) -> tuple[Image.Image, int]:
    """The idle pose the portrait should show, trimmed to its silhouette."""
    cell_width, cell_height = CELLS[unit]
    row = POSE_ROW.get(unit, DEFAULT_POSE_ROW)
    sheet_path = ACTION_DIR / f"{unit}_idle.png"
    with Image.open(sheet_path) as sheet:
        frame = sheet.convert("RGBA").crop(
            (
                POSE_FRAME * cell_width,
                row * cell_height,
                (POSE_FRAME + 1) * cell_width,
                (row + 1) * cell_height,
            )
        )
    box = frame.split()[-1].getbbox()
    if box is None:
        raise SystemExit(f"{sheet_path} has an empty idle cell in row {row}; nothing to crop")
    return frame.crop(box), row


def render_portrait(unit: str, size: int) -> tuple[Image.Image, int]:
    """Render the portrait for `unit` in memory, with the sheet row it came from."""
    pose, row = idle_pose(unit)
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
    return portrait, row


def build_portrait(unit: str, size: int = DEFAULT_SIZE) -> Path:
    """Write the portrait for `unit` and return its path."""
    portrait, _ = render_portrait(unit, size)
    out_path = ASSET_DIR / f"{unit}_idle.png"
    portrait.save(out_path, "PNG", optimize=True)
    return out_path


def load_lock() -> dict:
    return json.loads(LOCK.read_text()) if LOCK.exists() else {"portraits": {}}


def write_lock(units: list[str]) -> None:
    """Record what each portrait was built from, so drift fails the test suite."""
    portraits = load_lock()["portraits"]
    for unit in units:
        source = ACTION_DIR / f"{unit}_idle.png"
        out_path = ASSET_DIR / f"{unit}_idle.png"
        with Image.open(out_path) as out:
            size = out.size[0]
        portraits[unit.upper()] = {
            "out": str(out_path.relative_to(ROOT)),
            "source": str(source.relative_to(ROOT)),
            "sourceSha256": sha256(source),
            "poseRow": POSE_ROW.get(unit, DEFAULT_POSE_ROW),
            "frame": POSE_FRAME,
            "cell": list(CELLS[unit]),
            "size": size,
            "sha256": sha256(out_path),
        }
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(json.dumps({"portraits": dict(sorted(portraits.items()))}, indent=2) + "\n")


def check(units: list[str]) -> int:
    """Report every portrait that no longer matches its sheet. 0 = in step."""
    stale = 0
    portraits = load_lock()["portraits"]
    for unit in units:
        entry = portraits.get(unit.upper())
        source = ACTION_DIR / f"{unit}_idle.png"
        out_path = ASSET_DIR / f"{unit}_idle.png"
        if entry is None:
            print(f"{unit}: no lock entry - rebuild it")
            stale += 1
        elif not out_path.exists():
            print(f"{unit}: {out_path.relative_to(ROOT)} is missing - rebuild it")
            stale += 1
        elif sha256(source) != entry["sourceSha256"]:
            print(f"{unit}: {source.name} changed since the portrait was built - rebuild it")
            stale += 1
        elif sha256(out_path) != entry["sha256"]:
            print(f"{unit}: {out_path.name} no longer matches the lock - rebuild it")
            stale += 1
    if stale:
        return 1
    print(f"portraits in step: {', '.join(units)}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("units", nargs="*", help=f"unit type(s), one of: {', '.join(sorted(CELLS))}")
    parser.add_argument("--size", type=int, default=DEFAULT_SIZE, help="square portrait size in px")
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the shipped portraits match the sheets instead of rebuilding",
    )
    args = parser.parse_args()

    units = args.units or sorted(CELLS)
    unknown = [unit for unit in units if unit not in CELLS]
    if unknown:
        parser.error(
            f"unknown unit(s): {', '.join(unknown)}; choose from {', '.join(sorted(CELLS))}"
        )

    if args.check:
        raise SystemExit(check(units))

    for unit in units:
        path = build_portrait(unit, args.size)
        print(f"{unit}: {path.relative_to(ROOT)} ({args.size}x{args.size})")
    write_lock(units)


if __name__ == "__main__":
    main()

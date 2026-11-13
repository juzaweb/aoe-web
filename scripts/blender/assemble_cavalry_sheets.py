"""Pack rendered cavalry frames into the client's directional sheets.

One row per compass direction (E, SE, S, SW, W, NW, N, NE), one column per
frame, cell size matching ``UNIT_ART.CAVALRY``. Renders are 2x the cell, so the
downsample happens here once per frame instead of in the sheet.

Usage:
    python3 scripts/blender/assemble_cavalry_sheets.py [--write] [--scale 224]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parent.parent
FRAMES = SCRIPT_DIR / "out" / "frames"
ACTIONS_DIR = REPO / "apps" / "client" / "public" / "assets" / "units" / "actions"
PREVIEW_DIR = SCRIPT_DIR / "out"

DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
FRAME_COUNTS = {"idle": 4, "walk": 11, "attack": 10, "death": 8}

# The Cycles render is lit darker than the OpenGameArt pack. The cavalry is
# matched to the spearman, the infantry it shares a front line with, by a gamma
# lift that preserves hue instead of a per-channel gain that would push the
# maroon caparison.
REFERENCE_SHEET = ACTIONS_DIR / "spearman_walk.png"
GAMMA_BOUNDS = (0.70, 1.10)


def median_luma(image: Image.Image) -> float:
    pixels = np.asarray(image.convert("RGBA"), dtype=np.float32)
    opaque = pixels[..., 3] > 200
    rgb = pixels[..., :3][opaque]
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return float(np.median(luma))


def luminance_gamma(sheet: Image.Image) -> float:
    """Exponent that moves ``sheet``'s median luma onto the reference's."""
    if not REFERENCE_SHEET.exists():
        return 1.0
    with Image.open(REFERENCE_SHEET) as reference:
        target = median_luma(reference)
    current = median_luma(sheet)
    if current <= 1 or target <= 1:
        return 1.0
    gamma = math.log(target / 255.0) / math.log(current / 255.0)
    return min(GAMMA_BOUNDS[1], max(GAMMA_BOUNDS[0], gamma))


def apply_gamma(sheet: Image.Image, gamma: float) -> Image.Image:
    if abs(gamma - 1.0) < 1e-3:
        return sheet
    table = [
        int(round(min(255.0, max(0.0, (value / 255.0) ** gamma * 255.0)))) for value in range(256)
    ]
    bands = [band.point(table) for band in sheet.convert("RGBA").split()[:3]]
    bands.append(sheet.getchannel("A"))
    return Image.merge("RGBA", bands)


def load_cell(path: Path, cell: int) -> Image.Image:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
    if rgba.size != (cell, cell):
        rgba = rgba.resize((cell, cell), Image.Resampling.LANCZOS)
    return rgba


def build_sheet(action: str, cell: int) -> Image.Image:
    count = FRAME_COUNTS[action]
    sheet = Image.new("RGBA", (count * cell, len(DIRECTIONS) * cell), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        folder = FRAMES / action / direction
        files = sorted(folder.glob("*.png"))
        if len(files) != count:
            raise SystemExit(f"{action}/{direction}: expected {count} frames, found {len(files)}")
        for col, path in enumerate(files):
            sheet.paste(load_cell(path, cell), (col * cell, row * cell))
    return sheet


def build_preview(sheet: Image.Image, action: str) -> Image.Image:
    """2x contact sheet on grey, to eyeball the rows before shipping."""
    scale = 2
    preview = Image.new(
        "RGBA", (sheet.width * scale, sheet.height * scale), (70, 74, 78, 255)
    )
    enlarged = sheet.resize((sheet.width * scale, sheet.height * scale), Image.Resampling.LANCZOS)
    preview.alpha_composite(enlarged)
    return preview


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="publish into the client assets")
    parser.add_argument("--scale", type=int, default=224)
    args = parser.parse_args()

    gamma = luminance_gamma(build_sheet("walk", args.scale))
    print(f"luminance gamma {gamma:.3f}")

    written = {}
    for action in FRAME_COUNTS:
        if not (FRAMES / action).is_dir():
            print(f"skip {action}: no frames rendered")
            continue
        sheet = apply_gamma(build_sheet(action, args.scale), gamma)
        preview = build_preview(sheet, action)
        preview.save(PREVIEW_DIR / f"preview_{action}.png")
        if args.write:
            ACTIONS_DIR.mkdir(parents=True, exist_ok=True)
            destination = ACTIONS_DIR / f"cavalry_{action}.png"
            sheet.save(destination, optimize=True)
            written[action] = {
                "path": str(destination.relative_to(REPO)),
                "size": list(sheet.size),
            }
            print(f"wrote {destination} {sheet.size}")
        else:
            print(f"built {action} {sheet.size} (dry run)")
    if written:
        (PREVIEW_DIR / "written.json").write_text(json.dumps(written, indent=2))


if __name__ == "__main__":
    main()

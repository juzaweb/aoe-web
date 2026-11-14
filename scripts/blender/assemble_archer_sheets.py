"""Pack the rendered archer frames into the client's directional sheets.

One row per compass direction (E, SE, S, SW, W, NW, N, NE), one column per
frame, 192x168 cells matching ``UNIT_ART.ARCHER`` and the spearman's ground line.
Renders are 2x the cell (384x336), so the downsample happens here once per frame
instead of in the sheet.

The Cycles render is lit darker than the OpenGameArt pack the rest of the
infantry comes from, so the sheets are gamma-lifted onto the spearman's median
luma, exactly like the cavalry sheets are.

Usage:
    python3 scripts/blender/assemble_archer_sheets.py           # dry run + previews
    python3 scripts/blender/assemble_archer_sheets.py --write   # publish
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
FRAMES = SCRIPT_DIR / "out" / "archer_frames"
ACCENT_FRAMES = SCRIPT_DIR / "out" / "archer_accent_frames"
ACTIONS_DIR = REPO / "apps" / "client" / "public" / "assets" / "units" / "actions"
PREVIEW_DIR = SCRIPT_DIR / "out"

DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
FRAME_COUNTS = {"idle": 4, "walk": 11, "attack": 10, "death": 8}
CELL_SIZE = (192, 168)

# The camera puts the tile's ground point -- the world origin, which the game
# anchors the sprite to -- on row 144 of 168, the spearman's row. The archer's
# own soles fall a few pixels below it because the archery stance carries a foot
# toward the camera and the camera looks down 20 degrees; the reported median is
# the row `unitArt.ts` derives `offsetY` from.
GROUND_LINE_ROW = 144
# Each facing puts a different foot nearest the camera, so the rows cannot agree
# exactly: the shipped spearman's own idle rows span 10 px. Anything wider than
# the pack's own spread means a row was rendered with another camera.
ROW_SPREAD_TOLERANCE = 9

REFERENCE_SHEET = ACTIONS_DIR / "spearman_walk.png"
GAMMA_BOUNDS = (0.70, 1.10)
ALPHA_THRESHOLD = 24


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


def load_cell(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
    if rgba.size != size:
        rgba = rgba.resize(size, Image.Resampling.LANCZOS)
    return rgba


def build_sheet(
    action: str, size: tuple[int, int], frames_dir: Path = FRAMES
) -> Image.Image:
    count = FRAME_COUNTS[action]
    sheet = Image.new("RGBA", (count * size[0], len(DIRECTIONS) * size[1]), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        files = sorted((frames_dir / action / direction).glob("*.png"))
        if len(files) != count:
            raise SystemExit(f"{action}/{direction}: expected {count} frames, found {len(files)}")
        for col, path in enumerate(files):
            sheet.paste(load_cell(path, size), (col * size[0], row * size[1]))
    return sheet


def measure_sole_rows(sheet: Image.Image, size: tuple[int, int]) -> list[int]:
    """Lowest opaque row of the first (standing) frame of every direction row."""
    alpha = np.array(sheet.getchannel("A"))
    soles = []
    for row in range(len(DIRECTIONS)):
        first = alpha[row * size[1] : (row + 1) * size[1], : size[0]]
        opaque = np.nonzero(first > ALPHA_THRESHOLD)[0]
        if opaque.size == 0:
            raise SystemExit(f"row {DIRECTIONS[row]}: empty cell")
        soles.append(int(opaque.max()) + 1)
    return soles


def check_accent(sheet: Image.Image, action: str) -> float:
    """The accent sheet must cover the tunic and nothing else.

    A mask that lost its thresholds covers the whole figure (a flat tint over
    skin and steel) and one that was cut too tight leaves a bare patch; both are
    visible as a coverage far off the tunic's own share of the cell.
    """
    alpha = np.array(sheet.getchannel("A"), dtype=np.float32) / 255.0
    coverage = float(alpha.mean())
    if not 0.008 <= coverage <= 0.16:
        raise SystemExit(
            f"{action}: accent covers {coverage:.1%} of the sheet; expected the tunic "
            "(0.8-16%) -- check team_accent.py's band"
        )
    if float((alpha > 0.98).mean()) < 0.004:
        raise SystemExit(
            f"{action}: accent has almost no near-white pixels; the client multiplies "
            "the owner colour into this layer and a dark mask tints towards black"
        )
    return coverage


def build_preview(sheet: Image.Image, action: str) -> Image.Image:
    """2x contact sheet on grey, to eyeball the rows before shipping."""
    scale = 2
    preview = Image.new(
        "RGBA", (sheet.width * scale, sheet.height * scale), (70, 74, 78, 255)
    )
    enlarged = sheet.resize((sheet.width * scale, sheet.height * scale), Image.Resampling.LANCZOS)
    preview.alpha_composite(enlarged)
    return preview


def publish(
    sheet: Image.Image, action: str, suffix: str, preview_name: str, write: bool
) -> dict | None:
    """Write the preview, and the sheet itself when ``write`` is set."""
    build_preview(sheet, action).save(PREVIEW_DIR / f"archer_preview_{preview_name}.png")
    if not write:
        return None
    ACTIONS_DIR.mkdir(parents=True, exist_ok=True)
    destination = ACTIONS_DIR / f"archer_{action}{suffix}.png"
    sheet.save(destination, optimize=True)
    return {"path": str(destination.relative_to(REPO)), "size": list(sheet.size)}


def pack_body(size: tuple[int, int], written: dict, write: bool) -> None:
    """The shipped layer: luminance-matched onto the infantry's ground line."""
    gamma = luminance_gamma(build_sheet("walk", size))
    print(f"luminance gamma {gamma:.3f}")
    for action in FRAME_COUNTS:
        if not (FRAMES / action).is_dir():
            print(f"skip {action}: no frames rendered")
            continue
        sheet = apply_gamma(build_sheet(action, size), gamma)
        soles = measure_sole_rows(sheet, size)
        spread = max(soles) - min(soles)
        if spread > ROW_SPREAD_TOLERANCE:
            raise SystemExit(
                f"{action}: rows disagree by {spread} px on the sole row; "
                "re-render the outlier row with the same ground margin"
            )
        print(
            f"{action}: sole rows {min(soles)}-{max(soles)} (camera ground line "
            f"{GROUND_LINE_ROW}), {sheet.size[0]}x{sheet.size[1]}"
        )
        written[action] = publish(sheet, action, "", action, write)


def pack_accent(size: tuple[int, int], written: dict, write: bool) -> None:
    """The team-colour layer, packed as rendered.

    The body sheets are gamma-lifted onto the pack's median luma, which would
    darken every team colour if it were applied here: this layer is read through
    a multiply.
    """
    print("packing the team-colour layer (no luminance match)")
    for action in FRAME_COUNTS:
        if not (ACCENT_FRAMES / action).is_dir():
            print(f"skip {action}: no frames rendered")
            continue
        sheet = build_sheet(action, size, ACCENT_FRAMES)
        coverage = check_accent(sheet, action)
        print(f"{action}: accent covers {coverage:.1%} of the sheet, {sheet.size[0]}x{sheet.size[1]}")
        written[action] = publish(sheet, action, "_accent", f"{action}_accent", write)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="publish into the client assets")
    parser.add_argument("--cell", type=int, default=CELL_SIZE[0])
    parser.add_argument(
        "--accent",
        action="store_true",
        help="pack the team-colour mask layer instead of the body",
    )
    args = parser.parse_args()
    size = (args.cell, round(args.cell * CELL_SIZE[1] / CELL_SIZE[0]))

    written: dict = {}
    if args.accent:
        pack_accent(size, written, args.write)
    else:
        pack_body(size, written, args.write)
    if written:
        (PREVIEW_DIR / "archer_written.json").write_text(json.dumps(written, indent=2))


if __name__ == "__main__":
    main()

"""Stitch the rendered team-colour frames into Phaser sheets.

``scripts/blender_bake_sheet.py`` writes one PNG per (direction, action, frame,
layer) at 2x the cell size. This script downsamples them and lays them out as the
two grids the client loads - one row per compass direction, one column per frame,
in ``unitDirections.ts`` row order - for both layers:

    spearman_<action>.png          body
    spearman_<action>_accent.png   accent (grayscale, alpha = surcoat only)

Downsampling is done on premultiplied alpha: resizing straight RGBA bleeds the
black of the transparent pixels into the silhouette and leaves a dark halo, which
at 83 px is a visible outline.

Usage:
    python3 scripts/pack_team_sheets.py
    python3 scripts/pack_team_sheets.py --check
    python3 scripts/pack_team_sheets.py --preview scripts/out/team_preview.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
RENDER_DIR = REPO_ROOT / "scripts" / "out" / "team_render"
SHEET_DIR = REPO_ROOT / "apps" / "client" / "public" / "assets" / "units" / "actions"

#: Source model / target unit. The soldier replaces the spearman sheet; the cell
#: and the frame counts are `UNIT_ART.SPEARMAN`'s (D6).
MODEL = "linh"
UNIT = "spearman"

CELL_WIDTH = 192
CELL_HEIGHT = 168
DIRECTIONS = ("E", "SE", "S", "SW", "W", "NW", "N", "NE")
#: Mirrors ``UNIT_ART.SPEARMAN.actions``. The vitest sheet test is the gate that
#: keeps this and ``unitArt.ts`` in step; this copy only drives ``--check``.
EXPECTED_FRAMES = {"idle": 4, "walk": 11, "attack": 10, "death": 8}


def frame_file(action: str, direction: str, index: int, layer: str) -> Path:
    return RENDER_DIR / f"{MODEL}_{direction}_{action}_{index:02d}_{layer}.png"


def downsample(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """LANCZOS resize in premultiplied alpha, so edges do not pick up black."""
    data = np.asarray(image.convert("RGBA")).astype(np.float32) / 255.0
    alpha = data[:, :, 3:4]
    premultiplied = np.concatenate([data[:, :, :3] * alpha, alpha], axis=2)

    channels = [
        np.asarray(
            Image.fromarray(premultiplied[:, :, index], mode="F").resize(size, Image.LANCZOS)
        )
        for index in range(4)
    ]
    stacked = np.stack(channels, axis=2)
    alpha_out = np.clip(stacked[:, :, 3:4], 0.0, 1.0)
    rgb = np.clip(stacked[:, :, :3] / np.maximum(alpha_out, 1e-4), 0.0, 1.0)
    merged = np.concatenate([rgb, alpha_out], axis=2)
    return Image.fromarray((merged * 255.0).round().astype(np.uint8), "RGBA")


def build_sheet(action: str, layer: str) -> Image.Image:
    frames = EXPECTED_FRAMES[action]
    sheet = Image.new(
        "RGBA", (CELL_WIDTH * frames, CELL_HEIGHT * len(DIRECTIONS)), (0, 0, 0, 0)
    )
    for row, direction in enumerate(DIRECTIONS):
        for index in range(frames):
            source = frame_file(action, direction, index, layer)
            if not source.exists():
                raise SystemExit(f"missing render {source}")
            cell = downsample(Image.open(source), (CELL_WIDTH, CELL_HEIGHT))
            sheet.paste(cell, (index * CELL_WIDTH, row * CELL_HEIGHT))
    return sheet


def sheet_path(action: str, layer: str) -> Path:
    suffix = "" if layer == "body" else "_accent"
    return SHEET_DIR / f"{UNIT}_{action}{suffix}.png"


def pack() -> int:
    for action in EXPECTED_FRAMES:
        for layer in ("body", "accent"):
            sheet = build_sheet(action, layer)
            target = sheet_path(action, layer)
            sheet.save(target, optimize=True)
            print(f"wrote {target.relative_to(REPO_ROOT)} {sheet.width}x{sheet.height}")
    return 0


#: D5 quality window for the accent layer, in display values. The floor keeps a
#: dark team colour out of near-black; the spread is what carries the folds, and a
#: flat accent reads as a sticker. The window is 0.25 wide, so a spread under 0.15
#: means the ramp collapsed - which is exactly what an emission written in linear
#: light while tuned in display values does (it shipped 0.11 before this gate).
ACCENT_FLOOR_MIN = 0.70
ACCENT_SPREAD_MIN = 0.15


def check() -> int:
    """Validate the sheets on disk against the cell, the frame table and D5."""
    failures: list[str] = []
    for action, frames in EXPECTED_FRAMES.items():
        for layer in ("body", "accent"):
            path = sheet_path(action, layer)
            if not path.exists():
                failures.append(f"missing {path.name}")
                continue
            with Image.open(path) as image:
                width, height = image.size
                accent = None if layer == "body" else np.asarray(image.convert("RGBA"))
            expected_width = CELL_WIDTH * frames
            expected_height = CELL_HEIGHT * len(DIRECTIONS)
            if (width, height) != (expected_width, expected_height):
                failures.append(
                    f"{path.name}: {width}x{height}, expected {expected_width}x{expected_height}"
                )
                continue
            if accent is not None:
                covered = accent[:, :, 3] > 200
                if covered.sum() == 0:
                    failures.append(f"{path.name}: accent layer is empty")
                    continue
                luminance = accent[covered][:, :3].mean(axis=1) / 255.0
                floor = float(np.percentile(luminance, 2))
                spread = float(np.percentile(luminance, 98) - floor)
                if floor < ACCENT_FLOOR_MIN:
                    failures.append(
                        f"{path.name}: accent floor {floor:.2f} < {ACCENT_FLOOR_MIN} "
                        "(a dark team colour would go black here)"
                    )
                if spread < ACCENT_SPREAD_MIN:
                    failures.append(
                        f"{path.name}: accent spread {spread:.2f} < {ACCENT_SPREAD_MIN} "
                        "(flat layer - the fold shading is gone)"
                    )

    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print(f"OK {len(EXPECTED_FRAMES) * 2} sheets match the {CELL_WIDTH}x{CELL_HEIGHT} cell")
    return 0


#: Colour the preview tints the accent with, so the two layers are told apart from
#: the body's own art while reviewing.
PREVIEW_TINT = (0.95, 0.25, 0.25)


def preview(path: Path) -> int:
    """Every action on grass: body with its accent tinted, the way the client draws it."""
    tiles = []
    for action in EXPECTED_FRAMES:
        body = Image.open(sheet_path(action, "body")).convert("RGBA")
        accent = np.asarray(Image.open(sheet_path(action, "accent")).convert("RGBA"), dtype=float)
        for channel, gain in enumerate(PREVIEW_TINT):
            accent[:, :, channel] *= gain
        composed = body.copy()
        composed.alpha_composite(
            Image.fromarray(accent.clip(0, 255).astype(np.uint8), "RGBA")
        )
        tiles.append(composed)
    width = max(tile.width for tile in tiles)
    height = sum(tile.height for tile in tiles)
    sheet = Image.new("RGBA", (width, height), (122, 146, 96, 255))
    top = 0
    for tile in tiles:
        sheet.alpha_composite(tile, (0, top))
        top += tile.height
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    print(f"wrote {path}")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate the sheets on disk")
    parser.add_argument("--preview", type=Path, help="write a contact sheet of every action")
    args = parser.parse_args(argv)
    if args.check:
        return check()
    if args.preview:
        return preview(args.preview)
    return pack()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

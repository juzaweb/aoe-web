"""Compose a scale check: the two Blender-rendered units beside the pack's art.

Draws one frame of each unit at the exact `unitArt.ts` geometry (cell size,
scale, offsetY) on a grass patch, in two rows: facing the viewer (S) and in
profile (E). This is how the mounted knight and the archer are judged against
the infantry they fight alongside, instead of in isolation.

Usage: python3 scripts/blender/preview_in_game.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent.parent
UNITS = REPO / "apps" / "client" / "public" / "assets" / "units"
TERRAIN = REPO / "apps" / "client" / "public" / "assets" / "terrain"
OUT = Path(__file__).resolve().parent / "out" / "scale_check.png"

TILE_W, TILE_H = 128, 64
ZOOM = 2
COLUMN_SPACING = 260

# label, sheet, cell, scale, offsetY
UNITS_TO_DRAW = [
    ("VILLAGER", "villager_walk.png", (148, 130), 0.92, -38),
    ("SPEARMAN", "spearman_walk.png", (192, 168), 0.95, -58),
    ("ARCHER", "archer_walk.png", (192, 168), 0.95, -58),
    ("CAVALRY", "cavalry_walk.png", (224, 224), 0.9, -79),
    ("CATAPULT", "catapult_walk.png", (224, 208), 0.95, -78),
]
# Direction rows: 2 = S (toward the viewer), 0 = E (screen right).
ROWS = [("S", 2, 250), ("E", 0, 520)]


def grass_patch(width: int, height: int) -> Image.Image:
    tile = Image.open(TERRAIN / "grass.png").convert("RGBA")
    base = Image.new("RGBA", (width, height), (70, 92, 48, 255))
    for row in range(-1, height // (TILE_H // 2) + 2):
        for col in range(-1, width // TILE_W + 2):
            x = col * TILE_W + (TILE_W // 2 if row % 2 else 0)
            y = row * (TILE_H // 2)
            base.alpha_composite(tile, (x, y))
    return base


def main() -> None:
    canvas = grass_patch(1400, 640)
    for _, direction_row, ground in ROWS:
        for index, (_, name, cell, scale, offset_y) in enumerate(UNITS_TO_DRAW):
            sheet = Image.open(UNITS / "actions" / name).convert("RGBA")
            cw, ch = cell
            frame = sheet.crop((0, direction_row * ch, cw, (direction_row + 1) * ch))
            drawn = frame.resize((round(cw * scale), round(ch * scale)), Image.Resampling.LANCZOS)
            x = 100 + index * COLUMN_SPACING
            canvas.alpha_composite(
                drawn,
                (round(x - drawn.width / 2), round(ground + offset_y - drawn.height / 2)),
            )
    canvas = canvas.resize((canvas.width * ZOOM, canvas.height * ZOOM), Image.Resampling.LANCZOS)
    canvas.save(OUT)
    print(f"wrote {OUT} {canvas.size}")


if __name__ == "__main__":
    main()

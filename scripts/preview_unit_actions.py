"""Compose a preview of a unit action sheet on grass, for eyeballing alignment.

Draws the sheet's eight direction rows over the game's grass tile at the sheet's
native frame size, once at 1x and once at the in-game minimum zoom, so drift in
the anchor or a scale mismatch between rows shows up immediately.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GRASS = ROOT / "apps" / "client" / "public" / "assets" / "terrain" / "grass.png"

DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
FRAMES = 4


def load_grass(size: tuple[int, int]) -> Image.Image:
    with Image.open(GRASS) as tile:
        tile = tile.convert("RGB")
        grid = Image.new("RGB", size)
        for y in range(0, size[1], tile.height):
            for x in range(0, size[0], tile.width):
                grid.paste(tile, (x, y))
        return grid


def render(sheet_path: Path, out_path: Path, zoom: float, scale_up: int) -> None:
    with Image.open(sheet_path) as sheet:
        frame_size = sheet.height // len(DIRECTIONS)
        width, height = sheet.width, sheet.height
        canvas = load_grass((max(1, round(width * zoom)), max(1, round(height * zoom))))
        shrunk = sheet.resize((canvas.width, canvas.height), Image.Resampling.LANCZOS)
        canvas.paste(shrunk, (0, 0), shrunk)
        if scale_up > 1:
            canvas = canvas.resize(
                (canvas.width * scale_up, canvas.height * scale_up), Image.Resampling.NEAREST
            )
        canvas.save(out_path)
        print(f"{out_path} zoom={zoom} frame={frame_size}px")


if __name__ == "__main__":
    sheet = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    render(sheet, out_dir / f"{sheet.stem}_1x.png", 1.0, 1)
    render(sheet, out_dir / f"{sheet.stem}_zoom04.png", 0.4, 2)

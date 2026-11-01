"""Build a large preview sheet for cursor PNGs so they can be eyeballed."""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CURSOR_DIR = ROOT / "apps" / "client" / "public" / "assets" / "cursors"
GRASS = ROOT / "apps" / "client" / "public" / "assets" / "terrain" / "grass.png"

SCALE = 8
PAD = 12


def main(names: list[str]) -> int:
    icons = []
    for name in names:
        path = CURSOR_DIR / f"{name}.png"
        if not path.exists():
            print(f"missing: {name}")
            continue
        icons.append((name, Image.open(path).convert("RGBA")))
    if not icons:
        return 1

    cell = 32 * SCALE
    width = (cell + PAD) * len(icons) + PAD
    sheet = Image.new("RGBA", (width, cell + 2 * PAD), (60, 90, 45, 255))

    # Grass tile backdrop to judge contrast at real scale.
    if GRASS.exists():
        grass = Image.open(GRASS).convert("RGBA")
        for row in range(0, sheet.height, grass.height):
            for col in range(0, sheet.width, grass.width):
                sheet.alpha_composite(grass, (col, row))

    for idx, (name, icon) in enumerate(icons):
        big = icon.resize((cell, cell), Image.Resampling.NEAREST)
        x = PAD + idx * (cell + PAD)
        sheet.alpha_composite(big, (x, PAD))
        print(f"{name}: {icon.size}")

    out = ROOT / "scripts" / "raw_downloads" / "cursors" / "_preview.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"preview: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["default"]))

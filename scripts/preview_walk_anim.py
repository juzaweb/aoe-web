"""Render the procedural walk at in-game size, as a still strip and an animated GIF.

A contact sheet of four nearly-identical poses is a poor way to judge a walk: the
eye resolves motion from frame-to-frame change at playback speed, not from four
stills. This script downsamples the frames to the height the client actually draws
them at (``visualScale`` 0.72 of the 128 px sheet, so roughly 65 px for a figure
91 px tall) and writes both a still strip and a looping GIF at the action's frame
rate.

    python scripts/preview_walk_anim.py SPEARMAN --direction E --amp 0.22
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_walk_from_idle import (  # noqa: E402
    ACTIONS_DIR,
    DIRECTIONS,
    FRAME_SIZE,
    STAGING_DIR,
    build_row,
    load_row,
)
from PIL import Image  # noqa: E402

# Supersampling factor applied after the downscale so the GIF is watchable
# without copying the client's own zoom level.
ZOOM = 4
GAME_SCALE = 0.72
FRAME_RATE = 8


def to_game_size(frame: Image.Image, height: int) -> Image.Image:
    box = frame.getbbox()
    if not box:
        return Image.new("RGBA", (height, height), (0, 0, 0, 0))
    figure = frame.crop(box)
    ratio = height / figure.height
    scaled = figure.resize(
        (max(1, round(figure.width * ratio)), height),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (scaled.width + 8, height + 8), (0, 0, 0, 0))
    # A contact shadow keeps the feet readable against the ground.
    shadow = Image.new("RGBA", (scaled.width, 4), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, (4, 4))
    canvas.alpha_composite(shadow, (4, height + 2))
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unit", nargs="?", default="SPEARMAN")
    parser.add_argument("--direction", default="E")
    parser.add_argument("--amp", type=float, default=0.22)
    parser.add_argument("--height", type=int, default=0, help="figure height in game px; 0 = from the sheet")
    args = parser.parse_args()

    frame_size = FRAME_SIZE[args.unit.upper()]
    idle_sheet = Image.open(ACTIONS_DIR / f"{args.unit.lower()}_idle.png").convert("RGBA")
    base = load_row(idle_sheet, DIRECTIONS.index(args.direction), frame_size)
    frames = build_row(base, args.direction, args.amp)

    height = args.height
    if not height:
        box = base.getbbox() or (0, 0, frame_size, frame_size)
        height = max(1, round((box[3] - box[1]) * GAME_SCALE))

    cells = [to_game_size(frame, height) for frame in frames]
    width = max(cell.width for cell in cells)
    strip = Image.new("RGBA", (width * len(cells), height + 8), (255, 255, 255, 0))
    for index, cell in enumerate(cells):
        strip.alpha_composite(cell, (index * width, 0))

    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    prefix = f"walk_anim_{args.unit.lower()}_{args.direction}"
    strip_path = STAGING_DIR / f"{prefix}_strip.png"
    strip.resize((strip.width * ZOOM, strip.height * ZOOM), Image.Resampling.NEAREST).save(strip_path)

    background = Image.new("RGBA", strip.size, (107, 143, 63, 255))
    background.alpha_composite(strip)
    gif_frames = [
        background.crop((index * width, 0, (index + 1) * width, height + 8))
        .resize(((width) * ZOOM, (height + 8) * ZOOM), Image.Resampling.NEAREST)
        .convert("P", palette=Image.Palette.ADAPTIVE)
        for index in range(len(cells))
    ]
    gif_path = STAGING_DIR / f"{prefix}.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(1000 / FRAME_RATE),
        loop=0,
        disposal=2,
    )

    print(f"{args.unit} {args.direction}: figure {height} px tall on screen, amp {args.amp:.2f}")
    print(f"  strip {strip_path}")
    print(f"  gif   {gif_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

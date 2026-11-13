#!/usr/bin/env python3
"""Turn the Canva-drawn arrow into the client's projectile sprite.

Usage:
    python scripts/process_arrow_asset.py --source /path/to/arrow-export.png
    python scripts/process_arrow_asset.py --check    # CI gate, no source

The arrow is project-original art drawn in Canva (design `DAHawq00igA`), not a
third-party download: it is deliberately absent from
`scripts/assets/manifest.json` and `assets.lock.json`, which exist to pin OGA
downloads to their upstream URL and license. `--check` is what keeps it honest
instead of a hash: it re-measures the shipped PNG, so the art can be regenerated
from a new Canva export without rewriting a lock.

Pipeline:

    flat green backdrop -> chroma key -> despill the edge pixels -> trim to the
    alpha bounds -> premultiplied LANCZOS resize to 160 px wide -> 2 px
    transparent border -> RGBA PNG

The Canva export paints the arrow pointing right on a flat, saturated green
field. The key is a soft ramp on the RGB distance to the sampled backdrop colour
rather than a hard "green = transparent" test: the feathers and the steel head
carry a green cast on their antialiased edges, and a hard cut would leave a
jagged, haloed silhouette that shimmers once the sprite is rotated in game.

The shipped sprite is 160 px wide and the client draws it at 46 px
(`ARROW_LENGTH_PX` in `projectiles.ts`), i.e. ~3.5x downscale, so the arrow stays
crisp on a high-DPI display without shipping a 1080 px texture for a 0.4 s
effect.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path("apps/client/public/assets/fx/arrow.png")

#: Width the shipped sprite is scaled to, in pixels.
SPRITE_WIDTH = 160

#: Transparent margin around the arrow, so a rotated sprite never clips.
PAD = 2

#: Ramp of the alpha key, in RGB distance from the backdrop colour. Below `LO`
#: a pixel is backdrop, above `HI` it is solid arrow; between the two it is
#: antialiasing. Measured on the Canva export: its flat green field is not
#: perfectly uniform (a soft gradient puts it 25-31 away from the median corner
#: colour), while the arrow never comes closer than ~71. The ramp sits between
#: those two populations, with room for the antialiased edge.
KEY_LO = 45.0
KEY_HI = 88.0

#: How far the green channel may exceed the red/blue average before it is pulled
#: back on the transparent edges. The arrow has no genuinely green pigment, so
#: any excess there is spill from the backdrop.
DESPILL_MARGIN = 10.0

#: Alpha below which a pixel does not count as artwork when trimming.
TRIM_ALPHA = 8


def _background_colour(rgb: np.ndarray) -> np.ndarray:
    """Median colour of the four corners: the flat field the arrow sits on."""
    height, width, _ = rgb.shape
    corners = np.stack(
        [rgb[0, 0], rgb[0, width - 1], rgb[height - 1, 0], rgb[height - 1, width - 1]]
    )
    return np.median(corners, axis=0)


def despill(rgb: np.ndarray) -> np.ndarray:
    """Pull the green channel back to the red/blue average.

    The artwork has no green pigment at all (warm wood, neutral steel, white
    feathers), so any green above the red/blue average is backdrop spill wherever
    it appears — including the antialiased rim, where leaving it in produces a
    halo once the sprite is rotated against the grass. Applied twice: once on the
    keyed source, and once after the premultiplied resize, whose unpremultiply
    step can push a channel back up to 255 on the soft edge.
    """
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    neutral = (red + blue) / 2.0
    excess = np.clip(green - neutral - DESPILL_MARGIN, 0.0, None)
    out = rgb.copy()
    out[..., 1] = np.clip(green - excess, 0.0, 255.0)
    return out


def key_out_background(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split a flat-backdrop render into straight-alpha colour and alpha."""
    backdrop = _background_colour(rgb)
    distance = np.sqrt(((rgb - backdrop) ** 2).sum(axis=-1))
    alpha = np.clip((distance - KEY_LO) / (KEY_HI - KEY_LO), 0.0, 1.0)

    return despill(colour := rgb.copy()), alpha


def _premultiplied_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize RGBA without letting the transparent pixels bleed into the edges."""
    array = np.asarray(image).astype(np.float32)
    alpha = array[..., 3:4] / 255.0
    premultiplied = np.concatenate([array[..., :3] * alpha, array[..., 3:4]], axis=-1)
    resized = np.asarray(
        Image.fromarray(premultiplied.astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)
    ).astype(np.float32)

    alpha = resized[..., 3:4] / 255.0
    with np.errstate(divide="ignore", invalid="ignore"):
        straight = np.where(alpha > 0.0, resized[..., :3] / np.maximum(alpha, 1e-6), 0.0)
    result = np.concatenate([np.clip(straight, 0.0, 255.0), resized[..., 3:4]], axis=-1)
    return Image.fromarray(result.astype(np.uint8), "RGBA")


def _trim(image: Image.Image) -> Image.Image:
    """Crop to the alpha bounds, or fail loudly when the key produced nothing."""
    alpha = np.asarray(image)[..., 3]
    rows = np.where(alpha.max(axis=1) > TRIM_ALPHA)[0]
    columns = np.where(alpha.max(axis=0) > TRIM_ALPHA)[0]
    if rows.size == 0 or columns.size == 0:
        raise SystemExit("the chroma key removed every pixel: check the source export")
    return image.crop(
        (int(columns[0]), int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1)
    )


def build(source: Path, out: Path) -> dict[str, object]:
    """Key, trim, scale and write the sprite. Returns the measured report."""
    rgb = np.asarray(Image.open(source).convert("RGB")).astype(np.float32)
    colour, alpha = key_out_background(rgb)

    rgba = np.concatenate([colour, (alpha * 255.0)[..., None]], axis=-1)
    keyed = Image.fromarray(rgba.astype(np.uint8), "RGBA")
    trimmed = _trim(keyed)

    scale = SPRITE_WIDTH / trimmed.width
    height = max(1, round(trimmed.height * scale))
    scaled = _premultiplied_resize(trimmed, (SPRITE_WIDTH, height))
    # The unpremultiply inside the resize can lift a soft edge channel back to
    # 255, so the rim is despilled once more on the final pixels.
    scaled_array = np.asarray(scaled).astype(np.float32)
    scaled = Image.fromarray(
        np.concatenate(
            [despill(scaled_array[..., :3]), scaled_array[..., 3:4]], axis=-1
        ).astype(np.uint8),
        "RGBA",
    )

    canvas = Image.new("RGBA", (SPRITE_WIDTH + PAD * 2, height + PAD * 2), (0, 0, 0, 0))
    canvas.paste(scaled, (PAD, PAD))

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)

    return {
        "source": str(source),
        "out": str(out),
        "size": canvas.size,
        "trimmed": trimmed.size,
        "bytes": out.stat().st_size,
    }


def check(out: Path = OUT) -> None:
    """Re-measure the shipped sprite, the way `--check` gates the other assets."""
    if not out.exists():
        raise SystemExit(f"missing {out}")
    image = Image.open(out)
    if image.mode != "RGBA":
        raise SystemExit(f"{out} is {image.mode}, expected RGBA")

    array = np.asarray(image).astype(np.int16)
    alpha = array[..., 3]
    if image.width != SPRITE_WIDTH + PAD * 2:
        raise SystemExit(f"{out} is {image.width} px wide, expected {SPRITE_WIDTH + PAD * 2}")

    # The border must be fully transparent, or the sprite shows a rectangle of
    # leftover backdrop when it is rotated.
    border = np.concatenate(
        [alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]]
    )
    if border.max() > 0:
        raise SystemExit(f"{out} has opaque pixels on its border")

    if alpha.max() < 200:
        raise SystemExit(f"{out} has no solid artwork")

    # A surviving green cast means the key failed on this export.
    visible = alpha > 32
    red, green, blue = array[..., 0], array[..., 1], array[..., 2]
    greenish = visible & (green > (red + blue) / 2 + 24)
    if greenish.any():
        raise SystemExit(f"{out} still has {int(greenish.sum())} green-fringed pixels")

    print(f"ok {out} {image.size} alpha={int(alpha.max())} solid={int((alpha > 200).sum())}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Canva PNG export of the arrow")
    parser.add_argument("--out", type=Path, default=OUT, help=f"shipped sprite (default {OUT})")
    parser.add_argument("--check", action="store_true", help="verify the shipped sprite only")
    arguments = parser.parse_args()

    if arguments.check:
        check(arguments.out)
        return 0

    if arguments.source is None:
        parser.error("--source is required unless --check is used")

    report = build(arguments.source, arguments.out)
    for key, value in report.items():
        print(f"{key}: {value}")
    check(arguments.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

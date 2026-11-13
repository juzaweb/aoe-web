"""Cut the team-colour accent layer out of the painted building sprites.

The buildings are 2D art (no model to re-render), so the accent layer that the
runtime tints with the owner's colour has to be derived from the PNG itself: one
mask per building, cut from the same pixels, keeping their shading. TEAM-30 in
``docs/plans/31-team-color-buildings.md``.

What gets the colour
--------------------
Per building, a hand-picked region - the roof for most of them, the banners on
the gate and the castle, the hut roof on a field. The region is a polygon in
normalized art coordinates, intersected with the sprite's own alpha, so the mask
never spills onto the grass and never needs to trace the silhouette by hand: a
slanted roof only needs its outline drawn, the alpha does the rest.

Each mask is then written as a grayscale accent layer:

* RGB = the region's own luminance, remapped into ``LUMINANCE_MIN..LUMINANCE_MAX``
  (display values, the same window as the unit accent). The runtime multiplies it
  by the team colour, so the shading - roof tiles, folds, banner creases -
  survives while the hue is replaced.
* A = the mask, antialiased by drawing it 4x and downsampling.

Usage:
    python3 scripts/build_building_accent_masks.py
    python3 scripts/build_building_accent_masks.py --check
    python3 scripts/build_building_accent_masks.py --preview /tmp/buildings.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
ART_DIR = REPO_ROOT / "apps" / "client" / "public" / "assets" / "buildings"

#: Supersampling factor for the mask outline. Roof eaves are diagonals, so a
#: 1x mask leaves them stair-stepped once the sprite is drawn at 1.5x on screen.
SUPERSAMPLE = 4

#: Accent brightness window, in display values - the same one the unit accent
#: uses (D5 of phase 30). Below ~0.75 a dark team colour reads as black.
LUMINANCE_MIN = 0.76
LUMINANCE_MAX = 1.00
#: Percentiles the region's own luminance is stretched across that window, so one
#: very dark or very bright pixel cannot flatten the whole roof.
LOW_PERCENTILE = 2.0
HIGH_PERCENTILE = 98.0

Point = tuple[float, float]

#: What gets the team colour, per building. A spec may carry:
#:
#: ``regions``  polygons in normalized art coordinates (0..1, y down). Only the
#:              outline has to be right - the sprite's alpha trims whatever part
#:              reaches past the art, which is what makes a rough quad enough for
#:              a roof whose eaves are already the silhouette.
#: ``hue``      ``(low, high, saturation_min, value_min)``: keep only pixels of
#:              that colour. For the two buildings whose accent is dyed cloth
#:              rather than a roof, this is what separates the banner from the
#:              stone behind it. Combined with ``regions`` it is an intersection;
#:              on its own it scans the whole sprite.
#:
#: A building with no spec fails the build instead of silently getting no colour.
ACCENT_SPECS: dict[str, dict] = {
    # Stone cottage: one gabled roof over the whole footprint.
    "house": {
        "regions": [[(0.04, 0.42), (0.28, 0.10), (0.87, 0.44), (0.52, 0.63)]]
    },
    # Water mill: the slate roof of the tower; the wheel and the race keep theirs.
    "mill": {
        "regions": [[(0.44, 0.31), (0.57, 0.17), (0.88, 0.33), (0.76, 0.47)]]
    },
    # Lumber camp: the shingled roof of the open-sided shed.
    "lumber_camp": {
        "regions": [[(0.03, 0.28), (0.22, 0.06), (0.75, 0.36), (0.55, 0.52)]]
    },
    # Mining camp: the small pitched roof over the mine entrance.
    "mining_camp": {
        "regions": [[(0.33, 0.50), (0.44, 0.43), (0.63, 0.54), (0.52, 0.62)]]
    },
    # Farm: the thatched roof of the field hut; the crops stay their own colour.
    "farm": {
        "regions": [[(0.62, 0.34), (0.68, 0.28), (0.79, 0.36), (0.73, 0.43)]]
    },
    # Watch tower: the conical roof, which the sprite's silhouette already bounds.
    "tower": {
        "regions": [[(0.24, 0.30), (0.50, 0.02), (0.76, 0.30)]]
    },
    # Siege workshop: the big shingle roof, plus the lean-to on its right.
    "siege_workshop": {
        "regions": [
            [(0.10, 0.42), (0.30, 0.13), (0.76, 0.45), (0.55, 0.62)],
            [(0.72, 0.50), (0.83, 0.38), (0.96, 0.50), (0.85, 0.60)],
        ]
    },
    # Barracks: three roof masses - the three-gabled manor, and one hip roof on
    # each of the two courtyard towers. The manor needs its whole silhouette
    # traced because the gable peaks step, and the eave runs down to the right
    # at a shallower angle than the ridge above it.
    "barracks": {
        "regions": [
            [
                (0.405, 0.250),
                (0.400, 0.170),
                (0.432, 0.120),
                (0.468, 0.052),
                (0.487, 0.014),
                (0.548, 0.040),
                (0.612, 0.083),
                (0.662, 0.055),
                (0.702, 0.106),
                (0.762, 0.136),
                (0.802, 0.156),
                (0.880, 0.181),
                (0.932, 0.216),
                (0.985, 0.262),
                (0.995, 0.322),
                (0.930, 0.455),
            ],
            [(0.098, 0.446), (0.236, 0.370), (0.352, 0.442), (0.195, 0.500)],
            [(0.338, 0.662), (0.500, 0.572), (0.632, 0.648), (0.455, 0.720)],
        ]
    },
    # Archery range: the tower roof and the covered shed along the butts.
    "archery_range": {
        "regions": [
            [(0.60, 0.38), (0.72, 0.24), (0.86, 0.40), (0.74, 0.52)],
            [(0.08, 0.36), (0.20, 0.28), (0.45, 0.44), (0.32, 0.52)],
        ]
    },
    # Stable: the upper gable, the left wing and the right wing.
    "stable": {
        "regions": [
            [(0.30, 0.24), (0.42, 0.05), (0.63, 0.25), (0.50, 0.40)],
            [(0.02, 0.50), (0.14, 0.33), (0.32, 0.48), (0.19, 0.62)],
            [(0.55, 0.44), (0.67, 0.31), (0.87, 0.46), (0.74, 0.58)],
        ]
    },
    # The gate already hangs two dyed banners; a generous box around each plus the
    # hue window picks the cloth and leaves the stone alone.
    "portal": {
        "regions": [
            [(0.08, 0.41), (0.22, 0.41), (0.22, 0.66), (0.08, 0.66)],
            [(0.68, 0.54), (0.81, 0.54), (0.81, 0.76), (0.68, 0.76)],
        ],
        "hue": (200.0, 300.0, 0.15, 0.15),
    },
    # The castle carries a dozen small blue banners and shields; scanning the hue
    # is far cleaner than tracing each one.
    "town_center": {"hue": (180.0, 245.0, 0.45, 0.15)},
}


def polygon_mask(size: tuple[int, int], polygons: list[list[Point]]) -> Image.Image:
    """Antialiased union of `polygons`, drawn 4x and downsampled."""
    width, height = size
    big = Image.new("L", (width * SUPERSAMPLE, height * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(big)
    for polygon in polygons:
        draw.polygon(
            [(x * width * SUPERSAMPLE, y * height * SUPERSAMPLE) for x, y in polygon],
            fill=255,
        )
    return big.resize(size, Image.LANCZOS)


def hue_mask(art: Image.Image, window: tuple[float, float, float, float]) -> Image.Image:
    """Mask of the pixels inside a ``(low, high, saturation_min, value_min)`` window."""
    low_hue, high_hue, saturation_min, value_min = window
    rgb = np.asarray(art.convert("RGB"), dtype=np.float32) / 255.0
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    delta = np.maximum(maximum - minimum, 1e-6)
    saturation = np.where(maximum > 0, (maximum - minimum) / np.maximum(maximum, 1e-6), 0.0)
    hue = np.where(
        maximum == b,
        60.0 * (4.0 + (r - g) / delta),
        np.where(maximum == g, 60.0 * (2.0 + (b - r) / delta), 60.0 * ((g - b) / delta)),
    ) % 360.0

    keep = (
        (hue >= low_hue)
        & (hue <= high_hue)
        & (saturation >= saturation_min)
        & (maximum >= value_min)
    )
    mask = Image.fromarray((keep * 255).astype(np.uint8), "L")
    # The hue test is per pixel and therefore hard-edged; a blur keeps the cloth
    # edge from aliasing against the wall behind it.
    return mask.filter(ImageFilter.GaussianBlur(0.8))


def region_for(stem: str, art: Image.Image) -> Image.Image:
    """Accent region of one building: its polygons, its hue window, or both."""
    spec = ACCENT_SPECS.get(stem)
    if spec is None:
        raise SystemExit(f"{stem}: no accent spec - add an entry to ACCENT_SPECS")

    region: Image.Image | None = None
    if "regions" in spec:
        region = polygon_mask(art.size, spec["regions"])
    if "hue" in spec:
        hue = hue_mask(art, spec["hue"])
        if region is None:
            region = hue
        else:
            region = Image.fromarray(
                np.minimum(np.asarray(region), np.asarray(hue)).astype(np.uint8), "L"
            )
    if region is None:
        raise SystemExit(f"{stem}: accent spec has neither regions nor hue")
    return region


def build_accent(stem: str) -> Image.Image:
    """Grayscale accent layer for one building, alpha = its accent region."""
    art = Image.open(ART_DIR / f"{stem}.png").convert("RGBA")

    region = region_for(stem, art)

    alpha = np.minimum(np.asarray(region, dtype=np.float32), np.asarray(art)[:, :, 3].astype(np.float32))
    covered = alpha > 8
    if not covered.any():
        raise SystemExit(f"{stem}: accent region is empty")

    rgb = np.asarray(art.convert("RGB"), dtype=np.float32) / 255.0
    luminance = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    low = float(np.percentile(luminance[covered], LOW_PERCENTILE))
    high = float(np.percentile(luminance[covered], HIGH_PERCENTILE))
    spread = max(high - low, 1e-3)
    stretched = np.clip((luminance - low) / spread, 0.0, 1.0)
    value = LUMINANCE_MIN + stretched * (LUMINANCE_MAX - LUMINANCE_MIN)
    grey = (value * 255.0).round().astype(np.uint8)

    accent = np.dstack([grey, grey, grey, alpha.round().astype(np.uint8)])
    return Image.fromarray(accent, "RGBA")


def accent_path(stem: str) -> Path:
    return ART_DIR / f"{stem}_accent.png"


def build_all() -> int:
    for stem in sorted({path.stem for path in ART_DIR.glob("*.png") if not path.stem.endswith("_accent")}):
        accent = build_accent(stem)
        accent.save(accent_path(stem), optimize=True)
        covered = float((np.asarray(accent)[:, :, 3] > 8).mean())
        print(f"wrote {accent_path(stem).name} {accent.width}x{accent.height} ({covered:.1%} accent)")
    return 0


def check() -> int:
    """Gate: same canvas as the art, a real region, and the D5 brightness window."""
    failures: list[str] = []
    stems = sorted({path.stem for path in ART_DIR.glob("*.png") if not path.stem.endswith("_accent")})
    for stem in stems:
        art_path = ART_DIR / f"{stem}.png"
        accent = accent_path(stem)
        if not accent.exists():
            failures.append(f"missing {accent.name}")
            continue
        with Image.open(art_path) as art, Image.open(accent) as mask:
            art_size, mask_size = art.size, mask.size
            data = np.asarray(mask.convert("RGBA"))
        if mask_size != art_size:
            failures.append(f"{accent.name}: {mask_size} != art {art_size}")
            continue
        coverage = float((data[:, :, 3] > 8).mean())
        if coverage < 0.004:
            failures.append(f"{accent.name}: accent covers only {coverage:.2%} of the canvas")
        if coverage > 0.60:
            failures.append(f"{accent.name}: accent covers {coverage:.0%} - that is the whole building")
        opaque = data[:, :, 3] > 200
        if not opaque.any():
            failures.append(f"{accent.name}: no fully opaque accent pixels")
            continue
        values = data[opaque][:, :3].mean(axis=1) / 255.0
        floor = float(np.percentile(values, LOW_PERCENTILE))
        spread = float(np.percentile(values, HIGH_PERCENTILE) - floor)
        if floor < LUMINANCE_MIN - 0.02:
            failures.append(f"{accent.name}: floor {floor:.2f} below {LUMINANCE_MIN}")
        if spread < 0.05:
            failures.append(f"{accent.name}: flat layer (spread {spread:.2f})")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print(f"OK {len(stems)} building accent layers")
    return 0


def preview(path: Path, tint: tuple[float, float, float] = (0.95, 0.25, 0.25)) -> int:
    """Every building with its accent tinted, on grass - the visual gate."""
    stems = sorted({p.stem for p in ART_DIR.glob("*.png") if not p.stem.endswith("_accent")})
    tiles = []
    for stem in stems:
        art = Image.open(ART_DIR / f"{stem}.png").convert("RGBA")
        accent = np.asarray(Image.open(accent_path(stem)).convert("RGBA"), dtype=float)
        for channel, gain in enumerate(tint):
            accent[:, :, channel] *= gain
        composed = art.copy()
        composed.alpha_composite(Image.fromarray(accent.clip(0, 255).astype(np.uint8), "RGBA"))
        on_grass = Image.new("RGBA", composed.size, (122, 146, 96, 255))
        on_grass.alpha_composite(composed)
        tiles.append((stem, on_grass))

    columns = 4
    cell_w = max(tile.width for _, tile in tiles)
    cell_h = max(tile.height for _, tile in tiles)
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGBA", (cell_w * columns, cell_h * rows), (30, 40, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for index, (stem, tile) in enumerate(tiles):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        sheet.alpha_composite(tile, (x + (cell_w - tile.width) // 2, y))
        draw.text((x + 4, y + 2), stem, fill=(255, 255, 255, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    print(f"wrote {path}")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate the masks on disk")
    parser.add_argument("--preview", type=Path, help="write a contact sheet of every building")
    args = parser.parse_args(argv)
    if args.check:
        return check()
    if args.preview:
        return preview(args.preview)
    return build_all()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Derive the team-colour mask sheets for the shipped infantry and cavalry.

The client multiplies the owner's colour over a white, shaded mask drawn on top
of the body sprite (see ``entityAccent.ts``). For the archer that mask comes out
of Blender, because the body itself is rendered from ``linh.blend`` with the
tunic isolated in a material slot.

The spearman and the cavalry have no such pass: their shipped sheets are the art
of record, and re-rendering 528 frames only to rebuild a mask would risk moving
the bodies off the grid the game already draws. Their tunic is instead masked
straight out of the shipped pixels: the cloth is the only large region inside a
narrow teal band (the helmet, hands, boots and horse armour all sample outside
it), so a per-pixel selection followed by a size filter, a hole fill and a grow
back over the cloth's own antialiasing reproduces the same patch the 3D mask
would have selected, aligned to the body pixel for pixel.

The mask keeps the body's own luminance, remapped onto 0.75-1.0, so the folds
survive the multiply -- a flat white mask would erase them and the tint would
read as plastic.

Usage:
    python3 scripts/build_team_accent.py                 # dry run + previews
    python3 scripts/build_team_accent.py --check         # shipped sheets match a fresh build
    python3 scripts/build_team_accent.py --write         # publish the sheets
    python3 scripts/build_team_accent.py --unit SPEARMAN --write

After ``--write``, re-pin the hashes with ``python3 scripts/assets/build.py --legacy``;
``build.py --check`` is the asset-lock gate and will report the new PNGs as "not in
the lock" until then.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ACTIONS_DIR = ROOT / "apps" / "client" / "public" / "assets" / "units" / "actions"
PREVIEW_DIR = ROOT / "scripts" / "out" / "team_accent"

# Cell geometry, mirroring ``UNIT_ART`` in unitArt.ts. The accent sheet has to
# share the body's grid exactly: a drift of one column would tint the facing
# beside the soldier's own.
UNITS: dict[str, tuple[int, int]] = {
    "SPEARMAN": (192, 168),
    "CAVALRY": (224, 224),
}

# Actions every unit ships, mirroring the keys of ``UNIT_ART.<UNIT>.actions``.
# Listed rather than globbed so a stray PNG in the directory cannot become an
# accent sheet the client never loads, and a missing action fails the build.
ACTIONS = ("idle", "walk", "attack", "death")

# Row order is compass-from-east, the order ``unitDirections.ts`` indexes with.
ROW_COUNT = 8

# The tunic's teal band, measured off the shipped sheets. The cloth sits at hue
# 188-198 with saturation 0.30-0.44, while the helmet's blued steel sits at hue
# 201-210 with saturation 0.07-0.15: the cavalry's sheet was gamma-lifted onto a
# different median than the spearman's, which is what raises the steel's
# saturation enough to slip through a wide window. The band therefore stops at
# 202 and keeps a 0.18 saturation floor, which still admits the shadowed folds
# (0.22-0.30) but not the helmet.
HUE_RANGE = (184.0, 202.0)
MIN_SATURATION = 0.18
MIN_VALUE = 0.06

# A stray armour texel in the same band would tint a grey sleeve; the tabard is
# one large patch per frame, so anything under this is noise.
MIN_COMPONENT_PIXELS = 24

# The cloth's edge pixels blend toward the background and sample less
# saturated than the chest, so the mask takes them back through a looser band.
# Only pixels already in the cloth's hue may be grown into, which is what stops
# this from bleeding onto the helmet's blued steel.
ANTIALIAS_SATURATION = 0.08
ANTIALIAS_GROW_ROUNDS = 2

# Where the shading is lifted to. The body's cloth renders at a median luminance
# of ~0.34, which multiplied by a team colour would read almost black; the
# archer's Blender mask sits at 0.9, so the same range is targeted here.
SHADE_FLOOR = 0.75
SHADE_CEIL = 1.0

# A mask that covers the whole figure has lost its band; an empty one means the
# band no longer matches the art. Both are publish failures, not warnings.
#
# The ceiling is a share of the figure, not of the cell: the figure itself only
# fills 3.9-12% of a cell, so an absolute 16% ceiling would let a mask that tints
# every limb through. The tabard is the largest legitimate mask and covers at
# most 63% of its figure (spearman), leaving 0.8 as the line where the mask has
# stopped being cloth.
#
# The floor is per cell because the cavalry's death clip hides the rider behind
# the horse on its last frames: that cell bottoms out at 0.53% and is still
# correct art, so the floor sits below it with room for the next art tweak.
MIN_CELL_COVERAGE = 0.004
MAX_FIGURE_SHARE = 0.8

TEAM_PREVIEW = np.array([0.89, 0.23, 0.18], dtype=np.float32)  # AoE player-1 red


def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hue in degrees plus saturation and value, all from a 0..1 float image."""
    max_c = rgb.max(axis=-1)
    min_c = rgb.min(axis=-1)
    delta = max_c - min_c
    saturation = np.where(max_c > 0, delta / np.maximum(max_c, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    safe = np.maximum(delta, 1e-9)
    hue = np.where(
        max_c == r,
        ((g - b) / safe) % 6,
        np.where(max_c == g, (b - r) / safe + 2, (r - g) / safe + 4),
    )
    return hue * 60.0, saturation, max_c


def dilate(mask: np.ndarray) -> np.ndarray:
    out = mask.copy()
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def erode(mask: np.ndarray) -> np.ndarray:
    out = mask.copy()
    out[1:, :] &= mask[:-1, :]
    out[:-1, :] &= mask[1:, :]
    out[:, 1:] &= mask[:, :-1]
    out[:, :-1] &= mask[:, 1:]
    return out


def components(selected: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """Four-connected component labels and their sizes, sized for tiny masks."""
    height, width = selected.shape
    labels = np.zeros((height, width), dtype=np.int32)
    sizes: list[int] = []
    current = 0
    for y, x in np.argwhere(selected):
        if labels[y, x]:
            continue
        current += 1
        queue = deque([(int(y), int(x))])
        labels[y, x] = current
        size = 0
        while queue:
            cy, cx = queue.popleft()
            size += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < height and 0 <= nx < width and selected[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    queue.append((ny, nx))
        sizes.append(size)
    return labels, sizes


def fill_holes(selected: np.ndarray, allowed: np.ndarray) -> np.ndarray:
    """Selects the unselected figure pixels a mask region encloses.

    Specular highlights and a belt buckle inside the tabard sample outside the
    cloth band; leaving them transparent would show the tunic underneath as
    pinholes, so anything the selection surrounds is part of the mask.
    """
    height, width = selected.shape
    reached = np.zeros_like(selected)
    queue: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        # The flood starts in the transparent margin, so it may not be gated on
        # the figure: only the mask itself blocks it.
        if not selected[y, x] and not reached[y, x]:
            reached[y, x] = True
            queue.append((y, x))

    for x in range(width):
        seed(0, x)
        seed(height - 1, x)
    for y in range(height):
        seed(y, 0)
        seed(y, width - 1)

    while queue:
        cy, cx = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < height and 0 <= nx < width:
                seed(ny, nx)
    return allowed & ~selected & ~reached


def cell_mask(cell: np.ndarray) -> np.ndarray:
    """Selected cloth pixels of one cell."""
    rgb = cell[..., :3]
    alpha = cell[..., 3]
    hue, saturation, value = hsv(rgb)

    selected = (
        (alpha > 0.5)
        & (hue >= HUE_RANGE[0])
        & (hue <= HUE_RANGE[1])
        & (saturation >= MIN_SATURATION)
        & (value > MIN_VALUE)
    )

    labels, sizes = components(selected)
    kept = np.zeros_like(selected)
    for index, size in enumerate(sizes):
        if size >= MIN_COMPONENT_PIXELS:
            kept |= labels == index + 1

    # Close one-pixel folds, then take the enclosed highlights, then grow back
    # over the cloth's own antialiasing so no teal fringe is left around the
    # tinted tabard. The grow may only take pixels that are still in the cloth
    # band at a lower saturation and a lower alpha: growing over every figure
    # pixel would draw a tinted line along the grey sleeve and the boots.
    allowed = alpha > 0.35
    kept = erode(dilate(kept))
    kept |= fill_holes(kept, allowed)
    antialias = (
        (alpha > 0.05)
        & (hue >= HUE_RANGE[0])
        & (hue <= HUE_RANGE[1])
        & (saturation >= ANTIALIAS_SATURATION)
        & (value > 0.03)
    )
    for _ in range(ANTIALIAS_GROW_ROUNDS):
        kept |= dilate(kept) & antialias
    return kept


def luminance(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def sheet_paths(unit: str) -> list[Path]:
    prefix = f"{unit.lower()}_"
    return [ACTIONS_DIR / f"{prefix}{action}.png" for action in ACTIONS]


def build_unit(unit: str, preview: bool) -> tuple[list[tuple[str, np.ndarray]], list[str]]:
    """Builds every accent sheet of a unit.

    Returns the finished RGBA arrays -- not yet written -- plus the guard
    failures. Publishing is deferred to ``main`` so a guard failure on the second
    unit cannot leave the first unit's masks on disk behind a non-zero exit.
    """
    frame_width, frame_height = UNITS[unit]
    failures: list[str] = []

    images: dict[str, np.ndarray] = {}
    selections: dict[str, np.ndarray] = {}
    lums: list[np.ndarray] = []

    for path in sheet_paths(unit):
        if not path.exists():
            failures.append(f"{unit}: missing body sheet {path.name}")
            continue
        image = np.array(Image.open(path).convert("RGBA"), dtype=np.float32) / 255.0
        height, width = image.shape[:2]
        if width % frame_width:
            failures.append(
                f"{path.name}: width {width} is not a whole number of {frame_width}px cells"
            )
            continue
        if height != frame_height * ROW_COUNT:
            failures.append(
                f"{path.name}: height {height} is not {ROW_COUNT} rows of {frame_height}px"
            )
            continue
        columns = width // frame_width
        masks = np.zeros((height, width), dtype=bool)
        for row in range(ROW_COUNT):
            for column in range(columns):
                cell = image[
                    row * frame_height : (row + 1) * frame_height,
                    column * frame_width : (column + 1) * frame_width,
                ]
                mask = cell_mask(cell)
                masks[
                    row * frame_height : (row + 1) * frame_height,
                    column * frame_width : (column + 1) * frame_width,
                ] = mask
                coverage = float(mask.mean())
                figure = float((cell[..., 3] > 0.35).mean())
                if coverage < MIN_CELL_COVERAGE:
                    failures.append(
                        f"{path.name} row {row} col {column}: mask covers "
                        f"{coverage * 100:.2f}% of the cell (too empty)"
                    )
                if figure > 0 and coverage / figure > MAX_FIGURE_SHARE:
                    failures.append(
                        f"{path.name} row {row} col {column}: mask covers "
                        f"{coverage / figure * 100:.0f}% of the figure (tinting the whole figure)"
                    )
        images[path.stem] = image
        selections[path.stem] = masks
        pixel_lums = luminance(image[..., :3])[masks]
        if pixel_lums.size:
            lums.append(pixel_lums)

    if not lums:
        return [], failures + [
            f"{unit}: no cloth pixels found; the colour band no longer matches the art"
        ]

    pooled = np.concatenate(lums)
    low, high = (float(value) for value in np.percentile(pooled, (2, 98)))
    if high <= low:
        return [], failures + [
            f"{unit}: the cloth has no luminance range (p2 {low:.3f}, p98 {high:.3f})"
        ]

    # A guard failure is a broken mask, not a warning: publishing it would put a
    # white or half-tinted unit in the game.
    if failures:
        return [], failures

    outputs: list[tuple[str, np.ndarray]] = []
    for name, image in images.items():
        masks = selections[name]
        shade = np.clip((luminance(image[..., :3]) - low) / (high - low), 0.0, 1.0)
        shade = SHADE_FLOOR + (SHADE_CEIL - SHADE_FLOOR) * shade
        accent = np.zeros_like(image)
        accent[..., 0] = shade
        accent[..., 1] = shade
        accent[..., 2] = shade
        accent[..., 3] = image[..., 3] * masks
        # Under alpha 0 the colour is unreadable, so zero it: the sheets are
        # preloaded at startup and transparent RGB is pure payload (cavalry
        # walk drops from ~705 KB to ~128 KB).
        accent[..., :3] *= masks[..., None]

        if preview:
            PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
            tinted = tint_preview(accent, image)
            Image.fromarray(tinted).save(PREVIEW_DIR / f"{name}_preview.png", optimize=True)
            print(f"preview {unit} {name}: cloth band {low:.2f}-{high:.2f} luma")

        accent_u8 = (np.clip(accent, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
        outputs.append((name, accent_u8))

    return outputs, []


def tint_preview(accent: np.ndarray, body: np.ndarray) -> np.ndarray:
    """Composites the mask over the body with a team colour, as the client does.

    ``accent`` is straight-alpha RGBA and ``body`` is the source sheet, both 0..1.
    The result is premultiplied over the grass colour, so a white mask (untinted)
    and a missing one are both obvious at a glance.
    """
    accent_alpha = accent[..., 3:4]
    body_alpha = body[..., 3:4]
    alpha = accent_alpha + body_alpha * (1.0 - accent_alpha)
    tinted = accent[..., :3] * TEAM_PREVIEW * accent_alpha
    under = body[..., :3] * body_alpha * (1.0 - accent_alpha)
    grass = np.array([0.23, 0.3, 0.19], dtype=np.float32)
    preview = tinted + under + grass * (1.0 - alpha)
    return (np.clip(preview, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def check_outputs(outputs: list[tuple[str, np.ndarray]]) -> list[str]:
    """Compares a fresh build with the shipped accent sheets."""
    problems: list[str] = []
    for name, accent_u8 in outputs:
        path = ACTIONS_DIR / f"{name}_accent.png"
        if not path.exists():
            problems.append(f"{path.name}: missing (run --write)")
            continue
        try:
            shipped = np.array(Image.open(path).convert("RGBA"))
        except OSError as error:
            problems.append(f"{path.name}: cannot read ({error}); run --write")
            continue
        if shipped.shape != accent_u8.shape:
            problems.append(
                f"{path.name}: {shipped.shape[1]}x{shipped.shape[0]} on disk, "
                f"rebuild is {accent_u8.shape[1]}x{accent_u8.shape[0]}"
            )
        elif not np.array_equal(shipped, accent_u8):
            problems.append(f"{path.name}: stale or hand-edited (run --write); body art changed?")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="publish the accent sheets")
    mode.add_argument(
        "--check",
        action="store_true",
        help="verify the shipped accent sheets match a fresh build",
    )
    parser.add_argument("--unit", choices=sorted(UNITS), help="only this unit (default: both)")
    args = parser.parse_args(argv)

    units = [args.unit] if args.unit else sorted(UNITS)
    outputs: list[tuple[str, np.ndarray]] = []
    failures: list[str] = []
    for unit in units:
        sheets, unit_failures = build_unit(unit, preview=not (args.write or args.check))
        outputs.extend(sheets)
        failures.extend(unit_failures)

    if failures:
        print("\nmask guards failed:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1

    if args.check:
        problems = check_outputs(outputs)
        if problems:
            print("\naccent check FAILED:", file=sys.stderr)
            for problem in problems:
                print(f"  {problem}", file=sys.stderr)
            return 1
        print(f"accent check OK: {len(outputs)} sheets match a fresh build")
        return 0

    if args.write:
        # Encode every sheet first, then rename them into place: an I/O error
        # while encoding leaves the shipped masks untouched instead of replacing
        # them one by one.
        staged: list[tuple[Path, Path]] = []
        for name, accent_u8 in outputs:
            output = ACTIONS_DIR / f"{name}_accent.png"
            temporary = output.with_name(output.name + ".tmp")
            Image.fromarray(accent_u8).save(temporary, format="PNG", optimize=True)
            staged.append((temporary, output))
        for temporary, output in staged:
            os.replace(temporary, output)
            print(f"wrote {output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

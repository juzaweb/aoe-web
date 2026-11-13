"""Rebuild the citadel wall and the town-centre castle from Canva-generated art.

Inputs live in ``scripts/raw_downloads/canva_rework``:

* ``wall_face_raw.png`` -- seamless stone elevation, mapped onto both wall faces.
* ``wall_cap_raw.png``  -- top-down stone paving, mapped onto the walkway cap.
* ``town_center_wide_mat_raw.png`` -- background-removed 4:3 castle render.

Outputs overwrite the shipped citadel wall and town-centre sprites:

* ``apps/client/public/assets/citadel/wall.png``
* ``apps/client/public/assets/buildings/town_center.png``

Nothing is drawn here. The wall is delegated to
``process_citadel_assets.build_wall`` -- the same geometry, shading and parapet
``CitadelLayer`` measures against -- and validated with
``process_citadel_assets.wall_failures``. The castle goes through the ``ops``
helpers ``scripts/assets/build.py`` already uses, matching the shipped 576x440
canvas, a warm sandstone palette target and bottom-center anchor.

Texture handling changed in phase 31. The Canva stone is shot at 1264-1456 px and
mapped onto 64 px faces, so its grain aliases into speckle. The old pipeline
answered that with a Gaussian blur, which erased the mortar joints and left the
stone at chroma 11.5 -- it read as plastic concrete beside a painted house at
chroma 23.2. Now the sheet is box-downsampled (a real mip level: averaging 4x4
blocks, not a kernel smear) and the joints are rebuilt at a fixed brightness by
``process_citadel_assets.mortar_lines``, so detail stays and speckle does not.

Usage:
    python scripts/rebuild_canva_wall_town.py              # write the PNGs
    python scripts/rebuild_canva_wall_town.py --check      # validate shipped files
    python scripts/rebuild_canva_wall_town.py --preview    # compose a proof sheet
    python scripts/rebuild_canva_wall_town.py --castle /path/to/keep.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts" / "assets"))

import ops  # noqa: E402
import process_arrow_asset as arrow  # noqa: E402
import process_citadel_assets as pca  # noqa: E402

RAW_DIR = ROOT / "scripts" / "raw_downloads" / "canva_rework"
ASSET_ROOT = ROOT / "apps" / "client" / "public" / "assets"

FACE_SOURCE = RAW_DIR / "wall_face_raw.png"
CAP_SOURCE = RAW_DIR / "wall_cap_raw.png"
CASTLE_SOURCE = RAW_DIR / "town_center_wide_mat_raw.png"

WALL_OUT_REL = Path("citadel") / "wall.png"
TOWN_OUT_REL = Path("buildings") / "town_center.png"
TOWN_CANVAS = (576, 440)
# Raised from 74.8. The old target matched the floor stone, which is a cool grey;
# a keep has to sit in the same family as the house (86.7) and barracks (86.8) it
# stands beside, or it reads as a different game's asset.
TOWN_MATCH_LUM = 86.0
TOWN_CHROMA_MIN = 16.0
# Hard ceiling too: the Canva renders come back far more saturated than the game
# palette (mean channel spread 50-76 against the house's 23.2), and a keep at
# chroma 70 reads as a candy-coloured toy beside it. Blended toward grey until it
# lands in the band the house and barracks occupy.
TOWN_CHROMA_TARGET = 26.0
TOWN_CHROMA_MAX = 32.0
TOWN_LUM_RANGE = (80.0, 92.0)
TOWN_ANCHOR = "bottom-center"
# How far the keep render is pulled warm. The house and barracks sit at chroma
# 23-24 with a warm base; this closes the gap without baking a tint. The wall does
# *not* use this: `process_citadel_assets.STONE_GAIN` owns the stone colour, and
# applying both turned the block terracotta at chroma 47.
TOWN_WARM_GAIN = (1.10, 1.0, 0.86)


def build_wall(face: Path, cap: Path) -> dict:
    """Build and validate the wall block against the shipped contract.

    The texture prep lives in `process_citadel_assets.load_stone`, so the wall is
    built from the raw sheets directly: preparing them here as well applied the
    mip and the warmth twice, and the block shipped at chroma 47.
    """
    built = pca.build_wall(face, ASSET_ROOT, cap_source=cap, rel=WALL_OUT_REL)
    failures = pca.wall_failures(pca.measure(ASSET_ROOT / WALL_OUT_REL))
    if failures:
        raise SystemExit(f"{WALL_OUT_REL}: " + "; ".join(failures))
    return built


def matte(source: Path) -> Image.Image:
    """Key out a flat backdrop and despill, reusing the arrow's tuned ramp.

    A Canva export of this design comes back already matted; an older export is
    flat on a light page. Both routes end as straight alpha with a despilled
    rim, so the rest of the pipeline never has to care which it got.
    """
    image = Image.open(source).convert("RGBA")
    if image.getchannel("A").getextrema()[0] == 0:
        array = np.asarray(image).astype(np.float32)
        colour = arrow.despill(array[..., :3])
        return Image.fromarray(
            np.concatenate([colour, array[..., 3:4]], axis=-1).astype(np.uint8), "RGBA"
        )
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    colour, alpha = arrow.key_out_background(rgb)
    rgba = np.concatenate([colour, (alpha * 255.0)[..., None]], axis=-1)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def match_chroma(art: Image.Image, target: float = TOWN_CHROMA_TARGET) -> tuple[Image.Image, float]:
    """Blend toward grey until the mean channel spread lands on `target`.

    `ops.match_luminance` fixes brightness but leaves saturation untouched, and
    the Canva keep renders arrive at chroma 50-76 while the house they stand next
    to sits at 23.2. A single global grey-mix is the least invasive correction:
    it keeps every hue relation and only reduces how far each pixel departs from
    its own brightness.
    """
    array = np.asarray(art).astype(np.float32)
    solid = array[..., 3] > 16
    if not solid.any():
        return art, 0.0
    rgb = array[..., :3]
    current = float((rgb[solid].max(axis=1) - rgb[solid].min(axis=1)).mean())
    if current <= target:
        return art, 0.0
    # `mix` is how far each pixel is pulled to its own luminance. Solve for the
    # value that lands the mean spread exactly on the target.
    mix = 1.0 - target / current
    grey = (
        0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    )[..., None]
    array[..., :3] = rgb * (1.0 - mix) + grey * mix
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGBA"), mix


def build_town_center(source: Path) -> dict:
    """Crop, warm, desaturate, fit and anchor the keep like every building sheet.

    Unlike the wall this keeps the art's own silhouette: the keep is a single 4:3
    render, not a geometry contract, so it is composited the same way the house
    and barracks are.
    """
    art = ops.crop_to_alpha(matte(source))
    art = ops.apply_gain(art, TOWN_WARM_GAIN)
    art, chroma_mix = match_chroma(art)
    art, gain = ops.match_luminance(art, TOWN_MATCH_LUM)

    scaled, scale = ops.fit(art, TOWN_CANVAS)
    sheet = ops.place(scaled, TOWN_CANVAS, TOWN_ANCHOR)

    span, offset = ops.iso_base(sheet)
    if span > ops.ISO_BASE_MAX_SPAN or offset > ops.ISO_BASE_MAX_OFFSET:
        raise SystemExit(
            f"{TOWN_OUT_REL}: base row reads as a flat wall "
            f"(span {span:.2f} > {ops.ISO_BASE_MAX_SPAN}, "
            f"offset {offset:.2f} > {ops.ISO_BASE_MAX_OFFSET})"
        )
    if ops.bottom_inset(sheet) != 0:
        raise SystemExit(f"{TOWN_OUT_REL}: art does not sit on the canvas bottom row")
    for column in (0, sheet.width - 1):
        for row in (0, sheet.height - 1):
            if sheet.getpixel((column, row))[3] != 0:
                raise SystemExit(f"{TOWN_OUT_REL}: canvas corner ({column}, {row}) is opaque")

    target = ASSET_ROOT / TOWN_OUT_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, "PNG", optimize=True)
    return {
        "name": target.name,
        "size": sheet.size,
        "bbox": ops.alpha_bbox(sheet),
        "lum": ops.luminance(sheet),
        "chroma": pca.measure_chroma(np.asarray(sheet)),
        "gain": gain,
        "chromaMix": chroma_mix,
        "scale": scale,
        "span": span,
        "offset": offset,
    }


def town_center_failures() -> list[str]:
    """Contract of the shipped keep, so `--check` gates it like the citadel."""
    path = ASSET_ROOT / TOWN_OUT_REL
    if not path.exists():
        return [f"missing {TOWN_OUT_REL}"]
    sheet = ops.load_rgba(path)
    failures: list[str] = []
    if sheet.size != TOWN_CANVAS:
        failures.append(f"{TOWN_OUT_REL} size {sheet.size} != {TOWN_CANVAS}")
    if ops.bottom_inset(sheet) != 0:
        failures.append(f"{TOWN_OUT_REL} does not sit on the canvas bottom row")
    corner_alpha = [
        sheet.getpixel((0, 0))[3],
        sheet.getpixel((sheet.width - 1, 0))[3],
        sheet.getpixel((0, sheet.height - 1))[3],
        sheet.getpixel((sheet.width - 1, sheet.height - 1))[3],
    ]
    if any(corner_alpha):
        failures.append(f"{TOWN_OUT_REL} has an opaque canvas corner")
    span, offset = ops.iso_base(sheet)
    if span > ops.ISO_BASE_MAX_SPAN or offset > ops.ISO_BASE_MAX_OFFSET:
        failures.append(
            f"{TOWN_OUT_REL} base reads as a flat wall (span {span:.2f}, offset {offset:.2f})"
        )
    array = np.asarray(sheet)
    chroma = pca.measure_chroma(array)
    lum = ops.luminance(sheet)
    # Reported, not gated: the shipped Town Center is still the pre-phase-31
    # castle render (chroma 8.4, lum 74.3), and the palette band described above
    # is a target for a *rebuilt* keep, not a contract the old art can meet.
    # Gating it here would fail `--check` on a file nobody changed.
    print(
        f"  town centre: chroma {chroma:.1f}, lum {lum:.1f} "
        f"(a rebuilt keep should land in {TOWN_CHROMA_MIN:.0f}-{TOWN_CHROMA_MAX:.0f} "
        f"chroma and {TOWN_LUM_RANGE[0]:.0f}-{TOWN_LUM_RANGE[1]:.0f} lum)"
    )
    return failures


def check() -> int:
    failures = town_center_failures()
    wall_path = ASSET_ROOT / WALL_OUT_REL
    if not wall_path.exists():
        failures.append(f"missing {WALL_OUT_REL}")
    else:
        failures.extend(pca.wall_failures(pca.measure(wall_path)))

    if failures:
        print("FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print("OK: citadel wall and town centre match the shipping contract")
    return 0


def preview() -> int:
    """Delegates to the citadel proof sheet, which composites the keep."""
    return pca.preview(ASSET_ROOT)


def candidate_sheet(sources: list[Path]) -> int:
    """Proof sheet for CIT-02: every keep candidate next to the shipped one.

    Each candidate goes through the *real* build path (`matte` → warm → fit →
    anchor), so the sheet shows what would actually ship rather than the raw
    render. A candidate that breaks the iso-base or corner contract is drawn with
    its failure instead of being silently dropped: the point of the sheet is to
    compare, and a candidate rejected by the numeric gate must not look like a
    winner.
    """
    if not sources:
        raise SystemExit("no candidate renders given")
    panels: list[tuple[str, Image.Image, str]] = []

    shipped = ASSET_ROOT / TOWN_OUT_REL
    if shipped.exists():
        panels.append(("shipped", ops.crop_to_alpha(ops.load_rgba(shipped)), "current art"))

    for index, source in enumerate(sources, start=1):
        art = ops.crop_to_alpha(matte(source))
        art = ops.apply_gain(art, TOWN_WARM_GAIN)
        art, _ = match_chroma(art)
        art, _ = ops.match_luminance(art, TOWN_MATCH_LUM)
        scaled, scale = ops.fit(art, TOWN_CANVAS)
        sheet = ops.place(scaled, TOWN_CANVAS, TOWN_ANCHOR)
        span, offset = ops.iso_base(sheet)
        chroma = pca.measure_chroma(np.asarray(sheet))
        lum = ops.luminance(sheet)
        problems: list[str] = []
        if span > ops.ISO_BASE_MAX_SPAN:
            problems.append(f"span {span:.2f}>{ops.ISO_BASE_MAX_SPAN}")
        if offset > ops.ISO_BASE_MAX_OFFSET:
            problems.append(f"offset {offset:.2f}>{ops.ISO_BASE_MAX_OFFSET}")
        if not TOWN_CHROMA_MIN <= chroma <= TOWN_CHROMA_MAX:
            problems.append(f"chroma {chroma:.1f} out of {TOWN_CHROMA_MIN:.0f}-{TOWN_CHROMA_MAX:.0f}")
        low, high = TOWN_LUM_RANGE
        if not low <= lum <= high:
            problems.append(f"lum {lum:.1f} out of {low:.0f}-{high:.0f}")
        note = (
            f"{source.name}  scale {scale:.2f}  lum {lum:.1f}  chroma {chroma:.1f}"
            + ("  FAIL: " + "; ".join(problems) if problems else "  ok")
        )
        panels.append((f"candidate {index}", ops.crop_to_alpha(sheet), note))

    cell_w, cell_h = 460, 360
    sheet = Image.new("RGBA", (cell_w * len(panels), cell_h + 60), (32, 32, 34, 255))
    for index, (_label, art, note) in enumerate(panels):
        scale = min(cell_w / art.width, cell_h / art.height)
        thumb = art.resize(
            (max(1, round(art.width * scale)), max(1, round(art.height * scale))),
            Image.Resampling.LANCZOS,
        )
        x = index * cell_w + (cell_w - thumb.width) // 2
        y = cell_h - thumb.height
        backdrop = Image.new("RGBA", (cell_w, cell_h), (88, 117, 45, 255))
        backdrop.alpha_composite(thumb, ((cell_w - thumb.width) // 2, cell_h - thumb.height))
        sheet.alpha_composite(backdrop, (index * cell_w, 0))
        print(f"  panel {index + 1}: {note}")

    out = ROOT / "scripts" / "out" / "citadel" / "candidates.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out)
    print(f"candidate sheet written to {out} ({sheet.width}x{sheet.height})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--castle", type=Path, default=CASTLE_SOURCE, help="4:3 keep render")
    parser.add_argument("--face", type=Path, default=FACE_SOURCE, help="stone elevation")
    parser.add_argument("--cap", type=Path, default=CAP_SOURCE, help="stone paving")
    parser.add_argument("--check", action="store_true", help="validate shipped files only")
    parser.add_argument("--preview", action="store_true", help="compose a proof sheet only")
    parser.add_argument(
        "--candidates",
        type=Path,
        nargs="+",
        help="keep renders to compare in a proof sheet before choosing one",
    )
    arguments = parser.parse_args()

    if arguments.candidates:
        return candidate_sheet(arguments.candidates)
    if arguments.check:
        return check()
    if arguments.preview:
        return preview()

    for source in (arguments.face, arguments.cap, arguments.castle):
        if not source.exists():
            raise SystemExit(f"missing Canva source: {source.relative_to(ROOT)}")

    wall = build_wall(arguments.face, arguments.cap)
    print(
        f"  {wall['name']:<18} {wall['size'][0]}x{wall['size'][1]} "
        f"lum {wall['meanLum']:.1f} chroma {wall['chroma']:.1f}"
    )

    town_center = build_town_center(arguments.castle)
    print(
        f"  {town_center['name']:<18} {town_center['size'][0]}x{town_center['size'][1]} "
        f"bbox {town_center['bbox']} lum {town_center['lum']:.1f} "
        f"chroma {town_center['chroma']:.1f} "
        f"gain {town_center['gain']:.2f} scale {town_center['scale']:.2f} "
        f"iso_base span {town_center['span']:.3f} offset {town_center['offset']:.3f}"
    )
    return check()


if __name__ == "__main__":
    raise SystemExit(main())

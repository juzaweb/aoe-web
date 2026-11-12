"""Rebuild the citadel wall and the town-centre castle from Canva-generated art.

Inputs live in ``scripts/raw_downloads/canva_rework``:

* ``wall_face_raw.png`` -- seamless stone elevation, mapped onto both wall faces.
* ``wall_cap_raw.png``  -- top-down stone paving, mapped onto the walkway cap.
* ``town_center_wide_mat_raw.png`` -- background-removed 4:3 castle render.

Outputs are *new* files next to the shipping art, so the old sprites stay
comparable:

* ``apps/client/public/assets/citadel/wall_v2.png``
* ``apps/client/public/assets/buildings/town_center_v2.png``

Nothing is drawn here. The wall is delegated to
``process_citadel_assets.build_wall`` -- the same geometry, outline and shading
``CitadelLayer`` measures against -- and validated with
``process_citadel_assets.wall_failures``. The castle goes through the ``ops``
helpers ``scripts/assets/build.py`` already uses, with the canvas size, the
palette luminance target and the anchor read from that target's manifest entry
instead of being restated here.

The Canva stone is shot at 1264 px and mapped onto 64 px faces, so its grain
aliases into speckle. A pre-blur stands in for the missing mip level, and
desaturating a quarter keeps the moss from reading as green noise beside the
neutral citadel floor.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts" / "assets"))

import ops  # noqa: E402
import process_citadel_assets as pca  # noqa: E402

RAW_DIR = ROOT / "scripts" / "raw_downloads" / "canva_rework"
WORK_DIR = ROOT / "scripts" / "out" / "canva_wall"
ASSET_ROOT = ROOT / "apps" / "client" / "public" / "assets"
MANIFEST = ROOT / "scripts" / "assets" / "manifest.json"

FACE_SOURCE = RAW_DIR / "wall_face_raw.png"
CAP_SOURCE = RAW_DIR / "wall_cap_raw.png"
CASTLE_SOURCE = RAW_DIR / "town_center_wide_mat_raw.png"

WALL_VARIANT_REL = Path("citadel") / "wall_v2.png"
TOWN_VARIANT_REL = Path("buildings") / "town_center_v2.png"
TOWN_TARGET_ID = "building.town-center"

FACE_CROP = 360
CAP_CROP = 512
TEXTURE_BLUR = 3.0
TEXTURE_DESAT = 0.25


def prepare_texture(source: Path, crop: int) -> Image.Image:
    """Centre-crop to a square, downscale, de-alias and neutralise colour."""
    image = Image.open(source).convert("RGB")
    width, height = image.size
    side = min(width, height)
    left, top = (width - side) // 2, (height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize(
        (crop, crop), Image.Resampling.LANCZOS
    )
    image = image.filter(ImageFilter.GaussianBlur(TEXTURE_BLUR))
    # Same Rec. 709 weights `ops.luminance` uses, so "desaturated" means the same
    # thing here as it does for every other sprite in the pipeline.
    pixels = np.asarray(image).astype(np.float64)
    grey = (
        0.2126 * pixels[..., 0] + 0.7152 * pixels[..., 1] + 0.0722 * pixels[..., 2]
    )[..., None]
    pixels = pixels * (1.0 - TEXTURE_DESAT) + grey * TEXTURE_DESAT
    return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))


def build_wall(face: Path, cap: Path) -> dict:
    """Build and validate the wall variant against the shipped contract."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    face_ready = WORK_DIR / "wall_face_prepared.png"
    cap_ready = WORK_DIR / "wall_cap_prepared.png"
    prepare_texture(face, FACE_CROP).save(face_ready)
    prepare_texture(cap, CAP_CROP).save(cap_ready)

    built = pca.build_wall(face_ready, ASSET_ROOT, cap_source=cap_ready, rel=WALL_VARIANT_REL)
    failures = pca.wall_failures(pca.measure(ASSET_ROOT / WALL_VARIANT_REL))
    if failures:
        raise SystemExit(f"{WALL_VARIANT_REL}: " + "; ".join(failures))
    return built


def town_center_spec() -> dict:
    """Canvas, palette luminance and anchor of the shipped town centre."""
    manifest = json.loads(MANIFEST.read_text())
    target = manifest["targets"].get(TOWN_TARGET_ID)
    if target is None:
        raise SystemExit(f"{TOWN_TARGET_ID} is missing from {MANIFEST.relative_to(ROOT)}")
    return {
        "canvas": tuple(target["canvas"]),
        "matchLum": target["op"].get("matchLum"),
        "anchor": target["op"].get("anchor", "bottom-center"),
    }


def build_town_center(source: Path, spec: dict) -> dict:
    """Crop, recolour, fit and anchor the castle like every building sheet."""
    art = ops.crop_to_alpha(ops.load_rgba(source))
    gain = 1.0
    if spec["matchLum"] is not None:
        art, gain = ops.match_luminance(art, spec["matchLum"])

    scaled, scale = ops.fit(art, spec["canvas"])
    sheet = ops.place(scaled, spec["canvas"], spec["anchor"])

    span, offset = ops.iso_base(sheet)
    if span > ops.ISO_BASE_MAX_SPAN or offset > ops.ISO_BASE_MAX_OFFSET:
        raise SystemExit(
            f"{TOWN_VARIANT_REL}: base row reads as a flat wall "
            f"(span {span:.2f} > {ops.ISO_BASE_MAX_SPAN}, "
            f"offset {offset:.2f} > {ops.ISO_BASE_MAX_OFFSET})"
        )
    if ops.bottom_inset(sheet) != 0:
        raise SystemExit(f"{TOWN_VARIANT_REL}: art does not sit on the canvas bottom row")
    for column in (0, sheet.width - 1):
        for row in (0, sheet.height - 1):
            if sheet.getpixel((column, row))[3] != 0:
                raise SystemExit(f"{TOWN_VARIANT_REL}: canvas corner ({column}, {row}) is opaque")

    target = ASSET_ROOT / TOWN_VARIANT_REL
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, "PNG", optimize=True)
    return {
        "name": target.name,
        "size": sheet.size,
        "bbox": ops.alpha_bbox(sheet),
        "lum": ops.luminance(sheet),
        "gain": gain,
        "scale": scale,
        "span": span,
        "offset": offset,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.parse_args()

    for source in (FACE_SOURCE, CAP_SOURCE, CASTLE_SOURCE):
        if not source.exists():
            raise SystemExit(f"missing Canva source: {source.relative_to(ROOT)}")

    wall = build_wall(FACE_SOURCE, CAP_SOURCE)
    print(f"  {wall['name']:<18} {wall['size'][0]}x{wall['size'][1]} lum {wall['meanLum']:.1f}")

    town_center = build_town_center(CASTLE_SOURCE, town_center_spec())
    print(
        f"  {town_center['name']:<18} {town_center['size'][0]}x{town_center['size'][1]} "
        f"bbox {town_center['bbox']} lum {town_center['lum']:.1f} "
        f"gain {town_center['gain']:.2f} scale {town_center['scale']:.2f} "
        f"iso_base span {town_center['span']:.3f} offset {town_center['offset']:.3f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

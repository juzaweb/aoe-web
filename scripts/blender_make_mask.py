"""Bake the team-colour mask for the 3D soldier (``linh.glb`` / ``linh.blend``).

The model is a single mesh with a single material whose colours are baked into a
2048 px atlas, so there is no "scarf" or "trim" material to tint at runtime:
``material.color = teamColour`` would only darken the baked teal. TEAM-01 solves
that the way the retail RTS games do by baking a mask that the runtime multiplies
by the owner's colour (D2/D3 in ``docs/plans/30-team-color-unit-sheets.md``).

What the mask covers
--------------------
The soldier wears a teal surcoat over a chainmail hauberk. That surcoat - front,
back, skirt and the shoulder panels - is the accent region. The helmet, mail,
boots, belt and the sword are not, so a team-coloured soldier still reads as a
mail-clad figure instead of one flat blob.

Why not a hue test on the rendered pixels
-----------------------------------------
A texture-space hue threshold cannot separate the surcoat from the steel helmet
and the blade: all three sit around hue 200. It also leaves every non-teal
texel inside the garment untouched, which punches holes in the mask. This script
therefore decides **per face** in the mesh instead - the same thing the manual
"select the faces in Edit Mode" workflow does (D3) - using two independent
signals that the helmet fails and the surcoat passes:

``hue/saturation/value``
    Cloth is a saturated dye (S ~ 0.37); the helmet and the blade are metal
    (S < 0.2). A face counts as dyed when the majority of its UV-mapped texels
    are in hue 180-215 deg with S >= 0.25 and V <= 0.85.

``neck line``
    Nothing above the collar is treated as clothing, which keeps a specular
    highlight on the helmet from ever qualifying. The gate is in the rest pose,
    so it stays valid for every animation frame.

A face is either fully accent or fully body, so the mask has hard edges in UV
space and no holes. Anti-aliasing happens in screen space at render time.

Usage:
    blender -b --python scripts/blender_make_mask.py
    blender -b --python scripts/blender_make_mask.py --check
"""

from __future__ import annotations

import argparse
import colorsys
import sys
from pathlib import Path

import bpy

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BLEND = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "linh.blend"
DEFAULT_OUT = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "linh_teammask.png"

#: Body mesh that carries the surcoat. The weapon is a second object and is
#: deliberately excluded: tinting a steel blade would look like a toy.
BODY_OBJECT = "Mesh0"
BASE_COLOR_IMAGE = "texture_0"

MASK_SIZE = 2048
#: Rest-pose height below which the character wears clothing. The collar sits at
#: ~1.5 m on this ~1.75 m model; the head is above it.
NECK_HEIGHT_Z = 1.50

#: Dyed-cloth window. Values measured on the atlas: cloth (hue 195, S 0.37,
#: V 0.48), helmet (hue 203, S 0.14, V 0.61), leather (hue 23, S 0.16).
HUE_MIN, HUE_MAX = 180.0, 215.0
SATURATION_MIN = 0.25
VALUE_MIN, VALUE_MAX = 0.12, 0.85
#: Share of a face's corner texels that must be dyed before the whole face moves.
FACE_TEXEL_MAJORITY = 0.5


def open_model(blend: Path) -> None:
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    # ``linh.blend`` carries a 2 m icosphere in a collection excluded from the
    # glTF export. It is only a viewport backdrop, but it is opaque in a render
    # and sits between the camera and the soldier.
    backdrop = bpy.data.objects.get("Icosphere")
    if backdrop is not None:
        bpy.data.objects.remove(backdrop, do_unlink=True)


def texel_reader():
    """Sampler over the packed base-colour image, in linear RGB."""
    image = bpy.data.images[BASE_COLOR_IMAGE]
    width, height = image.size
    pixels = list(image.pixels)

    def sample(u: float, v: float) -> tuple[float, float, float]:
        x = min(width - 1, max(0, int((u % 1.0) * (width - 1))))
        y = min(height - 1, max(0, int((v % 1.0) * (height - 1))))
        offset = (y * width + x) * 4
        return pixels[offset], pixels[offset + 1], pixels[offset + 2]

    return sample


def is_dyed_cloth(rgb: tuple[float, float, float]) -> bool:
    hue, saturation, value = colorsys.rgb_to_hsv(*rgb)
    return (
        HUE_MIN <= hue * 360.0 <= HUE_MAX
        and saturation >= SATURATION_MIN
        and VALUE_MIN <= value <= VALUE_MAX
    )


def select_accent_faces(mesh) -> list[int]:
    """Indices of the polygons that make up the surcoat."""
    sample = texel_reader()
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise SystemExit(f"{BODY_OBJECT} has no UV map to bake from")
    uv_data = uv_layer.data

    selected: list[int] = []
    for polygon in mesh.polygons:
        centre_z = polygon.center.z
        if centre_z >= NECK_HEIGHT_Z:
            continue
        dyed = 0
        for loop_index in range(polygon.loop_start, polygon.loop_start + polygon.loop_total):
            uv = uv_data[loop_index].uv
            if is_dyed_cloth(sample(uv.x, uv.y)):
                dyed += 1
        if dyed / polygon.loop_total > FACE_TEXEL_MAJORITY:
            selected.append(polygon.index)
    return selected


def make_emit_material(name: str, grey: float):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (grey, grey, grey, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    output = nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def bake_mask(body, selected: list[int], out_path: Path) -> None:
    mesh = body.data
    chosen = set(selected)

    # The bake writes whatever each face's material emits: white for the
    # accent region, black everywhere else. Two slots is all it takes.
    black = make_emit_material("TeamMaskBody", 0.0)
    white = make_emit_material("TeamMaskAccent", 1.0)
    mesh.materials.clear()
    mesh.materials.append(black)
    mesh.materials.append(white)
    for polygon in mesh.polygons:
        polygon.material_index = 1 if polygon.index in chosen else 0

    target = bpy.data.images.new("linh_teammask", MASK_SIZE, MASK_SIZE, alpha=False)
    target.colorspace_settings.name = "Non-Color"
    for material in (black, white):
        nodes = material.node_tree.nodes
        image_node = nodes.new("ShaderNodeTexImage")
        image_node.image = target
        image_node.select = True
        nodes.active = image_node

    scene = bpy.context.scene
    # Bake is a Cycles operator; one sample is enough for a two-colour emit pass
    # and keeps the 2048 px bake at a couple of seconds.
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    # A little padding so filtering at the texture edge does not pull black into
    # the accent silhouette.
    scene.render.bake.margin = 16

    for obj in bpy.data.objects:
        obj.select_set(obj == body)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.bake(type="EMIT", use_clear=True, margin=16)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    target.filepath_raw = str(out_path)
    target.file_format = "PNG"
    target.save()


def check_mask(path: Path) -> int:
    """TEAM-01 gate: right size, and a mask that is neither empty nor solid."""
    if not path.exists():
        print(f"FAIL {path} does not exist", file=sys.stderr)
        return 1

    image = bpy.data.images.load(str(path))
    width, height = image.size
    pixels = list(image.pixels)
    # Base-colour channel; the three channels are identical after an emit bake.
    values = pixels[0::4]
    white = sum(1 for value in values if value > 0.5)
    fraction = white / max(1, len(values))

    problems: list[str] = []
    if (width, height) != (MASK_SIZE, MASK_SIZE):
        problems.append(f"size {width}x{height}, expected {MASK_SIZE}x{MASK_SIZE}")
    if fraction < 0.02:
        problems.append(f"only {fraction:.3%} white - the surcoat selection is empty")
    if fraction > 0.50:
        problems.append(f"{fraction:.3%} white - the selection leaked past the surcoat")

    if problems:
        for problem in problems:
            print(f"FAIL {problem}", file=sys.stderr)
        return 1
    print(f"OK {path.name}: {width}x{height}, {fraction:.1%} of the atlas is accent")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", type=Path, default=DEFAULT_BLEND)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="only validate an existing mask instead of re-baking it",
    )
    args = parser.parse_args(argv)

    if args.check:
        return check_mask(args.out)

    open_model(args.blend)
    body = bpy.data.objects.get(BODY_OBJECT)
    if body is None:
        raise SystemExit(f"{args.blend} has no object named {BODY_OBJECT}")

    selected = select_accent_faces(body.data)
    if not selected:
        raise SystemExit("no accent faces matched - the atlas or the model changed")
    print(f"accent faces: {len(selected)} of {len(body.data.polygons)}")
    bake_mask(body, selected, args.out)
    print(f"wrote {args.out}")
    return check_mask(args.out)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    sys.exit(main(argv))

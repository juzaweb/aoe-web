"""Team-colour mask for the Mixamo soldier: which faces are the tunic.

The soldier ships as one mesh with one material whose colours are baked into a
2048 square atlas, so there is no material or object to recolour at runtime.
Team colour therefore needs a mask, and the mask is made here once, from the
atlas itself: every face samples the base-colour texture at its own UVs, and the
faces whose texel colour falls in the cloth's teal band become the accent.

Selected faces are moved to a second material slot (``TeamAccent``) so the rest
of the pipeline can address them by index. In the accent pass every other
material is replaced with a Cycles holdout, and the accent slot is a plain white
Principled BSDF: the render then carries the tunic's shading into the alpha
sheet, which is what keeps the folds when the client multiplies a team colour
over it.

Usage (inside Blender, soldier file already open):
    blender -b .../linh.blend --python scripts/blender/team_accent.py -- --probe
    blender -b .../linh.blend --python scripts/blender/team_accent.py -- --report
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

import bpy
import numpy as np

BODY_OBJECT = "Mesh0"

# The tunic's teal band, measured off the atlas: 7,437 cloth faces sit at hue
# 190-200 with a median saturation of 0.39. The band is kept narrow -- the helmet
# is the same hue at saturation 0.12 -- and the saturation floor low, because the
# skirt's folds sample at 0.13 where the chest samples at 0.39.
HUE_RANGE = (185.0, 205.0)
MIN_SATURATION = 0.13
MIN_VALUE = 0.05

# The tunic covers the torso and the skirt, down to the hem at z 0.40; the
# boots, hands and helmet are outside this band, which keeps the helmet's
# low-saturation teal out of the mask without tuning the saturation floor against
# it. The 408 faces that touch the mask all sit at hue 190-200 with saturation
# 0.38 except a rim of metal edges, which is why the band can stay this tight.
Z_RANGE = (0.38, 1.36)

# A face whose colour happens to match the band on the rim of an armoured sleeve
# would tint a grey sleeve red; the tunic is one large connected patch, so
# anything smaller than this is noise.
MIN_COMPONENT_FACES = 40

ACCENT_SLOT_NAME = "TeamAccent"

# The base-colour image, cached on first read. `setup_accent_pass` replaces the
# body's materials with the holdout, so a second pass in the same session can no
# longer find the atlas through a material slot; the mask is derived from the
# same image every time, so remembering it keeps the pass repeatable.
_BASE_IMAGE: bpy.types.Image | None = None
ACCENT_BASE_COLOUR = (0.93, 0.93, 0.93, 1.0)


def base_colour_image(material: bpy.types.Material) -> bpy.types.Image | None:
    if not material or not material.use_nodes:
        return None
    for node in material.node_tree.nodes:
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        name = node.image.name.lower()
        if "normal" in name or "metallic" in name:
            continue
        return node.image
    return None


def image_pixels(image: bpy.types.Image) -> tuple[np.ndarray, int, int]:
    width, height = image.size
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    return buffer.reshape(height, width, 4), width, height


def face_features(
    mesh: bpy.types.Mesh, pixels: np.ndarray, width: int, height: int
) -> tuple[np.ndarray, np.ndarray]:
    """Per-face sampled colour (mean of its UV texels) and world-space centre."""
    uvs = mesh.uv_layers.active.data
    colours = np.zeros((len(mesh.polygons), 3), dtype=np.float32)
    centres = np.zeros((len(mesh.polygons), 3), dtype=np.float32)
    for poly in mesh.polygons:
        samples = []
        for loop_index in poly.loop_indices:
            uv = uvs[loop_index].uv
            x = min(width - 1, max(0, int(uv.x * width)))
            # Blender's image rows run bottom-up; UV v is bottom-up too.
            y = min(height - 1, max(0, int(uv.y * height)))
            samples.append(pixels[y, x, :3])
        colours[poly.index] = np.mean(samples, axis=0)
        centre = mesh.vertices[poly.vertices[0]].co
        centres[poly.index] = np.array(centre)
    return colours, centres


def hsv(colours: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    maximum = colours.max(axis=1)
    minimum = colours.min(axis=1)
    delta = maximum - minimum
    saturation = np.where(maximum > 1e-6, delta / np.maximum(maximum, 1e-6), 0.0)
    hue = np.zeros_like(maximum)
    for index in range(len(colours)):
        r, g, b = colours[index]
        d = delta[index]
        if d < 1e-6:
            continue
        if maximum[index] == r:
            hue[index] = (60.0 * ((g - b) / d)) % 360.0
        elif maximum[index] == g:
            hue[index] = 60.0 * ((b - r) / d) + 120.0
        else:
            hue[index] = 60.0 * ((r - g) / d) + 240.0
    return hue, saturation, maximum


def _largest_components(mesh: bpy.types.Mesh, selected: np.ndarray) -> np.ndarray:
    """Drop selected islands smaller than ``MIN_COMPONENT_FACES``."""
    edge_faces: dict[tuple[int, int], list[int]] = defaultdict(list)
    for poly in mesh.polygons:
        for key in poly.edge_keys:
            edge_faces[key].append(poly.index)
    neighbours: dict[int, list[int]] = defaultdict(list)
    for faces in edge_faces.values():
        for left in faces:
            for right in faces:
                if left != right:
                    neighbours[left].append(right)

    keep = np.zeros_like(selected)
    visited = np.zeros_like(selected)
    for seed in np.nonzero(selected)[0]:
        if visited[seed]:
            continue
        stack = [int(seed)]
        visited[seed] = True
        component: list[int] = []
        while stack:
            current = stack.pop()
            component.append(current)
            for neighbour in neighbours[current]:
                if selected[neighbour] and not visited[neighbour]:
                    visited[neighbour] = True
                    stack.append(neighbour)
        if len(component) >= MIN_COMPONENT_FACES:
            keep[component] = True
    return keep


def body_base_image(body: bpy.types.Object) -> bpy.types.Image:
    """The body's base-colour atlas, or an exit when the mesh has none."""
    global _BASE_IMAGE
    if _BASE_IMAGE is None:
        _BASE_IMAGE = base_colour_image(body.material_slots[0].material)
    if _BASE_IMAGE is None:
        raise SystemExit("team_accent: the body has no base-colour texture")
    return _BASE_IMAGE


def select_accent_faces(body: bpy.types.Object) -> np.ndarray:
    mesh = body.data
    image = body_base_image(body)
    pixels, width, height = image_pixels(image)
    colours, centres = face_features(mesh, pixels, width, height)
    hue, saturation, value = hsv(colours)
    z = centres[:, 2]
    band = (
        (hue >= HUE_RANGE[0])
        & (hue <= HUE_RANGE[1])
        & (saturation >= MIN_SATURATION)
        & (value >= MIN_VALUE)
        & (z >= Z_RANGE[0])
        & (z <= Z_RANGE[1])
    )
    selected = _largest_components(mesh, band)
    print(
        f"team_accent: {int(selected.sum())}/{len(selected)} faces in the cloth band "
        f"({100.0 * selected.mean():.1f}%), hues {HUE_RANGE[0]:.0f}-{HUE_RANGE[1]:.0f}, "
        f"dropped {int(band.sum() - selected.sum())} stray faces"
    )
    return selected


def accent_material() -> bpy.types.Material:
    material = bpy.data.materials.get(ACCENT_SLOT_NAME)
    if material is not None:
        return material
    material = bpy.data.materials.new(ACCENT_SLOT_NAME)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = ACCENT_BASE_COLOUR
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def assign_accent_slot(body: bpy.types.Object) -> int:
    """Move the cloth faces onto a second slot; returns how many were moved."""
    selected = select_accent_faces(body)
    material = accent_material()
    if ACCENT_SLOT_NAME not in [slot.material.name if slot.material else "" for slot in body.material_slots]:
        body.data.materials.append(material)
    slot_index = [slot.material.name for slot in body.material_slots].index(ACCENT_SLOT_NAME)
    mesh = body.data
    for poly in mesh.polygons:
        if selected[poly.index]:
            poly.material_index = slot_index
    mesh.update()
    return int(selected.sum())


def _holdout_material() -> bpy.types.Material:
    material = bpy.data.materials.get("_AccentHoldout")
    if material is not None:
        return material
    material = bpy.data.materials.new("_AccentHoldout")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    holdout = nodes.new("ShaderNodeHoldout")
    material.node_tree.links.new(holdout.outputs[0], output.inputs["Surface"])
    return material


def setup_accent_pass(body: bpy.types.Object, others) -> None:
    """Render only the cloth of ``body``: everything else holds out (transparent).

    ``others`` is every other object in the frame -- the bow, the string, the
    arrow -- so the mask cannot leak a prop into the team colour.
    """
    assign_accent_slot(body)
    holdout = _holdout_material()
    accent = accent_material()
    for obj in others:
        if obj.type == "CURVE":
            # Curve material slots are read-only mirrors of the data's list.
            for index in range(len(obj.data.materials)):
                obj.data.materials[index] = holdout
            continue
        for slot in obj.material_slots:
            if slot.material is not None:
                slot.material = holdout
    for slot in body.material_slots:
        if slot.material is None:
            continue
        slot.material = accent if slot.material.name == ACCENT_SLOT_NAME else holdout
    bpy.context.view_layer.update()


def report() -> None:
    body = bpy.data.objects[BODY_OBJECT]
    mesh = body.data
    pixels, width, height = image_pixels(body_base_image(body))
    colours, centres = face_features(mesh, pixels, width, height)
    hue, saturation, value = hsv(colours)
    z = centres[:, 2]
    for label, mask in (
        ("all", np.ones(len(hue), dtype=bool)),
        ("torso 0.85-1.20", (z > 0.85) & (z < 1.20)),
        ("head z>1.38", z > 1.38),
        ("legs z<0.55", z < 0.55),
    ):
        if not mask.any():
            continue
        print(
            f"{label:18}: faces {int(mask.sum()):5d} "
            f"hue p50 {np.median(hue[mask]):5.0f} "
            f"sat p50 {np.median(saturation[mask]):.2f} "
            f"val p50 {np.median(value[mask]):.2f}"
        )
    teal = (hue >= HUE_RANGE[0]) & (hue <= HUE_RANGE[1])
    for threshold in (0.10, 0.18, 0.24, 0.30, 0.36):
        band = teal & (saturation >= threshold) & (z > Z_RANGE[0]) & (z < Z_RANGE[1])
        print(f"teal & sat>={threshold:.2f}: {int(band.sum())} faces")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args(argv)
    if args.report:
        report()
    elif args.probe:
        body = bpy.data.objects[BODY_OBJECT]
        moved = assign_accent_slot(body)
        print(f"assigned {moved} faces to {ACCENT_SLOT_NAME}")
    else:
        parser.error("choose --probe or --report")


if __name__ == "__main__":
    main()

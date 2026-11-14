"""Compose the catapult from the checked-in ``maybanda.glb``.

The source is a static stone-throwing engine: a wooden frame on four wheels, a
long throwing arm in a cup, and a boxed counterweight at the rear. It ships with
a ``SmartRig`` armature and no actions at all -- the bones are an auto-rig from
the 3D-generation service, placed by surface heuristics rather than around the
machine's real joints. Rotating them deforms the counterweight and the frame
(measured: a 35 degree arm swing crushed the box and bent a side rail), which is
exactly what a wooden engine must never look like.

The rig is therefore rebuilt around three mechanical pivots:

- ``Frame`` -- everything rigid: frame, side rails, counterweight box;
- ``Arm`` -- the beam, cup and its axle bracket, spun about the measured pivot
  ``(x 0.282, z 1.03)``;
- ``FrontAxle`` / ``RearAxle`` -- the four wheels, spun about the measured axle
  centres.

Every face is assigned to exactly one bone at weight 1, so a rotation is rigid
per part instead of a skin deform. The mesh's own vertices are unwelded (one set
per face), which makes face-level assignment clean.

The engine is modelled facing -X, while the direction sheets are laid out for a
model facing -Y; ``FACING_YAW_DEG`` turns it onto the sheet's axis.

Team colour is the counterweight box and the two posts that carry it: the only
large, readable machined surfaces on the model, painted in the owner's colour.

Run inside Blender (``render_catapult.py`` imports this module):

    blender -b --python scripts/blender/catapult_scene.py
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MODEL_GLB = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "maybanda.glb"

BODY_OBJECT = "output_unwrapped"
SOURCE_RIG = "SmartRigArmature"

# Helper geometry the glb carries: an untextured cube, the generated-model
# icosphere, and the exporter's camera/light. Any of them would render.
HELPERS = ("Cube", "Icosphere", "Camera", "Light")

# The throwing arm's axle, measured from the bracket's vertices: the barrel that
# holds the beam spans x 0.05..0.42 (mean 0.282) and z 0.72..1.17 (mean 1.03).
ARM_PIVOT = Vector((0.282, 0.0, 1.03))

# Axle centres, fitted to the wheel rims (radius 0.165, z 0.17). The frame is
# asymmetric on purpose: the counterweight overhangs the rear axle.
FRONT_AXLE = Vector((-0.28, 0.0, 0.17))
REAR_AXLE = Vector((0.69, 0.0, 0.17))
WHEEL_RADIUS = 0.20
# Wheels sit outside the rails on y, but the outer side beams share the same y
# band, so a wheel face is also required to be short along x: the beam faces are
# long strips, the wheel's rim/spoke faces are small patches.
WHEEL_Y_RANGE = (0.385, 0.66)
WHEEL_MAX_X_SPAN = 0.12

# The source rig's arm weights. Dominant-group classification reproduces the arm
# cleanly: the beam, the cup and the axle barrel, and nothing of the frame.
ARM_GROUPS = frozenset(
    {
        "Bone_012",
        "Bone_013",
        "Bone_014",
        "Bone_015",
        "Bone_017",
        "Bone_018",
        "Bone_019",
        "Bone_020",
    }
)

# The counterweight box plus the two posts that mount it, in the mesh's own
# coordinates. Checked against the textured model from four azimuths.
ACCENT_BOX = {
    "x": (0.52, 0.95),
    # Symmetric about the centreline: the box and its two posts.
    "y": (-0.32, 0.32),
    "z": (0.45, 1.08),
}

# Sheet geometry. The catapult is rendered at 0.0125 m/px on a 224x208 cell, not
# at the infantry's 0.0183 m/px: the source engine is only 1.7 m tall, and at the
# pack's scale it reads as a handcart next to a soldier. 0.0125 m/px with the
# client's 0.95 sprite scale draws it ~1.5x a soldier, a siege engine rather
# than a toy, while keeping every other unit on its own 0.0183 m/px sheet.
CELL_WIDTH = 448  # 2x the 224 px cell
CELL_HEIGHT = 416  # 2x the 208 px cell
ORTHO_SCALE = 2.8  # metres across; the height follows the cell's aspect
GROUND_MARGIN = 0.45  # the world origin, this far above the cell bottom

# The engine faces -X in its own space; the sheet's yaw 0 is a model facing -Y.
FACING_YAW_DEG = 90.0


def _remove(objects: tuple[bpy.types.Object, ...]) -> None:
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)


def load_body() -> bpy.types.Object:
    """Import the glb and leave only its mesh, unparented and unskinned."""
    bpy.ops.import_scene.gltf(filepath=str(MODEL_GLB))
    _remove(tuple(bpy.data.objects[name] for name in HELPERS if name in bpy.data.objects))

    body = bpy.data.objects[BODY_OBJECT]
    world = body.matrix_world.copy()
    body.parent = None
    body.matrix_world = world
    for modifier in list(body.modifiers):
        body.modifiers.remove(modifier)

    rig = bpy.data.objects.get(SOURCE_RIG)
    if rig is not None:
        bpy.data.objects.remove(rig, do_unlink=True)
    return body


def _dominant_groups(body: bpy.types.Object) -> list[str | None]:
    """Name of each vertex's heaviest original weight, before the rig is replaced."""
    names = {group.index: group.name for group in body.vertex_groups}
    dominant: list[str | None] = []
    for vertex in body.data.vertices:
        if not vertex.groups:
            dominant.append(None)
            continue
        heaviest = max(vertex.groups, key=lambda entry: entry.weight)
        dominant.append(names[heaviest.group])
    return dominant


def _wheel_bone(center: Vector) -> str | None:
    if not (WHEEL_Y_RANGE[0] <= abs(center.y) <= WHEEL_Y_RANGE[1]):
        return None
    for bone, axle in (("FrontAxle", FRONT_AXLE), ("RearAxle", REAR_AXLE)):
        dx = center.x - axle.x
        dz = center.z - axle.z
        if dx * dx + dz * dz <= WHEEL_RADIUS * WHEEL_RADIUS:
            return bone
    return None


def classify_faces(body: bpy.types.Object) -> list[str]:
    """Bone name for every face: a rigid wheel, the arm, or the frame."""
    dominant = _dominant_groups(body)
    assignment: list[str] = []
    for poly in body.data.polygons:
        xs = [body.data.vertices[index].co.x for index in poly.vertices]
        center = sum((body.data.vertices[index].co for index in poly.vertices), Vector()) / len(
            poly.vertices
        )
        wheel = _wheel_bone(center)
        if wheel is not None and max(xs) - min(xs) <= WHEEL_MAX_X_SPAN:
            assignment.append(wheel)
            continue
        arm_votes = sum(1 for index in poly.vertices if dominant[index] in ARM_GROUPS)
        assignment.append("Arm" if arm_votes * 2 > len(poly.vertices) else "Frame")
    return assignment


def bind_mechanical_rig(body: bpy.types.Object) -> bpy.types.Object:
    """Replace the auto-rig with Frame/Arm/FrontAxle/RearAxle and hard-weight it."""
    assignment = classify_faces(body)
    counts = {name: assignment.count(name) for name in ("Frame", "Arm", "FrontAxle", "RearAxle")}

    body.vertex_groups.clear()
    groups = {
        name: body.vertex_groups.new(name=name)
        for name in ("Frame", "Arm", "FrontAxle", "RearAxle")
    }
    per_bone: dict[str, list[int]] = {name: [] for name in groups}
    for poly, bone in zip(body.data.polygons, assignment):
        per_bone[bone].extend(poly.vertices)
    for bone, vertices in per_bone.items():
        if vertices:
            groups[bone].add(sorted(set(vertices)), 1.0, "REPLACE")

    armature = bpy.data.armatures.new("CatapultRigData")
    rig = bpy.data.objects.new("CatapultRig", armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    frame = armature.edit_bones.new("Frame")
    frame.head = (0.0, 0.0, 0.0)
    frame.tail = (0.0, 0.0, 0.4)
    # Arm and wheel bones point along +Y so their local Y is the spin axis: a
    # pose bone's `rotation_euler.y` then turns them about the machine's axle
    # instead of about an arbitrary bone roll.
    for name, head in (
        ("Arm", ARM_PIVOT),
        ("FrontAxle", FRONT_AXLE),
        ("RearAxle", REAR_AXLE),
    ):
        bone = armature.edit_bones.new(name)
        bone.head = head
        bone.tail = (head.x, head.y + 0.35, head.z)
        bone.parent = frame
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    body.parent = rig
    body.matrix_parent_inverse = Matrix.Identity(4)
    modifier = body.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    modifier.use_vertex_groups = True
    bpy.context.view_layer.update()

    print(
        "catapult rig: "
        + ", ".join(f"{name} {counts[name]} faces" for name in counts)
    )
    return rig


def build_scene() -> tuple[bpy.types.Object, bpy.types.Object]:
    """The unit root (shared with every frame) and its mesh."""
    body = load_body()
    rig = bind_mechanical_rig(body)
    bpy.context.view_layer.update()
    return rig, body


def select_accent_faces(body: bpy.types.Object) -> np.ndarray:
    """Faces of the counterweight box and its mounting posts, per polygon."""
    selected = np.zeros(len(body.data.polygons), dtype=bool)
    for poly in body.data.polygons:
        center = sum(
            (body.data.vertices[index].co for index in poly.vertices), Vector()
        ) / len(poly.vertices)
        inside = (
            ACCENT_BOX["x"][0] <= center.x <= ACCENT_BOX["x"][1]
            and ACCENT_BOX["y"][0] <= center.y <= ACCENT_BOX["y"][1]
            and ACCENT_BOX["z"][0] <= center.z <= ACCENT_BOX["z"][1]
        )
        selected[poly.index] = inside
    print(
        f"catapult accent: {int(selected.sum())}/{len(selected)} faces "
        f"({100.0 * selected.mean():.1f}% of the mesh)"
    )
    return selected


def setup_render(
    width: int = CELL_WIDTH,
    height: int = CELL_HEIGHT,
    ortho_scale: float = ORTHO_SCALE,
    ground_margin: float = GROUND_MARGIN,
    samples: int = 24,
    elevation_deg: float = 20.0,
) -> bpy.types.Camera:
    """Orthographic camera at the infantry pack's 20 degree elevation.

    ``ortho_scale`` is the width of the view in metres; ``ground_margin`` puts
    the world origin -- the game's sprite anchor -- that far above the cell
    bottom, exactly as ``archer_scene.setup_render`` does.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.film_transparent = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("CatapultWorld")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.62, 0.66, 0.72, 1.0)
    background.inputs[1].default_value = 0.45

    key = bpy.data.lights.new("Key", type="SUN")
    key.energy = 3.2
    key.angle = math.radians(8)
    key_obj = bpy.data.objects.new("Key", key)
    scene.collection.objects.link(key_obj)
    key_obj.rotation_euler = Euler((math.radians(48), 0.0, math.radians(40)), "XYZ")

    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 1.1
    fill_obj = bpy.data.objects.new("Fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = Euler((math.radians(70), 0.0, math.radians(-125)), "XYZ")

    camera_data = bpy.data.cameras.new("Cam")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ortho_scale
    camera = bpy.data.objects.new("Cam", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    elevation = math.radians(elevation_deg)
    centre = Vector((0.0, 0.0, ortho_scale * 0.5))
    camera.location = centre + Vector(
        (0.0, -math.cos(elevation), math.sin(elevation))
    ) * 20.0
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

    up = camera.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    origin_y = (camera.matrix_world.inverted() @ Vector((0.0, 0.0, 0.0))).y
    view_height = ortho_scale * height / width
    target_origin_y = -view_height * 0.5 + ground_margin
    camera.location = camera.location + up.normalized() * (origin_y - target_origin_y)
    bpy.context.view_layer.update()
    return camera


def main() -> None:
    import sys

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = argv[0] if argv else str(REPO_ROOT / "scripts" / "blender" / "out" / "catapult_test.png")
    build_scene()
    setup_render()
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("WROTE", out)


if __name__ == "__main__":
    main()

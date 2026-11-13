"""Compose the mounted knight from the two source .blend files.

The rider (linh.blend) is a Mixamo-rigged knight with a bone-parented sword; the
horse (ngua.blend) is an armoured warhorse on a SmartRig armature. Both face -Y
in Blender, so the horse keeps its own walk cycle and the rider is posed into a
saddle posture on top of it.

Run inside Blender with the rider file already open:
    blender -b scripts/raw_downloads/models/linh.blend \
        --python scripts/blender/cavalry_scene.py -- --out scripts/blender/out/test.png
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
HORSE_BLEND = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "ngua.blend"

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = Vector((0.0, 0.0, 0.0))
# Where the saddle puts the rider's pelvis: measured off the horse's back surface
# (z 1.32) plus the thickness of the seated thigh, and just behind the withers.
SADDLE_POINT = Vector((0.0, 0.20, 1.47))
# The rider is a little smaller than life to keep the mount readable at sprite
# scale; 0.92 puts his head about two heads over the withers.
RIDER_SCALE = 0.95


def _append_objects(blend_path: str, names: list[str]) -> None:
    path = bpy.path.abspath(blend_path)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    for obj in dst.objects:
        bpy.context.scene.collection.objects.link(obj)


def load_sources() -> tuple[bpy.types.Object, bpy.types.Object]:
    if "SmartRigArmature" not in bpy.data.objects:
        _append_objects(str(HORSE_BLEND), ["SmartRigArmature", "output_unwrapped"])
    rider_arm = bpy.data.objects["Armature"]
    horse_arm = bpy.data.objects["SmartRigArmature"]

    rider_arm.name = "Rider"
    horse_arm.name = "Horse"

    # Helper geometry carried by the exports (an untextured icosphere) would
    # render as a grey ball behind the unit.
    for obj in list(bpy.data.objects):
        if obj.name.lower().startswith("icosphere"):
            bpy.data.objects.remove(obj, do_unlink=True)

    for arm in (rider_arm, horse_arm):
        if arm.animation_data:
            arm.animation_data.action = None
            for track in list(arm.animation_data.nla_tracks):
                arm.animation_data.nla_tracks.remove(track)
        for pb in arm.pose.bones:
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    return rider_arm, horse_arm


def rider_saddle_offset(rider_arm: bpy.types.Object) -> Vector:
    """Translation that lands the rider's pelvis on ``SADDLE_POINT``."""
    pelvis = rider_arm.pose.bones["mixamorig:Hips"].head.copy()
    return SADDLE_POINT - pelvis


def stance_shift(arm: bpy.types.Object, rider_pelvis: Vector) -> None:
    """Move the rider armature so his pelvis lands on ``SADDLE_POINT``."""
    k = SADDLE_POINT - rider_pelvis
    arm.location = k
    arm.scale = (RIDER_SCALE,) * 3
    bpy.context.view_layer.update()


def aim_bone(arm: bpy.types.Object, bone: str, target_dir: Vector) -> None:
    """Swing a pose bone about its head until it points along ``target_dir``.

    Directions are in armature space, which is what the rest pose in this file
    is measured in. Working from directions instead of per-bone Euler axes keeps
    the mount pose readable; the generated roll is the minimal twist.
    """
    pb = arm.pose.bones[bone]
    bpy.context.view_layer.update()
    head = pb.head.copy()
    current = (pb.tail - head).normalized()
    target = target_dir.normalized()
    q = current.rotation_difference(target)
    pb.matrix = (
        Matrix.Translation(head)
        @ q.to_matrix().to_4x4()
        @ Matrix.Translation(-head)
        @ pb.matrix
    )
    bpy.context.view_layer.update()


def rotate_bone(arm: bpy.types.Object, bone: str, euler_deg: tuple[float, float, float]) -> None:
    """Rotate a pose bone in its own local space (degrees)."""
    pb = arm.pose.bones[bone]
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = Euler(
        [math.radians(a) for a in euler_deg], "XYZ"
    ).to_quaternion() @ pb.rotation_quaternion
    bpy.context.view_layer.update()


def pose_rider_mounted(rider: bpy.types.Object) -> None:
    """Sitting posture: legs astride, torso upright, hands on the reins."""
    # Pelvis tips back a touch so the rider sits in the saddle instead of
    # standing on it, and the spine curls forward over the horse.
    aim_bone(rider, "mixamorig:Hips", Vector((0.0, 0.14, 1.0)))
    aim_bone(rider, "mixamorig:Spine", Vector((0.0, 0.10, 1.0)))
    aim_bone(rider, "mixamorig:Spine1", Vector((0.0, 0.02, 1.0)))
    aim_bone(rider, "mixamorig:Spine2", Vector((0.0, -0.05, 1.0)))

    for side, sign in (("Left", 1.0), ("Right", -1.0)):
        # Thighs out and forward over the horse's shoulders.
        aim_bone(
            rider,
            f"mixamorig:{side}UpLeg",
            Vector((sign * 0.55, -0.62, -0.56)),
        )
        # Shins drop vertically, slightly back, so the boots reach the stirrups.
        aim_bone(
            rider,
            f"mixamorig:{side}Leg",
            Vector((-sign * 0.18, 0.34, -0.92)),
        )
        aim_bone(
            rider,
            f"mixamorig:{side}Foot",
            Vector((-sign * 0.10, -0.55, -0.83)),
        )
        # Arms forward and down, elbows tucked, forearms up to the pommel.
        aim_bone(
            rider,
            f"mixamorig:{side}Arm",
            Vector((-sign * 0.22, -0.42, -0.88)),
        )
        aim_bone(
            rider,
            f"mixamorig:{side}ForeArm",
            Vector((-sign * 0.30, -0.86, 0.10)),
        )
    aim_bone(rider, "mixamorig:Head", Vector((0.0, -0.10, 1.0)))


# Filled in by ``build_scene`` so callers can re-seat the rider after a pose reset.
SADDLE_OFFSET = Vector((0.0, 0.0, 0.0))


def build_scene() -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    global SADDLE_OFFSET
    rider, horse = load_sources()
    rider_pelvis = rider.pose.bones["mixamorig:Hips"].head.copy() * 1.0
    SADDLE_OFFSET = rider_saddle_offset(rider)
    stance_shift(rider, rider_pelvis)
    pose_rider_mounted(rider)

    root = bpy.data.objects.new("UnitRoot", None)
    bpy.context.scene.collection.objects.link(root)
    for obj in (rider, horse):
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()
    bpy.context.view_layer.update()
    return root, rider, horse


def setup_render(
    px: int,
    ortho_scale: float,
    elevation_deg: float,
    azim_deg: float,
    ground_margin: float = 0.5,
) -> bpy.types.Camera:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.film_transparent = True
    scene.render.resolution_x = px
    scene.render.resolution_y = px
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("CavalryWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.66, 0.72, 1.0)
    bg.inputs[1].default_value = 0.45

    sun = bpy.data.lights.new("Key", type="SUN")
    sun.energy = 3.2
    sun.angle = math.radians(8)
    sun_obj = bpy.data.objects.new("Key", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = Euler(
        (math.radians(48), 0.0, math.radians(40)), "XYZ"
    )

    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 1.1
    fill_obj = bpy.data.objects.new("Fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = Euler((math.radians(70), 0.0, math.radians(-125)), "XYZ")

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Camera sits on the -Y side (the models face -Y) at a 20 degree elevation,
    # matching the angle the shipped spearman sheets were drawn at.
    elev = math.radians(elevation_deg)
    azim = math.radians(azim_deg)
    # Aim at the unit's centre of mass, then slide along the camera's own up
    # vector so the world origin (the point the game anchors the sprite to) lands
    # `ground_margin` metres above the frame's bottom edge. The hooves nearest the
    # camera project below that point, and clipping them would cut the feet off in
    # three of the eight rows.
    center = Vector((0.0, 0.0, ortho_scale * 0.5))
    cam.location = center + Vector(
        (math.sin(azim) * math.cos(elev), -math.cos(azim) * math.cos(elev), math.sin(elev))
    ) * 20.0
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

    up = cam.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    origin_y = (cam.matrix_world.inverted() @ Vector((0.0, 0.0, 0.0))).y
    target_origin_y = -ortho_scale * 0.5 + ground_margin
    cam.location = cam.location + up.normalized() * (origin_y - target_origin_y)
    bpy.context.view_layer.update()
    return cam


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = argv[0] if argv else "scripts/blender/out/cav_test.png"
    azim = float(argv[1]) if len(argv) > 1 else 0.0
    px = int(argv[2]) if len(argv) > 2 else 384

    build_scene()
    setup_render(px, ortho_scale=3.2, elevation_deg=20.0, azim_deg=azim)
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("WROTE", out)


if __name__ == "__main__":
    main()

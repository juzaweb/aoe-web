"""Render the mounted knight's directional action sheets.

Builds the unit from the two source .blend files (via ``cavalry_scene``), plays
each action, and writes one PNG per (action, direction, frame) to
``scripts/blender/out/frames``. ``assemble_cavalry_sheets.py`` packs those into
the Phaser sheets.

Camera and scale are fixed for every frame so the whole set shares one
world-to-pixel mapping; the ground plane sits a constant few pixels above the
canvas bottom, which is what puts every frame's hooves on the same line.

Usage:
    blender -b scripts/raw_downloads/models/linh.blend \
        --python scripts/blender/render_cavalry.py -- [--only walk] [--px 448]
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
import mathutils

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cavalry_scene as cs  # noqa: E402

OUT = Path(__file__).resolve().parent / "out" / "frames"

# Row order is compass-from-east, the order ``unitDirections.ts`` indexes with.
# The model faces -Y at yaw 0, which is "toward the viewer", i.e. row 2 (S).
DIRECTION_YAW_DEG = {
    "E": 90.0,
    "SE": 45.0,
    "S": 0.0,
    "SW": -45.0,
    "W": -90.0,
    "NW": -135.0,
    "N": 180.0,
    "NE": 135.0,
}

FRAMES = {"idle": 4, "walk": 11, "attack": 10, "death": 8}

# Cell geometry shared with ``unitArt.ts`` and the assembler: a 4.1 m square of
# world space drawn into the cell, the tile's ground point 0.45 m above its bottom
# edge. Sized from the measured union of all four actions (3.81 m wide, 3.24 m
# tall): the death fall lays the whole mount across the frame, which sets the
# width, and the attack's raised sword sets the top.
ORTHO_SCALE = 4.1
PIXELS = 448
GROUND_MARGIN = 0.45

# Horse walk cycle in the source file; sampled over 0..31 for 11 frames.
HORSE_WALK_RANGE = (1.0, 32.0)
# Sword combo window: the overhead chop, from the wind-up to the follow-through.
ATTACK_RANGE = (6.0, 26.0)
LEG_BONES = ("UpLeg", "Leg", "Foot", "Toe")


def reset_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def mount_pose(rider: bpy.types.Object) -> None:
    """Reset both pose and rider offset, then re-seat him on the saddle."""
    reset_pose(rider)
    rider.location = cs.SADDLE_OFFSET
    rider.scale = (cs.RIDER_SCALE,) * 3
    bpy.context.view_layer.update()
    cs.pose_rider_mounted(rider)


def build_attack_action(rider: bpy.types.Object) -> bpy.types.Action:
    """The sword combo with its leg and root-motion channels stripped.

    The mounted legs are held by the pose, so the action must not touch them;
    the hips' location curve is Mixamo root motion and would slide the rider out
    of the saddle.
    """
    source = bpy.data.actions["Triple_Combo_Attack"].copy()
    source.name = "MountedAttack"
    drop = []
    for fc in source.fcurves:
        path = fc.data_path
        lower = any(f'"{side}{part}"' in path for side in ("Left", "Right") for part in LEG_BONES)
        if lower:
            drop.append(fc)
        elif path.endswith(".location"):
            drop.append(fc)
        elif "Spine" in path or "Neck" in path or "Head" in path:
            # Keep a trace of the torso's lean: full strength folds the rider onto
            # the horse's neck. Quaternion X/Y/Z scaled toward 0 leaves W, which
            # is the shortest rotation toward the rest pose.
            if fc.array_index != 0:
                for kp in fc.keyframe_points:
                    kp.co.y *= 0.35
                    kp.handle_left.y *= 0.35
                    kp.handle_right.y *= 0.35
    for fc in drop:
        source.fcurves.remove(fc)
    rider.animation_data_create()
    rider.animation_data.action = source
    return source


def assign_horse_action(horse: bpy.types.Object, name: str) -> None:
    horse.animation_data_create()
    horse.animation_data.action = bpy.data.actions[name]


def clear_actions(rider: bpy.types.Object, horse: bpy.types.Object) -> None:
    for arm in (rider, horse):
        if arm.animation_data:
            arm.animation_data.action = None
    bpy.context.view_layer.update()


def sway(rider: bpy.types.Object, phase: float, amount: float, bone: str, axis: str) -> None:
    """Nudge one bone by a sine-driven angle, on top of whatever pose it holds."""
    index = "XYZ".index(axis)
    euler = [0.0, 0.0, 0.0]
    euler[index] = amount * math.sin(phase)
    pb = rider.pose.bones[bone]
    pb.rotation_quaternion = (
        mathutils.Euler([math.radians(a) for a in euler], "XYZ").to_quaternion() @ pb.rotation_quaternion
    )
    bpy.context.view_layer.update()


def pose_for(action: str, t: float, rider: bpy.types.Object, horse: bpy.types.Object, root: bpy.types.Object) -> None:
    """Pose one frame. ``t`` runs 0..1 across the action.

    The root carries the fall as a quaternion about the unit's own axes; the
    facing yaw is composed on top in ``render_frames``. Setting that pair as an
    Euler made the yaw and the roll fight over the same axes, which silently
    stood the corpse back up in three of the eight rows.
    """
    mount_pose(rider)
    clear_actions(rider, horse)
    mount_pose(rider)
    root.rotation_mode = "QUATERNION"
    root.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    root.location = (0.0, 0.0, 0.0)

    if action == "idle":
        # Breathing only: the horse is planted, the rider's chest rises a hair.
        sway(rider, t * math.tau, 1.1, "mixamorig:Spine1", "X")
        sway(rider, t * math.tau, 0.8, "mixamorig:Head", "X")
        sway(rider, t * math.tau, 1.4, "mixamorig:RightForeArm", "X")
    elif action == "walk":
        assign_horse_action(horse, "Walk")
        bpy.context.scene.frame_set(int(HORSE_WALK_RANGE[0] + t * (HORSE_WALK_RANGE[1] - HORSE_WALK_RANGE[0])))
        bpy.context.view_layer.update()
        # The horse's bob carries the rider: a small lagged lean sells the seat.
        sway(rider, t * math.tau + 0.9, 1.6, "mixamorig:Spine", "X")
        sway(rider, t * math.tau + 0.4, 1.2, "mixamorig:Head", "X")
    elif action == "attack":
        build_attack_action(rider)
        bpy.context.scene.frame_set(int(ATTACK_RANGE[0] + t * (ATTACK_RANGE[1] - ATTACK_RANGE[0])))
        bpy.context.view_layer.update()
        # The horse braces into the swing.
        root.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    elif action == "death":
        # A hit reels the mount over on its side; the corpse settles a little as
        # the rider slumps across its neck. Rolling about the facing axis is the
        # only fall where the horse ends up lying flat: pitching about X stands
        # the spine up instead of laying it down.
        ease = t ** 1.7
        root.rotation_quaternion = mathutils.Euler((0.0, math.radians(84.0) * ease, 0.0), "XYZ").to_quaternion()
        root.location = (0.0, 0.0, -0.10 * ease * ease)
        slump = 18.0 * ease
        cs.rotate_bone(rider, "mixamorig:Spine", (slump, 0.0, 0.0))
        cs.rotate_bone(rider, "mixamorig:Spine1", (slump * 0.7, 0.0, 0.0))
        cs.rotate_bone(rider, "mixamorig:Head", (slump * 0.8, 0.0, 0.0))
    else:
        raise SystemExit(f"unknown action {action}")


def render_frames(only: list[str] | None) -> None:
    root, rider, horse = cs.build_scene()
    cam = cs.setup_render(PIXELS, ortho_scale=ORTHO_SCALE, elevation_deg=20.0, azim_deg=0.0, ground_margin=GROUND_MARGIN)
    cam.data.ortho_scale = ORTHO_SCALE

    for action, count in FRAMES.items():
        if only and action not in only:
            continue
        for direction, yaw in DIRECTION_YAW_DEG.items():
            folder = OUT / action / direction
            folder.mkdir(parents=True, exist_ok=True)
            for i in range(count):
                t = i / count
                # The root spins the unit; the camera and key light stay put, so
                # each direction carries its own natural shading.
                pose_for(action, t, rider, horse, root)
                # Compass yaw composed on top of whatever the action put on the
                # root, so a fall keeps its axis in every row.
                yaw_quat = mathutils.Euler((0.0, 0.0, math.radians(yaw)), "XYZ").to_quaternion()
                root.rotation_quaternion = yaw_quat @ root.rotation_quaternion
                bpy.context.view_layer.update()
                bpy.context.scene.render.filepath = str(folder / f"{i:02d}.png")
                bpy.ops.render.render(write_still=True)
        print(f"ACTION {action} done")


def main() -> None:
    global PIXELS
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--px", type=int, default=PIXELS)
    args = parser.parse_args(argv)
    PIXELS = args.px
    bpy.context.scene.cycles.samples = 24
    render_frames(args.only)
    print("RENDER DONE")


if __name__ == "__main__":
    main()

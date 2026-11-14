"""Render the catapult's directional action sheets.

The machine is posed by three mechanical pivots (see ``catapult_scene``): the
throwing arm on its axle, the front and rear wheel axles, and the rigid frame.

- ``idle``: the arm breathes a fraction of a degree and the frame settles;
- ``walk``: both axles turn one full revolution per cycle (rolling toward the
  model's -X face) with a two-beat frame bob, so the engine reads as rolling
  rather than gliding;
- ``attack``: the arm is winched down over six frames, then released through a
  fast forward swing and settles -- a mangonel's shot, not a bow's draw;
- ``death``: the engine shudders, then topples onto its side about the near
  ground edge and the arm drops. Every frame is recentred horizontally because
  the toppled machine is wider than its upright footprint.

The source model faces -X; ``FACING_YAW_DEG`` turns it onto the sheet's -Y axis,
so the arm throws along the row's facing.

Usage:
    blender -b --python scripts/blender/render_catapult.py -- [--only attack] [--dirs S,E] [--px 448]

    # team-colour mask: the counterweight box alone, white, on the same frames
    blender -b --python scripts/blender/render_catapult.py -- --accent
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import catapult_scene as csc  # noqa: E402
import team_accent  # noqa: E402

OUT = Path(__file__).resolve().parent / "out" / "catapult_frames"
ACCENT_OUT = Path(__file__).resolve().parent / "out" / "catapult_accent_frames"

# Row order is compass-from-east, the order ``unitDirections.ts`` indexes with.
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

# The arm's loaded and released angles, in degrees about its axle. The rest pose
# is the released, upright arm; the shot starts by winching it down.
COCK_DEG = -40.0
RELEASE_DEG = 14.0
COCK_END_T = 0.60
RELEASE_T = 0.72

# Wheels turn one revolution per walk cycle. A negative angle about the bone's
# own +Y axis rolls the machine toward its model-space -X face, i.e. forward.
WALK_WHEEL_DEG = -360.0

# The topple: about the model's own +X axis, pivoting on the ground edge at
# y -0.61 so the machine lies down on its side instead of sinking through the
# floor. 78 degrees is short of flat, which reads as wrecked rather than levelled.
DEATH_TIP_DEG = 78.0
DEATH_PIVOT = Vector((0.0, -0.61, 0.0))
DEATH_END_T = 0.80

# Leave this much empty cell around the toppled machine when recentring it.
DEATH_MARGIN_PX = 8


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def reset_pose(rig: bpy.types.Object) -> None:
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
    rig.rotation_mode = "QUATERNION"
    rig.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    rig.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()


def _tip(x_deg: float = 0.0, y_deg: float = 0.0) -> Quaternion:
    """Rotation about the model's own X (topple) and Y (pitch) axes."""
    return (
        Quaternion((1.0, 0.0, 0.0), math.radians(x_deg))
        @ Quaternion((0.0, 1.0, 0.0), math.radians(y_deg))
    )


def _recentre(rig: bpy.types.Object, camera: bpy.types.Object) -> None:
    """Slide the posed machine horizontally so its silhouette stays in cell."""
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    body = bpy.data.objects[csc.BODY_OBJECT]
    evaluated = body.evaluated_get(depsgraph)
    matrix = evaluated.matrix_world
    lowest = 1e9
    highest = -1e9
    for vertex in evaluated.data.vertices:
        projected = world_to_camera_view(scene, camera, matrix @ vertex.co)
        lowest = min(lowest, projected.x)
        highest = max(highest, projected.x)
    margin = DEATH_MARGIN_PX / scene.render.resolution_x
    if lowest >= margin and highest <= 1.0 - margin:
        return
    shift = (0.5 - (lowest + highest) * 0.5) * camera.data.ortho_scale
    right = camera.matrix_world.to_3x3() @ Vector((1.0, 0.0, 0.0))
    rig.location = rig.location + right.normalized() * shift
    bpy.context.view_layer.update()


def pose_for(action: str, t: float, direction: str, rig: bpy.types.Object, camera: bpy.types.Object) -> None:
    """Pose one frame; ``t`` runs 0..1 across the action."""
    reset_pose(rig)

    arm_deg = 0.0
    tip_deg = 0.0
    pitch_deg = 0.0
    bob = 0.0
    pivot_shift = Vector((0.0, 0.0, 0.0))

    if action == "idle":
        phase = t * math.tau
        arm_deg = 0.8 * math.sin(phase)
        bob = 0.003 * math.sin(phase)
        pitch_deg = 0.25 * math.sin(phase + 0.7)
    elif action == "walk":
        phase = t * math.tau
        # One turn per cycle, plus a two-beat bob from the plank surface.
        for axle in ("FrontAxle", "RearAxle"):
            rig.pose.bones[axle].rotation_euler = (
                0.0,
                math.radians(WALK_WHEEL_DEG * t),
                0.0,
            )
        arm_deg = 0.9 * math.sin(phase)
        bob = 0.008 * math.sin(phase * 2.0)
        pitch_deg = 0.45 * math.sin(phase * 2.0 + 1.1)
    elif action == "attack":
        phase = t
        if phase < COCK_END_T:
            arm_deg = COCK_DEG * smoothstep(phase / COCK_END_T)
            # The winch pulls the front of the frame down as the arm comes back.
            pitch_deg = -1.2 * smoothstep(phase / COCK_END_T)
        elif phase < RELEASE_T:
            release = smoothstep((phase - COCK_END_T) / (RELEASE_T - COCK_END_T))
            arm_deg = COCK_DEG + (RELEASE_DEG - COCK_DEG) * release
            # The frame kicks back as the arm whips forward.
            pitch_deg = -1.2 + 2.6 * release
        else:
            settle = smoothstep((phase - RELEASE_T) / (1.0 - RELEASE_T))
            arm_deg = RELEASE_DEG * (1.0 - settle)
            pitch_deg = 1.4 * (1.0 - settle)
    elif action == "death":
        # A shudder, then the topple: the frame tips onto its side while the
        # arm falls slack across it.
        shudder = math.sin(t * math.tau * 2.5) * (1.0 - smoothstep(t / 0.3))
        tip_deg = DEATH_TIP_DEG * smoothstep((t - 0.22) / (DEATH_END_T - 0.22))
        arm_deg = -20.0 * smoothstep((t - 0.30) / 0.5) + 1.2 * shudder
        pitch_deg = 0.8 * shudder
        rotation = _tip(tip_deg)
        pivot_shift = DEATH_PIVOT - rotation @ DEATH_PIVOT
    else:
        raise SystemExit(f"unknown action {action}")

    yaw = Quaternion(
        (0.0, 0.0, 1.0),
        math.radians(DIRECTION_YAW_DEG[direction] + csc.FACING_YAW_DEG),
    )
    rotation = _tip(tip_deg, pitch_deg)
    rig.rotation_quaternion = yaw @ rotation
    rig.location = yaw @ pivot_shift + Vector((0.0, 0.0, bob))
    rig.pose.bones["Arm"].rotation_euler = (0.0, math.radians(arm_deg), 0.0)
    bpy.context.view_layer.update()

    if action == "death":
        _recentre(rig, camera)


def render_frames(
    only: list[str] | None, directions: list[str] | None, render_pass: str = "body"
) -> None:
    rig, body = csc.build_scene()
    camera = csc.setup_render(
        csc.CELL_WIDTH, csc.CELL_HEIGHT, csc.ORTHO_SCALE, csc.GROUND_MARGIN
    )

    out_dir = OUT
    if render_pass == "accent":
        selected = csc.select_accent_faces(body)
        team_accent.setup_accent_pass(body, [], selected)
        out_dir = ACCENT_OUT

    for action, count in FRAMES.items():
        if only and action not in only:
            continue
        for direction in DIRECTIONS:
            if directions and direction not in directions:
                continue
            folder = out_dir / action / direction
            folder.mkdir(parents=True, exist_ok=True)
            for index in range(count):
                pose_for(action, index / count, direction, rig, camera)
                bpy.context.scene.render.filepath = str(folder / f"{index:02d}.png")
                bpy.ops.render.render(write_still=True)
        print(f"ACTION {action} done")


DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--dirs", nargs="*", default=None)
    parser.add_argument("--px", type=int, default=csc.CELL_WIDTH)
    parser.add_argument(
        "--accent",
        action="store_true",
        help="render the team-colour mask pass instead of the body",
    )
    args = parser.parse_args(argv)

    csc.CELL_WIDTH = args.px
    csc.CELL_HEIGHT = round(args.px * 208 / 224)
    # Keep the same metres-per-pixel at any render size: the default 2.8 m view
    # is defined for the 448 px (2x) render the sheets are packed from.
    csc.ORTHO_SCALE = 2.8 * args.px / 448.0

    bpy.context.scene.cycles.samples = 24
    render_frames(args.only, args.dirs, "accent" if args.accent else "body")
    print("RENDER DONE")


if __name__ == "__main__":
    main()

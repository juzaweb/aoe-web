"""Render the archer's directional action sheets.

Builds the unit from the soldier and the bow (via ``archer_scene``), plays each
action, and writes one PNG per (action, direction, frame) to
``scripts/blender/out/archer_frames``. ``assemble_archer_sheets.py`` packs those
into the client's 192x168 sheets.

Camera and scale are fixed for every frame, so the whole set shares one
world-to-pixel mapping; the ground plane sits a constant few pixels above the
canvas bottom, which is what puts every frame's soles on the same line the
spearman and the villager stand on.

The source clip aims along the unit's +X (the bow arm is extended sideways), so
the attack rows are spun an extra -90 degrees: the arrow then leaves along the
row's own facing instead of 90 degrees off it.

Usage:
    blender -b scripts/raw_downloads/models/linh.blend \
        --python scripts/blender/render_archer.py -- [--only attack] [--dirs S,E] [--px 384]
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
import mathutils
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archer_scene as asc  # noqa: E402

OUT = Path(__file__).resolve().parent / "out" / "archer_frames"

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

# Cell geometry shared with ``unitArt.ts`` and the assembler: 192x168 at the
# spearman's 0.0183 m/px, rendered at 2x. The bows' upper tip sets the top of the
# drawn pose; the death fall sets the width.
CELL_WIDTH = 384  # 2x the 192 px cell
CELL_HEIGHT = 336  # 2x the 168 px cell
ORTHO_SCALE = 3.52  # metres across; the height follows the cell's aspect
GROUND_MARGIN = 0.45  # the world origin, this far above the cell bottom

# The attack is the source clip plus the loose the clip does not have: the draw
# runs to its own anchor, the last two frames snap the string straight, throw the
# arrow and kick the drawing arm back.
ATTACK_YAW_OFFSET = -90.0
DRAW_END_T = 0.7
RELEASE_T = 0.72

# Aiming along the camera's own axis (row S, row N) shows the bow edge-on, which
# is honest but unreadable at 192 px. The bow is therefore swung open about the
# vertical by this fraction of the angle that would turn its plane square to the
# camera; 0 keeps the export's plane, 1 faces the camera.
BOW_OPEN = 1.0

# Source clips.
IDLE_CLIP = "Archery_Shot_1"
WALK_CLIP = "Walking.002"
ATTACK_CLIP = "Archery_Shot_1"
DEATH_CLIP = "BeHit_FlyUp.002"

WALK_RANGE = (0.0, 24.8)
ATTACK_RANGE = (0.0, 24.0)
DEATH_RANGE = (0.0, 36.0)

# The source death launches the soldier two metres into the air, which reads as a
# spell hit rather than a fall. Its location channels (the launch) are stripped
# and the root is walked down to the ground instead; 0.55 m is what the hips'
# travel has to give up for the corpse to end up lying on the floor line.
DEATH_DROP = 0.55


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def reset_pose(soldier: bpy.types.Object) -> None:
    if soldier.animation_data:
        soldier.animation_data.action = None
    for pose_bone in soldier.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def build_death_action(soldier: bpy.types.Object) -> None:
    """The hit clip without its launch, stashed on the armature as ``ArcherDeath``."""
    if "ArcherDeath" in bpy.data.actions:
        return
    source = bpy.data.actions[DEATH_CLIP].copy()
    source.name = "ArcherDeath"
    for curve in [curve for curve in source.fcurves if curve.data_path.endswith(".location")]:
        source.fcurves.remove(curve)
    soldier.animation_data_create()
    soldier.animation_data.action = None


def assign_clip(soldier: bpy.types.Object, name: str, frame: float) -> None:
    soldier.animation_data_create()
    soldier.animation_data.action = bpy.data.actions[name]
    whole = int(math.floor(frame))
    bpy.context.scene.frame_set(whole, subframe=frame - whole)
    bpy.context.view_layer.update()


def rotate_bone(soldier: bpy.types.Object, bone: str, euler_deg: tuple[float, float, float]) -> None:
    """Add a rotation in the bone's own space, on top of the clip's pose."""
    pose_bone = soldier.pose.bones[bone]
    pose_bone.rotation_mode = "QUATERNION"
    pose_bone.rotation_quaternion = (
        mathutils.Euler([math.radians(angle) for angle in euler_deg], "XYZ").to_quaternion()
        @ pose_bone.rotation_quaternion
    )
    bpy.context.view_layer.update()


def pose_for(
    action: str,
    t: float,
    direction: str,
    root: bpy.types.Object,
    soldier: bpy.types.Object,
    bow: bpy.types.Object,
    string: bpy.types.Object,
    arrow: bpy.types.Object,
) -> None:
    """Pose one frame; ``t`` runs 0..1 across the action."""
    reset_pose(soldier)
    root.rotation_mode = "QUATERNION"
    root.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    root.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()

    drawn = False
    roll_deg = 0.0
    if action == "idle":
        # The clip's frame 0 is the archer at ease: bow arm slack, feet planted.
        assign_clip(soldier, IDLE_CLIP, 0.0)
        phase = t * math.tau
        rotate_bone(soldier, "mixamorig:Spine1", (1.2 * math.sin(phase), 0.0, 0.0))
        rotate_bone(soldier, "mixamorig:Head", (0.9 * math.sin(phase), 0.0, 0.0))
        rotate_bone(soldier, "mixamorig:RightForeArm", (1.5 * math.sin(phase), 0.0, 0.0))
        # The clip's own frame 0 leaves the bow arm behind the hip, which hides
        # the bow in the side rows; a slightly forward hang keeps it readable.
        asc.aim_bone(soldier, "mixamorig:LeftArm", Vector((0.42, -0.28, -0.86)))
    elif action == "walk":
        assign_clip(soldier, WALK_CLIP, WALK_RANGE[0] + t * (WALK_RANGE[1] - WALK_RANGE[0]))
        phase = t * math.tau
        rotate_bone(soldier, "mixamorig:Spine", (1.6 * math.sin(phase + 0.9), 0.0, 0.0))
        rotate_bone(soldier, "mixamorig:Head", (1.2 * math.sin(phase + 0.4), 0.0, 0.0))
    elif action == "attack":
        if t < RELEASE_T:
            frame = min(
                ATTACK_RANGE[1],
                ATTACK_RANGE[0] + (t / DRAW_END_T) * (ATTACK_RANGE[1] - ATTACK_RANGE[0]),
            )
            assign_clip(soldier, ATTACK_CLIP, frame)
            drawn = True
        else:
            # The clip stops at full draw, so the loose is played here: the string
            # snaps straight and the drawing arm is kicked back off the anchor.
            assign_clip(soldier, ATTACK_CLIP, ATTACK_RANGE[1])
            recoil = smoothstep((t - RELEASE_T) / (1.0 - RELEASE_T))
            rotate_bone(soldier, "mixamorig:RightForeArm", (0.0, 0.0, -34.0 * recoil))
            rotate_bone(soldier, "mixamorig:RightHand", (0.0, 0.0, -20.0 * recoil))
            rotate_bone(soldier, "mixamorig:LeftForeArm", (0.0, 0.0, 9.0 * recoil))
    elif action == "death":
        build_death_action(soldier)
        assign_clip(
            soldier, "ArcherDeath", DEATH_RANGE[0] + t * (DEATH_RANGE[1] - DEATH_RANGE[0])
        )
        root.location = (0.0, 0.0, -DEATH_DROP * t * t)
        # The bow is still in the hand as he goes down; it tips over and lands on
        # the ground line instead of standing up out of the corpse.
        roll_deg = 76.0 * smoothstep((t - 0.25) / 0.55)
    else:
        raise SystemExit(f"unknown action {action}")

    yaw = DIRECTION_YAW_DEG[direction]
    if action == "attack":
        yaw += ATTACK_YAW_OFFSET
    root.rotation_quaternion = (
        mathutils.Euler((0.0, 0.0, math.radians(yaw)), "XYZ").to_quaternion()
        @ root.rotation_quaternion
    )
    bpy.context.view_layer.update()

    hand = asc.palm_point(soldier)
    chest = soldier.matrix_world @ soldier.pose.bones["mixamorig:Spine2"].head
    string_dir = Vector((chest.x - hand.x, chest.y - hand.y, 0.0))
    if string_dir.length < 0.05:
        # The corpse's hand can sit on its own chest; fall back to the unit's
        # forward so the bow keeps a sane plane instead of spinning on noise.
        string_dir = root.matrix_world.to_quaternion() @ Vector((0.0, -1.0, 0.0))
        string_dir.z = 0.0
    asc.place_bow(bow, root, hand, string_dir, open_fraction=BOW_OPEN, roll_deg=roll_deg)
    if drawn:
        draw_hand = asc.hand_point(soldier, asc.STRING_HAND)
        nock = asc.bow_nock(bow, draw_hand, root)
        asc.move_string(string, nock)
        asc.place_arrow(arrow, bow, nock, root)
        asc.set_visible(arrow, True)
    else:
        asc.rest_string(string)
        asc.set_visible(arrow, False)


def render_frames(only: list[str] | None, directions: list[str] | None) -> None:
    root, soldier, bow, string, arrow = asc.build_scene()
    asc.setup_render(CELL_WIDTH, CELL_HEIGHT, ortho_scale=ORTHO_SCALE, ground_margin=GROUND_MARGIN)

    for action, count in FRAMES.items():
        if only and action not in only:
            continue
        for direction in DIRECTIONS:
            if directions and direction not in directions:
                continue
            folder = OUT / action / direction
            folder.mkdir(parents=True, exist_ok=True)
            for index in range(count):
                pose_for(action, index / count, direction, root, soldier, bow, string, arrow)
                bpy.context.scene.render.filepath = str(folder / f"{index:02d}.png")
                bpy.ops.render.render(write_still=True)
        print(f"ACTION {action} done")


DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]


def main() -> None:
    global CELL_WIDTH, CELL_HEIGHT, BOW_OPEN
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--dirs", nargs="*", default=None)
    parser.add_argument("--px", type=int, default=CELL_WIDTH)
    parser.add_argument("--open", type=float, default=BOW_OPEN)
    args = parser.parse_args(argv)
    BOW_OPEN = args.open

    CELL_WIDTH = args.px
    CELL_HEIGHT = round(args.px * 168 / 192)

    bpy.context.scene.cycles.samples = 24
    render_frames(args.only, args.dirs)
    print("RENDER DONE")


if __name__ == "__main__":
    main()

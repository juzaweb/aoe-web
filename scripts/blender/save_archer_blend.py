"""Save the composed archer as a stand-alone .blend.

The sheets are the shipped deliverable; this file is the editable scene behind
them: the soldier, the bow with its rebuilt three-point string, the nocked arrow,
the camera and the two suns, and every clip baked onto one timeline under
markers. Nothing here is needed to rebuild the sheets -- `render_archer.py`
places the bow, the string and the arrow procedurally, and this script bakes
exactly that placement so the file plays back without running any Python.

Timeline:

    idle    1-24    breathing, bow carried
    walk    25-49   the soldier's own walk cycle, bow swinging with the hand
    attack  50-74   draw to full anchor, then the loose and the drawing arm kick
    death   75-110  knocked down, the bow tipping over onto the floor line

Usage:
    blender -b scripts/raw_downloads/models/linh.blend \
        --python scripts/blender/save_archer_blend.py -- [out.blend]
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import archer_scene as asc  # noqa: E402
import render_archer as ra  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_OUT = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "linh_cung.blend"

# Action, marker name and the number of frames to bake. The counts follow the
# source clips (24 fps), so the scene plays at source speed rather than at the
# sheet's 4/11/10/8 keyframe sampling.
CLIPS = (
    ("idle", "Archer_Idle", "idle", 24),
    ("walk", "Archer_Walk", "walk", 25),
    ("attack", "Archer_Attack", "attack", 25),
    ("death", "Archer_Death", "death", 36),
)

DIRECTION = "S"
FPS = 24


def rename_scene(root, soldier, bow, string, arrow) -> None:
    """Give the objects the names a person opening the file would look for."""
    soldier.name = "ArcherArmature"
    soldier.data.name = "ArcherRig"
    body = bpy.data.objects.get("Mesh0")
    if body is not None:
        body.name = "ArcherBody"
        body.data.name = "ArcherBodyMesh"
    bow.name = "ArcherBow"
    bow.data.name = "ArcherBowMesh"
    string.name = "ArcherString"
    arrow.name = "ArcherArrow"
    arrow.data.name = "ArcherArrowMesh"
    root.name = "ArcherRoot"


def sample_clip(action: str, count: int, root, soldier, bow, string, arrow) -> list[dict]:
    """Pose every frame of one clip and record what the renderer would draw."""
    spline = string.data.splines[0]
    samples = []
    for index in range(count):
        ra.pose_for(action, index / count, DIRECTION, root, soldier, bow, string, arrow)
        bpy.context.view_layer.update()
        root_loc, root_quat, _ = root.matrix_basis.decompose()
        bow_loc, bow_quat, bow_scale = bow.matrix_basis.decompose()
        arrow_loc, arrow_quat, _ = arrow.matrix_basis.decompose()
        samples.append(
            {
                "pose": {
                    bone.name: (
                        bone.rotation_quaternion.copy(),
                        bone.location.copy(),
                        bone.scale.copy(),
                    )
                    for bone in soldier.pose.bones
                },
                "root": (root_loc.copy(), root_quat.copy()),
                "bow": (bow_loc.copy(), bow_quat.copy(), bow_scale.copy()),
                "string": [point.co.copy() for point in spline.points],
                "arrow": (arrow_loc.copy(), arrow_quat.copy(), not arrow.hide_render),
            }
        )
    return samples


def write_pose_keys(soldier, samples: list[dict], frame: int) -> None:
    for bone in soldier.pose.bones:
        quaternion, location, scale = samples["pose"][bone.name]
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = quaternion
        bone.location = location
        bone.scale = scale
        bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
        bone.keyframe_insert("location", frame=frame, group=bone.name)
        bone.keyframe_insert("scale", frame=frame, group=bone.name)


def write_object_keys(
    obj,
    location,
    quaternion,
    scale,
    frame: int,
    name: str,
) -> None:
    obj.rotation_mode = "QUATERNION"
    obj.location = location
    obj.rotation_quaternion = quaternion
    obj.scale = scale
    obj.keyframe_insert("location", frame=frame, group=name)
    obj.keyframe_insert("rotation_quaternion", frame=frame, group=name)
    obj.keyframe_insert("scale", frame=frame, group=name)


def write_string_keys(string, samples: list[dict], frame: int) -> None:
    spline = string.data.splines[0]
    for index, co in enumerate(samples["string"]):
        spline.points[index].co = co
        string.data.keyframe_insert(
            data_path=f"splines[0].points[{index}].co", frame=frame, group="String"
        )


def linearise(owner) -> None:
    """Bakes are per-frame samples: Bezier handles would overshoot between them."""
    animation = owner.animation_data
    if animation is None or animation.action is None:
        return
    for curve in animation.action.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"


def bake(root, soldier, bow, string, arrow) -> None:
    per_clip = [
        (marker, count, sample_clip(action, count, root, soldier, bow, string, arrow))
        for action, _action_name, marker, count in CLIPS
    ]

    soldier.animation_data_create()
    bow.animation_data_create()
    string.data.animation_data_create()
    arrow.animation_data_create()
    root.animation_data_create()

    soldier.animation_data.action = bpy.data.actions.new("ArcherBaked")
    bow.animation_data.action = bpy.data.actions.new("ArcherBowBaked")
    string.data.animation_data.action = bpy.data.actions.new("ArcherStringBaked")
    arrow.animation_data.action = bpy.data.actions.new("ArcherArrowBaked")
    root.animation_data.action = bpy.data.actions.new("ArcherRootBaked")

    frame = 1
    scene = bpy.context.scene
    for marker, count, samples in per_clip:
        scene.timeline_markers.new(marker, frame=frame)
        for offset, sample in enumerate(samples):
            current = frame + offset
            write_pose_keys(soldier, sample, current)
            root_loc, root_quat = sample["root"]
            write_object_keys(root, root_loc, root_quat, (1.0, 1.0, 1.0), current, "Root")
            bow_loc, bow_quat, bow_scale = sample["bow"]
            write_object_keys(bow, bow_loc, bow_quat, bow_scale, current, "Bow")
            write_string_keys(string, sample, current)
            arrow_loc, arrow_quat, visible = sample["arrow"]
            write_object_keys(arrow, arrow_loc, arrow_quat, (1.0, 1.0, 1.0), current, "Arrow")
            arrow.hide_render = not visible
            arrow.keyframe_insert("hide_render", frame=current, group="Arrow")
        frame += count

    for owner in (soldier, root, bow, arrow):
        linearise(owner)
    linearise(string.data)

    scene.frame_start = 1
    scene.frame_end = frame - 1
    scene.frame_set(1)
    scene.render.fps = FPS
    print(f"baked {frame - 1} frames, {len(CLIPS)} clips")


def pack_textures() -> None:
    """The soldier's textures live inside linh.blend; keep them in the copy."""
    try:
        bpy.ops.file.pack_all()
    except RuntimeError as error:  # nothing to pack, or a datablock that cannot
        print(f"pack_all: {error}")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = Path(argv[0]).resolve() if argv else DEFAULT_OUT

    root, soldier, bow, string, arrow = asc.build_scene()
    asc.setup_render(384, 336, ortho_scale=3.52, ground_margin=0.45)
    rename_scene(root, soldier, bow, string, arrow)
    bake(root, soldier, bow, string, arrow)
    pack_textures()

    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
    size = out.stat().st_size / (1024 * 1024)
    print(f"WROTE {out} ({size:.1f} MB)")


if __name__ == "__main__":
    main()

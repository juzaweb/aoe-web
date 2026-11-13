"""Measure the camera-space extent of every cavalry frame.

Used once to choose the sheet's ortho scale: the sword swings wider than the
horse, and the death tip lays the whole mount on its side, so the cell has to be
sized from the union of all actions rather than from the idle pose.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import mathutils
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cavalry_scene as cs  # noqa: E402
import render_cavalry as rc  # noqa: E402


def cam_space(cam: bpy.types.Object, point: Vector) -> Vector:
    return cam.matrix_world.inverted() @ point


def main() -> None:
    root, rider, horse = cs.build_scene()
    cam = cs.setup_render(64, ortho_scale=rc.ORTHO_SCALE, elevation_deg=20.0, azim_deg=0.0)
    bpy.context.view_layer.update()
    origin = cam_space(cam, Vector((0.0, 0.0, 0.0)))
    deps = bpy.context.evaluated_depsgraph_get()

    union = {"min_x": 1e9, "max_x": -1e9, "min_y": 1e9, "max_y": -1e9}
    for action, count in rc.FRAMES.items():
        act = {"min_x": 1e9, "max_x": -1e9, "min_y": 1e9, "max_y": -1e9}
        for direction, yaw in rc.DIRECTION_YAW_DEG.items():
            for i in range(count):
                rc.pose_for(action, i / count, rider, horse, root)
                yaw_quat = mathutils.Euler((0.0, 0.0, math.radians(yaw)), "XYZ").to_quaternion()
                root.rotation_quaternion = yaw_quat @ root.rotation_quaternion
                bpy.context.view_layer.update()
                deps = bpy.context.evaluated_depsgraph_get()
                for obj in bpy.data.objects:
                    if obj.type != "MESH":
                        continue
                    ev = obj.evaluated_get(deps)
                    mesh = ev.to_mesh()
                    mw = ev.matrix_world
                    for index, v in enumerate(mesh.vertices):
                        if index % 4:
                            continue
                        p = cam_space(cam, mw @ v.co)
                        for key, value in (("min_x", p.x), ("max_x", p.x), ("min_y", p.y), ("max_y", p.y)):
                            if key.startswith("min"):
                                act[key] = min(act[key], value)
                            else:
                                act[key] = max(act[key], value)
                    ev.to_mesh_clear()
        print(
            f"{action}: x [{act['min_x']:+.2f},{act['max_x']:+.2f}] "
            f"y [{act['min_y']:+.2f},{act['max_y']:+.2f}] "
            f"up={act['max_y'] - origin.y:+.2f} down={origin.y - act['min_y']:+.2f}"
        )
        for k in union:
            union[k] = min(union[k], act[k]) if k.startswith("min") else max(union[k], act[k])

    up = union["max_y"] - origin.y
    down = origin.y - union["min_y"]
    half_w = max(-union["min_x"], union["max_x"])
    print(f"UNION up={up:+.2f} down={down:+.2f} half_w={half_w:+.2f} origin_y={origin.y:+.2f}")
    print(f"NEEDED side={2 * half_w:.2f} height={up + down:.2f}")


if __name__ == "__main__":
    main()

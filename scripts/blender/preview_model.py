"""Render orthogonal turnaround stills of one .blend to check facing and scale.

Usage: blender -b <file.blend> --python scripts/blender/preview_model.py -- <out_dir> <tag>
"""
import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = argv[0] if argv else "scripts/blender/out"
tag = argv[1] if len(argv) > 1 else "model"

# Hide helper geometry that is not part of the character.
for obj in list(bpy.data.objects):
    if obj.name.lower().startswith("icosphere"):
        bpy.data.objects.remove(obj, do_unlink=True)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'
scene.render.film_transparent = True
scene.render.resolution_x = 384
scene.render.resolution_y = 384
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'

# World light
world = bpy.data.worlds.new("W") if not bpy.data.worlds else bpy.data.worlds[0]
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.58, 0.62, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.55

sun_data = bpy.data.lights.new("Sun", type='SUN')
sun_data.energy = 3.0
sun = bpy.data.objects.new("Sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))

# Bounds of all meshes
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
deps = bpy.context.evaluated_depsgraph_get()
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    ev = obj.evaluated_get(deps)
    for corner in ev.bound_box:
        p = ev.matrix_world @ Vector(corner)
        lo = Vector((min(lo[i], p[i]) for i in range(3)))
        hi = Vector((max(hi[i], p[i]) for i in range(3)))
center = (lo + hi) / 2
size = max((hi - lo)[i] for i in range(3))
print("BOUNDS", tag, tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi))

cam_data = bpy.data.cameras.new("Cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = size * 1.45
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

elev = math.radians(20)
dist = size * 4
for i, azim in enumerate((0, 90, 180, 270)):
    a = math.radians(azim)
    cam.location = center + Vector((math.sin(a) * math.cos(elev), -math.cos(a) * math.cos(elev), math.sin(elev))) * dist
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{out_dir}/{tag}_az{azim}.png"
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)

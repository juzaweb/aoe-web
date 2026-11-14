"""Compose the archer from the Mixamo soldier and the bow .glb.

The soldier (``linh.blend``) is the same Mixamo infantryman the spearman and the
mounted knight are rendered from; the bow (``cung.glb``) is a recurve on a
SmartRig armature. Three pieces of the two sources have to be undone before they
can share a scene:

- the sword is a separate mesh bone-parented to the right hand, so it is deleted;
- both exports carry an untextured helper icosphere that would render as a grey
  ball behind the unit, so those are deleted;
- the bow's baked string is a twisted cord modelled as ~630 loose scraps of three
  to forty vertices. It cannot bend, so the scraps are cut out and replaced with a
  three-point curve whose middle point is driven to the drawing hand.

Everything else in the bow (riser, leather grip, limbs, tip wraps) is kept as
exported. The bow is then posed per frame by ``place_bow``: it rides in the
soldier's left hand, stays upright, is canted by ``cant_deg`` and is lifted so
its lowest tip never sinks below the ground line.

Run inside Blender with the soldier file already open (see ``render_archer.py``).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BOW_GLB = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "cung.glb"

# The hand that holds the bow, and the hand that draws it.
BOW_HAND = "mixamorig:LeftHand"
STRING_HAND = "mixamorig:RightHand"

# 1.7 m of recurve is longer than the 1.68 m soldier at full size; 0.75 puts the
# strung bow between hip and collar height, which is how the sprite reads a bow
# rather than a staff.
BOW_SCALE = 0.75

# Where the hand grips the bow, in the bow's own mesh units: the middle of the
# leather wrap on the riser.
GRIP_LOCAL = Vector((-0.015, 0.0, 0.850))

# Longest draw, in bow-local units (0.56 m at BOW_SCALE): the source clip's own
# anchor position is ~0.5, and clamping keeps a stray pose from folding the
# string through the riser.
MAX_DRAW = 0.75

# A cord scrap is thin (|y| narrower than the braid) and short; the riser's
# leather wrap and the tip wraps are far thicker, so they survive the cut.
CORD_Y_WIDTH = 0.012
CORD_X_BOUNDS = (0.10, 0.20)
CORD_MAX_VERTS = 40


def _loose_parts(mesh: bpy.types.Mesh) -> list[list[int]]:
    """Vertex indices of every connected component, largest first."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    seen: set[int] = set()
    parts: list[list[int]] = []
    for vert in bm.verts:
        if vert.index in seen:
            continue
        stack = [vert]
        part: list[int] = []
        seen.add(vert.index)
        while stack:
            current = stack.pop()
            part.append(current.index)
            for edge in current.link_edges:
                other = edge.other_vert(current)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        parts.append(part)
    bm.free()
    parts.sort(key=len, reverse=True)
    return parts


def _cut_baked_string(bow: bpy.types.Object) -> tuple[float, float, float]:
    """Delete the baked cord; returns the line it occupied (x, z0, z1)."""
    parts = _loose_parts(bow.data)
    mesh = bow.data
    cord: list[int] = []
    xs: list[float] = []
    zs: list[float] = []
    for part in parts:
        coords = [mesh.vertices[index].co for index in part]
        x_lo = min(co.x for co in coords)
        x_hi = max(co.x for co in coords)
        y_lo = min(co.y for co in coords)
        y_hi = max(co.y for co in coords)
        if len(part) > CORD_MAX_VERTS:
            continue
        if x_lo < CORD_X_BOUNDS[0] or x_hi > CORD_X_BOUNDS[1]:
            continue
        if y_hi - y_lo >= CORD_Y_WIDTH:
            continue
        cord.extend(part)
        xs.extend(co.x for co in coords)
        zs.extend(co.z for co in coords)
    if not cord:
        raise SystemExit("cung.glb: no baked string found; the glb changed")

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    doomed = [bm.verts[index] for index in cord]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    print(f"BOW cut baked string: {len(cord)} verts, {len(parts)} parts")
    return sum(xs) / len(xs), min(zs), max(zs)


def _delete_helpers() -> None:
    """Drop the untextured icospheres both exports carry."""
    for obj in list(bpy.data.objects):
        if obj.name.lower().startswith("icosphere"):
            bpy.data.objects.remove(obj, do_unlink=True)


def _drop_sword() -> None:
    """The soldier's sword is a mesh bone-parented to the right hand."""
    sword = bpy.data.objects.get("Mesh_0")
    if sword is not None:
        bpy.data.objects.remove(sword, do_unlink=True)


def load_bow() -> tuple[bpy.types.Object, float, float, float]:
    """Import the bow, strip its rig and string, and leave it at the origin."""
    _drop_sword()
    bpy.ops.import_scene.gltf(filepath=str(BOW_GLB))
    bow = bpy.data.objects["Mesh_0"]
    world = bow.matrix_world.copy()
    bow.parent = None
    bow.matrix_world = world
    for modifier in list(bow.modifiers):
        bow.modifiers.remove(modifier)
    rig = bpy.data.objects.get("SmartRigArmature")
    if rig is not None:
        bpy.data.objects.remove(rig, do_unlink=True)
    _delete_helpers()
    x, z0, z1 = _cut_baked_string(bow)
    # The bow's own transform is overwritten every frame, so start it upright at
    # the origin rather than wherever the glb's rig left it.
    bow.matrix_basis = Matrix.Identity(4)
    return bow, x, z0, z1


def _cord_material() -> bpy.types.Material:
    material = bpy.data.materials.get("BowCord")
    if material is not None:
        return material
    material = bpy.data.materials.new("BowCord")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.62, 0.55, 0.42, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    return material


def build_string(
    bow: bpy.types.Object, x: float, z0: float, z1: float
) -> bpy.types.Object:
    """A three-point polyline standing in for the cord that was cut out."""
    curve = bpy.data.curves.new("BowString", type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.018
    curve.bevel_resolution = 2
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(2)
    middle = (z0 + z1) * 0.5
    for point, co in zip(spline.points, [(x, 0.0, z0), (x, 0.0, middle), (x, 0.0, z1)]):
        point.co = (co[0], co[1], co[2], 1.0)
    string = bpy.data.objects.new("BowString", curve)
    # Identity parent inverse: the points are in the bow's own space, so the
    # string inherits the bow's scale, cant and roll for free.
    string.parent = bow
    string.matrix_parent_inverse = Matrix.Identity(4)
    curve.materials.append(_cord_material())
    bpy.context.scene.collection.objects.link(string)
    return string


def move_string(string: bpy.types.Object, nock: Vector) -> None:
    """Bend the cord to ``nock`` (bow-local space)."""
    points = string.data.splines[0].points
    low = Vector(points[0].co[:3])
    high = Vector(points[2].co[:3])
    rest_x = low.x
    drawn = Vector(
        (
            min(rest_x + MAX_DRAW, max(rest_x, nock.x)),
            max(-0.12, min(0.12, nock.y)),
            max(low.z + 0.05, min(high.z - 0.05, nock.z)),
        )
    )
    points[1].co = (drawn.x, drawn.y, drawn.z, 1.0)
    string.data.update_tag()


def rest_string(string: bpy.types.Object) -> None:
    points = string.data.splines[0].points
    low = Vector(points[0].co[:3])
    high = Vector(points[2].co[:3])
    middle = (low + high) * 0.5
    points[1].co = (middle.x, 0.0, middle.z, 1.0)
    string.data.update_tag()


def _material(name: str, colour: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        bsdf = material.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
    return material


def _bar(bm: bmesh.types.BMesh, start: float, end: float, width: float, height: float) -> None:
    """A rectangular blade from x=start to x=end, centred on the arrow's axis."""
    length = end - start
    matrix = Matrix.Translation((start + length * 0.5, 0.0, 0.0)) @ Matrix.Diagonal(
        (length, width, height, 1.0)
    )
    bmesh.ops.create_cube(bm, size=1.0, matrix=matrix)


def build_arrow(root: bpy.types.Object) -> bpy.types.Object:
    """A nocked arrow: shaft from the nock (origin) toward -X, head at the tip.

    The mesh is modelled in real metres at the arrow's own scale, so it is
    parented to the unit root rather than to the 0.75-scaled bow.
    """
    mesh = bpy.data.meshes.new("ArrowMesh")
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=8,
        radius1=0.0055,
        radius2=0.0055,
        depth=0.66,
        matrix=Matrix.Translation((-0.33, 0.0, 0.0))
        @ Matrix.Rotation(math.radians(90.0), 4, "Y"),
    )
    shaft_faces = list(bm.faces)
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=True,
        segments=8,
        radius1=0.014,
        radius2=0.0,
        depth=0.085,
        matrix=Matrix.Translation((-0.7025, 0.0, 0.0))
        @ Matrix.Rotation(math.radians(-90.0), 4, "Y"),
    )
    head_faces = [face for face in bm.faces if face not in shaft_faces]
    bm.normal_update()
    # Three fletch blades at the nock, 120 degrees apart about the shaft.
    fletch_faces: list[bmesh.types.BMFace] = []
    before = set(bm.faces)
    for index in range(3):
        angle = math.radians(120.0 * index)
        _bar(bm, -0.135, -0.015, 0.0035, 0.052)
        new_faces = [face for face in bm.faces if face not in before]
        bmesh.ops.rotate(
            bm,
            verts=list({vert for face in new_faces for vert in face.verts}),
            cent=(0.0, 0.0, 0.0),
            matrix=Matrix.Rotation(angle, 3, "X"),
        )
        fletch_faces.extend(new_faces)
        before = set(bm.faces)
    for face in bm.faces:
        if face in fletch_faces:
            face.material_index = 2
        elif face in head_faces:
            face.material_index = 1
        else:
            face.material_index = 0
    bm.to_mesh(mesh)
    bm.free()

    mesh.materials.append(_material("ArrowShaft", (0.24, 0.17, 0.10), 0.7))
    mesh.materials.append(_material("ArrowHead", (0.55, 0.56, 0.58), 0.35))
    mesh.materials.append(_material("ArrowFletch", (0.55, 0.16, 0.12), 0.8))

    arrow = bpy.data.objects.new("Arrow", mesh)
    bpy.context.scene.collection.objects.link(arrow)
    arrow.parent = root
    arrow.matrix_parent_inverse = Matrix.Identity(4)
    return arrow


def build_scene() -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    """Root empty, soldier armature, bow, string and arrow."""
    _delete_helpers()
    soldier = bpy.data.objects["Armature"]
    if soldier.animation_data:
        soldier.animation_data.action = None
        for track in list(soldier.animation_data.nla_tracks):
            soldier.animation_data.nla_tracks.remove(track)
    for pose_bone in soldier.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()

    bow, cord_x, cord_top, cord_bottom = load_bow()
    string = build_string(bow, cord_x, cord_top, cord_bottom)

    root = bpy.data.objects.new("UnitRoot", None)
    bpy.context.scene.collection.objects.link(root)
    bow.parent = root
    bow.matrix_parent_inverse = Matrix.Identity(4)
    soldier.parent = root
    soldier.matrix_parent_inverse = Matrix.Identity(4)
    arrow = build_arrow(root)
    bpy.context.view_layer.update()
    return root, soldier, bow, string, arrow


def aim_bone(soldier: bpy.types.Object, bone: str, target_dir: Vector) -> None:
    """Swing a pose bone about its head until it points along ``target_dir``.

    Directions are in armature space, which is what the rest pose in this file is
    measured in. Working from directions instead of per-bone Euler axes keeps the
    pose readable; the generated roll is the minimal twist.
    """
    pose_bone = soldier.pose.bones[bone]
    bpy.context.view_layer.update()
    head = pose_bone.head.copy()
    current = (pose_bone.tail - head).normalized()
    target = target_dir.normalized()
    quaternion = current.rotation_difference(target)
    pose_bone.matrix = (
        Matrix.Translation(head)
        @ quaternion.to_matrix().to_4x4()
        @ Matrix.Translation(-head)
        @ pose_bone.matrix
    )
    bpy.context.view_layer.update()


def hand_point(soldier: bpy.types.Object, bone_name: str, along: float = 0.045) -> Vector:
    """World position of a hand's palm, a little past the wrist."""
    bone = soldier.pose.bones[bone_name]
    return soldier.matrix_world @ (bone.head + bone.y_axis * along)


def palm_point(soldier: bpy.types.Object) -> Vector:
    """World position of the bow hand's palm, a little past the wrist."""
    return hand_point(soldier, BOW_HAND)


def _nearest_screen_yaw(direction: Vector) -> float:
    """Yaw that lays a horizontal direction along the screen's own X axis."""
    return 0.0 if direction.x >= 0.0 else math.pi


def place_bow(
    bow: bpy.types.Object,
    root: bpy.types.Object,
    grip: Vector,
    string_dir: Vector,
    open_fraction: float = 0.0,
    roll_deg: float = 0.0,
    cant_deg: float = 0.0,
) -> None:
    """Seat the bow's grip in the hand, its string turned back toward the archer.

    ``string_dir`` is the horizontal direction from the bow to the archer's
    chest, so the bow's plane always contains the shot: the string faces the
    drawer and the limbs face the target. Aiming along the camera's own axis
    (rows S and N) leaves that plane edge-on, so ``open_fraction`` swings the
    bow toward the screen's X axis by that share of the way -- a sprite cheat,
    the same one the pack's own archer art makes.
    """
    root_yaw = root.matrix_world.to_quaternion().to_euler("XYZ").z
    world_yaw = math.atan2(string_dir.y, string_dir.x)
    delta = _nearest_screen_yaw(string_dir) - world_yaw
    delta = (delta + math.pi) % math.tau - math.pi
    yaw = world_yaw + delta * open_fraction
    world = (
        Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Rotation(math.radians(roll_deg), 4, "Y")
        @ Matrix.Rotation(math.radians(cant_deg), 4, "X")
    )
    local = root.matrix_world.inverted() @ grip
    transform = (
        Matrix.Translation(local)
        @ Matrix.Rotation(-root_yaw, 4, "Z")
        @ world
        @ Matrix.Scale(BOW_SCALE, 4)
        @ Matrix.Translation(-GRIP_LOCAL)
    )
    bow.matrix_basis = transform

    # Keep the lowest tip on or above the ground line: during the death fall the
    # hand ends up on the floor and the bow would otherwise poke through it.
    tips = (Vector((0.15, 0.0, 0.0)), Vector((0.15, 0.0, 1.70)))
    lowest = min((transform @ tip).z for tip in tips)
    if lowest < 0.0:
        bow.matrix_basis = Matrix.Translation((0.0, 0.0, -lowest)) @ transform
    bpy.context.view_layer.update()


def bow_nock(bow: bpy.types.Object, hand: Vector, root: bpy.types.Object) -> Vector:
    """The drawing hand expressed in the bow's own space."""
    local = bow.matrix_basis.inverted() @ (root.matrix_world.inverted() @ hand)
    return local


def place_arrow(
    arrow: bpy.types.Object,
    bow: bpy.types.Object,
    nock: Vector,
    root: bpy.types.Object,
) -> None:
    """Nock the arrow on the string, its shaft running along the shot axis.

    The tail sits wherever the string drew it, but the shaft runs along the
    unit's own +X (the row's facing) rather than the bow's plane, so the arrow
    leaves where the game's flight code sends it even when the bow is opened.
    """
    position = bow.matrix_basis @ nock
    rotation = Matrix.Rotation(math.radians(180.0), 4, "Z")
    arrow.matrix_basis = Matrix.Translation(position) @ rotation
    bpy.context.view_layer.update()


def set_visible(obj: bpy.types.Object, visible: bool) -> None:
    obj.hide_render = not visible


def setup_render(
    width: int,
    height: int,
    ortho_scale: float,
    ground_margin: float,
    samples: int = 24,
    elevation_deg: float = 20.0,
) -> bpy.types.Camera:
    """Orthographic camera shared by every frame, at the spearman's angle.

    ``ortho_scale`` is the width of the view in metres; the height follows the
    cell's aspect (192x168 cells render at 384x336, so 3.52 m across and 3.08 m
    down). ``ground_margin`` puts the world origin, which the game anchors the
    sprite to, that many metres above the frame's bottom edge.
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

    world = bpy.data.worlds.new("ArcherWorld")
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
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = argv[0] if argv else str(REPO_ROOT / "scripts" / "blender" / "out" / "archer_test.png")
    build_scene()
    setup_render(384, 336, ortho_scale=3.52, ground_margin=0.45)
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("WROTE", out)


if __name__ == "__main__":
    main()

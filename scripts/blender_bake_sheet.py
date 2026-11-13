"""Render the eight-direction sprite sheets of the 3D soldier, in two layers.

The runtime tints a team-coloured sprite with the owner's colour, so the sheet
that ships is really two sheets: an opaque ``body`` layer and a translucent
``accent`` layer covering only the surcoat (TEAM-02/TEAM-03 in
``docs/plans/30-team-color-unit-sheets.md``). This script produces the frames for
both layers; ``scripts/pack_team_sheets.py`` stitches them into sheets.

Camera
------
``gridToScreen`` in ``packages/shared`` is a 2:1 dimetric projection, i.e. an
orthographic camera at 30 deg elevation looking along the grid diagonals. The
model is rotated per row with the lights fixed in the world, so the shading
matches the map's sun from every facing (D4).

The eight rows are not evenly spaced in world yaw. A row is selected by the
*screen-space* heading (``directionIndex``/``quantizeDirection``), but at 30 deg
elevation a world yaw of 45 deg projects to roughly 27 deg on screen. Rotating
the model in even 45 deg steps would leave every diagonal row facing ~27 deg off
from the heading it is played for; ``yaw_for_row`` inverts the projection so each
row faces the screen heading it is indexed by.

Frames
------
``Walking`` -> walk (11 frames), ``Triple_Combo_Attack`` -> attack (10),
``BeHit_FlyUp`` -> death (8, a hit reaction standing in for a death clip - D7),
and 4 near-neutral frames out of ``Walking`` for idle. Renders are supersampled
2x and downsampled with LANCZOS by the packer, which is what keeps the sprite
edges clean.

Usage:
    # one direction, one action: the TEAM-02 checkpoint
    blender -b --python scripts/blender_bake_sheet.py -- --actions walk --directions E

    # the full 528-render bake: every action, every facing
    blender -b --python scripts/blender_bake_sheet.py
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

# The accent faces are decided once, in the mask script, and reused here so the
# body layer goes black exactly where the mask is white.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_make_mask  # noqa: E402  (needs the path above)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BLEND = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "linh.blend"
DEFAULT_MASK = REPO_ROOT / "scripts" / "raw_downloads" / "models" / "linh_teammask.png"
DEFAULT_OUT = REPO_ROOT / "scripts" / "out" / "team_render"

#: Cell geometry shared with ``UNIT_ART.SPEARMAN``. Only the PNGs change in this
#: phase, so the cell, the scale and the offset must not be touched (D4).
CELL_WIDTH = 192
CELL_HEIGHT = 168
SOLE_ROW = 145
#: Height of the figure inside the cell, in final (1x) pixels. The villager and
#: the archer draw ~79 display px at 0.92 scale; 83 px at 0.95 is the same height
#: on the ground.
FIGURE_PIXELS = 83.0
SUPERSAMPLE = 2

#: Row order of every directional sheet: compass-from-east, clockwise.
DIRECTIONS = ("E", "SE", "S", "SW", "W", "NW", "N", "NE")

#: Camera. 30 deg elevation is what makes a world axis project 2:1 (``sin 30``).
ELEVATION = math.radians(30.0)
AZIMUTH = math.radians(-45.0)
#: Model-space forward at yaw 0. Measured from the model: the face looks at the
#: camera when the object sits at yaw 0, i.e. along the camera azimuth.
MODEL_FORWARD = AZIMUTH

BODY_OBJECT = "Mesh0"
WEAPON_OBJECT = "Mesh_0"

#: Accent brightness window, in *display* (sRGB) values - what the PNG bytes mean
#: and what the runtime multiplies the tint by. A team colour is a multiply, so an
#: accent pixel much below ~0.75 turns a dark colour near-black; keeping the range
#: tight leaves the fold shading just visible, which is the point (D5). The
#: shader works in linear light, so ``emit`` converts this window back before it
#: reaches the emission: an emission of 0.76 linear ships as byte 225, i.e. a
#: floor of 0.89, and the folds vanish into the top 11% of the range.
ACCENT_LUMINANCE_MIN = 0.76
ACCENT_LUMINANCE_MAX = 1.00
#: Range of ``dot(normal, key light)`` over the visible surcoat, mapped across that
#: window. Measured by rendering the raw dot through the mask: p5 0.00, median
#: 0.38, p95 0.82. Anything outside clamps to the window's ends.
ACCENT_RAMP_LOW = 0.00
ACCENT_RAMP_HIGH = 0.82

ACTIONS = {
    "walk": {"clip": "Walking", "frames": 11},
    "attack": {"clip": "Triple_Combo_Attack", "frames": 10},
    "death": {"clip": "BeHit_FlyUp", "frames": 8},
    # No idle clip in the GLB: four frames from the passing pose of the walk
    # cycle - the point where the legs are under the body - spaced two source
    # frames apart, which reads as a standing soldier shifting his weight rather
    # than one marching in place.
    "idle": {"clip": "Walking", "frames": 4, "neutral": True},
}
#: Where the passing pose sits in the ``Walking`` cycle, as a fraction of the
#: clip. Measured on the rendered feet spread: the legs are together from about
#: 55% to 90% of the cycle, and the contact pose at the start has them a stride
#: apart - which is not a standing pose.
NEUTRAL_START = 0.60
#: Source frames between idle frames. Two frames at 24 fps is a 12th of a second,
#: slow enough that the loop reads as near-still instead of a slow walk.
NEUTRAL_STEP = 2


def log(message: str) -> None:
    print(f"[bake] {message}", flush=True)


def open_model(blend: Path) -> None:
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    backdrop = bpy.data.objects.get("Icosphere")
    if backdrop is not None:
        # A 2 m backdrop sphere tucked into a collection excluded from the glTF
        # export; it is opaque in a render and hides the model.
        bpy.data.objects.remove(backdrop, do_unlink=True)


def camera_basis() -> tuple[Vector, Vector, Vector]:
    """View direction, screen-right and screen-up of the fixed camera."""
    view = Vector(
        (
            -math.cos(ELEVATION) * math.cos(AZIMUTH),
            -math.cos(ELEVATION) * math.sin(AZIMUTH),
            -math.sin(ELEVATION),
        )
    ).normalized()
    right = view.cross(Vector((0.0, 0.0, 1.0))).normalized()
    up = right.cross(view).normalized()
    return view, right, up


def yaw_for_row(index: int) -> float:
    """Object yaw that makes the model face screen heading ``index * 45`` deg.

    The screen heading of a world direction ``w`` is ``atan2(-w.up, w.right)``;
    with ``sin e = 0.5`` that is ``atan2(0.5 cos t, sin t)`` for ``t = yaw -
    azimuth``. Inverting it and removing the model's own forward offset gives the
    object yaw.
    """
    theta = index * math.pi / 4.0
    facing = AZIMUTH + math.atan2(math.cos(theta), 2.0 * math.sin(theta))
    return facing - MODEL_FORWARD


def setup_render() -> bpy.types.Scene:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = CELL_WIDTH * SUPERSAMPLE
    scene.render.resolution_y = CELL_HEIGHT * SUPERSAMPLE
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.eevee.taa_render_samples = 16
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.filter_size = 1.0
    return scene


def setup_lighting(scene: bpy.types.Scene) -> None:
    """Fixed world lighting: a warm key from the screen's upper left, a cool fill
    and a back rim. The lights never move, the model turns (D4)."""
    world = bpy.data.worlds.new("TeamSpriteWorld")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.48, 0.50, 0.55, 1.0)
    background.inputs["Strength"].default_value = 2.4
    scene.world = world

    view, right, up = camera_basis()
    for name, direction, energy, colour in (
        ("TeamKey", -right * 0.65 + view * 0.75 - up * 1.0, 7.0, (1.0, 0.97, 0.92)),
        ("TeamFill", right * 0.8 + view * 0.45 - up * 0.25, 2.4, (0.82, 0.88, 1.0)),
        ("TeamRim", right * 0.15 - view * 0.9 - up * 0.35, 3.0, (0.95, 0.95, 1.0)),
    ):
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.angle = math.radians(15.0)
        light.color = colour
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.rotation_euler = direction.normalized().to_track_quat("-Z", "Y").to_euler()


def key_light_direction() -> Vector:
    """Unit vector pointing from a surface *toward* the key light.

    The lamp's own vector is the direction the light travels, which is this one
    negated; the dot product in the accent shader needs the to-light side.
    """
    view, right, up = camera_basis()
    return (right * 0.65 - view * 0.75 + up * 1.0).normalized()


def posed_extent(objects) -> tuple[float, float]:
    """Lowest and highest world z of the posed meshes at the current frame."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lowest = math.inf
    highest = -math.inf
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            z = (obj.matrix_world @ vertex.co).z
            lowest = min(lowest, z)
            highest = max(highest, z)
        evaluated.to_mesh_clear()
    return lowest, highest


def setup_camera(scene: bpy.types.Scene, objects) -> None:
    """Frame the cell so the sole lands on ``SOLE_ROW`` at ``FIGURE_PIXELS``."""
    sole, top = posed_extent(objects)
    pixels_per_metre = FIGURE_PIXELS / (top - sole)
    view, _, up = camera_basis()

    camera_data = bpy.data.cameras.new("TeamSpriteCam")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = CELL_WIDTH / pixels_per_metre
    camera_data.clip_start = 0.1
    camera_data.clip_end = 100.0
    camera = bpy.data.objects.new("TeamSpriteCam", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    # The point that projects to the centre of the cell: the sole row sits
    # ``SOLE_ROW - CELL_HEIGHT / 2`` cells below the centre, so the target is that
    # many pixels above the sole along screen up.
    sole_point = Vector((0.0, 0.0, sole))
    offset = (SOLE_ROW - CELL_HEIGHT / 2.0) / pixels_per_metre
    target = sole_point + up * offset
    camera.location = target - view * 6.0
    camera.rotation_euler = view.to_track_quat("-Z", "Y").to_euler()
    log(f"figure {top - sole:.3f} m -> {FIGURE_PIXELS:.0f} px ({pixels_per_metre:.1f} px/m)")
    return camera


def centre_camera(scene: bpy.types.Scene, camera, body) -> None:
    """Slide the camera along screen right so the *body* sits over the tile.

    The world origin is the model's pivot, but the posed figure is not centred on
    it - a walk pose leans, and the sword hangs off to one side. A unit whose
    torso is off-centre reads as standing beside its own tile. Measured once on
    the neutral pose, never per frame, so the sprite does not jitter.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    left = math.inf
    rightmost = -math.inf
    for vertex in mesh.vertices:
        projected = world_to_camera_view(scene, camera, body.matrix_world @ vertex.co)
        left = min(left, projected.x)
        rightmost = max(rightmost, projected.x)
    evaluated.to_mesh_clear()

    _, right, _ = camera_basis()
    shift = (0.5 - (left + rightmost) / 2.0) * camera.data.ortho_scale
    camera.location = camera.location + right * shift
    log(f"body centred: screen x {(left + rightmost) / 2.0:.3f} -> 0.500")


def mask_node(tree, image):
    """Mask sampler. ``Closest`` keeps the 1-bit mask from being blurred in UV."""
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Closest"
    node.extension = "EXTEND"
    return node


def build_empty_material():
    """Flat black: the body layer has to be empty where the accent sits, or the
    tinted overlay composites over the original teal and muddies it."""
    material = bpy.data.materials.new("TeamBodyEmpty")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    emission.inputs["Strength"].default_value = 0.0
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def build_accent_material(mask_image):
    """Emission of the accent shading, with alpha = mask.

    The accent is multiplied by the owner's colour at runtime, so it is emitted
    self-lit inside ``ACCENT_LUMINANCE_MIN..MAX`` instead of being shaded by the
    scene: a lit pass ranges over 0..1 and would turn a dark team colour black in
    the folds.

    The shading comes from the surface normal against the same key light the body
    uses. The albedo is not usable as a shading source: measured on this model the
    surcoat's base colour is flat to within 4% across every texel (linear
    luminance 0.126-0.166), so ``mask * luminance(albedo)`` - the D5 formula -
    would paint one solid patch and lose every fold in the sculpt.
    """
    material = bpy.data.materials.new("TeamAccent")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()

    mask = mask_node(tree, mask_image)

    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    dot = tree.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    light = key_light_direction()
    dot.inputs[1].default_value = (light.x, light.y, light.z)
    tree.links.new(geometry.outputs["Normal"], dot.inputs[0])

    # Ramp across the normals a camera actually sees. Built from Math nodes rather
    # than a Map Range: the Map Range version of this exact chain rendered a flat
    # patch on this build, and a Math chain has no per-data-type socket aliasing
    # to get wrong.
    offset = tree.nodes.new("ShaderNodeMath")
    offset.operation = "SUBTRACT"
    offset.inputs[1].default_value = ACCENT_RAMP_LOW
    tree.links.new(dot.outputs["Value"], offset.inputs[0])

    spread = tree.nodes.new("ShaderNodeMath")
    spread.operation = "DIVIDE"
    spread.inputs[1].default_value = ACCENT_RAMP_HIGH - ACCENT_RAMP_LOW
    spread.use_clamp = True
    tree.links.new(offset.outputs["Value"], spread.inputs[0])

    scale = tree.nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY_ADD"
    scale.inputs[1].default_value = ACCENT_LUMINANCE_MAX - ACCENT_LUMINANCE_MIN
    scale.inputs[2].default_value = ACCENT_LUMINANCE_MIN
    tree.links.new(spread.outputs["Value"], scale.inputs[0])

    # The window above is in display values; the renderer emits linear light. Undo
    # the sRGB transfer so the shipped byte really is 0.76..1.0 instead of
    # 0.89..1.0.
    encode = tree.nodes.new("ShaderNodeMath")
    encode.operation = "POWER"
    encode.inputs[1].default_value = 2.2
    tree.links.new(scale.outputs["Value"], encode.inputs[0])

    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(encode.outputs["Value"], emission.inputs["Color"])

    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(mask.outputs["Color"], mix.inputs["Fac"])
    tree.links.new(transparent.outputs["BSDF"], mix.inputs[1])
    tree.links.new(emission.outputs["Emission"], mix.inputs[2])

    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    material.blend_method = "BLEND"
    return material


def action_frames(action: str) -> list[int]:
    """Source frames to sample for one repo action, in play order."""
    spec = ACTIONS[action]
    clip = bpy.data.actions[spec["clip"]]
    first, last = clip.frame_range
    if spec.get("neutral"):
        start = first + round((last - first) * NEUTRAL_START)
        return [int(start) + offset * NEUTRAL_STEP for offset in range(spec["frames"])]

    count = spec["frames"]
    if count == 1:
        return [int(first)]
    step = (last - first) / (count - 1)
    return [round(first + step * index) for index in range(count)]


def frame_path(out_dir: Path, direction: str, action: str, index: int) -> Path:
    return out_dir / f"linh_{direction}_{action}_{index:02d}"


def render_pass(scene, meshes, materials, path: Path) -> None:
    """Assign one material per mesh (slot 0) and render."""
    for obj, material in zip(meshes, materials):
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_body_pass(scene, body, weapon, base, empty, accent_faces, path: Path) -> None:
    """Body layer: the untouched baked material, black over the accent faces."""
    body.data.materials.clear()
    body.data.materials.append(base)
    body.data.materials.append(empty)
    for polygon in body.data.polygons:
        polygon.material_index = 1 if polygon.index in accent_faces else 0
    if weapon is not None:
        weapon.data.materials.clear()
        weapon.data.materials.append(bpy.data.materials["Material_0"])
        for polygon in weapon.data.polygons:
            polygon.material_index = 0
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", type=Path, default=DEFAULT_BLEND)
    parser.add_argument("--mask", type=Path, default=DEFAULT_MASK)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--actions", default="walk,attack,death,idle")
    parser.add_argument("--directions", default=",".join(DIRECTIONS))
    parser.add_argument(
        "--list-frames",
        action="store_true",
        help="print the sampled source frames per action and exit",
    )
    args = parser.parse_args(argv)

    open_model(args.blend)

    actions = [a.strip() for a in args.actions.split(",") if a]
    unknown = [a for a in actions if a not in ACTIONS]
    if unknown:
        raise SystemExit(f"unknown action(s): {', '.join(unknown)}")
    directions = [d.strip() for d in args.directions.split(",") if d]
    unknown = [d for d in directions if d not in DIRECTIONS]
    if unknown:
        raise SystemExit(f"unknown direction(s): {', '.join(unknown)}")

    if args.list_frames:
        for action in actions:
            log(f"{action}: {ACTIONS[action]['clip']} frames {action_frames(action)}")
        return 0

    if not args.mask.exists():
        raise SystemExit(f"missing team mask {args.mask}; run scripts/blender_make_mask.py")

    mask_image = bpy.data.images.load(str(args.mask))
    mask_image.colorspace_settings.name = "Non-Color"

    body = bpy.data.objects[BODY_OBJECT]
    weapon = bpy.data.objects.get(WEAPON_OBJECT)
    meshes = [body] + ([weapon] if weapon is not None else [])

    scene = setup_render()
    setup_lighting(scene)

    armature = bpy.data.objects["Armature"]
    armature.rotation_mode = "XYZ"
    armature.animation_data_create()

    # Measure the figure in its rest pose, not in one of the clips: the camera
    # scale has to be identical for every action and every re-run, and a pose's
    # height moves by ~5% between frames (heads bob, knees bend). A clip-dependent
    # measurement silently rescaled the sheets whenever a different action was
    # baked on its own.
    armature.animation_data.action = None
    scene.frame_set(0)
    armature.rotation_euler = (0.0, 0.0, 0.0)
    camera = setup_camera(scene, meshes)
    centre_camera(scene, camera, body)

    accent_material = build_accent_material(mask_image)
    empty_material = build_empty_material()
    base_material = bpy.data.materials["BakedMaterial"]
    accent_faces = set(blender_make_mask.select_accent_faces(body.data))
    log(f"accent faces: {len(accent_faces)} of {len(body.data.polygons)}")

    invisible = bpy.data.materials.new("TeamAccentWeapon")
    invisible.use_nodes = True
    invisible_tree = invisible.node_tree
    invisible_tree.nodes.clear()
    transparent = invisible_tree.nodes.new("ShaderNodeBsdfTransparent")
    invisible_output = invisible_tree.nodes.new("ShaderNodeOutputMaterial")
    invisible_tree.links.new(transparent.outputs["BSDF"], invisible_output.inputs["Surface"])

    args.out_dir.mkdir(parents=True, exist_ok=True)
    total = len(actions) * len(directions)
    done = 0
    for action in actions:
        frames = action_frames(action)
        armature.animation_data.action = bpy.data.actions[ACTIONS[action]["clip"]]
        log(f"{action}: {len(frames)} frames from {ACTIONS[action]['clip']}")
        for direction in directions:
            armature.rotation_euler = (0.0, 0.0, yaw_for_row(DIRECTIONS.index(direction)))
            for index, frame in enumerate(frames):
                scene.frame_set(frame)
                stem = frame_path(args.out_dir, direction, action, index)
                render_body_pass(
                    scene,
                    body,
                    weapon,
                    base_material,
                    empty_material,
                    accent_faces,
                    Path(f"{stem}_body.png"),
                )
                render_pass(
                    scene,
                    meshes,
                    [accent_material] + [invisible] * (len(meshes) - 1),
                    Path(f"{stem}_accent.png"),
                )
            done += 1
            log(f"  {direction}: {len(frames)} frames ({done}/{total} directions)")

    log(f"rendered into {args.out_dir}; pack with scripts/pack_team_sheets.py")
    return 0


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    sys.exit(main(argv))

# 3D unit art pipeline (Blender)

Two units are rendered from local 3D sources under
`scripts/raw_downloads/models/` instead of coming out of the OpenGameArt pack:

- **Cavalry** — a Mixamo-rigged knight (`linh.blend`, sword bone-parented to the
  right hand) seated on an armoured warhorse (`ngua.blend`, SmartRig armature).
- **Archer** — the same soldier on foot with a recurve bow (`cung.glb`), the
  sword dropped and a drawn string added.

Blender 4.5 headless renders Cycles. Everything here is reproducible from the
checked-in source files: no image API, no manual retouching.

## Commands

```bash
# Cavalry: render every action, all eight facings (frames land in
# scripts/blender/out/frames)
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/render_cavalry.py -- --px 448

# Archer: frames land in scripts/blender/out/archer_frames
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/render_archer.py -- --px 384

# Iterating on one action / one row
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/render_archer.py -- --only attack --dirs S,E --px 384

# Pack frames into the client's sheets, then publish them
python3 scripts/blender/assemble_cavalry_sheets.py            # dry run + previews
python3 scripts/blender/assemble_cavalry_sheets.py --write    # write into public/assets/units/actions

python3 scripts/blender/assemble_archer_sheets.py            # dry run + previews
python3 scripts/blender/assemble_archer_sheets.py --write    # write into public/assets/units/actions

# Archer as a stand-alone, editable scene (45 MB, textures packed)
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/save_archer_blend.py -- scripts/raw_downloads/models/linh_cung.blend
```

`measure_extent.py` prints the union of every frame's camera-space extent. Run
it before changing a framing: the cavalry's 4.1 m camera square and its 0.45 m
ground margin are both chosen from those numbers — the death fall sets the width
(3.81 m), the attack's raised sword sets the top (2.83 m above the tile).

## Conventions

- **Row order** is compass-from-east, `E, SE, S, SW, W, NW, N, NE` — the order
  `unitDirections.ts` indexes with. The model faces -Y at yaw 0, so the yaw per
  row is `90, 45, 0, -45, -90, -135, 180, 135`.
- **The camera and key light never move**; the unit is spun on its root. Each
  facing therefore carries its own shading instead of a relit, mirrored copy.
- **World-to-pixel scale is shared.** Both units render at 0.0183 m/px, so a
  1.5 m figure is the same height in either sheet and both stand on the same
  ground line: the world origin — the point the game anchors the sprite to — sits
  0.45 m above the cell bottom, which is the agent's sole row. `unitArt.ts`
  mirrors these numbers in `frameWidth`/`frameHeight`/`offsetY`.
- **Cells.** Cavalry 224x224 (4.1 m camera square). Archer 192x168 at the
  spearman's scale: 3.52 m across and 3.08 m down, sole row 144 of 168 — the
  drawn bow reaches above the helmet, so the cell is one row taller than the
  pack's 148x130.
- **Lighting** is deliberately dimmer than the OpenGameArt pack. Both assemblers
  lift each sheet by the gamma that moves its median luma onto
  `spearman_walk.png`, keeping hue instead of applying a per-channel gain.

## The archer scene file

`scripts/raw_downloads/models/linh_cung.blend` is the composed archer, saved
from `save_archer_blend.py`: the soldier, the bow with its rebuilt string, the
nocked arrow, the orthographic camera and the two suns, with every texture
packed so the file opens on its own. Nothing in it needs Python to play back —
the script bakes what `render_archer.py` computes per frame, one keyframe per
frame, onto four marked ranges of the timeline:

| Marker | Frames | Clip |
| --- | --- | --- |
| `idle` | 1-24 | breathing, bow carried at the side |
| `walk` | 25-49 | the soldier's walk cycle, bow swinging with the hand |
| `attack` | 50-74 | draw to the anchor, then the loose and the arm kick |
| `death` | 75-110 | knocked down, the bow tipping onto the floor line |

Frames are baked at 24 fps, so the scene plays at the source clips' own speed
rather than at the sheets' 4/11/10/8 sampling. The file is a rendering aid — the
sheets stay the shipped deliverable, and re-running `render_archer.py` never
reads it.

## Cavalry notes

- **Actions** are idle (breathing only, horse planted), walk (the horse's own
  `Walk` clip plus a lagged rider lean), attack (the knight's sword combo with
  its leg and root-motion channels stripped so the mounted legs hold), and death
  (a reel onto the haunches and over on its side; rolling about the facing axis
  is the only fall where the horse ends up lying flat, pitching about X stands
  the spine up instead).
- **Spine scaling in the attack**: the source combo folds the torso onto the
  horse's neck; its spine/neck/head quaternion X/Y/Z components are scaled to
  0.35, leaving W, which is the shortest rotation toward the rest pose.
- Legs are never keyed by an action. The mounted posture is applied to the pose
  first (`pose_rider_mounted`) and any action that runs on top cannot override it.

## Archer notes

- **Sources.** `linh.blend` carries a Mixamo rig whose clips are reused directly:
  `Archery_Shot_1` (0-24, the draw), `Walking.002` (0-24.8), `BeHit_FlyUp.002`
  (0-36). `cung.glb` is a 1.7 m recurve skinned to a SmartRig; it ships no
  animation, so it is used as a rigid prop scaled to 0.75 (1.28 m at the
  soldier's size).
- **The baked string is cut out.** The export's cord is a twisted braid modelled
  as ~630 loose scraps, so it cannot bend. `archer_scene.py` deletes those scraps
  (thin in Y, short, inside the string's column) and replaces them with a
  three-point poly curve whose middle point is driven to the drawing hand —
  that is what makes the draw and the loose readable.
- **The arrow** is built as a mesh (shaft, head, three fletch blades) and nocked
  on the string while the clip draws; it disappears on the loose because the
  client's projectile FX takes over at that frame.
- **The clip aims along the unit's +X**, not its face: the bow arm is extended
  sideways. Attack rows are therefore spun an extra -90 degrees so the arrow
  leaves along the row's own facing, and the bow is seated by
  `place_bow`, which points its string back at the archer's chest.
- **Bow open cheat.** Aiming along the camera's own axis (rows S and N) leaves
  the bow's plane edge-on, a few pixels wide. `BOW_OPEN` swings the bow toward
  the screen plane by that share of the angle needed — 1.0 by default, which is
  the same cheat the pack's own archer art makes. The arrow shaft still follows
  the row's facing rather than the opened bow, so the projectile never leaves at
  an angle.
- **The attack has no loose in the source.** `Archery_Shot_1` stops at full
  draw, so `render_archer.py` plays the release itself on the last two frames:
  the string snaps straight, the arrow hides and the drawing arm is kicked back
  off the anchor.
- **Idle** is the clip's frame 0 plus a breathing sway and one correction: the
  clip leaves the bow arm behind the hip, which hides the bow in the profile
  rows, so the upper arm is aimed slightly forward (`aim_bone`).
- **Death** strips the source's location channels, which launch the soldier two
  metres into the air, and walks the root 0.55 m down instead so the corpse ends
  up lying on the floor line. The bow tips over as he goes down and is lifted so
  its lowest tip never crosses the ground.

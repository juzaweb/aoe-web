# Cavalry art pipeline (Blender)

The cavalry is the only unit whose art is not from an upstream pack: it is
rendered from two local 3D sources under `scripts/raw_downloads/models/` — a
Mixamo-rigged knight (`linh.blend`, with its sword bone-parented to the right
hand) and an armoured warhorse (`ngua.blend`, SmartRig armature).

Blender 4.5 headless renders Cycles. Everything here is reproducible from the
two `.blend` files: no image API, no manual retouching.

## Commands

```bash
# 1. Render every action, all eight facings (frames land in scripts/blender/out/frames)
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/render_cavalry.py -- --px 448

# One action only, for iterating on a pose
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/render_cavalry.py -- --only attack

# 2. Pack frames into the client's sheets, then publish them
python3 scripts/blender/assemble_cavalry_sheets.py            # dry run + previews
python3 scripts/blender/assemble_cavalry_sheets.py --write    # write into public/assets/units/actions
```

`measure_extent.py` prints the union of every frame's camera-space extent. Run
it before changing the framing: the 4.1 m camera square and the 0.45 m ground
margin are both chosen from those numbers — the death fall sets the width
(3.81 m), the attack's raised sword sets the top (2.83 m above the tile).

## Conventions

- **Row order** is compass-from-east, `E, SE, S, SW, W, NW, N, NE` — the order
  `unitDirections.ts` indexes with. The model faces -Y at yaw 0, so the yaw per
  row is `90, 45, 0, -45, -90, -135, 180, 135`.
- **The camera and key light never move**; the unit is spun on its root. Each
  facing therefore carries its own shading instead of a relit, mirrored copy.
- **Cell geometry** is 224x224 px, rendered at 2x (448) and downsampled. The
  camera's 4.1 m square maps to the cell, and the world origin — the point the
  game anchors the sprite to — sits 0.45 m above the cell bottom, because the
  hooves nearest the camera project below it. `unitArt.ts` mirrors these numbers
  in `frameWidth`/`frameHeight`/`offsetY`.
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

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

# Team-colour layer: same camera and clips, only the tunic lit
blender -b scripts/raw_downloads/models/linh.blend \
    --python scripts/blender/render_archer.py -- --px 384 --accent

# Pack frames into the client's sheets, then publish them
python3 scripts/blender/assemble_cavalry_sheets.py            # dry run + previews
python3 scripts/blender/assemble_cavalry_sheets.py --write    # write into public/assets/units/actions

python3 scripts/blender/assemble_archer_sheets.py            # dry run + previews
python3 scripts/blender/assemble_archer_sheets.py --write    # write into public/assets/units/actions
python3 scripts/blender/assemble_archer_sheets.py --accent --write   # the team-colour layer

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

## Team colour

The archer ships a second sheet per action, `<unit>_<action>_accent.png`: the
tunic alone, rendered white, with the rest of the figure cut out. The client
draws it over the body sprite, tinted with the owner's colour, which is the
multiply-based team colour AoE uses.

- **The mask comes from the atlas, not from a painted selection.**
  `team_accent.py` samples the base-colour texture at each face's UVs and keeps
  the faces inside the cloth band (hue 185-205, saturation >= 0.13, z 0.38-1.36):
  7,096 of 19,489 faces. Everything smaller than 40 connected faces is dropped,
  because a handful of armoured-wear texels happen to sit in the same band and
  would tint a grey sleeve. Selected faces move to a second material slot so the
  accent pass can address them by index.
- **The accent pass is a holdout render.** Every other material (and the bow,
  the string and the arrow) is replaced with a Cycles holdout, the accent slot
  becomes a plain white BSDF, and the result carries the tunic's own shading
  into the alpha. That shading is what survives the multiply: a flat white mask
  would erase the folds.
- **No luminance match on this layer.** The assembler lifts the body sheets onto
  the spearman's median luma, which would darken every team colour if it were
  applied to the mask. `--accent` packs as rendered.
- **Checks.** The assembler refuses an accent sheet covering less than 0.8% or
  more than 16% of the cell (a broken band either tints the whole figure or
  leaves bare patches), and `unitArt.sheets.test.ts` fails when the accent grid
  drifts a column from the body grid, which would tint the neighbouring pose.

### Spearman and cavalry

Those two masks are not rendered. Their shipped sheets are the art of record, so
`scripts/build_team_accent.py` derives `<unit>_<action>_accent.png` from those
exact pixels, which also guarantees the mask sits on the body pixel for pixel:

- **The band.** The cloth is the only region at hue 184-202 with saturation
  >= 0.18. The cavalry sheet was gamma-lifted onto a different median than the
  spearman's, which lifts its blued-steel helmet to hue 201-210 at saturation
  0.07-0.15 — a wider window tints the helmet, a narrower one leaves holes in
  the shadowed folds.
- **Cleanup.** Components under 24 px are dropped (armour texels in the band),
  the mask is closed by one pixel, enclosed highlights and belt buckles are
  filled, and it grows back over the cloth's own antialiased edge through a
  looser saturation band, so no teal fringe shows around the tinted tabard. The
  grow may only take pixels still in the cloth's hue, or it would draw a tinted
  line along the grey sleeve.
- **Shading.** The mask keeps the body's own luminance remapped onto 0.75-1.0, so
  the folds survive the multiply. A flat white mask reads as plastic.
- **Guards.** The script refuses a cell whose mask covers under 0.4% of it, or
  over 80% of the *figure* in it, and dies before writing anything if any cell
  fails. The floor is per cell because the cavalry's death clip hides the rider
  behind the horse on its last frames and bottoms out at 0.53%, which is still
  correct art. The ceiling is a share of the figure rather than of the cell: a
  cell is only 4-12% figure, so an absolute ceiling would let a mask that tints
  every limb through. Every sheet is staged to `<name>.png.tmp` and renamed into
  place, so an I/O error cannot leave half the masks replaced.
- **Previews and the stale gate.** The dry run writes tinted previews to
  `scripts/out/team_accent/` for all eight facings. `--check` rebuilds the masks
  in memory and fails when a shipped sheet is missing, is the wrong size, or no
  longer matches the current body art — the only thing that catches an accent
  left behind after a body re-render.

```bash
python3 scripts/build_team_accent.py            # dry run + previews
python3 scripts/build_team_accent.py --check    # shipped sheets still match the bodies
python3 scripts/build_team_accent.py --write    # publish the accent sheets
python3 scripts/build_team_accent.py --unit CAVALRY --write
python3 scripts/assets/build.py --legacy        # re-pin the new hashes, then --check
```

`--check` is a manual gate, like the other asset checks: the Node test suite reads
only the PNG header, so nothing in CI rebuilds the masks.

The horse is deliberately outside the mask: its armour is steel and its small
maroon saddle cloth is trim, so only the rider's tabard takes the owner's colour
and the mount keeps the palette it was rendered with.

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

---
name: unit-art-pipeline
description: Builds or changes a directional (8-facing) unit sprite sheet rendered from a local 3D model in Blender, and adds an AoE-style team-colour layer. Use when a unit's art must come from .blend/.glb sources instead of an image pack, when replacing a unit sheet, when a unit looks wrong on the ground line, or when units need per-player team colour.
---

# Unit art pipeline (Blender → sheets → client)

Three scripts per unit do all the work, and every number below was measured, not
guessed. Copy the shape of `scripts/blender/archer_scene.py`,
`render_archer.py`, `assemble_archer_sheets.py` when adding a unit; copy the
`team_accent.py` + `--accent` path when adding team colour.

## When to use

- A unit has no art in the upstream pack, or its pack art is being replaced.
- The unit needs eight compass facings (`unitDirections.ts` row order).
- Units must show the owner's colour on cloth (AoE team colour).

Not for: terrain, buildings, UI, or anything the `scripts/assets/` manifest
pipeline already builds from a PNG source.

## Ground rules

1. **One unit = one cell geometry, shared with its neighbours.** Read
   `UNIT_ART` in `apps/client/src/game/render/unitArt.ts` first and reuse the
   first unit's numbers. Two soldiers must stand on the same row or they bob
   against each other on screen.
2. **The camera never moves; the unit spins.** Every facing then carries its own
   shading instead of a relit, mirrored copy.
3. **Render at 2x the cell, downsample once** in the packer (LANCZOS). Never
   resample in Blender, never twice.
4. **Match the pack's luminance, not your taste.** Cycles is darker than the
   OpenGameArt pack; the assembler lifts each sheet by the gamma that moves its
   median luma onto `spearman_walk.png`.
5. **Art and code ship together**: sheets + `UNIT_ART` + preload + anim keys +
   `scripts/assets/assets.lock.json` (`python3 scripts/assets/build.py --legacy`)
   + `CREDITS.md` + `scripts/blender/README.md`.

## Part A — a new unit sheet

### 1. Inspect the source before writing any script

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b <model.blend> --python-expr "
import bpy
for ob in bpy.data.objects: print('OB', ob.name, ob.type, ob.parent and ob.parent.name, ob.parent_type, ob.parent_bone)
for a in bpy.data.actions: print('ACT', a.name, a.frame_range)
for ob in bpy.data.objects:
    if ob.type=='MESH': print('MAT', ob.name, [m.name if m else None for m in ob.data.materials], len(ob.data.polygons))
"
```

Record: the armature name, its bone names, available actions and their frame
ranges, and **which objects are props bone-parented to a hand** (`parent_type`
`BONE` with a `parent_bone`). Also delete the untextured `Icosphere` helper that
some exports carry, or it renders as a grey ball behind the figure.

Write one `*_scene.py` with `build_scene()` returning `(root, rig, …props)` and
`setup_render(width, height, ortho_scale, ground_margin)`; keep every constant
there. Then a `render_*.py` that only poses and loops.

### 2. Geometry that matches the rest of the infantry

| Constant | Value | Why |
| --- | --- | --- |
| metres per pixel | `0.0183` | derived from the pack: 192 px cell / 3.52 m |
| cell | `192 x 168` (render `384 x 336`) | tall enough for a raised weapon |
| `ORTHO_SCALE` | `3.52` m across | width of the view; height follows the cell aspect |
| `GROUND_MARGIN` | `0.45` m | world origin this far above the cell bottom |
| sole row | `144` of 168 | `unitArt.offsetY` is derived from it |
| camera elevation | `20°`, azimuth `0` | the angle the shipped pack sheets were drawn at |

The world origin is the point the game anchors the sprite to. Verify it by
projecting `(0,0,0)` through the camera, not by eye — `bpy_extras.object_utils.world_to_camera_view`
gave row 144 for the archer while the feet rendered at 148–155, which is correct
(a stance carries one foot toward a 20°-down camera).

### 3. Pose per action

| Action | Source | Frames @ fps |
| --- | --- | --- |
| `idle` | clip frame 0 + a small sine sway | 4 |
| `walk` | the walk clip sampled over its range | 11 @ 16 |
| `attack` | the attack clip, released at the client's `DRAW_MS` | 10 @ 10 |
| `death` | the hit clip | 8 @ 9 |

Traps, each of which cost a re-render:

- **Aim axis.** `Archery_Shot_1` aims along the unit's **+X**, not its face
  (−Y). Spin the attack rows an extra −90° so the projectile leaves along the
  row's own facing.
- **The clip usually stops before the loose.** Play the release yourself on the
  last frames: string snaps straight, arrow hides, drawing arm kicks back.
- **Death clips often launch the body.** Strip every `.location` fcurve
  (`source.fcurves.remove(fc)` for `fc.data_path.endswith(".location")`) and walk
  the root down instead (0.55 m for the archer), or the corpse flies two metres.
- **Props need their own placement code**, not just parenting: the bow is seated
  in the palm by `place_bow(hand, string_dir)`, scaled to 0.75, kept above the
  ground line, and its baked string replaced by a three-point curve driven to
  the drawing hand.
- **A prop seen edge-on is invisible at 192 px.** When the camera looks straight
  down the prop's plane (rows S/N), swing it toward the screen plane by a
  fraction of the angle needed (`BOW_OPEN`); the projectile still follows the
  row's facing.

### 4. Render

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b <model.blend> \
    --python scripts/blender/render_<unit>.py -- --px 384 [--only attack] [--dirs S,E]
```

Cycles, CPU, 24 samples, denoise on, `film_transparent`, `view_transform =
"Standard"`, 8-row order `E, SE, S, SW, W, NW, N, NE`, yaw
`90, 45, 0, -45, -90, -135, 180, 135`. One fixed key sun + fill. Expect ~30–50
min for ~264 frames; run it as a background job and keep working.

### 5. Assemble

```bash
python3 scripts/blender/assemble_<unit>_sheets.py          # dry run + previews
python3 scripts/blender/assemble_<unit>_sheets.py --write  # publish
```

The packer must refuse to publish when:

- a `(action, direction)` folder does not hold exactly the configured frames;
- the rows disagree on the sole row by more than the shipped art's own spread
  (the spearman's idle rows span **9 px** across the eight facings — a stance
  puts a different foot nearest a 20°-down camera — so a tolerance under that
  fails on correct art);
- an accent sheet's coverage is outside 0.8–16 % of the cell.

### 6. Client wiring

1. `UNIT_ART.<UNIT>` — cell, `scale`, `offsetY`, `actions` with `fps` per action.
   `offsetY` comes from the sole row: `(soleY - frameHeight / 2) * scale`.
2. `WorldScene.preload` — the generic loop already loads every
   `unitSheets()`; add a new loader **only** for a second layer. Bump `uv`
   (`v=N` → `v=N+1`): the URL is the browser cache key.
3. `EntityRenderer.initUnitAnimations` — same generic loop registers the clips.
4. `apps/client/src/game/render/unitArt.sheets.test.ts` reads the PNG IHDR and
   fails on a wrong cell or column count; run it.
5. Re-pin the lock: `python3 scripts/assets/build.py --legacy`, then `--check`.
   It also catches pre-existing drift, so run `--check` on `HEAD` first to know
   what was already red.

## Part B — team colour (AoE style)

Team colour is a **multiply of the owner colour onto a masked, shaded layer**,
never a per-colour bake: the colour comes from `PlayerState.color` at runtime.

### 1. Mask from the atlas, then eyeball it

One material, colours baked into a 2048² atlas ⇒ no slot to recolour. Sample the
base-colour texture at each face's UVs and keep a colour band:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b <model.blend> \
    --python scripts/blender/team_accent.py -- --report   # histogram by hue/z
```

Start from the measured band (archer tunic: hue **185–205**, saturation
**≥ 0.13**, z **0.38–1.36** → 7 096 / 19 489 faces) and then:

- **Keep the hue window narrow and the saturation floor low.** Folds sample far
  less saturated than the chest (0.13 vs 0.39); a high floor leaves a bare patch
  in the skirt.
- **Drop islands under ~40 connected faces.** A few armoured-wear texels sit in
  the same band and would tint a grey sleeve.
- Put the selected faces on a second material slot; do not edit the mesh
  geometry.
- **Look at the result.** Composite body + tinted mask in PIL and check the
  whole figure, not the numbers.

### 2. Accent pass: a holdout render

`render_<unit>.py --accent` must:

- call `setup_accent_pass(body, [all other objects])` — every other material,
  including props and curves, becomes a **Cycles holdout**;
- make the accent slot a plain white Principled BSDF (roughness ~0.85);
- reuse the exact same camera, clips and frame loop, writing to a sibling
  `out/<unit>_accent_frames/`.

The render keeps the cloth's own shading in the alpha. A flat white mask erases
the folds and the tint goes plastic.

Two traps: curve material slots are read-only mirrors (`obj.data.materials[i]`),
and the pass replaces the body's materials, so cache the base-colour image on
first read or a second pass in the same session cannot find the atlas.

### 3. Pack the accent

`assemble_<unit>_sheets.py --accent --write` → `<unit>_<action>_accent.png`, same
grid, **no luminance match** (that gamma lift would darken every team colour).

### 4. Client: one sprite over the body, tinted

- `UNIT_ART.<UNIT>.accent = true`; `hasTeamAccent()` is the only flag to read.
- Keep **all** the rules in `entityAccent.ts` (`accentClipKey`, `accentTint`,
  `createAccentSprite`, `paintAccent`, `syncAccent`, `accentClipSpecs`) against a
  narrow `AccentHost` interface, so they can be tested with plain objects
  instead of a running Phaser scene. Do not grow these decisions inline in
  `EntityRenderer` — that file is already near 900 lines.
- Container order is draw order: ring, body, **accent**, selection ring, hp bar.
- Play the accent in the same branch as the body, copy `timeScale`, and **hide**
  it when the body falls back to a legacy clip with no mask, or a stale tunic
  floats without its body.
- `accentTint(undefined)` must return `UNKNOWN_OWNER_COLOR`, never white: an
  untinted mask is a glowing white tunic. Corpses carry no owner in
  `CorpseState`, so remember the unit's last colour and give the corpse that.
- Repaint only when the colour changed; track the team colour separately from
  the ownership-ring signature (`-1` means "hide the ring", our own units, who
  still show their team colour).
- Anything you add to `WorldScene.resetForNewWorld()` must be optional-chained
  (`this.entityRenderer?.x()`): React releases the old room as soon as it is
  detached, which can happen **before** Phaser ran `create()`, and the services
  built there do not exist yet. `worldSceneReset.test.ts` calls the method on a
  stub for exactly that case.

### 5. Guards worth keeping

- The accent grid test fails when the accent sheet drifts a column from the body
  grid — that would tint the neighbouring pose's tunic.
- The packer's coverage bounds catch a broken colour band (whole figure tinted)
  and an empty mask.

## Verification gates

```bash
cd apps/client && ../../node_modules/.bin/tsc --noEmit        # clean
cd apps/client && ./node_modules/.bin/vitest run              # all green
python3 scripts/assets/build.py --check                       # asset lock OK
python3 scripts/blender/assemble_<unit>_sheets.py             # dry run prints sole rows
```

Then **look at it**: `preview_in_game.py` renders the unit at the exact
`unitArt.ts` geometry on grass beside the others. For team colour, a throwaway
HTML page that draws body + mask on a canvas with `globalCompositeOperation =
'multiply'` proves the tint in a real browser without starting the game.

Finally, mutate the new tests: invert each condition the change adds and confirm
something goes red. A surviving mutation is a missing test, or a branch that
should be deleted.

## Traps seen in practice

| Symptom | Cause | Fix |
| --- | --- | --- |
| Figure faces 90° off the arrow | clip's aim axis ≠ unit facing | spin that action's rows |
| Corpse flies up | death clip's `.location` fcurves | strip them, drop the root |
| Bow/string detached from hand | prop left at its export transform | place it from the palm each frame |
| Prop invisible on two rows | aimed along the camera axis | open the prop toward the screen |
| Unit floats or sinks on the tile | sole row ≠ the pack's | re-derive `offsetY` from the measured sole row |
| Team colour nearly black | accent too dark | keep mask luminance 0.75–1.0, no gamma lift |
| White tunic | mask not tinted | `accentTint` fallback, always `setTint` |
| Soles wander row to row | different camera/margin per render | re-render the outlier row |
| `Cannot read properties of undefined (reading '…')` at `resetForNewWorld` | a service created in `create()` dereferenced on the travel/teardown path | optional-chain it; stub call order is tested in `worldSceneReset.test.ts` |

## Checklist

- [ ] Sources inspected: rig, actions, hand-parented props, helper meshes
- [ ] Cell/scale/offset shared with the neighbouring unit; sole row measured
- [ ] Clips mapped; aim axis, release frames, launch channels handled
- [ ] Rendered at 2x, packed at 1x with one LANCZOS downsample
- [ ] Sole-row and coverage guards pass
- [ ] `UNIT_ART`, preload (cache bump), anim registration, sheet test
- [ ] `--legacy` re-pin, `--check` green, `CREDITS.md` + `scripts/blender/README.md`
- [ ] Team colour (if used): mask eyeballed, accent packed without gamma,
      `entityAccent.ts` rules tested, corpse inherits colour
- [ ] Mutation check on the new tests

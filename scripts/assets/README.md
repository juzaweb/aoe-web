# OpenGameArt asset pipeline

Rebuilds the client's third-party sprites from `manifest.json`. The shipped PNGs
and `assets.lock.json` are the only committed outputs; downloaded archives and
extracted frames stay in `scripts/.cache/assets/` (gitignored).

## Commands

```bash
python scripts/assets/build.py --fetch        # download + extract into the cache
python scripts/assets/build.py --fetch --force  # refetch even when hashes match
python scripts/assets/build.py --all          # rebuild every target
python scripts/assets/build.py --only tree    # rebuild targets whose id matches
python scripts/assets/build.py --check        # verify shipped files against the lock
python scripts/assets/build.py --legacy       # pin hashes of sprites this pipeline does not build
python scripts/assets/build.py --report       # measured box, top inset, scale, gain
```

`--fetch` refuses to reuse a cached archive whose hash does not match the lock,
and deletes a fresh download that does not match: an upstream re-upload must be
inspected, not silently absorbed.

`--check` is the CI gate. It fails when a shipped PNG no longer matches its lock
hash, when the canvas or the recorded artwork box/insets drifted, when the bottom
row is empty (art not bottom-anchored), when a `building.*` sprite does not stand
on a front corner (`iso_base`), when a source lost its author/license or is
missing from `CREDITS.md`, or when a legacy sprite was edited or is new (`--legacy`
re-pins them).

## Adding a sprite

1. Add the source under `sources` in `manifest.json` (`page`, `author`,
   `license`, and one entry per uploaded file). OGA download URLs are direct
   `https://opengameart.org/sites/default/files/<name>` links.
2. Add a target with:
   - `source` + `file` (and `entry` for a member of an archive),
   - `op`: `crop` (`alpha`/`none`), `flip` (`x`), `split` (`index`, `minArea`,
     `dropEdge`), `gain` (per-channel `[r, g, b]`), `fit`, `matchLum`, `anchor`,
   - `out` and `canvas`; the license is inherited from the source.
3. `--fetch`, then `--all`.
4. Check `--report`: an upscale factor above ~1.6 means the source is too small
   for the canvas; widen the canvas instead of stretching a painted sprite.
   A `lumGain` far from 1.0 means the pack was lit for a different engine.
5. Add the author to `CREDITS.md` (the build warns, `--check` fails).

## Conventions

- Canvas sizes are the client's existing ones, and every sprite is anchored to
  the bottom-centre row. `buildingArt.ts` and `EntityRenderer.ts` keep their
  offsets; the health-bar heights are derived from `topInset` and guarded by
  `assetManifest.test.ts`.
- `matchLum` keeps the map's brightness stable when a pack was lit for another
  engine. The gain is clamped in `ops.py`, recorded as `lumGain`, and hue is
  preserved.
- `gain` multiplies each channel before `matchLum` and is the hook for a pack
  whose saturation, not hue, is off: the forbs sheet has the client's green hue
  but only 0.36 median saturation against the grass's 0.62, so it gets
  `[1.20, 1.30, 1.05]` and the luminance match then restores brightness.
- `split` cuts a sheet target into separate sprites by connected alpha regions,
  sorted by area then position, so `index` is stable for fixed source bytes.
  Components touching the sheet border are dropped (clipped art).
- `flip: "x"` mirrors the source before scaling. A mirrored 2:1 iso render is
  still a valid view of the same building (the opposite ground corner), so this
  is how a single-direction source is turned to face the client's camera.
- A `building.*` source must be a 45-degree view, not a straight-on one: its
  bottom row has to be the front corner of the footprint diamond, which is what
  `iso_base` measures and what bottom-centre anchoring assumes. In a 16-direction
  turnaround the camera orbits the object, not its ground point, so the frames
  differ in how far the contact point sits from the artwork centre; pick the
  45-degree frame with the smallest offset. `hovel_00000` was 97% wide at the
  bottom (a wall line, not a corner) and shipped for a while because every other
  check accepts it.
- Resampling is done in premultiplied alpha to avoid dark fringes.
- The lock records `bbox`, `topInset`, `bottomInset`, `scale`, `lumGain`,
  `sourceSha256` and the license/author for every file. Hashes are of the PNG
  bytes, so a different Pillow build may need a rebuild (same pixels, new bytes).
- `legacy` in the lock pins the PNGs no target builds (terrain, gold/stone/berry,
  farm/lumber camp/mill/mining camp/tower, units, cursors, icons). They have no upstream to
  rebuild from, so they are hash-only: a hand edit or a stray regeneration fails
  `--check` instead of shipping silently. The generated gate, road stamps and
  citadel stone are excluded because other scripts rebuild and check them (see
  below).

## Generated art (not third-party)

`scripts/process_generated_assets.py` builds `buildings/portal.png` and the four
`terrain/road_stamp{,_1,_2,_3}.png` from project-original generated textures.
They have no upstream URL or license and are reproducible from two source PNGs,
so they stay out of `manifest.json` and this lock; pinning their bytes would make
every regeneration look like a hand edit. Their contract lives in that script:

```bash
python scripts/process_generated_assets.py --gate <gate.png> --road <dirt.png>
python scripts/process_generated_assets.py --check   # canvas, anchoring, lum, doorway
```

That script needs Pillow and numpy; the OpenGameArt pipeline itself only needs
Pillow.

`buildings/siege_workshop.png` is project-original local ComfyUI art, generated
by `scripts/generate_siege_workshop_asset.py` and pinned under `legacy` in the
lock. It is not wired into `buildingArt.ts` yet, so nothing loads it at runtime.

`buildings/stable.png`, `buildings/archery_range.png` and `buildings/tower.png`
were previously project-original generated art; they are now built from
OpenGameArt packs by `building.stable`, `building.archery-range` and
`building.tower` in the manifest. `scripts/generate_buildings_assets.py` no
longer defines them, so running it cannot overwrite the shipped sprites.

The three economy drop-off camps are the exception. `buildings/lumber_camp.png`
used to be rebuilt from the stable source (`building.lumber-camp`), which made it
a scaled-down copy of `stable.png`; `mill.png` and `mining_camp.png` were
unmigrated AI art. All three are now purpose-generated (sawmill camp, water mill
with its own wheel, rocky mine adit with a headframe and ore cart) so they no
longer read as recolours of the house, the stable or each other:

```bash
python scripts/generate_buildings_assets.py --only lumber_camp,mill,mining_camp
```

They use the house's 256x220 canvas, stay out of `manifest.json` (no upstream
URL or license), and are hash-pinned as `legacy` by `build.py --legacy`. Their
`HP_BAR_Y` values in `buildingArt.ts` are measured from the shipped art, so
re-running the generator means re-measuring the top inset.

### Citadel stone

`assets/citadel/{floor,wall,gate,gate_door,tc_platform}.png` are project-original
generated art with no upstream URL, so they stay out of `manifest.json` and the
lock, like the portal. Two Python scripts own them:

```bash
python scripts/generate_citadel_assets.py --only floor,wall   # raw textures
python scripts/process_citadel_assets.py --floor <floor.png> --wall <wall.png>
python scripts/process_citadel_assets.py --check     # canvas, anchoring, lum, arch
python scripts/process_citadel_assets.py --preview   # 17x17 citadel proof sheet
```

`floor.png` and `wall.png` are tiles (128x64 and 128x154) that must repeat
exactly, so the processor squashes the generated stone into the iso diamonds and
wall faces instead of trusting a generated sprite to tile. `gate.png` (512x500)
and `gate_door.png` (192x169) are assembled from the same stone because the
layout's 3-tile opening and 6-tile front are fixed geometry; the portcullis is a
separate texture so `CitadelLayer` can raise it when a unit walks in.

`tc_platform.png` (784x555) is the raised palace terrace under the Town Center: a
6x6 tile paved podium with coursed retaining faces, a stone balustrade on the
front rim and a seven-step flight on the south-east face, directly below the
gatehouse. Its top-centre anchor sits `TC_RISE` (112 px) above the floor. The
client draws it in `CitadelLayer` and lifts the Town Center art by the same rise
in `EntityRenderer`; `townCenterPlatform.ts` carries the shared constants. The
proof sheet composites the building on the terrace so a size or anchor drift
shows up immediately.

## Not migrated

`terrain/{grass,dirt}*.png`, `resources/{gold,stone,berry}.png`,
`buildings/{farm,lumber_camp,mill,mining_camp}.png`, cavalry, icons and cursors keep
their project-original art;
their bytes are pinned under `legacy` in the lock, with the icon provenance
recorded as unknown. The grassland tileset ships no tile map (its OGA page points
at the Flare repo, whose current tileset definition maps a different image), and
only 19 of its 64x32 cells are real iso diamonds - all dirt, none grass. It is
also drawn unlit, about 2x darker than the client's grass. See
`docs/plans/06-aoe-asset-rebuild.md` §16.3 for the measurements.

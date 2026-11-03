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
row is empty (art not bottom-anchored), when a source lost its author/license or
is missing from `CREDITS.md`, or when a legacy sprite was edited or is new
(`--legacy` re-pins them).

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
- Resampling is done in premultiplied alpha to avoid dark fringes.
- The lock records `bbox`, `topInset`, `bottomInset`, `scale`, `lumGain`,
  `sourceSha256` and the license/author for every file. Hashes are of the PNG
  bytes, so a different Pillow build may need a rebuild (same pixels, new bytes).
- `legacy` in the lock pins the PNGs no target builds (terrain, gold/stone/berry,
  farm/mill/mining camp/tower, units, cursors, icons). They have no upstream to
  rebuild from, so they are hash-only: a hand edit or a stray regeneration fails
  `--check` instead of shipping silently. The generated gate and road stamps are
  excluded because another script rebuilds them (see below).

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

## Not migrated

`terrain/{grass,dirt}*.png`, `resources/{gold,stone,berry}.png`, `buildings/{farm,mill,
mining_camp,tower}.png`, cavalry, icons and cursors keep their previous art;
their bytes are pinned under `legacy` in the lock, with the icon provenance
recorded as unknown. The grassland tileset ships no tile map (its OGA page points
at the Flare repo, whose current tileset definition maps a different image), and
only 19 of its 64x32 cells are real iso diamonds - all dirt, none grass. It is
also drawn unlit, about 2x darker than the client's grass. See
`docs/plans/06-aoe-asset-rebuild.md` §16.3 for the measurements.

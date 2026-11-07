# Credits

## Third-party art

### 400+ Items - BaseHumanMale / Orc / Skeleton

- **Author:** SKYZ0R ([OpenGameArt profile](https://opengameart.org/users/skyz0r))
- **Source:** https://opengameart.org/content/400-items-basehumanmale-orc-skeleton
- **License:** [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Used for:** the villager, spearman and archer units
  (`assets/units/actions/{villager,spearman,archer}_*.png`). Cavalry keeps its own
  procedurally drawn art: the pack is humanoid only and ships no mounted base.

**Changes made.** The pack ships single frames per item, animation, camera and
time step. We composite a base body with clothing layers, reorder the cameras into
the client's east-first compass order, re-baseline every direction onto a shared
ground line (vertically only - the pack already centres figures horizontally, and
re-centring on the feet measured worse), and soften the hard alpha edge so it does
not shimmer against the grass. No frame is redrawn or recoloured.

The build is reproducible: `scripts/build_oga_unit_sheets.py` documents the
camera mapping it measures from the pack and writes both the sheets and a report
of the per-direction offsets that were applied. `scripts/build_oga_soldier_variants.py`
holds the soldier outfit candidates, builds them for comparison, and rebuilds the
chosen one into the client assets.

Current layers, bottom to top:

- villager: `BaseHumanMale` (body), `BrownPants`, `TunicBlue` (muted indigo,
  #464a6c), `ShortHairLight` (blond hair), `BeardLight`. The carry sheet adds
  `Satchel` to that stack and reuses the walk cycle, because the pack ships no
  carrying animation:

      python scripts/build_oga_unit_sheets.py --unit villager \
          --layers BaseHumanMale,BrownPants,TunicBlue,ShortHairLight,BeardLight,Satchel \
          --actions idle=1_Idle,carry=5_Walk --title "villager carry" \
          --out scripts/out/oga_villager/carry --preview-dir scripts/out/oga_villager/carry
- spearman: `BaseHumanMale`, `BrownPants`, `BreastPlate1`, `ShortHairDark`,
  `GuardHelmet1`, `Spear`
- archer: `BaseHumanMale`, `BrownPants`, `ScaleShirt`, `LeatherBoots`,
  `ShortHairDark`, `ChainCoif`, `HuntingBow`, `QuiverBelt`

The pack also ships `LongHair*`, `PonyBeard*`, `DreamWalkerHair*`, several armour
and helmet sets and other weapons; `scripts/preview_oga_variants.py` renders the
candidates side by side so a different look can be swapped in by changing the
layer list only.

The archer's attack sheet is built from the pack's `3_Bow` draw-and-loose rather
than its melee swing, and every unit's death sheet from `7_Death`.

If you reuse this project's art elsewhere, keep this attribution with it. If you
only reuse the original pack, attributing SKYZ0R directly satisfies the license.

## Buildings, trees and props

The art below replaces the AI-generated building and tree sprites. It is built by
`scripts/assets/build.py` from the manifest in `scripts/assets/manifest.json`; the
lock file records every output hash, canvas and the measured artwork box. Sprite
dimensions are normalised to what the client already draws, so no renderer
geometry had to change.

All sprites are cropped to their alpha bounds, scaled to the existing canvas,
anchored bottom-centre, and their luminance is matched to the sprite they
replace so the map keeps its current brightness. No sprite is redrawn;
the ground cover also gets a per-channel gain so its saturation reaches the
client's grass, and the border forest reuses three trees of the same pack.

### Tree Collection v2.6 — Bleed

- **Author:** Bleed
- **Source:** https://opengameart.org/content/tree-collection-v26-bleeds-game-art
- **License:** [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Used for:** `assets/resources/tree.png`, `tree_2.png`, `tree_3.png`,
  `tree_4.png` — the four silhouettes a resource node picks from
  (`scripts/assets/manifest.json`, targets `resource.tree*`) — and
  `assets/decor/border_tree_01..03.png` for the forest ring outside the map.

**Changes made.** Seven trees (`_tree_02`, `_tree_04`, `_tree_05`, `_tree_11` for
resource nodes; `_tree_09`, `_tree_12`, `_tree_13` for the border) were taken from
the pack, one camera each (`00000`), cropped to alpha, fitted into the client's
canvas (160x220 for resource nodes, 400x340 for border trees) and
luminance-matched. No frame is recoloured; the files differ only in the source
tree. Variants were chosen by measured hue so the forest stays one palette:
`_tree_06`/`_tree_07` (45 deg, autumn) and `_tree_10`/`_tree_14` (23-27 deg,
bare) are deliberately unused.

### 100+ isometric forbs and Assorted isometric rocks — Hansjörg Malthaner

- **Author:** Hansjörg Malthaner (Varkalandar)
- **Source:** https://opengameart.org/content/100-isometric-forbs (forbs),
  https://opengameart.org/content/assorted-isometric-rocks (rocks)
- **License:** [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/) for the
  forbs, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) for the rocks
- **Used for:** `assets/decor/forb_01..12.png` (flowers, grass tufts, bushes) and
  `assets/decor/rock_01..06.png` (scattered stones).

**Changes made.** Each upload is a sheet of separate plants/rocks; the build cuts
the sheet into sprites by connected alpha regions, picks one sprite per target,
crops it to alpha, applies a per-channel gain (forbs only, to lift the pack's
duller saturation to the client's grass), luminance-matches it, and fits it into
a 160x96 (forbs) or 80x64 (rocks) canvas, anchored bottom-centre. Rocks are not
gain-corrected. No sprite is redrawn.

### Simple Isometric Hovel — Bleed

- **Author:** Bleed
- **Source:** https://opengameart.org/content/simple-isometric-hovel
- **License:** [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Used for:** `assets/buildings/house.png`.

**Changes made.** One of the pack's 16 directions (`00000`) is cropped to alpha,
scaled to 256x220 and luminance-matched. The separate shadow layer in the pack
is not shipped as a second sprite; the game has no dynamic shadow system, so the
building stands on its own footprint.

### Medieval Buildings 01, 04, 05 and 06 — Bleed

- **Author:** Bleed
- **Source:** https://opengameart.org/content/medieval-building-01-bleeds-game-art-0,
  https://opengameart.org/content/medieval-building-04-bleeds-game-art,
  https://opengameart.org/content/medieval-building-05-bleeds-game-art,
  https://opengameart.org/content/medieval-building-06
- **License:** [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Used for:** `assets/buildings/house_2.png` (building 05),
  `house_3.png` (building 06), `house_4.png` (building 01) and `house_5.png`
  (building 04) — the four level tiers above the hovel above.

**Changes made.** Each sheet is cropped to alpha, luminance-matched to the map's
`107.3` target and fitted to its own canvas, anchored bottom-centre. Three of the
four pack a soft drop shadow into the sprite itself; `scripts/assets/ops.py`
`floor_alpha` fades it out (alpha ≤ 96 → 0, the rest rescaled) before the crop and
again after the fit, because the shadow otherwise drags the measured iso base
corner ~12–17% off centre and fails `build.py --check`. Nothing is redrawn.

### Galata Tower — Bleed

- **Author:** Bleed
- **Source:** https://opengameart.org/content/galata-tower-bleeds-game-art
- **License:** [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Used for:** `assets/buildings/tower.png`.

**Changes made.** One of the pack's eight directions (`Galata-Tower_0003`) is
cropped to alpha, scaled to the client's 160x360 canvas and luminance-matched.
The source is a tall, round tower whose anti-aliased base would otherwise widen
the lowest opaque row past the `iso_base` gate after downscaling, so a 160 alpha
floor trims that fringe before the crop and again after the fit. No artwork is
redrawn.

### Medieval Barracks, Medieval Stable, Medieval Archery Range and Castle — feudalwars

- **Author:** feudalwars (made for [Feudal Wars](https://feudalwars.net/))
- **Source:** https://opengameart.org/content/medieval-barracks-isometric-25d,
  https://opengameart.org/content/medieval-stable-isometric-25d,
  https://opengameart.org/content/medieval-archery-range-isometric-25d,
  https://opengameart.org/content/western-european-castle-isometric-25d
- **License:** CC0 1.0 (public domain dedication — attribution not required,
  kept here for provenance)
- **Used for:** `assets/buildings/barracks.png` (barracks),
  `assets/buildings/stable.png` (stable), `assets/buildings/archery_range.png`
  (archery range), `assets/buildings/lumber_camp.png` (stable, reused as the
  wood drop-off) and `assets/buildings/town_center.png` (castle).

**Changes made.** All five are cropped to alpha, scaled to the client's canvas
and luminance-matched; the stable is reused as the lumber camp because the pack
has no dedicated drop-off building, and the castle stands in for the town centre
because the set has no town-hall building. The castle is also mirrored
horizontally so its gate faces the direction the client's isometric camera
looks from; the other buildings are unmodified apart from crop/scale.


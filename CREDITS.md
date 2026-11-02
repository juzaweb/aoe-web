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

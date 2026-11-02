# Credits

## Third-party art

### 400+ Items - BaseHumanMale / Orc / Skeleton

- **Author:** SKYZ0R ([OpenGameArt profile](https://opengameart.org/users/skyz0r))
- **Source:** https://opengameart.org/content/400-items-basehumanmale-orc-skeleton
- **License:** [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Used for:** the villager unit (`assets/units/actions/villager_*.png`)

**Changes made.** The pack ships single frames per item, animation, camera and
time step. We composite a base body with clothing layers, reorder the cameras into
the client's east-first compass order, re-baseline every direction onto a shared
ground line (vertically only - the pack already centres figures horizontally, and
re-centring on the feet measured worse), and soften the hard alpha edge so it does
not shimmer against the grass. No frame is redrawn or recoloured.

The build is reproducible: `scripts/build_oga_unit_sheets.py` documents the
camera mapping it measures from the pack and writes both the sheets and a report
of the per-direction offsets that were applied.

Current villager layers, bottom to top: `BaseHumanMale` (body), `BrownPants`,
`TunicBlue` (muted indigo, #464a6c), `ShortHairLight` (blond hair), `BeardLight`.

The pack also ships `LongHair*`, `PonyBeard*`, `DreamWalkerHair*` and combined
hair-and-beard layers; `scripts/preview_oga_variants.py` renders them side by side
so a different look can be swapped in by changing the layer list only.

If you reuse this project's art elsewhere, keep this attribution with it. If you
only reuse the original pack, attributing SKYZ0R directly satisfies the license.

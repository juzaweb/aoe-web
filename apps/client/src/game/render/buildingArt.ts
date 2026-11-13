import {
  getBuildingVisualTier,
  getBuildingVisualTierNameForTier,
  getNextVisualTierLevel,
  type BuildingType
} from '@chien-quoc/shared';

/** Where a building type's artwork sits relative to its container origin. */
export interface BuildingArt {
  textureKey: string;
  offsetY: number;
  scale: number;
}

/**
 * The generated gate sheet, as measured by
 * `scripts/process_generated_assets.py --check`: a 320x360 canvas with four
 * empty rows on top, drawn at 1.5x so the gate reads as a landmark rather than a
 * 2x2 prop. Its lift and health-bar height are derived from these numbers, so a
 * rescale or a re-crop cannot leave the bar floating over the arch.
 */
const PORTAL_SHEET = { canvasHeight: 360, topInset: 4, scale: 1.5 } as const;

/** Local y of the art's bottom row: the same `+40` the 2x2 house uses. */
const GATE_BASE_Y = 40;

/** Lift that puts the scaled sheet's bottom row on `GATE_BASE_Y`. */
const PORTAL_LIFT = GATE_BASE_Y - (PORTAL_SHEET.canvasHeight * PORTAL_SHEET.scale) / 2;

/** Bar 8 px above the scaled art top, which sits `topInset` below the canvas. */
const PORTAL_HP_BAR_Y =
  PORTAL_LIFT -
  (PORTAL_SHEET.canvasHeight / 2) * PORTAL_SHEET.scale +
  PORTAL_SHEET.topInset * PORTAL_SHEET.scale -
  8;

/**
 * Wall art geometry, shared with `CitadelLayer`.
 *
 * `citadel/wall.png` is a 128x184 canvas whose base centre sits 152 px down; a
 * normal centre-origin image therefore sits at `-(152 - 184 / 2) = -60` so the
 * player-built segment lines up with the citadel's own wall run. The bar sits
 * just above the cap, whose top edge is 152 px above the tile centre.
 */
const WALL_TEXTURE_KEY = 'citadel_wall';
const WALL_ART_OFFSET_Y = -60;
const WALL_HP_BAR_Y = -160;

/**
 * Lift of the generated `building_<TYPE>` sheet above the tile centre.
 *
 * Every sheet is bottom-anchored (art touches the last row), so the lift is what
 * puts the base of the art on the footprint rather than its centre. Canvas sizes
 * differ per type, which is why the lift is a table rather than a constant.
 *
 * Exported for the asset test, which recomputes the health-bar height from the
 * measured artwork top in `scripts/assets/assets.lock.json`.
 */
export const SHEET_OFFSET_Y: Partial<Record<BuildingType, number>> = {
  TOWN_CENTER: -130,
  BARRACKS: -96,
  // MIL-01: both new sheets are drawn at the barracks' 400x320 canvas, so they
  // reuse its lift. A different canvas size would need its own number here.
  STABLE: -96,
  ARCHERY_RANGE: -96,
  // Generated on the same 400x320 canvas as the military trainers.
  SIEGE_WORKSHOP: -96,
  HOUSE: -88,
  FARM: 0,
  TOWER: -160,
  // ECO: the three drop-off camps are drawn on the same sheet as the house.
  LUMBER_CAMP: -70,
  MILL: -70,
  MINING_CAMP: -70,
  // Bottom-anchored at `GATE_BASE_Y`, so the taller art grows upwards.
  PORTAL: PORTAL_LIFT
};

/**
 * Sprite scale for sheets that are drawn larger than their footprint.
 *
 * The 2x2 footprint is unchanged, so collision and the server's placement rules
 * are untouched; only the drawn sprite grows.
 */
const SHEET_SCALE: Partial<Record<BuildingType, number>> = {
  PORTAL: PORTAL_SHEET.scale
};

/**
 * Procedural textures used when a building has no generated PNG.
 *
 * `hpBarY` is part of the entry, not a derived value: the placeholder is a much
 * smaller canvas than the real sheet, so a bar positioned from the sheet's
 * numbers floats far above the drawn sprite. Keeping the two together means a
 * fallback cannot ship without saying where its own bar goes.
 */
const FALLBACK_ART: Partial<
  Record<BuildingType, { textureKey: string; offsetY: number; hpBarY: number }>
> = {
  BARRACKS: { textureKey: 'b_barracks', offsetY: -70, hpBarY: -126 },
  // MIL-01: both new buildings now ship a 400x320 sheet, so this only draws when
  // that PNG failed to load. A blank tile would be worse than a shared
  // placeholder: it still reads as a military building on the map and minimap.
  STABLE: { textureKey: 'b_barracks', offsetY: -70, hpBarY: -126 },
  ARCHERY_RANGE: { textureKey: 'b_barracks', offsetY: -70, hpBarY: -126 },
  // The generated sheet is the normal path; a failed load keeps the barracks
  // silhouette rather than a blank tile.
  SIEGE_WORKSHOP: { textureKey: 'b_barracks', offsetY: -70, hpBarY: -126 },
  HOUSE: { textureKey: 'b_house', offsetY: -50, hpBarY: -90 },
  FARM: { textureKey: 'b_farm', offsetY: 0, hpBarY: -40 },
  TOWER: { textureKey: 'b_tower', offsetY: -90, hpBarY: -148 },
  // Fallback only when neither the wall sheet nor the citadel masonry loaded;
  // the tower silhouette is at least a stone fortification.
  WALL: { textureKey: 'b_tower', offsetY: -90, hpBarY: -148 },
  // The gate has its own sheet now (`GATE-01`); this only draws when that PNG
  // failed to load, so it keeps the tower silhouette rather than a blank tile.
  PORTAL: { textureKey: 'b_tower', offsetY: -90, hpBarY: -148 }
};

/**
 * Per-tier artwork for buildings whose silhouette changes with level (LVL3).
 *
 * Index 0 is tier 1. `canvasHeight` and `topInset` are the shipped sheet's
 * measurements (see `scripts/assets/assets.lock.json`); everything else is
 * derived from them.
 *
 * Currently all buildings share a level-invariant silhouette; this table is
 * preserved for when multi-tier visual assets are reintroduced.
 */
interface TierArtSpec {
  canvasHeight: number;
  topInset: number;
}

const TIER_ART: Partial<Record<BuildingType, readonly TierArtSpec[]>> = {};

const DEFAULT_ART = { textureKey: 'b_town_center', offsetY: -130, hpBarY: -203 };

/**
 * Top of the health / construction bar, in the container's local space. Each
 * building's roof sits at a different height, so the bar has to follow it.
 *
 * The numbers track the top of the artwork inside each shipped sheet, not the
 * sheet rectangle: a sprite whose art does not reach the top row leaves a gap
 * that the bar has to absorb. The OpenGameArt pass recomputed the four rows it
 * replaced from the measured top inset in `scripts/assets/assets.lock.json`;
 * `PORTAL` comes from the generated 320x360 sheet, whose top inset is 4 px
 * (measured by `scripts/process_generated_assets.py --check`).
 */
const HP_BAR_Y: Partial<Record<BuildingType, number>> = {
  // Canva rework 576x440 sheet: -130 - 440/2 + topInset 23 - 8.
  TOWN_CENTER: -335,
  // Bleed's Galata Tower: -160 - 360/2 + topInset 9 - 8.
  TOWER: -339,
  BARRACKS: -260,
  // MIL-01: same 400x320 canvas, but each OpenGameArt sheet keeps its own
  // artwork height: -264 + topInset (Stable 3, Archery Range 29).
  STABLE: -261,
  ARCHERY_RANGE: -235,
  // Generated 400x320 sheet: -96 - 320/2 + topInset 0 - 8.
  SIEGE_WORKSHOP: -264,
  HOUSE: -224,
  FARM: -100,
  // ECO: generated camps on the 256x220 house canvas. -70 - 220/2 + topInset - 8.
  LUMBER_CAMP: -187,
  MILL: -188,
  MINING_CAMP: -188,
  // Gate: the bar follows the scaled art's top edge, not the sheet rectangle.
  PORTAL: PORTAL_HP_BAR_Y
};

/**
 * The one place that maps a building type to its artwork. The placed sprite and
 * the placement ghost both read it, so a preview can never drift from the real
 * building.
 *
 * `hasTexture` keeps this free of Phaser: the callers pass their texture
 * manager's `exists`.
 *
 * `level` selects a visual tier for types whose shape changes with level
 * (LVL3). The lookup walks down from the requested tier so a missing sheet
 * degrades to the previous shape instead of a green box, and the level-1 sheet
 * is the last generated fallback before the procedural texture.
 */
export function buildingArt(
  type: BuildingType,
  hasTexture: (textureKey: string) => boolean,
  level = 1
): BuildingArt {
  const requested = visualTier(type, level);
  const drawn = drawnTier(type, requested, hasTexture);
  if (drawn > 1) {
    return {
      textureKey: `building_${type}_${drawn}`,
      offsetY: tierOffsetY(type, drawn),
      scale: 1
    };
  }

  // The wall reuses the citadel masonry so a player-built segment reads as the
  // same stone as the capital's ring. Checked before the stand-alone sheet name
  // so a stray `building_WALL` file cannot silently change the alignment.
  if (type === 'WALL' && hasTexture(WALL_TEXTURE_KEY)) {
    return {
      textureKey: WALL_TEXTURE_KEY,
      offsetY: WALL_ART_OFFSET_Y,
      scale: 1
    };
  }

  const customKey = `building_${type}`;
  if (hasTexture(customKey)) {
    return {
      textureKey: customKey,
      offsetY: SHEET_OFFSET_Y[type] ?? DEFAULT_ART.offsetY,
      scale: SHEET_SCALE[type] ?? 1
    };
  }
  return fallbackArt(type);
}

/**
 * Building types whose art ships a team-colour accent layer.
 *
 * The accent is a second PNG, `<type>_accent.png`, drawn over the building and
 * tinted with the owner's colour - the same two-layer trick the directional unit
 * sheets use (see `docs/plans/31-team-color-building-accents.md`). The layer
 * covers the roofs, or the banners on the two buildings that fly cloth, so the
 * team colour reads from across the map without repainting the art per kingdom.
 *
 * A type missing from this list keeps its painted colours. `WALL` is the one
 * case: a player-built segment borrows the citadel's masonry sheet, which is not
 * part of the accent set, so it has no accent file to draw.
 */
export const BUILDING_ACCENT_TYPES: readonly BuildingType[] = [
  'TOWN_CENTER',
  'BARRACKS',
  'STABLE',
  'ARCHERY_RANGE',
  'SIEGE_WORKSHOP',
  'HOUSE',
  'FARM',
  'TOWER',
  'PORTAL',
  'LUMBER_CAMP',
  'MILL',
  'MINING_CAMP'
];

/**
 * Texture key of a building's accent layer, e.g. `building_HOUSE_accent`.
 *
 * Derived from the body's key rather than from the type, so a tiered sheet
 * (`building_HOUSE_2`) keeps its own accent and a sprite that degraded to a
 * procedural placeholder (`b_house`) asks for a key nobody loaded instead of
 * borrowing another building's accent. The caller checks the cache either way.
 */
export function buildingAccentKey(textureKey: string): string {
  return `${textureKey}_accent`;
}

/**
 * The procedural placeholder, copied field by field.
 *
 * Spreading the table entry would leak its `hpBarY` into the returned
 * `BuildingArt`, and a spread also bypasses TypeScript's excess-property check,
 * so the leak would be silent. Copying the three drawn fields keeps the two
 * concerns separate: `buildingArt` says what to draw, `buildingHpBarY` reads
 * `hpBarY` itself.
 */
function fallbackArt(type: BuildingType): BuildingArt {
  const entry = FALLBACK_ART[type] ?? DEFAULT_ART;
  return { textureKey: entry.textureKey, offsetY: entry.offsetY, scale: 1 };
}

/**
 * The highest tier at or below `requested` whose sheet actually loaded.
 *
 * One walk, so the sprite and the detail panel cannot disagree: if tier 4's PNG
 * is missing, both draw and *report* tier 3 rather than labelling a cottage as
 * a manor. Returns `1` when even the tier-1 sheet is missing, which is the
 * procedural fallback the caller then handles.
 */
function drawnTier(
  type: BuildingType,
  requested: number,
  hasTexture: (textureKey: string) => boolean
): number {
  for (let candidate = requested; candidate > 1; candidate--) {
    if (hasTexture(`building_${type}_${candidate}`)) return candidate;
  }
  return 1;
}

/**
 * How many shape sheets a type ships; `1` means level-invariant.
 *
 * This is the *art* count, and it is deliberately separate from
 * `getBuildingVisualTierCount` in `@chien-quoc/shared`: that one counts game
 * milestones. If the shared table gains a milestone before the sheet exists,
 * preload would ask for a PNG nobody drew — so preload and the renderer read
 * this count, and a missing sheet just degrades to the previous shape.
 */
export function buildingVisualTierCount(type: BuildingType): number {
  return TIER_ART[type]?.length ?? 1;
}

/** Everything the detail panel shows about a building's shape. */
export interface BuildingTierInfo {
  /** 1-based shape currently drawn, clamped to the shipped sheets. */
  tier: number;
  /** How many shapes this type ships; `1` means level-invariant. */
  count: number;
  /** English shape name, or `null` for a type that never changes. */
  name: string | null;
  /** Level that draws the next shape, or `null` at the last shipped one. */
  nextLevel: number | null;
}

/**
 * Resolves the tier triple in one place so the panel cannot disagree with the
 * sprite, including when a sheet is missing and the art degrades.
 *
 * `hasTexture` is optional so a caller without a texture manager (a test, or a
 * future non-Phaser surface) still gets the level-derived answer, but the scene
 * passes its real one.
 */
export function buildingTierInfo(
  type: BuildingType,
  level = 1,
  hasTexture: (textureKey: string) => boolean = () => true
): BuildingTierInfo {
  const count = buildingVisualTierCount(type);
  if (count === 1) return { tier: 1, count: 1, name: null, nextLevel: null };

  const requested = visualTier(type, level);
  const tier = drawnTier(type, requested, hasTexture);
  return {
    tier,
    count,
    name: getBuildingVisualTierNameForTier(type, tier),
    // Only promise a shape change we can actually draw.
    nextLevel: tier < count ? getNextVisualTierLevel(type, level) : null
  };
}

/**
 * Top of the health / construction bar for a building at `level`, in container
 * space.
 *
 * Level-invariant types keep the hand-tuned table; tiered types derive it from
 * the sheet's measured art top so a new tier cannot float its bar.
 *
 * `hasTexture` decides *which* art is on screen. A building whose sheet is
 * missing draws its procedural placeholder, which is a much smaller canvas, so
 * the bar has to follow the placeholder instead of the sheet that was never
 * drawn — otherwise the bar hangs in empty space above a small sprite. Pass the
 * scene's real texture manager; the default assumes the sheet exists, which is
 * what a unit test without a renderer wants.
 */
export function buildingHpBarY(
  type: BuildingType,
  level = 1,
  hasTexture: (textureKey: string) => boolean = () => true
): number {
  // The wall uses the citadel sheet, whose bar height is part of that art's
  // geometry rather than the stand-alone building tables below.
  if (type === 'WALL' && hasTexture(WALL_TEXTURE_KEY)) return WALL_HP_BAR_Y;
  // Ask the same function that picked the sprite. A texture key that does not
  // start with `building_` is the procedural placeholder, whose own bar height
  // is part of its `FALLBACK_ART` entry.
  if (!buildingArt(type, hasTexture, level).textureKey.startsWith('building_')) {
    return (FALLBACK_ART[type] ?? DEFAULT_ART).hpBarY;
  }

  const tier = visualTier(type, level);
  const spec = tierSpec(type, tier);
  if (spec) {
    return tierOffsetY(type, tier) - spec.canvasHeight / 2 + spec.topInset - 8;
  }
  return HP_BAR_Y[type] ?? -120;
}

/**
 * Visual tier for a level: the shared milestone answer, clamped to the number
 * of sheets this module actually ships.
 */
function visualTier(type: BuildingType, level: number): number {
  const specs = TIER_ART[type];
  if (!specs) return 1;
  return Math.min(getBuildingVisualTier(type, level), specs.length);
}

function tierSpec(type: BuildingType, tier: number): TierArtSpec | null {
  const specs = TIER_ART[type];
  if (!specs) return null;
  return specs[Math.min(Math.max(1, tier), specs.length) - 1];
}

function tierOffsetY(type: BuildingType, tier: number): number {
  const spec = tierSpec(type, tier);
  if (!spec) return SHEET_OFFSET_Y[type] ?? DEFAULT_ART.offsetY;
  return 40 - spec.canvasHeight / 2;
}

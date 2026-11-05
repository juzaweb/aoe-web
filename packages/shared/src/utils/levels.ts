import { BUILDING_BLUEPRINTS, UNIT_BLUEPRINTS } from '../constants/index.js';
import type { BuildingType, Resources, UnitType } from '../types/index.js';

/**
 * Stat growth is linear in the level number: level 1 is the blueprint's
 * baseline, and every level above it adds a fixed share of that baseline. No
 * compounding, so the numbers in the UI stay predictable at level 100.
 *
 * Price and duration are the exception and compound in their second phase (see
 * {@link timeScale} / {@link costScale}): stats may stay readable, the climb
 * itself must not run out of road.
 */
export const BUILDING_STAT_GROWTH_PER_LEVEL = 0.02;
export const UNIT_STAT_GROWTH_PER_LEVEL = 0.05;

/** Drop-off buildings still stop at ten levels. */
export const MAX_BUILDING_LEVEL = 10;
export const MAX_TOWN_CENTER_LEVEL = 100;
/** Core buildings climb alongside the Town Center, so they share its cap. */
export const MAX_CORE_BUILDING_LEVEL = 100;
export const MAX_UNIT_LEVEL = 10;

/**
 * The four buildings that gate the Town Center (LVL2).
 *
 * A Town Center may not pull ahead of them: every {@link CORE_LEVEL_STEP}
 * levels it demands the same level from all four, which turns "wait for the
 * timer" into "build the base that supports the Town Center". `LUMBER_CAMP`,
 * `MILL` and `MINING_CAMP` are drop-offs and stay capped at
 * {@link MAX_BUILDING_LEVEL}; they are deliberately not part of the gate.
 */
export const CORE_BUILDING_TYPES: readonly BuildingType[] = [
  'HOUSE',
  'BARRACKS',
  'FARM',
  'TOWER'
];

/** How many Town Center levels one core-level step covers. */
export const CORE_LEVEL_STEP = 5;

/**
 * How many of a player's buildings may upgrade at the same time (LVL-09).
 *
 * Without a cap the four core ladders run in parallel and the Town Center gate
 * costs nothing but attention; two slots keep a real queue in front of the
 * player without turning every upgrade into a global lock.
 */
export const MAX_CONCURRENT_BUILDING_UPGRADES = 2;

/** Gold added on top of the unit's own cost for each research level. */
export const UNIT_RESEARCH_GOLD_PER_LEVEL = 25;

/**
 * Index order of `PlayerState.unitLevels`. Shared with the server, which stores
 * the array as a CSV column in the same order.
 */
export const UNIT_UPGRADE_ORDER: readonly UnitType[] = [
  'VILLAGER',
  'SPEARMAN',
  'ARCHER',
  'CAVALRY'
];

/**
 * Level milestones where a building's artwork changes (LVL3).
 *
 * A building has one sprite per "visual tier". The house climbs to level 100,
 * which is far too many drawings to ship, so the shape changes at four points:
 * a hut, a cottage, a timber house, a stone house and finally a manor. The
 * tiers are a pure function of the level, so the server never has to replicate
 * anything and a client that reconnects redraws the same shape.
 *
 * Element `i` is the first level of tier `i + 1`: level 1 is tier 1, level 2
 * tier 2, level 5 tier 3, level 10 tier 4 and level 25 tier 5, and every level
 * above 25 stays on the last tier.
 */
export const HOUSE_VISUAL_TIER_LEVELS: readonly number[] = [1, 2, 5, 10, 25];

/** Display names of the house tiers, index-aligned with the milestones. */
export const HOUSE_VISUAL_TIER_NAMES: readonly string[] = [
  'Thatched Hut',
  'Timber Cottage',
  'Stone Cottage',
  'Town House',
  'Manor'
];

export interface BuildingLevelStats {
  maxHp: number;
  attackPower: number;
  populationProvided: number;
}
export interface UnitLevelStats {
  maxHp: number;
  attackPower: number;
  carryCapacity: number;
}

/** One core building's progress towards the Town Center's current gate. */
export interface CoreLevelGap {
  type: BuildingType;
  /** Highest finished level the player owns for this type; 0 when none. */
  current: number;
  required: number;
  met: boolean;
}

export function getBuildingMaxLevel(type: BuildingType): number {
  if (type === 'TOWN_CENTER') return MAX_TOWN_CENTER_LEVEL;
  if (CORE_BUILDING_TYPES.includes(type)) return MAX_CORE_BUILDING_LEVEL;
  return MAX_BUILDING_LEVEL;
}

/**
 * Which visual tier's artwork a building shows at `rawLevel` (LVL3).
 *
 * Returns a 1-based tier index clamped to the milestone table, so a level-100
 * House keeps the last drawing instead of asking for a sprite that does not
 * exist. Types without their own tier table always stay on tier 1.
 */
export function getBuildingVisualTier(type: BuildingType, rawLevel: number): number {
  const milestones = visualTierLevels(type);
  if (!milestones) return 1;

  const level = clampLevel(rawLevel, getBuildingMaxLevel(type));
  let tier = 1;
  for (let i = 0; i < milestones.length; i++) {
    if (level >= milestones[i]) tier = i + 1;
  }
  return tier;
}

/** How many distinct shapes a building type ships; `1` means level-invariant. */
export function getBuildingVisualTierCount(type: BuildingType): number {
  return visualTierLevels(type)?.length ?? 1;
}

/**
 * English display name of a 1-based tier, or `null` when the type has no tiers.
 *
 * `rawTier` is the 1-based tier index. The client resolves which shape it
 * actually drew (a missing sheet degrades to the previous one) and names that
 * index, so the label always matches the sprite. Callers that only have a level
 * go through {@link getBuildingVisualTierName}.
 */
export function getBuildingVisualTierNameForTier(
  type: BuildingType,
  rawTier: number
): string | null {
  const milestones = visualTierLevels(type);
  if (!milestones) return null;
  const tier = Math.floor(Number(rawTier));
  if (!Number.isFinite(tier) || tier < 1 || tier > milestones.length) return null;
  return HOUSE_VISUAL_TIER_NAMES[tier - 1] ?? null;
}

/** English display name of the tier a level draws, or `null` without tiers. */
export function getBuildingVisualTierName(type: BuildingType, rawLevel: number): string | null {
  return getBuildingVisualTierNameForTier(type, getBuildingVisualTier(type, rawLevel));
}

/**
 * The level at which the next shape appears, or `null` at the last tier.
 *
 * The UI reads this to tell the player "shape changes at level 5" without
 * duplicating the milestone table.
 */
export function getNextVisualTierLevel(type: BuildingType, rawLevel: number): number | null {
  const milestones = visualTierLevels(type);
  if (!milestones) return null;

  const tier = getBuildingVisualTier(type, rawLevel);
  return tier < milestones.length ? milestones[tier] : null;
}

/** Per-type tier milestones; `null` for types whose art is level-invariant. */
function visualTierLevels(type: BuildingType): readonly number[] | null {
  return type === 'HOUSE' ? HOUSE_VISUAL_TIER_LEVELS : null;
}

/**
 * The level all four core buildings must reach before the Town Center may go
 * from `townCenterLevel` to `townCenterLevel + 1` (LVL2/D5).
 *
 * It only steps up every {@link CORE_LEVEL_STEP} levels, so the first four
 * upgrades are free and a level-50 Town Center demands level-45 pillars.
 */
export function getRequiredCoreLevel(townCenterLevel: number): number {
  const level = clampLevel(townCenterLevel, MAX_TOWN_CENTER_LEVEL);
  return Math.floor(level / CORE_LEVEL_STEP) * CORE_LEVEL_STEP;
}

/**
 * Compares the player's core buildings against the Town Center's gate.
 *
 * `levels` is the highest finished level per core type, so owning two Houses
 * only requires one of them to be tall enough — the gate asks for a base that
 * supports the Town Center, not for every copy to be upgraded.
 */
export function getCoreLevelGaps(
  levels: Partial<Record<BuildingType, number>> | null | undefined,
  townCenterLevel: number
): CoreLevelGap[] {
  const required = getRequiredCoreLevel(townCenterLevel);
  return CORE_BUILDING_TYPES.map((type) => {
    const raw = Math.floor(Number(levels?.[type] ?? 0));
    const current = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { type, current, required, met: current >= required };
  });
}

export function getUnitMaxLevel(): number {
  return MAX_UNIT_LEVEL;
}

export function getUnitUpgradeIndex(type: UnitType): number {
  return UNIT_UPGRADE_ORDER.indexOf(type);
}

/** Reads one type's level from a `PlayerState.unitLevels` snapshot. */
export function getPlayerUnitLevel(
  levels: ArrayLike<number> | null | undefined,
  type: UnitType
): number {
  const index = getUnitUpgradeIndex(type);
  const raw = index >= 0 && levels ? levels[index] : undefined;
  return clampLevel(raw ?? 1, MAX_UNIT_LEVEL);
}

/**
 * Level-aware building stats. The population rule is the one place the types
 * differ: the Town Center adds one population per level, while a House scales
 * its flat blueprint value (rounded, so it gains its first point at level 10).
 */
export function getBuildingLevelStats(
  type: BuildingType,
  rawLevel: number
): BuildingLevelStats {
  const blueprint = BUILDING_BLUEPRINTS[type];
  if (!blueprint) return { maxHp: 0, attackPower: 0, populationProvided: 0 };

  const level = clampLevel(rawLevel, getBuildingMaxLevel(type));
  const steps = level - 1;
  const multiplier = 1 + BUILDING_STAT_GROWTH_PER_LEVEL * steps;

  return {
    maxHp: Math.round(blueprint.maxHp * multiplier),
    attackPower: round2(blueprint.attackPower * multiplier),
    populationProvided:
      type === 'TOWN_CENTER'
        ? blueprint.populationProvided + steps
        : Math.round(blueprint.populationProvided * multiplier)
  };
}

export function getUnitLevelStats(type: UnitType, rawLevel: number): UnitLevelStats {
  const blueprint = UNIT_BLUEPRINTS[type];
  if (!blueprint) return { maxHp: 0, attackPower: 0, carryCapacity: 0 };

  const level = clampLevel(rawLevel, MAX_UNIT_LEVEL);
  const multiplier = 1 + UNIT_STAT_GROWTH_PER_LEVEL * (level - 1);

  return {
    maxHp: Math.round(blueprint.maxHp * multiplier),
    attackPower: round2(blueprint.attackPower * multiplier),
    carryCapacity: Math.round(blueprint.carryCapacity * multiplier)
  };
}

/**
 * Cost to take a building from `level` to `level + 1` (LVL2/D2).
 *
 * Two phases: the first ten levels stay on the gentle ramp the opening hours
 * need, then every level compounds by 8% so the late Town Center is a real
 * commitment instead of spare change. `level` is the current level, never the
 * target.
 */
export function getBuildingUpgradeCost(type: BuildingType, rawLevel: number): Resources {
  const blueprint = BUILDING_BLUEPRINTS[type];
  if (!blueprint) return { wood: 0, food: 0, gold: 0, stone: 0 };

  const scale = costScale(clampLevel(rawLevel, getBuildingMaxLevel(type)));
  return {
    wood: Math.round(blueprint.cost.wood * scale),
    food: Math.round(blueprint.cost.food * scale),
    gold: Math.round(blueprint.cost.gold * scale),
    stone: Math.round(blueprint.cost.stone * scale)
  };
}

/**
 * Time to take a building from `level` to `level + 1` (LVL2/D1).
 *
 * The scale is applied to the blueprint's own build time, so a House stays
 * proportionally cheaper than the Town Center. There is deliberately **no
 * ceiling**: a level-99 Town Center is 73 hours of online play, and a cap would
 * flatten the whole second phase back into "a few hours per level".
 */
export function getBuildingUpgradeTimeMs(type: BuildingType, rawLevel: number): number {
  const blueprint = BUILDING_BLUEPRINTS[type];
  if (!blueprint) return 0;

  return Math.round(
    blueprint.buildTimeMs * timeScale(clampLevel(rawLevel, getBuildingMaxLevel(type)))
  );
}

/**
 * Cost to research one unit type from `level` to `level + 1`.
 *
 * The blueprint price is scaled, then a flat gold surcharge is added so military
 * research always competes with unit production for gold.
 */
export function getUnitUpgradeCost(type: UnitType, rawLevel: number): Resources {
  const blueprint = UNIT_BLUEPRINTS[type];
  if (!blueprint) return { wood: 0, food: 0, gold: 0, stone: 0 };

  const level = clampLevel(rawLevel, MAX_UNIT_LEVEL);
  const scale = 0.4 + 0.3 * level + 0.02 * level * level;
  return {
    wood: Math.round(blueprint.cost.wood * scale),
    food: Math.round(blueprint.cost.food * scale),
    gold: Math.round(blueprint.cost.gold * scale) + UNIT_RESEARCH_GOLD_PER_LEVEL * level,
    stone: Math.round(blueprint.cost.stone * scale)
  };
}

export function getUnitUpgradeTimeMs(type: UnitType, rawLevel: number): number {
  const blueprint = UNIT_BLUEPRINTS[type];
  if (!blueprint) return 0;

  const steps = clampLevel(rawLevel, MAX_UNIT_LEVEL) - 1;
  return Math.round(blueprint.trainTimeMs * (0.5 + 0.25 * steps + 0.01 * steps * steps));
}

/**
 * Two-phase upgrade duration scale (LVL2/D1).
 *
 * Levels 1-10 are minutes: `7.5s` for the Town Center at 1, `40m` at 10, which
 * is where the player learns the mechanic. From 11 the ramp restarts at exactly
 * one hour for the Town Center and compounds by 5% per level, ending at 73.2h
 * for the last step. Both branches are multiplied by the blueprint's build time.
 */
function timeScale(level: number): number {
  return level <= 10 ? 0.5 * Math.pow(1.9, level - 1) : 240 * Math.pow(1.05, level - 11);
}

/**
 * Two-phase upgrade price scale (LVL2/D2).
 *
 * Same shape as {@link timeScale} but slightly steeper in the second phase
 * (8%), so resources stay a secondary wall behind time instead of replacing it.
 */
function costScale(level: number): number {
  return level <= 10
    ? 0.5 * Math.pow(1.07, level - 1)
    : 0.5 * Math.pow(1.07, 9) * Math.pow(1.08, level - 10);
}

function clampLevel(level: number, maxLevel: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(maxLevel, Math.max(1, Math.floor(level)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

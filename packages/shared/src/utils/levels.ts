import { BUILDING_BLUEPRINTS, UNIT_BLUEPRINTS } from '../constants/index.js';
import type { BuildingType, Resources, UnitType } from '../types/index.js';

/**
 * Upgrade levels are linear in the level number: level 1 is the blueprint's
 * baseline, and every level above it adds a fixed share of that baseline. No
 * compounding, so the numbers in the UI stay predictable at level 100.
 */
export const BUILDING_STAT_GROWTH_PER_LEVEL = 0.02;
export const UNIT_STAT_GROWTH_PER_LEVEL = 0.05;

export const MAX_BUILDING_LEVEL = 10;
export const MAX_TOWN_CENTER_LEVEL = 100;
export const MAX_UNIT_LEVEL = 10;

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

export function getBuildingMaxLevel(type: BuildingType): number {
  return type === 'TOWN_CENTER' ? MAX_TOWN_CENTER_LEVEL : MAX_BUILDING_LEVEL;
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
 * Cost to take a building from `level` to `level + 1`.
 *
 * The quadratic term is what keeps a 100-level Town Center meaningful: the
 * early levels cost a fraction of the build price, while the last ones are a
 * real commitment. `level` is the current level, never the target.
 */
export function getBuildingUpgradeCost(type: BuildingType, rawLevel: number): Resources {
  const blueprint = BUILDING_BLUEPRINTS[type];
  if (!blueprint) return { wood: 0, food: 0, gold: 0, stone: 0 };

  const scale = buildingUpgradeScale(clampLevel(rawLevel, getBuildingMaxLevel(type)));
  return {
    wood: Math.round(blueprint.cost.wood * scale),
    food: Math.round(blueprint.cost.food * scale),
    gold: Math.round(blueprint.cost.gold * scale),
    stone: Math.round(blueprint.cost.stone * scale)
  };
}

export function getBuildingUpgradeTimeMs(type: BuildingType, rawLevel: number): number {
  const blueprint = BUILDING_BLUEPRINTS[type];
  if (!blueprint) return 0;

  return Math.round(
    blueprint.buildTimeMs * buildingUpgradeScale(clampLevel(rawLevel, getBuildingMaxLevel(type)))
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

function buildingUpgradeScale(level: number): number {
  const steps = level - 1;
  return 0.5 + 0.1 * steps + 0.004 * steps * steps;
}

function clampLevel(level: number, maxLevel: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(maxLevel, Math.max(1, Math.floor(level)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

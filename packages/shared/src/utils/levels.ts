import { BUILDING_BLUEPRINTS, UNIT_BLUEPRINTS } from '../constants/index.js';
import type { BuildingType, Resources, UnitType } from '../types/index.js';

/**
 * Stat growth is linear in the level number: level 1 is the blueprint's
 * baseline, and every level above it adds a fixed share of that baseline. No
 * compounding, so the numbers in the UI stay predictable at the level cap.
 *
 * Price and duration compound instead (see {@link timeScale} /
 * {@link costScale}): stats may stay readable, the climb itself must cost.
 */
export const BUILDING_STAT_GROWTH_PER_LEVEL = 0.02;
export const UNIT_STAT_GROWTH_PER_LEVEL = 0.05;

/**
 * Extra field capacity per level for gatherable buildings (ECO-01).
 *
 * Faster than the generic building growth: a farm's harvest is the whole point
 * of levelling it, so 10%/level turns a 600-food field into 1,140 at the cap
 * instead of the 708 a 2% ramp would give.
 */
export const BUILDING_GATHER_CAPACITY_GROWTH_PER_LEVEL = 0.1;

/**
 * Every upgradable building stops at ten levels.
 *
 * The ladder is short on purpose: ten levels with a gate on every Town Center
 * step is a real campaign, while a hundred levels turned the late game into a
 * timer nobody could reach. The whole roster shares the cap, so a level-10
 * House is the tallest House that will ever exist.
 */
export const MAX_BUILDING_LEVEL = 10;
export const MAX_UNIT_LEVEL = 10;

/**
 * The buildings that gate the Town Center (LVL2).
 *
 * A Town Center may not pull ahead of them: raising it from `L` to `L + 1`
 * demands level `L` from all of them, so every Town Center level has to be
 * earned by a base that already supports it. `LUMBER_CAMP`, `MILL` and
 * `MINING_CAMP` are drop-offs and stay out of the gate.
 *
 * MIL-01: the military line is three buildings now, so all three are pillars.
 * That is the cost of the split — a player who wants a fast Town Center cannot
 * skip two of the three unit branches.
 */
export const CORE_BUILDING_TYPES: readonly BuildingType[] = [
  'HOUSE',
  'BARRACKS',
  'STABLE',
  'ARCHERY_RANGE',
  'FARM',
  'TOWER'
];

/**
 * How many of a player's buildings may upgrade at the same time (LVL-09).
 *
 * Without a cap the core ladders run in parallel and the Town Center gate costs
 * nothing but attention; two slots keep a real queue in front of the player
 * without turning every upgrade into a global lock.
 *
 * MIL-01: unchanged on purpose. The military split added two core pillars, so
 * the gate is heavier than phase 08 measured; raising this to 3 is the obvious
 * knob but it is a balance decision, not part of the split.
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
 * A building has one sprite per "visual tier". With a ten-level ladder the
 * house changes shape four times: a hut, a cottage, a timber house, a stone
 * house and finally a manor. The tiers are a pure function of the level, so the
 * server never has to replicate anything and a client that reconnects redraws
 * the same shape.
 *
 * Element `i` is the first level of tier `i + 1`: level 1 is tier 1, level 2
 * tier 2, level 4 tier 3, level 6 tier 4 and level 8 tier 5, so every tier is
 * reachable inside the cap.
 */
export const HOUSE_VISUAL_TIER_LEVELS: readonly number[] = [1, 2, 4, 6, 8];

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
  /** Harvest capacity for gatherable types; 0 for everything else. */
  gatherCapacity: number;
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

export function getBuildingMaxLevel(_type: BuildingType): number {
  // Every type shares one cap now, so the parameter only keeps the call sites
  // readable at the point where they ask "how high may this one go?".
  return MAX_BUILDING_LEVEL;
}

/**
 * Which visual tier's artwork a building shows at `rawLevel` (LVL3).
 *
 * Returns a 1-based tier index clamped to the milestone table, so a maxed-out
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
 * The UI reads this to tell the player "shape changes at level 6" without
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
 * The level every core building must reach before the Town Center may go from
 * `townCenterLevel` to `townCenterLevel + 1` (LVL2/D5).
 *
 * The gate steps on **every** Town Center level: a level-7 Town Center demands
 * level-7 pillars, so the capital can never outrun the base that feeds it. The
 * first upgrade already demands level-1 pillars, which means every core building
 * — including both new military branches (MIL-01) — has to exist before the Town
 * Center grows at all.
 */
export function getRequiredCoreLevel(townCenterLevel: number): number {
  return clampLevel(townCenterLevel, MAX_BUILDING_LEVEL);
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
  if (!blueprint) {
    return { maxHp: 0, attackPower: 0, populationProvided: 0, gatherCapacity: 0 };
  }

  const level = clampLevel(rawLevel, getBuildingMaxLevel(type));
  const steps = level - 1;
  const multiplier = 1 + BUILDING_STAT_GROWTH_PER_LEVEL * steps;
  const gatherMultiplier = 1 + BUILDING_GATHER_CAPACITY_GROWTH_PER_LEVEL * steps;

  return {
    maxHp: Math.round(blueprint.maxHp * multiplier),
    attackPower: round2(blueprint.attackPower * multiplier),
    populationProvided:
      type === 'TOWN_CENTER'
        ? blueprint.populationProvided + steps
        : Math.round(blueprint.populationProvided * multiplier),
    gatherCapacity: Math.round((blueprint.gatherCapacity ?? 0) * gatherMultiplier)
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
 * Upgrade duration scale (LVL2/D1, retuned for the ten-level ladder).
 *
 * One curve for the whole climb: `0.5` of the blueprint's build time at level 1
 * (`7.5s` for the Town Center) compounding by 3x per level. The last step
 * (9 → 10) is `13h40`, and the whole Town Center ladder is `20h30`. There is no
 * branch at level 11 any more: with a cap of ten levels the player reaches the
 * top long before a second phase would mean anything.
 */
function timeScale(level: number): number {
  return 0.5 * Math.pow(3, level - 1);
}

/**
 * Upgrade price scale (LVL2/D2).
 *
 * Gentler than {@link timeScale} (30% per level) so resources stay a secondary
 * wall behind time instead of replacing it: the last Town Center step costs
 * about 1.1k wood against 13h40 of waiting.
 */
function costScale(level: number): number {
  return 0.5 * Math.pow(1.3, level - 1);
}

function clampLevel(level: number, maxLevel: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(maxLevel, Math.max(1, Math.floor(level)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

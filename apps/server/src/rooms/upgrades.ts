import {
  BuildingType,
  MAX_UNIT_LEVEL,
  UNIT_UPGRADE_ORDER,
  UnitType,
  getBuildingLevelStats,
  getBuildingMaxLevel,
  getUnitLevelStats,
  getUnitUpgradeIndex
} from '@chien-quoc/shared';
import type { BuildingState } from '../schema/BuildingState.js';
import type { PlayerState } from '../schema/PlayerState.js';
import type { UnitState } from '../schema/UnitState.js';
import type { WorldState } from '../schema/WorldState.js';
import { parseUnitLevels } from '../services/playerLevels.js';

/** Replaces a player's replicated level array with the persisted values. */
export function loadPlayerLevels(
  player: PlayerState,
  csv: string | null | undefined
): void {
  player.unitLevels.clear();
  for (const level of parseUnitLevels(csv)) player.unitLevels.push(level);
}

export function isUpgradableUnitType(value: string): value is UnitType {
  return UNIT_UPGRADE_ORDER.includes(value as UnitType);
}

/**
 * Applies one completed building upgrade.
 *
 * The HP delta is added instead of restoring to full: a damaged building keeps
 * every point it was missing, so an upgrade is not a free heal under siege.
 */
export function applyBuildingUpgrade(building: BuildingState): void {
  const oldMaxHp = building.maxHp;
  const maxLevel = getBuildingMaxLevel(building.type as BuildingType);
  building.level = Math.min(maxLevel, Math.max(1, building.level) + 1);

  const stats = getBuildingLevelStats(building.type as BuildingType, building.level);
  building.maxHp = stats.maxHp;
  building.hp = Math.min(stats.maxHp, building.hp + Math.max(0, stats.maxHp - oldMaxHp));
  building.upgradeProgressMs = 0;
  building.upgradeTimeMs = 0;
}

/**
 * Applies one completed unit research to the whole empire.
 *
 * Every living unit of that type is updated on the spot: combat reads the level
 * live, but `maxHp`/`hp` are snapshots, so leaving them behind would desync the
 * health bar from the damage the unit actually takes.
 */
export function applyUnitResearch(
  state: WorldState,
  player: PlayerState,
  unitType: UnitType
): void {
  const index = getUnitUpgradeIndex(unitType);
  if (index < 0) {
    clearUnitResearch(player);
    return;
  }

  const nextLevel = Math.min(MAX_UNIT_LEVEL, (player.unitLevels[index] ?? 1) + 1);
  player.unitLevels[index] = nextLevel;

  const stats = getUnitLevelStats(unitType, nextLevel);
  state.units.forEach((unit: UnitState) => {
    if (unit.ownerId !== player.id || unit.type !== unitType) return;

    const oldMaxHp = unit.maxHp;
    unit.level = nextLevel;
    unit.maxHp = stats.maxHp;
    unit.hp = Math.min(stats.maxHp, unit.hp + Math.max(0, stats.maxHp - oldMaxHp));
  });

  clearUnitResearch(player);
}

export function clearUnitResearch(player: PlayerState): void {
  player.researchUnitType = '';
  player.researchProgressMs = 0;
  player.researchTimeMs = 0;
}

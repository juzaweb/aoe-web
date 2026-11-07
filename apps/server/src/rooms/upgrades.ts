import {
  BuildingType,
  CORE_BUILDING_TYPES,
  MAX_UNIT_LEVEL,
  UNIT_UPGRADE_ORDER,
  UnitType,
  getBuildingMaxLevel,
  getEffectiveBuildingMaxHp,
  getEffectiveUnitMaxHp,
  getUnitUpgradeIndex
} from '@chien-quoc/shared';
import type { BuildingState } from '../schema/BuildingState.js';
import type { PlayerState } from '../schema/PlayerState.js';
import type { UnitState } from '../schema/UnitState.js';
import type { WorldState } from '../schema/WorldState.js';
import { parseUnitLevels } from '../services/playerLevels.js';
import { growGatheredCapacity } from './gatherables.js';

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
 * Highest finished level of each core building the player owns (LVL2/D5).
 *
 * Only finished buildings count: a House foundation is not a level-10 House yet,
 * and letting it satisfy the gate would make the requirement free. Several
 * copies of one type collapse to the tallest, so the gate asks for a base that
 * supports the Town Center, not for the whole village to be upgraded.
 */
export function collectCoreLevels(
  state: WorldState,
  ownerId: string
): Partial<Record<BuildingType, number>> {
  const levels: Partial<Record<BuildingType, number>> = {};
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId || !building.isConstructed) return;
    const type = building.type as BuildingType;
    if (!CORE_BUILDING_TYPES.includes(type)) return;
    levels[type] = Math.max(levels[type] ?? 0, building.level);
  });
  return levels;
}

/**
 * How many of the player's buildings have an upgrade running (LVL2/D6).
 *
 * `upgradeTimeMs > 0` is the same flag the tick and the panel use, so a
 * cancelled upgrade frees its slot the moment the timer is cleared.
 */
export function countActiveBuildingUpgrades(state: WorldState, ownerId: string): number {
  let active = 0;
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId === ownerId && building.upgradeTimeMs > 0) active += 1;
  });
  return active;
}

/**
 * Restores an in-flight upgrade from the persisted columns (LVL2/D7).
 *
 * The timer only advances while the player is online, so the 13h40 last step is
 * spread over many sessions: progress is continued from the saved value instead
 * of restarting. A row with a timer but no progress is treated as "just started".
 *
 * A maxed building never resumes a timer. Saves written under the old 100-level
 * cap can carry a building whose stored level was just clamped down to the new
 * ten-level maximum *and* an upgrade row for it; restoring that timer would tick
 * to completion and apply nothing, so the row is dropped instead.
 */
export function restoreBuildingUpgrade(
  building: BuildingState,
  progressMs: number | null | undefined,
  timeMs: number | null | undefined
): void {
  const maxLevel = getBuildingMaxLevel(building.type as BuildingType);
  const time = Number(timeMs ?? 0);
  const resumable = Number.isFinite(time) && time > 0 && building.level < maxLevel;
  building.upgradeTimeMs = resumable ? time : 0;
  if (!resumable) {
    building.upgradeProgressMs = 0;
    return;
  }
  const progress = Number(progressMs ?? 0);
  building.upgradeProgressMs = Number.isFinite(progress) && progress > 0 ? progress : 0;
}

/**
 * Applies one completed building upgrade.
 *
 * The HP delta is added instead of restoring to full: a damaged building keeps
 * every point it was missing, so an upgrade is not a free heal under siege.
 *
 * `townCenterLevel` folds the owner's empire aura into the new maximum; the
 * default of 1 keeps every pre-phase-25 call site (and its tests) unchanged.
 */
export function applyBuildingUpgrade(building: BuildingState, townCenterLevel = 1): void {
  const oldMaxHp = building.maxHp;
  const maxLevel = getBuildingMaxLevel(building.type as BuildingType);
  const previousLevel = Math.max(1, building.level);
  building.level = Math.min(maxLevel, previousLevel + 1);

  // ECO-01: a field's harvest grows with its level, same as its HP.
  growGatheredCapacity(building, previousLevel, building.level);

  const nextMaxHp = getEffectiveBuildingMaxHp(
    building.type as BuildingType,
    building.level,
    townCenterLevel
  );
  building.maxHp = nextMaxHp;
  building.hp = Math.min(nextMaxHp, building.hp + Math.max(0, nextMaxHp - oldMaxHp));
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
  unitType: UnitType,
  townCenterLevel = 1
): void {
  const index = getUnitUpgradeIndex(unitType);
  if (index < 0) {
    clearUnitResearch(player);
    return;
  }

  const nextLevel = Math.min(MAX_UNIT_LEVEL, (player.unitLevels[index] ?? 1) + 1);
  player.unitLevels[index] = nextLevel;

  state.units.forEach((unit: UnitState) => {
    if (unit.ownerId !== player.id || unit.type !== unitType) return;

    const oldMaxHp = unit.maxHp;
    unit.level = nextLevel;
    // Combat reads the attack live, but `maxHp`/`hp` are snapshots; both the
    // research level and the Town Center aura must be folded in here.
    const nextMaxHp = getEffectiveUnitMaxHp(unitType, nextLevel, townCenterLevel);
    unit.maxHp = nextMaxHp;
    unit.hp = Math.min(nextMaxHp, unit.hp + Math.max(0, nextMaxHp - oldMaxHp));
  });

  clearUnitResearch(player);
}

export function clearUnitResearch(player: PlayerState): void {
  player.researchUnitType = '';
  player.researchProgressMs = 0;
  player.researchTimeMs = 0;
}

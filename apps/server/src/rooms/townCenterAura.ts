import {
  BuildingType,
  UnitType,
  getBuildingLevelStats,
  getEffectiveBuildingMaxHp,
  getEffectiveUnitMaxHp
} from '@chien-quoc/shared';
import type { BuildingState } from '../schema/BuildingState.js';
import type { UnitState } from '../schema/UnitState.js';
import type { WorldState } from '../schema/WorldState.js';

/**
 * Phase 25: the Town Center aura and how it is applied to one empire.
 *
 * Kept out of `WorldRoom` so the room keeps owning only orchestration: when the
 * aura refreshes is a room concern, but what the aura does to a building or a
 * unit is a rule that can be read and tested without a room.
 */

/** Server-created travel infrastructure. It never carries the aura. */
const AURA_EXEMPT_BUILDINGS = new Set<string>(['PORTAL']);

/**
 * Highest capital level `ownerId` has in this room, or 0 when it has none.
 *
 * Several capitals collapse to the tallest, matching how an empire's buff is
 * read from the best building rather than the first one found.
 */
export function findTownCenterLevel(state: WorldState, ownerId: string): number {
  let level = 0;
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId === ownerId && building.type === 'TOWN_CENTER') {
      level = Math.max(level, building.level);
    }
  });
  return level;
}

/**
 * `maxHp` of an owned building including the capital aura.
 *
 * Exempt types stay at their blueprint HP on every path (restore, refresh,
 * placement) so a portal cannot end up with a hidden buff.
 */
export function ownedBuildingMaxHp(
  type: string,
  level: number,
  townCenterLevel: number
): number {
  if (AURA_EXEMPT_BUILDINGS.has(type)) {
    return getBuildingLevelStats(type as BuildingType, level).maxHp;
  }
  return getEffectiveBuildingMaxHp(type as BuildingType, level, townCenterLevel);
}

/**
 * Recomputes `maxHp` for every building and unit `ownerId` owns.
 *
 * The amount of HP already missing is preserved, so a buff is not a free heal
 * and a formula change cannot erase damage. Callers decide when this runs;
 * a per-tick scan of the whole state would be wasted work because a capital
 * level changes a handful of times per game.
 */
export function applyTownCenterAura(
  state: WorldState,
  ownerId: string,
  townCenterLevel: number
): void {
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId) return;
    const nextMaxHp = ownedBuildingMaxHp(
      building.type,
      building.level,
      townCenterLevel
    );
    if (nextMaxHp === building.maxHp) return;

    const missingHp = Math.max(0, building.maxHp - building.hp);
    building.maxHp = nextMaxHp;
    building.hp = Math.max(0, nextMaxHp - missingHp);
  });

  state.units.forEach((unit: UnitState) => {
    if (unit.ownerId !== ownerId) return;
    const nextMaxHp = getEffectiveUnitMaxHp(
      unit.type as UnitType,
      unit.level,
      townCenterLevel
    );
    if (nextMaxHp === unit.maxHp) return;

    const missingHp = Math.max(0, unit.maxHp - unit.hp);
    unit.maxHp = nextMaxHp;
    unit.hp = Math.max(0, nextMaxHp - missingHp);
  });
}

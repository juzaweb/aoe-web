import {
  BuildingType,
  UnitType,
  dropOffGatherMultiplier,
  dropOffRangeFor,
  getGatherBuildingType,
  getUnitTrainerBuilding
} from '@chien-quoc/shared';
import type { BuildingState } from '../schema/BuildingState.js';
import type { WorldState } from '../schema/WorldState.js';

/**
 * Phase 26: numeric effects of a building's own level.
 *
 * Kept out of `WorldRoom` for the same reason as the Town Center aura: when a
 * cache refreshes is a room concern, but what a trainer or camp level does is a
 * rule that can be read and tested without a room.
 */

/** Highest finished level per building type for one owner. */
export type OwnerBuildingLevels = Partial<Record<BuildingType, number>>;

/**
 * Highest finished level of one type in this room, or 0 when the owner has none.
 *
 * Foundations are ignored: a building that is still being raised must not grant
 * trainer or drop-off effects before it is done.
 */
export function findBuildingLevel(
  state: WorldState,
  ownerId: string,
  type: BuildingType
): number {
  let level = 0;
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId || building.type !== type || !building.isConstructed) return;
    level = Math.max(level, building.level);
  });
  return level;
}

/** Snapshot of every finished type's highest level for one owner. */
export function findOwnerBuildingLevels(
  state: WorldState,
  ownerId: string
): OwnerBuildingLevels {
  const levels: OwnerBuildingLevels = {};
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId || !building.isConstructed) return;
    const type = building.type as BuildingType;
    levels[type] = Math.max(levels[type] ?? 0, building.level);
  });
  return levels;
}

/**
 * Level of the building that trains `unitType`, with a level-1 fallback.
 *
 * Villagers map to the Town Center, whose level is ignored by the trainer
 * multiplier; the lookup stays type-driven so no caller needs to special-case.
 */
export function trainerLevelFor(levels: OwnerBuildingLevels, unitType: UnitType): number {
  const trainer = getUnitTrainerBuilding(unitType);
  return trainer ? Math.max(1, levels[trainer] ?? 1) : 1;
}

/** Gather multiplier a camp level grants for `resourceType`. */
export function gatherMultiplierFor(
  levels: OwnerBuildingLevels,
  resourceType: string
): number {
  const camp = getGatherBuildingType(resourceType);
  return camp ? dropOffGatherMultiplier(levels[camp] ?? 1) : 1;
}

/** Unload ring of one building, in tiles. */
export function dropOffRangeOf(building: BuildingState): number {
  return dropOffRangeFor(building.type as BuildingType, building.level);
}

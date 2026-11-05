import { BUILDING_BLUEPRINTS, BuildingType, ResourceType, getBuildingLevelStats } from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';

/**
 * ECO-01: the resource a building yields when a villager works it, or `''` when
 * it yields none.
 *
 * One definition shared by the gather tick, the retarget scan and the code that
 * fills a finished building, so "which buildings hold a harvestable resource" is
 * answered the same way everywhere.
 */
export function gatheredType(building: BuildingState): ResourceType | '' {
  return BUILDING_BLUEPRINTS[building.type as BuildingType]?.gatheredResource ?? '';
}

/**
 * ECO-01: how much a gatherable building holds at its current level, or `0`
 * when the type holds nothing. Level-aware, so an upgraded farm is a bigger
 * field rather than the same 250 units forever.
 */
export function gatheredCapacity(building: BuildingState): number {
  if (!gatheredType(building)) return 0;
  return getBuildingLevelStats(building.type as BuildingType, building.level).gatherCapacity;
}

/**
 * ECO-01: fills a gatherable building to its capacity.
 *
 * Called when a building finishes and when the world is restored: neither a
 * foundation nor a row read back from SQLite carries an amount, and a field that
 * came back empty would be permanently barren. Half-used fields refilling on
 * restart is the accepted cost of not migrating the table (see `99-backlog.md`).
 */
export function seedGatheredBuilding(building: BuildingState): void {
  const capacity = gatheredCapacity(building);
  if (!capacity) return;

  building.resourceAmount = capacity;
  building.resourceCapacity = capacity;
}

/**
 * ECO-01: grows a field by one upgrade's worth of capacity.
 *
 * The delta is added to what is left instead of refilling the building, so an
 * upgrade is not a free harvest — the same rule as HP on a damaged tower. A
 * fallow field stays fallow: it still has to be re-sown for its cost, otherwise
 * a level-up would be a free crop.
 */
export function growGatheredCapacity(
  building: BuildingState,
  previousLevel: number,
  nextLevel: number
): void {
  if (!gatheredType(building)) return;

  const before = getBuildingLevelStats(
    building.type as BuildingType,
    previousLevel
  ).gatherCapacity;
  const after = getBuildingLevelStats(building.type as BuildingType, nextLevel).gatherCapacity;
  building.resourceCapacity = after;
  if (building.resourceAmount <= 0) {
    building.resourceAmount = 0;
    return;
  }
  building.resourceAmount = Math.min(after, building.resourceAmount + (after - before));
}

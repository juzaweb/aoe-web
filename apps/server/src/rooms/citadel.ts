import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  CitadelSlot,
  citadelLayoutFor,
  citadelTownCenterFor,
  getBuildingLevelStats,
  zoneKindOf
} from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { WorldState } from '../schema/WorldState.js';
import { entityIds } from '../services/EntityIdAllocator.js';
import { findOwnTownCenter } from './portals.js';

/**
 * Server-side citadel lifecycle.
 *
 * The geometry and scoring rules live in `@chien-quoc/shared`; this module is
 * only the part that mutates room state: spawn the compound's buildings, add
 * the ones an older save is missing, restore them after a raid, and answer
 * "is this tile a citadel wall?" for the movement and placement rules.
 */

/** True for the private kingdom map, the only place a citadel exists. */
export function hasCitadel(state: WorldState): boolean {
  return zoneKindOf(state.zoneId) === 'kingdom';
}

function createCitadelBuilding(
  ownerId: string,
  type: BuildingType,
  gridX: number,
  gridY: number
): BuildingState {
  const blueprint = BUILDING_BLUEPRINTS[type];
  const stats = getBuildingLevelStats(type, 1);

  const building = new BuildingState();
  building.id = `b_${entityIds.nextId()}`;
  building.ownerId = ownerId;
  building.type = type;
  building.gridX = gridX;
  building.gridY = gridY;
  building.sizeX = blueprint.sizeX;
  building.sizeY = blueprint.sizeY;
  building.maxHp = stats.maxHp;
  building.hp = stats.maxHp;
  building.level = 1;
  building.isConstructed = true;
  building.constructionProgress = 100;
  return building;
}

/** True when any building footprint covers any tile of `slot`. */
function slotOccupied(state: WorldState, slot: CitadelSlot): BuildingState | null {
  let found: BuildingState | null = null;
  state.buildings.forEach((building: BuildingState) => {
    if (found) return;
    const overlapX =
      building.gridX < slot.gridX + slot.sizeX &&
      building.gridX + building.sizeX > slot.gridX;
    const overlapY =
      building.gridY < slot.gridY + slot.sizeY &&
      building.gridY + building.sizeY > slot.gridY;
    if (overlapX && overlapY) found = building;
  });
  return found;
}

/**
 * Adds every non-Town-Center building the citadel should have but does not.
 *
 * Idempotent: a slot already covered by a building is left alone, so this is
 * safe to run on every join. That is what retrofits the compound onto kingdoms
 * saved before the citadel existed.
 */
export function spawnMissingCitadelBuildings(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): number {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  let added = 0;

  for (const slot of layout.slots) {
    if (slot.type === 'TOWN_CENTER') continue;
    if (slotOccupied(state, slot)) continue;

    const building = createCitadelBuilding(ownerId, slot.type, slot.gridX, slot.gridY);
    state.buildings.set(building.id, building);
    added++;
  }

  return added;
}

/**
 * Removes generated resource nodes buried under the walled compound.
 *
 * Runs before the starter trees are placed and again when an old snapshot is
 * upgraded, so a forest cannot grow through the stone floor or a wall.
 */
export function clearCitadelResources(state: WorldState, townCenter: BuildingState): void {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  const buried: string[] = [];

  state.resourceNodes.forEach((node: ResourceNodeState, id: string) => {
    if (
      node.gridX >= layout.originX &&
      node.gridX < layout.originX + layout.size &&
      node.gridY >= layout.originY &&
      node.gridY < layout.originY + layout.size
    ) {
      buried.push(id);
    }
  });

  for (const id of buried) state.resourceNodes.delete(id);
}

/** True when a building footprint overlaps a square of `size` tiles at (x, y). */
function footprintOverlaps(
  building: BuildingState,
  x: number,
  y: number,
  size: number
): boolean {
  return (
    building.gridX < x + size &&
    building.gridX + building.sizeX > x &&
    building.gridY < y + size &&
    building.gridY + building.sizeY > y
  );
}

/** A square of tiles that once held a citadel compound. */
interface CompoundRect {
  x: number;
  y: number;
  size: number;
}

function insideCompound(building: BuildingState, rect: CompoundRect): boolean {
  return footprintOverlaps(building, rect.x, rect.y, rect.size);
}

/**
 * Open floor tiles of the central walkway, east of the Town Center.
 *
 * Used to place starter crews and to rescue units that a legacy save left on a
 * tile that the moved citadel now uses as a wall.
 */
function walkwaySpots(
  layout: ReturnType<typeof citadelLayoutFor>
): Array<{ x: number; y: number }> {
  const spots: Array<{ x: number; y: number }> = [];
  for (let y = layout.originY + 5; y <= layout.originY + 11; y++) {
    for (let x = layout.originX + 5; x <= layout.originX + 14; x++) {
      spots.push({ x, y });
    }
  }
  return spots;
}

/** Whether the citadel already sits at its canonical centre position. */
function isCitadelCanonical(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): boolean {
  const target = citadelTownCenterFor(state.mapWidth, state.mapHeight);
  if (
    Math.round(townCenter.gridX) !== target.gridX ||
    Math.round(townCenter.gridY) !== target.gridY
  ) {
    return false;
  }

  const layout = citadelLayoutFor(target.gridX, target.gridY);
  for (const slot of layout.slots) {
    if (slot.type === 'TOWN_CENTER') continue;
    let found = false;
    state.buildings.forEach((building: BuildingState) => {
      if (found || building.ownerId !== ownerId) return;
      if (building.type !== slot.type) return;
      if (Math.round(building.gridX) !== slot.gridX) return;
      if (Math.round(building.gridY) !== slot.gridY) return;
      found = true;
    });
    if (!found) return false;
  }
  return true;
}

/** Sorts by strength, moves the first N into the slots and drops the rest. */
function assignCitadelBuildings(
  state: WorldState,
  list: BuildingState[],
  slots: CitadelSlot[]
): void {
  list.sort(
    (a, b) => b.level - a.level || b.maxHp - a.maxHp || a.id.localeCompare(b.id)
  );

  slots.forEach((slot, index) => {
    const building = list[index];
    if (!building) return;
    building.gridX = slot.gridX;
    building.gridY = slot.gridY;
  });

  for (let index = slots.length; index < list.length; index++) {
    state.buildings.delete(list[index].id);
  }
}

/**
 * Rebuilds a non-canonical citadel at the centre of the map.
 *
 * Layouts changed during development, so a save can hold orphaned barracks and
 * houses from an older compound (including the short-lived right-edge variant).
 * Every barracks and house inside a historical compound is gathered, the
 * strongest two/five are placed in the new slots and the surplus is removed.
 * Buildings outside those compounds — including anything the player built — are
 * never touched.
 */
function canonicalizeCitadel(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): BuildingState {
  const target = citadelTownCenterFor(state.mapWidth, state.mapHeight);
  const targetLayout = citadelLayoutFor(target.gridX, target.gridY);
  const currentLayout = citadelLayoutFor(
    Math.round(townCenter.gridX),
    Math.round(townCenter.gridY)
  );

  // Never bury a non-citadel structure that happens to sit on the destination.
  let blocked = false;
  state.buildings.forEach((building: BuildingState) => {
    if (blocked || building.ownerId !== ownerId) return;
    if (
      building.type === 'TOWN_CENTER' ||
      building.type === 'BARRACKS' ||
      building.type === 'HOUSE'
    ) {
      return;
    }
    if (footprintOverlaps(building, targetLayout.originX, targetLayout.originY, targetLayout.size)) {
      blocked = true;
    }
  });
  if (blocked) return townCenter;

  const rects: CompoundRect[] = [
    { x: targetLayout.originX, y: targetLayout.originY, size: targetLayout.size },
    { x: currentLayout.originX, y: currentLayout.originY, size: currentLayout.size },
    {
      // The short-lived right-edge layout this feature briefly shipped with.
      x: state.mapWidth - 6 - targetLayout.size,
      y: Math.floor((state.mapHeight - targetLayout.size) / 2),
      size: targetLayout.size
    }
  ];

  townCenter.gridX = target.gridX;
  townCenter.gridY = target.gridY;

  const barracks: BuildingState[] = [];
  const houses: BuildingState[] = [];
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId) return;
    if (building.type !== 'BARRACKS' && building.type !== 'HOUSE') return;
    if (!rects.some((rect) => insideCompound(building, rect))) return;
    (building.type === 'BARRACKS' ? barracks : houses).push(building);
  });

  assignCitadelBuildings(
    state,
    barracks,
    targetLayout.slots.filter((slot) => slot.type === 'BARRACKS')
  );
  assignCitadelBuildings(
    state,
    houses,
    targetLayout.slots.filter((slot) => slot.type === 'HOUSE')
  );

  // Units standing in any historical compound move into the new walkway.
  const spots = walkwaySpots(targetLayout);
  let spotIndex = 0;
  state.units.forEach((unit) => {
    if (unit.ownerId !== ownerId) return;
    const insideAny = rects.some(
      (rect) =>
        unit.x >= rect.x &&
        unit.x < rect.x + rect.size &&
        unit.y >= rect.y &&
        unit.y < rect.y + rect.size
    );
    if (!insideAny) return;

    const spot = spots[spotIndex % spots.length];
    spotIndex++;
    unit.x = spot.x + 0.5;
    unit.y = spot.y + 0.5;
    unit.targetX = unit.x;
    unit.targetY = unit.y;
  });

  console.log(`🏰 [Citadel] Rebuilt ${ownerId}'s citadel at the map centre.`);
  return townCenter;
}

/** Pulls any owned unit off a citadel wall tile into the open walkway. */
function rescueUnitsFromWalls(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): void {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  const wallKeys = new Set(layout.walls.map((tile) => `${tile.gridX},${tile.gridY}`));
  const spots = walkwaySpots(layout);
  let spotIndex = 0;

  state.units.forEach((unit) => {
    if (unit.ownerId !== ownerId) return;
    const key = `${Math.floor(unit.x)},${Math.floor(unit.y)}`;
    if (!wallKeys.has(key)) return;

    const spot = spots[spotIndex % spots.length];
    spotIndex++;
    unit.x = spot.x + 0.5;
    unit.y = spot.y + 0.5;
    unit.targetX = unit.x;
    unit.targetY = unit.y;
  });
}

/** Retrofits the citadel onto a kingdom restored from an older save. */
export function ensureCitadel(state: WorldState, ownerId: string): void {
  if (!hasCitadel(state)) return;

  const townCenter = findOwnTownCenter(state, ownerId);
  if (!townCenter) return;

  if (!isCitadelCanonical(state, ownerId, townCenter)) {
    canonicalizeCitadel(state, ownerId, townCenter);
  }

  rescueUnitsFromWalls(state, ownerId, townCenter);
  clearCitadelResources(state, townCenter);
  const added = spawnMissingCitadelBuildings(state, ownerId, townCenter);
  if (added > 0) {
    console.log(`🏰 [Citadel] Restored ${added} missing building(s) for ${ownerId}.`);
  }
}

/**
 * Brings every citadel building back to full strength after a raid.
 *
 * The citadel is a score, not a ruin: without this a single raid could leave a
 * player permanently short of houses and barracks. A slot destroyed during the
 * fight is rebuilt at level 1, matching how the Town Center already came back.
 */
export function restoreCitadel(state: WorldState, ownerId: string): void {
  if (!hasCitadel(state)) return;

  const townCenter = findOwnTownCenter(state, ownerId);
  if (!townCenter) return;

  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);

  for (const slot of layout.slots) {
    const building = slotOccupied(state, slot);
    if (building && building.ownerId === ownerId && building.type === slot.type) {
      building.hp = building.maxHp;
      building.isConstructed = true;
      building.constructionProgress = 100;
      continue;
    }
    if (building) continue; // Something else owns that tile; never overwrite it.

    const rebuilt = createCitadelBuilding(ownerId, slot.type, slot.gridX, slot.gridY);
    state.buildings.set(rebuilt.id, rebuilt);
  }
}

/**
 * Every citadel wall tile on this map, as `x,y` keys.
 *
 * Empty on a battlefield: walls are derived from the Town Center positions the
 * server already replicates, so no extra state is needed.
 */
export function citadelWallTileSet(state: WorldState): Set<string> {
  const tiles = new Set<string>();
  if (!hasCitadel(state)) return tiles;

  state.buildings.forEach((building: BuildingState) => {
    if (building.type !== 'TOWN_CENTER') return;
    for (const wall of citadelLayoutFor(building.gridX, building.gridY).walls) {
      tiles.add(`${wall.gridX},${wall.gridY}`);
    }
  });

  return tiles;
}

/** Whether a building footprint would cover any citadel wall tile. */
export function footprintTouchesCitadelWall(
  state: WorldState,
  gridX: number,
  gridY: number,
  sizeX: number,
  sizeY: number
): boolean {
  if (!hasCitadel(state)) return false;

  const walls = citadelWallTileSet(state);
  if (walls.size === 0) return false;

  for (let y = gridY; y < gridY + sizeY; y++) {
    for (let x = gridX; x < gridX + sizeX; x++) {
      if (walls.has(`${x},${y}`)) return true;
    }
  }
  return false;
}

/**
 * Whether `building` is one of its owner's citadel slots.
 *
 * Used by combat to stop a raid from deleting a house or barracks outright: the
 * citadel is a score, and a destroyed slot would be rebuilt at level 1, wiping
 * an upgrade the defender paid for.
 */
export function isCitadelBuilding(state: WorldState, building: BuildingState): boolean {
  if (!hasCitadel(state)) return false;

  const townCenter = findOwnTownCenter(state, building.ownerId);
  if (!townCenter) return false;

  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  return layout.slots.some(
    (slot) =>
      slot.type === building.type &&
      slot.gridX === Math.round(building.gridX) &&
      slot.gridY === Math.round(building.gridY)
  );
}

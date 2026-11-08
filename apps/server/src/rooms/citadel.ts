import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  CITADEL_SIZE,
  CitadelSlot,
  citadelLayoutFor,
  citadelStatus,
  citadelWallTopTileKeys,
  citadelTownCenterFor,
  getBuildingLevelStats,
  isCitadelAvenueTile,
  isCitadelInteriorTile,
  isCitadelWallTopTile,
  roadTileKey,
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

/**
 * Whether `building` is the virtual `CITADEL` compound box rather than a solid
 * structure.
 *
 * The box is only an aggregate for health and hit-testing: its four walls are
 * stamped as terrain and its eight interior slots are real buildings in their
 * own right. Anything that treats a building footprint as an obstacle (unit
 * movement, building placement) must skip it, otherwise the box reads as a
 * solid 26x26 block that seals the courtyard and its gate.
 */
export function isVirtualCitadelCompound(building: BuildingState): boolean {
  return building.type === 'CITADEL';
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
 * Removes generated resource nodes buried under the walled compound and on the
 * approach avenue in front of the east gate.
 *
 * Runs on every join, so a legacy snapshot or a regrown node cannot sit on the
 * stone floor, a wall, or the corridor leading out to the travel portal.
 */
export function clearCitadelResources(state: WorldState, townCenter: BuildingState): void {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  const buried: string[] = [];

  state.resourceNodes.forEach((node: ResourceNodeState, id: string) => {
    const underCompound =
      node.gridX >= layout.originX &&
      node.gridX < layout.originX + layout.sizeX &&
      node.gridY >= layout.originY &&
      node.gridY < layout.originY + layout.sizeY;

    if (underCompound || isCitadelAvenueTile(node.gridX, node.gridY, layout, state.mapWidth)) {
      buried.push(id);
    }
  });

  for (const id of buried) state.resourceNodes.delete(id);
}

/** True when a building footprint overlaps a `sizeX x sizeY` rect at (x, y). */
function footprintOverlaps(
  building: BuildingState,
  x: number,
  y: number,
  sizeX: number,
  sizeY: number
): boolean {
  return (
    building.gridX < x + sizeX &&
    building.gridX + building.sizeX > x &&
    building.gridY < y + sizeY &&
    building.gridY + building.sizeY > y
  );
}

/** A rectangle of tiles that once held, or now holds, a citadel compound. */
interface CompoundRect {
  x: number;
  y: number;
  sizeX: number;
  sizeY: number;
}

function insideCompound(building: BuildingState, rect: CompoundRect): boolean {
  return footprintOverlaps(building, rect.x, rect.y, rect.sizeX, rect.sizeY);
}

/**
 * Tiles a structure may never cover: the wall ring plus both stair flights.
 *
 * They are grouped because placement and migration only need "is this tile
 * reserved?", not which of the two it is.
 */
function citadelReservedTileKeys(
  layout: ReturnType<typeof citadelLayoutFor>
): Set<string> {
  const keys = new Set(layout.walls.map((tile) => `${tile.gridX},${tile.gridY}`));
  for (const stair of layout.stairs) {
    keys.add(`${stair.bottom.gridX},${stair.bottom.gridY}`);
    keys.add(`${stair.top.gridX},${stair.top.gridY}`);
  }
  return keys;
}

/** Removes player-painted road tiles from the stair flights. */
function clearStairRoads(state: WorldState, townCenter: BuildingState): void {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  for (const stair of layout.stairs) {
    for (const tile of [stair.bottom, stair.top]) {
      state.roads.delete(roadTileKey(tile.gridX, tile.gridY));
    }
  }
}

/**
 * Whether a footprint, optionally widened by `margin` tiles, covers any tile in
 * `wallKeys`.
 *
 * `margin: 1` is the clearance the generated house column uses: artwork is
 * wider than the footprint, so merely "not covering" a wall still lets a roof
 * reach the crest.
 */
function footprintCoversWalls(
  wallKeys: ReadonlySet<string>,
  gridX: number,
  gridY: number,
  sizeX: number,
  sizeY: number,
  margin = 0
): boolean {
  for (let y = gridY - margin; y < gridY + sizeY + margin; y++) {
    for (let x = gridX - margin; x < gridX + sizeX + margin; x++) {
      if (wallKeys.has(`${x},${y}`)) return true;
    }
  }
  return false;
}

/**
 * Whether `building` may stand at `(x, y)`: inside the map, clear of the wall
 * ring by `margin` tiles, clear of every other building (the virtual `CITADEL`
 * compound is not an obstacle), of resource nodes and of player-painted roads.
 */
function canBuildingOccupy(
  state: WorldState,
  building: BuildingState,
  x: number,
  y: number,
  wallKeys: ReadonlySet<string>,
  margin: number
): boolean {
  if (x < 0 || y < 0) return false;
  if (x + building.sizeX > state.mapWidth || y + building.sizeY > state.mapHeight) {
    return false;
  }
  if (footprintCoversWalls(wallKeys, x, y, building.sizeX, building.sizeY, margin)) {
    return false;
  }

  let blocked = false;
  state.buildings.forEach((other: BuildingState) => {
    if (blocked || other === building || isVirtualCitadelCompound(other)) return;
    if (footprintOverlaps(other, x, y, building.sizeX, building.sizeY)) blocked = true;
  });
  if (blocked) return false;

  state.resourceNodes.forEach((node: ResourceNodeState) => {
    if (blocked) return;
    if (
      node.gridX >= x &&
      node.gridX < x + building.sizeX &&
      node.gridY >= y &&
      node.gridY < y + building.sizeY
    ) {
      blocked = true;
    }
  });
  if (blocked) return false;

  for (let roadY = y; roadY < y + building.sizeY; roadY++) {
    for (let roadX = x; roadX < x + building.sizeX; roadX++) {
      if (state.roads.has(roadTileKey(roadX, roadY))) return false;
    }
  }
  return true;
}

/**
 * Open floor tiles of the central walkway, east of the Town Center.
 *
 * Used to place starter crews and to rescue units that a legacy save left on a
 * tile that the moved citadel now uses as a wall. The band follows the Town
 * Center's own rows so a spot can never land inside its footprint.
 */
function walkwaySpots(
  layout: ReturnType<typeof citadelLayoutFor>
): Array<{ x: number; y: number }> {
  const townCenter = layout.slots.find((slot) => slot.type === 'TOWN_CENTER');
  const startX = townCenter ? townCenter.gridX + townCenter.sizeX : layout.innerMinX;
  const startY = townCenter ? townCenter.gridY : layout.innerMinY + 4;
  const endY = townCenter ? townCenter.gridY + townCenter.sizeY - 1 : layout.innerMinY + 10;

  const spots: Array<{ x: number; y: number }> = [];
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= layout.innerMaxX; x++) {
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

  // If the Town Center is centered, check if there are legacy compounds (e.g. right edge)
  // holding orphan buildings that need to be cleaned up. Vacant slots from deliberately
  // deleted buildings are allowed and must not trigger canonicalization reshuffle.
  const rightEdgeOriginX = 110 - 6 - CITADEL_SIZE;
  const rightEdgeOriginY = Math.floor((110 - CITADEL_SIZE) / 2);
  let hasRightEdgeOrphans = false;
  state.buildings.forEach((building: BuildingState) => {
    if (hasRightEdgeOrphans || building.ownerId !== ownerId) return;
    if (building.type === 'BARRACKS' || building.type === 'HOUSE') {
      if (
        building.gridX >= rightEdgeOriginX &&
        building.gridX < rightEdgeOriginX + CITADEL_SIZE &&
        building.gridY >= rightEdgeOriginY &&
        building.gridY < rightEdgeOriginY + CITADEL_SIZE
      ) {
        hasRightEdgeOrphans = true;
      }
    }
  });

  return !hasRightEdgeOrphans;
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
    if (building.type !== slot.type) {
      // The compound used to field two barracks, so a legacy save holds a
      // barracks where the archery range now stands. Retag it in place: both
      // trainers share a footprint and the same health curve, so only the name
      // and the unit it trains change.
      const blueprint = BUILDING_BLUEPRINTS[slot.type];
      building.type = slot.type;
      building.sizeX = blueprint.sizeX;
      building.sizeY = blueprint.sizeY;
    }
  });

  for (let index = slots.length; index < list.length; index++) {
    state.buildings.delete(list[index].id);
  }
}

/**
 * Rebuilds a non-canonical citadel at the centre of the map.
 *
 * Layouts changed during development, so a save can hold orphaned military
 * buildings and houses from an older compound (including the short-lived
 * right-edge variant). Every barracks, archery range and house inside a
 * historical compound is gathered, the strongest two trainers and five houses
 * are placed in the new slots and the surplus is removed. Buildings outside
 * those compounds — including anything the player built — are never touched.
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
      building.type === 'ARCHERY_RANGE' ||
      building.type === 'HOUSE'
    ) {
      return;
    }
    if (
      footprintOverlaps(
        building,
        targetLayout.originX,
        targetLayout.originY,
        targetLayout.sizeX,
        targetLayout.sizeY
      )
    ) {
      blocked = true;
    }
  });
  if (blocked) return townCenter;

  const rects: CompoundRect[] = [
    {
      x: targetLayout.originX,
      y: targetLayout.originY,
      sizeX: targetLayout.sizeX,
      sizeY: targetLayout.sizeY
    },
    {
      x: currentLayout.originX,
      y: currentLayout.originY,
      sizeX: currentLayout.sizeX,
      sizeY: currentLayout.sizeY
    },
    {
      // The short-lived right-edge layout this feature briefly shipped with,
      // which was a square of `CITADEL_SIZE` tiles.
      x: state.mapWidth - 6 - CITADEL_SIZE,
      y: Math.floor((state.mapHeight - CITADEL_SIZE) / 2),
      sizeX: CITADEL_SIZE,
      sizeY: CITADEL_SIZE
    }
  ];

  townCenter.gridX = target.gridX;
  townCenter.gridY = target.gridY;

  const military: BuildingState[] = [];
  const houses: BuildingState[] = [];
  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId) return;
    if (
      building.type !== 'BARRACKS' &&
      building.type !== 'ARCHERY_RANGE' &&
      building.type !== 'HOUSE'
    ) {
      return;
    }
    if (!rects.some((rect) => insideCompound(building, rect))) return;
    (building.type === 'HOUSE' ? houses : military).push(building);
  });

  assignCitadelBuildings(
    state,
    military,
    targetLayout.slots.filter(
      (slot) => slot.type === 'BARRACKS' || slot.type === 'ARCHERY_RANGE'
    )
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
        unit.x < rect.x + rect.sizeX &&
        unit.y >= rect.y &&
        unit.y < rect.y + rect.sizeY
    );
    if (!insideAny) return;

    const spot = spots[spotIndex % spots.length];
    spotIndex++;
    unit.onWall = false;
    unit.x = spot.x + 0.5;
    unit.y = spot.y + 0.5;
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.pathX.clear();
    unit.pathY.clear();
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
  const wallKeys = new Set(
    [...layout.walls, ...layout.gates].map((tile) => `${tile.gridX},${tile.gridY}`)
  );
  const spots = walkwaySpots(layout);
  let spotIndex = 0;

  state.units.forEach((unit) => {
    if (unit.ownerId !== ownerId) return;
    const key = `${Math.floor(unit.x)},${Math.floor(unit.y)}`;
    const onCurrentWall = wallKeys.has(key);
    // A unit that legitimately climbed the wall keeps its post. Anything else
    // that ended up on a wall tile (a legacy save, or a stale `onWall` after the
    // citadel moved) is pulled back into the courtyard.
    if (onCurrentWall && unit.onWall) return;
    if (!onCurrentWall && !unit.onWall) return;

    unit.onWall = false;
    const spot = spots[spotIndex % spots.length];
    spotIndex++;
    unit.x = spot.x + 0.5;
    unit.y = spot.y + 0.5;
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.pathX.clear();
    unit.pathY.clear();
  });
}

/**
 * Steps citadel houses off the west wall on saves written before the setback.
 *
 * A house's artwork is wider than its 2x2 footprint, so the old flush-against-
 * the-wall column drew its roof over the wall crest. Only houses sitting on one
 * of the exact old slot coordinates move; a player's own house elsewhere inside
 * the compound is never touched. If the new slot is occupied (a player built
 * there), the house stays put rather than overlap it.
 */
function migrateHouseSetback(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): number {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  const wallKeys = citadelReservedTileKeys(layout);
  const oldGridX = layout.originX + 1;
  const houseSlots = layout.slots.filter((slot) => slot.type === 'HOUSE');
  let moved = 0;

  state.buildings.forEach((building: BuildingState) => {
    if (building.ownerId !== ownerId || building.type !== 'HOUSE') return;
    if (Math.round(building.gridX) !== oldGridX) return;

    const slot = houseSlots.find(
      (candidate) => candidate.gridY === Math.round(building.gridY)
    );
    if (!slot) return;
    if (!canBuildingOccupy(state, building, slot.gridX, slot.gridY, wallKeys, 0)) return;

    building.gridX = slot.gridX;
    building.gridY = slot.gridY;
    moved++;
  });

  return moved;
}

/**
 * Moves any legacy building whose footprint sits on a citadel wall off it.
 *
 * Placement already rejects a footprint that covers a wall tile, but a save
 * written before that rule (or before the compound moved) can still hold one:
 * the sprite then straddles the crest and reads as if it were built on top of
 * the wall. The building keeps its id, level and hp; only its tiles change, and
 * only to the nearest free spot that clears every wall and every other
 * building. A building with no free spot nearby is left where it is.
 */
function resolveBuildingsOnWalls(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): number {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  const wallKeys = citadelReservedTileKeys(layout);
  const centreX = layout.originX + layout.sizeX / 2;
  const centreY = layout.originY + layout.sizeY / 2;

  const offenders = Array.from(state.buildings.values()).filter(
    (building) =>
      building.ownerId === ownerId &&
      building.type !== 'CITADEL' &&
      footprintCoversWalls(
        wallKeys,
        Math.round(building.gridX),
        Math.round(building.gridY),
        building.sizeX,
        building.sizeY
      )
  );

  /**
   * Nearest free spot, ring by ring. Candidates are ordered towards the
   * courtyard centre so a wall-side building steps inwards rather than out.
   */
  const findSpot = (
    building: BuildingState,
    startX: number,
    startY: number,
    margin: number
  ): { x: number; y: number } | null => {
    for (let radius = 1; radius <= 8; radius++) {
      const candidates: Array<{ x: number; y: number }> = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          candidates.push({ x: startX + dx, y: startY + dy });
        }
      }
      candidates.sort(
        (a, b) =>
          Math.hypot(a.x + building.sizeX / 2 - centreX, a.y + building.sizeY / 2 - centreY) -
          Math.hypot(b.x + building.sizeX / 2 - centreX, b.y + building.sizeY / 2 - centreY)
      );
      const spot = candidates.find((candidate) =>
        canBuildingOccupy(state, building, candidate.x, candidate.y, wallKeys, margin)
      );
      if (spot) return spot;
    }
    return null;
  };

  let moved = 0;
  for (const building of offenders) {
    // Prefer the same one-tile clearance the generated column uses, and fall
    // back to merely clearing the wall if the courtyard is too cramped.
    const target =
      findSpot(building, Math.round(building.gridX), Math.round(building.gridY), 1) ??
      findSpot(building, Math.round(building.gridX), Math.round(building.gridY), 0);

    if (!target) continue;
    building.gridX = target.x;
    building.gridY = target.y;
    moved++;
    console.log(`🏰 [Citadel] Moved ${building.type} off the citadel wall for ${ownerId}.`);
  }

  return moved;
}

/** Retrofits the citadel onto a kingdom restored from an older save. */
export function ensureCitadel(state: WorldState, ownerId: string): void {
  if (!hasCitadel(state)) return;

  const townCenter = findOwnTownCenter(state, ownerId);
  if (!townCenter) return;

  if (!isCitadelCanonical(state, ownerId, townCenter)) {
    canonicalizeCitadel(state, ownerId, townCenter);
  }

  // Clear buried nodes first: the migrations below look for a free tile, and a
  // node that is about to be removed must not block it.
  clearCitadelResources(state, townCenter);
  clearStairRoads(state, townCenter);
  migrateHouseSetback(state, ownerId, townCenter);
  resolveBuildingsOnWalls(state, ownerId, townCenter);
  rescueUnitsFromWalls(state, ownerId, townCenter);
  // The gate is sealed to non-owners, so a raider left inside by an older save
  // (or by a raid that started before this rule) is moved back outside.
  evictForeignUnitsFromCitadel(state);

  // Retrofit missing compound buildings only if the empire was saved before
  // citadels existed (Town-Center-only save). Existing empires that deleted a
  // citadel building must not have it resurrected on every join.
  let nonTownCenterCount = 0;
  state.buildings.forEach((b: BuildingState) => {
    if (b.ownerId === ownerId && b.type !== 'TOWN_CENTER') nonTownCenterCount++;
  });
  if (nonTownCenterCount === 0) {
    const added = spawnMissingCitadelBuildings(state, ownerId, townCenter);
    if (added > 0) {
      console.log(`🏰 [Citadel] Restored ${added} missing building(s) for ${ownerId}.`);
    }
  }

  ensureCitadelEntity(state, ownerId, townCenter);
}

/**
 * Ensures every citadel slot exists after a raid without wiping battle damage.
 *
 * Buildings do not disappear when losing 100% HP, and their damage persists so
 * villagers can repair them or they passively regenerate over 72 hours.
 */
export function restoreCitadel(state: WorldState, ownerId: string): void {
  if (!hasCitadel(state)) return;

  const townCenter = findOwnTownCenter(state, ownerId);
  if (!townCenter) return;

  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);

  for (const slot of layout.slots) {
    const building = slotOccupied(state, slot);
    if (building && building.ownerId === ownerId && building.type === slot.type) {
      building.isConstructed = true;
      building.constructionProgress = 100;
      continue;
    }
    if (building) continue; // Something else owns that tile; never overwrite it.

    const rebuilt = createCitadelBuilding(ownerId, slot.type, slot.gridX, slot.gridY);
    state.buildings.set(rebuilt.id, rebuilt);
  }

  ensureCitadelEntity(state, ownerId, townCenter);
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

/**
 * Every wall-top and gate-roof tile on this map, as `x,y` keys.
 *
 * Units stand on these tiles when they climb a stair; the gate roof is included
 * so the wall run stays continuous over the gatehouse.
 */
export function citadelWallTopTileSet(state: WorldState): Set<string> {
  const tiles = new Set<string>();
  if (!hasCitadel(state)) return tiles;

  state.buildings.forEach((building: BuildingState) => {
    if (building.type !== 'TOWN_CENTER') return;
    for (const key of citadelWallTopTileKeys(citadelLayoutFor(building.gridX, building.gridY))) {
      tiles.add(key);
    }
  });

  return tiles;
}

/** Every gate tile on this map, as `x,y` keys. */
export function citadelGateTileSet(state: WorldState): Set<string> {
  const tiles = new Set<string>();
  if (!hasCitadel(state)) return tiles;

  state.buildings.forEach((building: BuildingState) => {
    if (building.type !== 'TOWN_CENTER') return;
    for (const gate of citadelLayoutFor(building.gridX, building.gridY).gates) {
      tiles.add(`${gate.gridX},${gate.gridY}`);
    }
  });

  return tiles;
}

/** Every stair tile on this map, as `x,y` keys. */
export function citadelStairTileSet(state: WorldState): Set<string> {
  const tiles = new Set<string>();
  if (!hasCitadel(state)) return tiles;

  state.buildings.forEach((building: BuildingState) => {
    if (building.type !== 'TOWN_CENTER') return;
    const layout = citadelLayoutFor(building.gridX, building.gridY);
    for (const stair of layout.stairs) {
      tiles.add(`${stair.bottom.gridX},${stair.bottom.gridY}`);
      tiles.add(`${stair.top.gridX},${stair.top.gridY}`);
    }
  });

  return tiles;
}

/** Owner of the kingdom's citadel, or null when this map has none. */
export function citadelOwnerIdOf(state: WorldState): string | null {
  if (!hasCitadel(state)) return null;
  let ownerId: string | null = null;
  state.buildings.forEach((building: BuildingState) => {
    if (ownerId || building.type !== 'TOWN_CENTER') return;
    ownerId = building.ownerId;
  });
  return ownerId;
}

/** Whether `(x, y)` lies inside the citadel courtyard (walls excluded). */
export function isInsideCitadelInterior(state: WorldState, x: number, y: number): boolean {
  if (!hasCitadel(state)) return false;
  let inside = false;
  state.buildings.forEach((building: BuildingState) => {
    if (inside || building.type !== 'TOWN_CENTER') return;
    inside = isCitadelInteriorTile(
      citadelLayoutFor(building.gridX, building.gridY),
      Math.floor(x),
      Math.floor(y)
    );
  });
  return inside;
}

/**
 * Whether `(x, y)` is the wall top or gate roof of the citadel owned by
 * `ownerId`. A wall belongs to the compound, not to whichever player asks.
 */
export function isOwnCitadelWallTop(
  state: WorldState,
  ownerId: string,
  x: number,
  y: number
): boolean {
  if (!hasCitadel(state)) return false;
  let owned = false;
  state.buildings.forEach((building: BuildingState) => {
    if (owned || building.type !== 'TOWN_CENTER' || building.ownerId !== ownerId) return;
    owned = isCitadelWallTopTile(citadelLayoutFor(building.gridX, building.gridY), x, y);
  });
  return owned;
}

/**
 * The nearest point outside the east gate, used to push foreign units out of a
 * sealed compound and to redirect a raider order that landed inside.
 *
 * The avenue east of the gate is always open ground, so this never needs a
 * pathfinder.
 */
export function outsideCitadelGatePoint(
  state: WorldState,
  _fromX: number,
  fromY: number
): { x: number; y: number } | null {
  if (!hasCitadel(state)) return null;
  let result: { x: number; y: number } | null = null;
  state.buildings.forEach((building: BuildingState) => {
    if (result || building.type !== 'TOWN_CENTER') return;
    const layout = citadelLayoutFor(building.gridX, building.gridY);
    const gateMiddle = layout.gates[Math.floor(layout.gates.length / 2)] ?? layout.gates[0];
    const gateY = gateMiddle ? gateMiddle.gridY : layout.originY + layout.sizeY / 2;
    const preferredY = Math.max(layout.innerMinY, Math.min(layout.innerMaxY, fromY));
    const y = Math.abs(preferredY - gateY) <= 6 ? preferredY : gateY;
    result = {
      x: Math.min(state.mapWidth - 1, layout.originX + layout.sizeX + 1),
      y: Math.max(0, Math.min(state.mapHeight - 1, y))
    };
  });
  return result;
}

/**
 * Moves every foreign unit out of the citadel into the avenue outside the gate.
 *
 * The gate is sealed to non-owners, so a unit that predates that rule would
 * otherwise be trapped inside a compound it can never leave. Returns how many
 * units were moved.
 */
export function evictForeignUnitsFromCitadel(state: WorldState): number {
  const ownerId = citadelOwnerIdOf(state);
  if (!ownerId) return 0;

  let moved = 0;
  state.units.forEach((unit) => {
    if (unit.ownerId === ownerId) return;
    if (
      !isInsideCitadelInterior(state, unit.x, unit.y) &&
      !isOwnCitadelWallTop(state, ownerId, Math.floor(unit.x), Math.floor(unit.y))
    ) {
      return;
    }

    const point = outsideCitadelGatePoint(state, unit.x, unit.y);
    if (!point) return;
    const offset = moved % 5;
    unit.x = point.x + 0.5;
    unit.y = Math.max(0, Math.min(state.mapHeight - 1, point.y - 2 + offset)) + 0.5;
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.onWall = false;
    unit.pathX.clear();
    unit.pathY.clear();
    unit.queueTargetX.clear();
    unit.queueTargetY.clear();
    unit.targetEntityId = '';
    unit.targetEntityType = '';
    unit.actionState = 'IDLE';
    moved++;
  });
  return moved;
}

/**
 * Whether a building footprint would cover any citadel wall tile.
 *
 * Only the wall tile itself is off-limits; a building may stand on the tile
 * beside it like anywhere else on the map.
 */
export function footprintTouchesCitadelWall(
  state: WorldState,
  gridX: number,
  gridY: number,
  sizeX: number,
  sizeY: number
): boolean {
  if (!hasCitadel(state)) return false;

  const reserved = new Set([...citadelWallTileSet(state), ...citadelStairTileSet(state)]);
  if (reserved.size === 0) return false;

  return footprintCoversWalls(reserved, gridX, gridY, sizeX, sizeY);
}

/**
 * Whether `building` is either the citadel compound entity or one of its interior slots.
 */
export function isCitadelBuilding(state: WorldState, building: BuildingState): boolean {
  if (!hasCitadel(state)) return false;
  if (building.type === 'CITADEL') return true;

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

/**
 * Whether `building` is an interior structure of the citadel (Town Center, Barracks, Archery Range, House).
 * These structures are protected from direct attacks: raids must attack the citadel walls/gate instead.
 */
export function isProtectedCitadelInteriorBuilding(state: WorldState, building: BuildingState): boolean {
  if (!hasCitadel(state)) return false;
  if (building.type === 'CITADEL') return false;
  return isCitadelBuilding(state, building);
}

/**
 * Finds the compound `CITADEL` building entity for `ownerId`, if present.
 */
export function findCitadel(state: WorldState, ownerId: string): BuildingState | null {
  let found: BuildingState | null = null;
  state.buildings.forEach((b: BuildingState) => {
    if (found) return;
    if (b.ownerId === ownerId && b.type === 'CITADEL') {
      found = b;
    }
  });
  return found;
}

/**
 * Ensures the citadel compound building exists in state, with its maxHp tied to the
 * sum of all interior slots.
 */
export function ensureCitadelEntity(
  state: WorldState,
  ownerId: string,
  townCenter: BuildingState
): BuildingState {
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  const status = citadelStatus(Array.from(state.buildings.values()), townCenter.gridX, townCenter.gridY);
  let citadel = findCitadel(state, ownerId);

  if (!citadel) {
    citadel = new BuildingState();
    citadel.id = `b_citadel_${ownerId}`;
    citadel.ownerId = ownerId;
    citadel.type = 'CITADEL';
    citadel.gridX = layout.originX;
    citadel.gridY = layout.originY;
    citadel.sizeX = layout.sizeX;
    citadel.sizeY = layout.sizeY;
    citadel.maxHp = status.maxHp;
    citadel.hp = status.maxHp;
    citadel.level = 1;
    citadel.isConstructed = true;
    citadel.constructionProgress = 100;
    state.buildings.set(citadel.id, citadel);
  } else {
    citadel.maxHp = status.maxHp;
    citadel.gridX = layout.originX;
    citadel.gridY = layout.originY;
    citadel.sizeX = layout.sizeX;
    citadel.sizeY = layout.sizeY;
  }

  return citadel;
}

/**
 * Finds the nearest citadel wall or gate tile coordinate to an entity standing at (fromX, fromY).
 */
export function findNearestCitadelWallOrGate(
  state: WorldState,
  citadel: BuildingState,
  fromX: number,
  fromY: number
): { x: number; y: number } {
  const townCenter = findOwnTownCenter(state, citadel.ownerId);
  if (!townCenter) {
    return { x: citadel.gridX + citadel.sizeX / 2, y: citadel.gridY + citadel.sizeY / 2 };
  }
  const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
  let bestDist = Infinity;
  let best = { x: layout.originX + layout.sizeX - 0.5, y: layout.originY + Math.floor(layout.sizeY / 2) + 0.5 };

  for (const wall of layout.walls) {
    const wx = wall.gridX + 0.5;
    const wy = wall.gridY + 0.5;
    const d = Math.hypot(wx - fromX, wy - fromY);
    if (d < bestDist) {
      bestDist = d;
      best = { x: wx, y: wy };
    }
  }
  for (const gate of layout.gates) {
    const gx = gate.gridX + 0.5;
    const gy = gate.gridY + 0.5;
    const d = Math.hypot(gx - fromX, gy - fromY);
    if (d < bestDist) {
      bestDist = d;
      best = { x: gx, y: gy };
    }
  }
  return best;
}

/**
 * Whether a specific grid coordinate is on a citadel wall or gate tile.
 */
export function isCitadelWallOrGateTile(
  layout: ReturnType<typeof citadelLayoutFor>,
  gridX: number,
  gridY: number
): boolean {
  return (
    layout.walls.some((w) => w.gridX === gridX && w.gridY === gridY) ||
    layout.gates.some((g) => g.gridX === gridX && g.gridY === gridY)
  );
}

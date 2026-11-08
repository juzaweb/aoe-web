import type { Room } from '@colyseus/sdk';
import { BUILDING_BLUEPRINTS, BuildingType, CITADEL_HEIGHT, CITADEL_WIDTH, TILE_HEIGHT, TILE_WIDTH, citadelLayoutFor } from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { GridPoint, WorldPoint } from './pointer.js';

/**
 * The parts of WorldScene every hit test reads. Keeping it structural instead of
 * importing the scene class avoids a runtime import cycle between the scene and
 * its input modules.
 */
export interface HitTestScene {
  room: Room | null;
  myOwnerId: string;
  unitSprites: Map<string, Phaser.GameObjects.Container>;
  buildingSprites: Map<string, Phaser.GameObjects.Container>;
  resourceSprites: Map<string, Phaser.GameObjects.Container>;
}

/**
 * `findUnitAt`/`findBuildingAt` take an owner filter that is either an owner id
 * or the literal `'enemy'`. Resolving that here keeps both call sites from
 * re-implementing the comparison.
 */
export function ownerMatches(scene: HitTestScene, ownerId: string, filter: string): boolean {
  return filter === 'enemy' ? ownerId !== scene.myOwnerId : ownerId === filter;
}

/**
 * Unit body ellipse in world coordinates, derived from the sprite sheet content
 * box and stored on the container at creation time. Every pointer interaction
 * (left-click, right-click, box-select) reads it from here, so they can never
 * disagree about where the unit actually is.
 *
 * @param slack Multiplier applied to both radii. A fingertip covers far more area
 *   than a mouse cursor, so the touch path asks for a wider box
 *   (`TOUCH_PICK_SLACK`); the mouse path keeps the default of exactly 1.
 */
export function getUnitBodyBox(container: Phaser.GameObjects.Container, slack = 1) {
  const centerY = container.y + ((container.getData('bodyOffsetY') as number) ?? -37);
  const radiusX = ((container.getData('bodyRadiusX') as number) ?? 36) * slack;
  const radiusY = ((container.getData('bodyRadiusY') as number) ?? 40) * slack;
  return { centerX: container.x, centerY, radiusX, radiusY };
}

export function hitTestUnit(
  worldX: number,
  worldY: number,
  container: Phaser.GameObjects.Container,
  slack = 1
): boolean {
  const { centerX, centerY, radiusX, radiusY } = getUnitBodyBox(container, slack);
  const nx = (worldX - centerX) / radiusX;
  const ny = (worldY - centerY) / radiusY;
  return nx * nx + ny * ny <= 1;
}

/**
 * Topmost unit of `ownerFilter` under the pointer. Shared by right-click
 * targeting and the CMD-03 cursor so the two can never disagree about what the
 * pointer is over.
 *
 * @param slack Widened hit box for touch; see `hitTestUnit`.
 */
export function findUnitAt(
  scene: HitTestScene,
  worldPoint: WorldPoint,
  ownerFilter?: string,
  slack = 1
): string | null {
  if (!scene.room) return null;
  let foundId: string | null = null;
  let foundDepth = -Infinity;
  scene.room.state.units.forEach((unit: any, uId: string) => {
    if (ownerFilter !== undefined && !ownerMatches(scene, unit.ownerId, ownerFilter)) return;
    const container = scene.unitSprites.get(uId);
    if (
      container &&
      hitTestUnit(worldPoint.x, worldPoint.y, container, slack) &&
      container.depth > foundDepth
    ) {
      foundId = uId;
      foundDepth = container.depth;
    }
  });
  return foundId;
}

/**
 * Whether `grid` lies on the compound's wall ring (which includes the gate
 * opening), the only part of a `CITADEL` that behaves like a clickable tile.
 */
export function citadelWallOrGateAt(_scene: HitTestScene, citadel: any, grid: GridPoint): boolean {
  const dx = grid.gridX - citadel.gridX;
  const dy = grid.gridY - citadel.gridY;
  if (dx < 0 || dx >= CITADEL_WIDTH || dy < 0 || dy >= CITADEL_HEIGHT) return false;
  return dx === 0 || dx === CITADEL_WIDTH - 1 || dy === 0 || dy === CITADEL_HEIGHT - 1;
}

function isClientProtectedCitadelInterior(scene: HitTestScene, building: any): boolean {
  if (building.type === 'CITADEL') return false;
  if (
    building.type !== 'TOWN_CENTER' &&
    building.type !== 'BARRACKS' &&
    building.type !== 'ARCHERY_RANGE' &&
    building.type !== 'HOUSE'
  ) {
    return false;
  }
  let townCenter: any = null;
  scene.room?.state.buildings?.forEach((b: any) => {
    if (!townCenter && b.ownerId === building.ownerId && b.type === 'TOWN_CENTER') {
      townCenter = b;
    }
  });
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
 * Building whose footprint contains `grid`. Ownership is the caller's filter:
 * right-click attacks foreign buildings, the cursor only cares that one is there.
 */
export function findBuildingAt(
  scene: HitTestScene,
  grid: GridPoint,
  ownerFilter?: string
): string | null {
  if (!scene.room) return null;
  let foundId: string | null = null;
  scene.room.state.buildings.forEach((b: any, bId: string) => {
    if (ownerFilter !== undefined && !ownerMatches(scene, b.ownerId, ownerFilter)) return;

    // Enemy players cannot attack protected interior citadel buildings directly.
    if (ownerFilter === 'enemy' && isClientProtectedCitadelInterior(scene, b)) {
      return;
    }

    if (b.type === 'CITADEL') {
      if (citadelWallOrGateAt(scene, b, grid)) {
        foundId = bId;
      }
      return;
    }

    if (
      grid.gridX >= b.gridX &&
      grid.gridX < b.gridX + b.sizeX &&
      grid.gridY >= b.gridY &&
      grid.gridY < b.gridY + b.sizeY
    ) {
      foundId = bId;
    }
  });
  return foundId;
}

/**
 * Building under a pointer: the rendered sprite's bounds first (a tall town
 * centre sticks up out of its footprint), then the footprint itself.
 *
 * The citadel compound is skipped in the sprite pass. It is a scoring entity,
 * not a drawn building — `CitadelLayer` renders its floor, walls and gate — so it
 * has no artwork of its own and its 26x26 footprint would otherwise swallow
 * every click meant for a structure standing inside the walls. The footprint pass
 * still selects it on its wall and gate tiles, keeping its health panel reachable.
 *
 * Shared with `SelectionController` so a left-click and the touch tap path can
 * never disagree about which building is under the pointer.
 *
 * @param pad Extra world pixels added to the visual bounds for a finger tap.
 */
export function findBuildingAtPoint(
  scene: HitTestScene,
  worldPoint: WorldPoint,
  grid: GridPoint,
  pad = 0
): string | null {
  if (!scene.room) return null;

  let foundId: string | null = null;

  scene.buildingSprites.forEach((container, bId) => {
    const building = scene.room?.state.buildings.get(bId);
    if (!building) return;
    if (building.type === 'CITADEL') return;

    const visualY = (container.getData('visualCenterY') as number) ?? -30;
    // LVL3: a tiered building's art grows taller with level (the manor is
    // 304 px against the hut's 220), so the clickable box has to cover the
    // artwork itself. The footprint box alone clipped the top of tall sprites.
    const image = container.getData('buildingImage') as
      | Phaser.GameObjects.Image
      | undefined;
    const footprintWidth = building.sizeX * TILE_WIDTH;
    const footprintHeight = building.sizeY * TILE_HEIGHT + 60;
    const width = Math.max(footprintWidth, image?.displayWidth ?? 0);
    const height = Math.max(footprintHeight, image?.displayHeight ?? 0);
    if (
      Math.abs(worldPoint.x - container.x) <= width / 2 + pad &&
      worldPoint.y >= container.y + visualY - height / 2 - pad &&
      worldPoint.y <= container.y + 20 + pad
    ) {
      foundId = bId;
    }
  });

  if (foundId) return foundId;

  scene.room.state.buildings.forEach((building: any, bId: string) => {
    if (building.type === 'CITADEL') {
      if (citadelWallOrGateAt(scene, building, grid)) {
        foundId = bId;
      }
      return;
    }

    if (
      grid.gridX >= building.gridX &&
      grid.gridX < building.gridX + building.sizeX &&
      grid.gridY >= building.gridY &&
      grid.gridY < building.gridY + building.sizeY
    ) {
      foundId = bId;
    }
  });

  return foundId;
}

/**
 * CMD-05: id of one of the player's own unfinished buildings whose footprint
 * contains `grid`, or null. Builds on `findBuildingAt` so the pointer, the
 * cursor and the right-click order all agree on which building a click lands on.
 */
export function findOwnFoundationAt(scene: HitTestScene, grid: GridPoint): string | null {
  const buildingId = findBuildingAt(scene, grid, scene.myOwnerId);
  if (buildingId) {
    const building = scene.room?.state.buildings.get(buildingId);
    if (
      building &&
      (!building.isConstructed ||
        (typeof building.hp === 'number' &&
          typeof building.maxHp === 'number' &&
          building.hp < building.maxHp))
    ) {
      return buildingId;
    }
  }
  const roads = (scene.room?.state as any)?.roads;
  const road = roads?.get(`${grid.gridX},${grid.gridY}`);
  if (road && road.ownerId === scene.myOwnerId && road.isConstructed === false) {
    return road.id;
  }
  return null;
}

/**
 * ECO-01: id of one of the player's own finished buildings that can be gathered
 * from (a farm), or null. Shares `findBuildingAt` so the right-click, the cursor
 * and the panel all agree on which building a click lands on.
 */
export function findOwnGatherableAt(scene: HitTestScene, grid: GridPoint): string | null {
  const buildingId = findBuildingAt(scene, grid, scene.myOwnerId);
  if (!buildingId) return null;
  const building = scene.room?.state.buildings.get(buildingId);
  if (!building || !building.isConstructed) return null;
  const blueprint = BUILDING_BLUEPRINTS[building.type as BuildingType];
  return blueprint?.gatheredResource ? buildingId : null;
}

/** Resource node under the pointer: sprite distance first, then exact grid cell. */
export function findResourceAt(
  scene: HitTestScene,
  worldPoint: WorldPoint,
  grid: GridPoint,
  slack = 1
): string | null {
  if (!scene.room) return null;
  const radius = 38 * slack;
  let foundId: string | null = null;
  scene.room.state.resourceNodes.forEach((res: any, resId: string) => {
    if (foundId) return;
    // Depleted nodes stay in the snapshot until they respawn, but they are not
    // visible and must not be selectable or harvestable.
    if (res.remainingAmount <= 0) return;
    const resSprite = scene.resourceSprites.get(resId);
    if (resSprite) {
      const centerY = res.type === 'TREE' ? resSprite.y - 45 : resSprite.y - 18;
      if (Math.hypot(worldPoint.x - resSprite.x, worldPoint.y - centerY) < radius) {
        foundId = resId;
      }
    }
    if (!foundId && res.gridX === grid.gridX && res.gridY === grid.gridY) {
      foundId = resId;
    }
  });
  return foundId;
}

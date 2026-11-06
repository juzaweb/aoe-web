import { BUILDING_BLUEPRINTS, isDirtRoadTile, roadTileKey, zoneKindOf } from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { WorldState } from '../schema/WorldState.js';
import { entityIds } from '../services/EntityIdAllocator.js';
import { terrainOf } from './mapLayout.js';

const PORTAL_BLUEPRINT = BUILDING_BLUEPRINTS.PORTAL;
const PORTAL_MARGIN = 5;



/** The account's portal in this room, if it already exists. */
export function findOwnPortal(state: WorldState, ownerId: string): BuildingState | null {
  let found: BuildingState | null = null;
  state.buildings.forEach((building: BuildingState) => {
    if (!found && building.ownerId === ownerId && building.type === 'PORTAL') {
      found = building;
    }
  });
  return found;
}

/** The account's Town Center in this room, if it has one. */
export function findOwnTownCenter(state: WorldState, ownerId: string): BuildingState | null {
  let found: BuildingState | null = null;
  state.buildings.forEach((building: BuildingState) => {
    if (!found && building.ownerId === ownerId && building.type === 'TOWN_CENTER') {
      found = building;
    }
  });
  return found;
}

/** 32-bit FNV-1a hash, so a battlefield portal is stable across restarts. */
function hashOwner(ownerId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < ownerId.length; i++) {
    hash ^= ownerId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface FreeSpotOptions {
  /**
   * The fixed kingdom gateway may sit on a road/resource tile. This covers the
   * deterministic battlefield roads and the player-painted kingdom roads alike:
   * a gateway is server infrastructure, not a build order.
   */
  ignoreRoads?: boolean;
  ignoreResources?: boolean;
  /** The portal being re-positioned must not block its own target spot. */
  ignoreBuildingId?: string;
  /** Gap kept on the right edge; the kingdom gateway sits flush (0). */
  rightMargin?: number;
}

function isPortalFootprintFree(
  state: WorldState,
  gx: number,
  gy: number,
  options: FreeSpotOptions = {}
): boolean {
  const sizeX = PORTAL_BLUEPRINT.sizeX;
  const sizeY = PORTAL_BLUEPRINT.sizeY;
  const { mapWidth: width, mapHeight: height } = state;

  if (
    gx < PORTAL_MARGIN ||
    gy < PORTAL_MARGIN ||
    gx + sizeX > width - (options.rightMargin ?? PORTAL_MARGIN) ||
    gy + sizeY > height - PORTAL_MARGIN
  ) {
    return false;
  }

  if (!options.ignoreRoads) {
    const terrain = terrainOf(state);
    for (let x = gx; x < gx + sizeX; x++) {
      for (let y = gy; y < gy + sizeY; y++) {
        if (isDirtRoadTile(x, y, terrain)) return false;
        if (state.roads.has(roadTileKey(x, y))) return false;
      }
    }
  }

  let clear = true;
  state.buildings.forEach((building: BuildingState) => {
    if (!clear) return;
    if (building.id === options.ignoreBuildingId) return;
    if (
      gx < building.gridX + building.sizeX &&
      gx + sizeX > building.gridX &&
      gy < building.gridY + building.sizeY &&
      gy + sizeY > building.gridY
    ) {
      clear = false;
    }
  });
  if (!clear) return false;

  if (!options.ignoreResources) {
    state.resourceNodes.forEach((node: ResourceNodeState) => {
      if (!clear) return;
      if (node.gridX >= gx && node.gridX < gx + sizeX && node.gridY >= gy && node.gridY < gy + sizeY) {
        clear = false;
      }
    });
  }

  return clear;
}

/** Spiral out from a preferred spot, then from the map centre. */
function findPortalSpot(
  state: WorldState,
  preferred: { x: number; y: number } | null
): { x: number; y: number } | null {
  const centres: Array<{ x: number; y: number }> = [];
  if (preferred) centres.push(preferred);
  centres.push({
    x: Math.floor(state.mapWidth / 2) - Math.floor(PORTAL_BLUEPRINT.sizeX / 2),
    y: Math.floor(state.mapHeight / 2) - Math.floor(PORTAL_BLUEPRINT.sizeY / 2)
  });

  for (const centre of centres) {
    for (let radius = 0; radius < 80; radius += 2) {
      const samples = radius === 0 ? 1 : radius * 8;
      for (let index = 0; index < samples; index++) {
        const angle = (index / samples) * Math.PI * 2;
        const gx = Math.round(centre.x + Math.cos(angle) * radius);
        const gy = Math.round(centre.y + Math.sin(angle) * radius);
        if (isPortalFootprintFree(state, gx, gy)) return { x: gx, y: gy };
      }
    }
  }

  return null;
}

/**
 * Fixed gateway position for a kingdom: flush against the right edge of the
 * map, vertically centred. Resources and roads may be under it (they are cleared
 * when the gateway is placed); only a building can push it inward.
 */
function findKingdomPortalSpot(
  state: WorldState,
  ignoreBuildingId?: string
): { x: number; y: number } | null {
  const sizeX = PORTAL_BLUEPRINT.sizeX;
  const sizeY = PORTAL_BLUEPRINT.sizeY;
  const edgeX = state.mapWidth - sizeX;
  const centreY = Math.floor(state.mapHeight / 2) - Math.floor(sizeY / 2);
  const options = {
    ignoreRoads: true,
    ignoreResources: true,
    ignoreBuildingId,
    rightMargin: 0
  };

  const tryColumn = (x: number): { x: number; y: number } | null => {
    for (let offset = 0; offset <= 80; offset += 2) {
      const candidates = offset === 0 ? [centreY] : [centreY - offset, centreY + offset];
      for (const y of candidates) {
        if (y < PORTAL_MARGIN || y + sizeY > state.mapHeight - PORTAL_MARGIN) continue;
        if (isPortalFootprintFree(state, x, y, options)) return { x, y };
      }
    }
    return null;
  };

  const onEdge = tryColumn(edgeX);
  if (onEdge) return onEdge;

  // A building already occupies the edge at the centre; step inward a little so
  // the gateway still reads as "on the right side" of the map.
  for (let x = edgeX - 2; x >= edgeX - 30; x -= 2) {
    const spot = tryColumn(x);
    if (spot) return spot;
  }

  return null;
}

/** Removes resource nodes buried under a server-placed gateway. */
function clearPortalResources(state: WorldState, portal: { gridX: number; gridY: number }): void {
  const sizeX = PORTAL_BLUEPRINT.sizeX;
  const sizeY = PORTAL_BLUEPRINT.sizeY;
  const buried: string[] = [];

  state.resourceNodes.forEach((node: ResourceNodeState, id: string) => {
    if (
      node.gridX >= portal.gridX &&
      node.gridX < portal.gridX + sizeX &&
      node.gridY >= portal.gridY &&
      node.gridY < portal.gridY + sizeY
    ) {
      buried.push(id);
    }
  });

  for (const id of buried) state.resourceNodes.delete(id);
}

/**
 * Finds the account's deterministic battlefield plot. The golden-ratio stride
 * keeps consecutive accounts far apart, and the spiral fallback keeps a crowded
 * map playable instead of refusing the join.
 */
function findBattlefieldSpot(state: WorldState, ownerId: string): { x: number; y: number } | null {
  const hash = hashOwner(ownerId);
  const usableX = Math.max(1, state.mapWidth - 2 * PORTAL_MARGIN);
  const usableY = Math.max(1, state.mapHeight - 2 * PORTAL_MARGIN);

  for (let attempt = 0; attempt < 512; attempt++) {
    const seedX = (hash + Math.imul(attempt, 0x9e3779b1)) >>> 0;
    const seedY = ((hash >>> 16) + Math.imul(attempt, 0x85ebca6b)) >>> 0;
    const gx = PORTAL_MARGIN + (seedX % usableX);
    const gy = PORTAL_MARGIN + (seedY % usableY);
    if (isPortalFootprintFree(state, gx, gy)) return { x: gx, y: gy };
  }

  return findPortalSpot(state, null);
}

function createPortal(ownerId: string, x: number, y: number): BuildingState {
  const portal = new BuildingState();
  portal.id = `b_${entityIds.nextId()}`;
  portal.ownerId = ownerId;
  portal.type = 'PORTAL';
  portal.gridX = x;
  portal.gridY = y;
  portal.sizeX = PORTAL_BLUEPRINT.sizeX;
  portal.sizeY = PORTAL_BLUEPRINT.sizeY;
  portal.maxHp = PORTAL_BLUEPRINT.maxHp;
  portal.hp = PORTAL_BLUEPRINT.maxHp;
  portal.level = 1;
  portal.isConstructed = true;
  portal.constructionProgress = 100;
  return portal;
}

/**
 * Ensures the account has a portal in this map and returns it.
 *
 * A kingdom gateway is fixed on the right edge of the map, vertically centred
 * (an existing one is moved there on the next join). The battlefield uses the
 * account's deterministic plot. The base `WorldRoom` (`zoneId === 'world'`, used
 * by the legacy unit tests) has no maps to travel between and no portal.
 */
export function ensurePortalFor(state: WorldState, ownerId: string): BuildingState | null {
  if (state.zoneId === 'world') return null;

  const kind = zoneKindOf(state.zoneId);

  if (kind === 'kingdom') {
    const existing = findOwnPortal(state, ownerId);
    const fixed = findKingdomPortalSpot(state, existing?.id);

    if (existing) {
      if (fixed && (existing.gridX !== fixed.x || existing.gridY !== fixed.y)) {
        existing.gridX = fixed.x;
        existing.gridY = fixed.y;
        clearPortalResources(state, existing);
      }
      return existing;
    }

    // The fixed edge is fully occupied by buildings: fall back to the old
    // near-Town-Center placement rather than leaving the kingdom without a gate.
    const townCenter = findOwnTownCenter(state, ownerId);
    const preferred = townCenter
      ? { x: townCenter.gridX + townCenter.sizeX + 1, y: townCenter.gridY }
      : null;
    const spot = fixed ?? findPortalSpot(state, preferred);
    if (!spot) return null;

    const portal = createPortal(ownerId, spot.x, spot.y);
    state.buildings.set(portal.id, portal);
    clearPortalResources(state, portal);
    return portal;
  }

  const existing = findOwnPortal(state, ownerId);
  if (existing) return existing;

  const spot = findBattlefieldSpot(state, ownerId);
  if (!spot) return null;

  const portal = createPortal(ownerId, spot.x, spot.y);
  state.buildings.set(portal.id, portal);
  return portal;
}

const ARRIVAL_COLUMNS = 7;
const ARRIVAL_SPACING = 0.8;

function arrivalCandidate(
  portal: BuildingState,
  slot: number,
  width: number,
  height: number
): { x: number; y: number } {
  const col = slot % ARRIVAL_COLUMNS;
  const row = Math.floor(slot / ARRIVAL_COLUMNS);

  // The fan is centred on the portal, then slid back inside the map. A kingdom
  // gateway sits flush on the right edge, so a centred fan would clamp all seven
  // columns onto the same x and arriving units would stack in one file.
  const fanWidth = (ARRIVAL_COLUMNS - 1) * ARRIVAL_SPACING;
  const centred = portal.gridX + portal.sizeX / 2 - fanWidth / 2;
  const start = Math.max(0.5, Math.min(width - 0.5 - fanWidth, centred));

  const x = start + col * ARRIVAL_SPACING;
  const y = portal.gridY + portal.sizeY + 1 + row * ARRIVAL_SPACING;

  return {
    x,
    y: Math.max(0.5, Math.min(height - 0.5, y))
  };
}

function isInsideBuilding(state: WorldState, x: number, y: number): boolean {
  let inside = false;
  state.buildings.forEach((building: BuildingState) => {
    if (inside) return;
    if (
      x >= building.gridX &&
      x < building.gridX + building.sizeX &&
      y >= building.gridY &&
      y < building.gridY + building.sizeY
    ) {
      inside = true;
    }
  });
  return inside;
}

/**
 * Where a travelling unit lands: a small grid just below the portal, clamped to
 * the map. Units do not collide with each other; this only keeps them out of
 * the portal or a building the owner placed under it.
 */
export function arrivalPoint(
  portal: BuildingState,
  index: number,
  state: WorldState
): { x: number; y: number } {
  const { mapWidth, mapHeight } = state;
  for (let slot = index; slot < index + ARRIVAL_COLUMNS * 20; slot++) {
    const candidate = arrivalCandidate(portal, slot, mapWidth, mapHeight);
    if (!isInsideBuilding(state, candidate.x, candidate.y)) {
      return candidate;
    }
  }

  return arrivalCandidate(portal, index, mapWidth, mapHeight);
}

export { isPortalFootprintFree };

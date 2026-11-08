import { BATTLEFIELD_MAP_SIZE, KINGDOM_MAP_SIZE, zoneKindOf } from '../constants/index.js';
import type { MapZoneKind } from '../types/index.js';
import {
  CITADEL_HEIGHT,
  CITADEL_WIDTH,
  citadelLayoutFor,
  citadelOriginFor,
  citadelTownCenterFor,
  type CitadelLayout
} from './citadel.js';

/** Everything the terrain generator needs to know about one map. */
export interface MapTerrain {
  width: number;
  height: number;
  kind: MapZoneKind;
}

export const TERRAIN_BATTLEFIELD: MapTerrain = { ...BATTLEFIELD_MAP_SIZE, kind: 'battlefield' };
export const TERRAIN_KINGDOM: MapTerrain = { ...KINGDOM_MAP_SIZE, kind: 'kingdom' };

/** Tiles of clear ground kept around the citadel before resources may spawn. */
export const CITADEL_CLEAR_MARGIN = 2;

/**
 * Tiles kept clear on each side of the gate opening on the approach avenue.
 *
 * The gate is only three tiles wide, but the avenue is drawn as a broad band:
 * it also keeps the travel portal at the far edge from being buried in a
 * forest. Eight tiles on each side leave the whole direction visibly open while
 * the rest of the map keeps its resource ring.
 */
export const CITADEL_APPROACH_MARGIN = 8;

/** Terrain layout of the map `zone` lives on. */
export function terrainForZone(zone: string): MapTerrain {
  return zoneKindOf(zone) === 'kingdom' ? TERRAIN_KINGDOM : TERRAIN_BATTLEFIELD;
}

/**
 * True inside the kingdom's citadel clearing.
 *
 * The compound sits at the centre of the map, so the generator must keep
 * resources out of that area: a tree inside a wall would be buried the moment
 * the base spawns. A small margin around the wall keeps the gate usable.
 */
export function isPlazaTile(gx: number, gy: number, terrain: MapTerrain): boolean {
  if (terrain.kind !== 'kingdom') return false;

  const { originX, originY } = citadelOriginFor(terrain.width, terrain.height);

  if (
    gx >= originX - CITADEL_CLEAR_MARGIN &&
    gx < originX + CITADEL_WIDTH + CITADEL_CLEAR_MARGIN &&
    gy >= originY - CITADEL_CLEAR_MARGIN &&
    gy < originY + CITADEL_HEIGHT + CITADEL_CLEAR_MARGIN
  ) {
    return true;
  }

  // Keep the avenue between the east gate and the map edge clear, so the only
  // thing in that direction is the travel portal on the far right edge.
  const anchor = citadelTownCenterFor(terrain.width, terrain.height);
  const layout = citadelLayoutFor(anchor.gridX, anchor.gridY);
  return isCitadelAvenueTile(gx, gy, layout, terrain.width);
}

/**
 * True on the avenue leading from the citadel's east gate to the map edge.
 *
 * Shared by the terrain generator (so resources never spawn there) and by the
 * snapshot upgrade that removes nodes saved by older builds. Keeping the rule in
 * one place stops the generator and the cleanup from drifting apart.
 */
export function isCitadelAvenueTile(
  gx: number,
  gy: number,
  layout: CitadelLayout,
  mapWidth: number
): boolean {
  const gateMinY = Math.min(...layout.gates.map((gate) => gate.gridY));
  const gateMaxY = Math.max(...layout.gates.map((gate) => gate.gridY));
  return (
    gx >= layout.originX + layout.sizeX &&
    gx < mapWidth &&
    gy >= gateMinY - CITADEL_APPROACH_MARGIN &&
    gy <= gateMaxY + CITADEL_APPROACH_MARGIN
  );
}

import { BATTLEFIELD_MAP_SIZE, KINGDOM_MAP_SIZE, zoneKindOf } from '../constants/index.js';
import type { MapZoneKind } from '../types/index.js';
import { CITADEL_SIZE, citadelOriginFor } from './citadel.js';

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

  return (
    gx >= originX - CITADEL_CLEAR_MARGIN &&
    gx < originX + CITADEL_SIZE + CITADEL_CLEAR_MARGIN &&
    gy >= originY - CITADEL_CLEAR_MARGIN &&
    gy < originY + CITADEL_SIZE + CITADEL_CLEAR_MARGIN
  );
}

import { BATTLEFIELD_MAP_SIZE, KINGDOM_MAP_SIZE, zoneKindOf } from '../constants/index.js';
import type { MapZoneKind } from '../types/index.js';

/** Everything the terrain generator needs to know about one map. */
export interface MapTerrain {
  width: number;
  height: number;
  kind: MapZoneKind;
}

export const TERRAIN_BATTLEFIELD: MapTerrain = { ...BATTLEFIELD_MAP_SIZE, kind: 'battlefield' };
export const TERRAIN_KINGDOM: MapTerrain = { ...KINGDOM_MAP_SIZE, kind: 'kingdom' };

/** Kingdom layouts keep this radius around the Town Center free of roads. */
export const KINGDOM_PLAZA_RADIUS = 7;

/** Terrain layout of the map `zone` lives on. */
export function terrainForZone(zone: string): MapTerrain {
  return zoneKindOf(zone) === 'kingdom' ? TERRAIN_KINGDOM : TERRAIN_BATTLEFIELD;
}

/**
 * True inside the kingdom's central plaza.
 *
 * The Town Center is placed dead centre, so the plaza keeps generated resource
 * nodes out of the starting build area. A kingdom starts with no roads at all:
 * the player paints their own (see `roadTileKey` and the PLACE_ROAD handler).
 */
export function isPlazaTile(gx: number, gy: number, terrain: MapTerrain): boolean {
  if (terrain.kind !== 'kingdom') return false;
  const cx = terrain.width / 2;
  const cy = terrain.height / 2;
  return Math.hypot(gx - cx, gy - cy) <= KINGDOM_PLAZA_RADIUS;
}

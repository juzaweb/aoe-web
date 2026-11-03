import { MapTerrain, zoneKindOf } from '@chien-quoc/shared';
import { WorldState } from '../schema/WorldState.js';

/**
 * Terrain layout of the map a room simulates.
 *
 * The size comes from the replicated state (the numbers the client sees) and
 * only the layout kind from the zone id, so a room can never simulate a map of
 * one size while telling the client another.
 */
export function terrainOf(state: WorldState): MapTerrain {
  return {
    width: state.mapWidth,
    height: state.mapHeight,
    kind: zoneKindOf(state.zoneId)
  };
}

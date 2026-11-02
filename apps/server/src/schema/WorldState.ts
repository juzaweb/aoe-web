import { Schema, type, MapSchema } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';
import { BuildingState } from './BuildingState.js';
import { UnitState } from './UnitState.js';
import { ResourceNodeState } from './ResourceNodeState.js';
import { MAP_GRID_HEIGHT, MAP_GRID_WIDTH } from '@chien-quoc/shared';

export class WorldState extends Schema {
  /**
   * Persistent id of the map this room simulates: `kingdom:<ownerId>` for a
   * private kingdom, `battlefield` for the shared map. Replicated so the client
   * can label the HUD/minimap without knowing the room naming scheme.
   */
  @type('string') zoneId: string = 'world';
  @type('number') mapWidth: number = MAP_GRID_WIDTH;
  @type('number') mapHeight: number = MAP_GRID_HEIGHT;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: BuildingState }) buildings = new MapSchema<BuildingState>();
  @type({ map: UnitState }) units = new MapSchema<UnitState>();
  @type({ map: ResourceNodeState }) resourceNodes = new MapSchema<ResourceNodeState>();
}


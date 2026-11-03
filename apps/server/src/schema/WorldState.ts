import { Schema, type, MapSchema } from '@colyseus/schema';
import { PlayerState } from './PlayerState.js';
import { BuildingState } from './BuildingState.js';
import { UnitState } from './UnitState.js';
import { CorpseState } from './CorpseState.js';
import { ResourceNodeState } from './ResourceNodeState.js';
import { MAP_GRID_HEIGHT, MAP_GRID_WIDTH } from '@chien-quoc/shared';

export class WorldState extends Schema {
  /**
   * Persistent id of the map this room simulates: `kingdom:<ownerId>` for a
   * private kingdom, `battlefield` for the shared map. Replicated so the client
   * can label the HUD/minimap without knowing the room naming scheme.
   */
  @type('string') zoneId: string = 'world';
  /**
   * Side lengths of the map this room simulates: 110 for a kingdom, 220 for the
   * battlefield. Set by `WorldRoom.onCreate` and replicated so the client sizes
   * its camera, terrain and minimap from the same numbers.
   */
  @type('number') mapWidth: number = MAP_GRID_WIDTH;
  @type('number') mapHeight: number = MAP_GRID_HEIGHT;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: BuildingState }) buildings = new MapSchema<BuildingState>();
  @type({ map: UnitState }) units = new MapSchema<UnitState>();
  /**
   * Units that just died, held briefly so the client can play the death
   * clip. Never part of the simulation: see {@link CorpseState}.
   */
  @type({ map: CorpseState }) corpses = new MapSchema<CorpseState>();
  @type({ map: ResourceNodeState }) resourceNodes = new MapSchema<ResourceNodeState>();
}


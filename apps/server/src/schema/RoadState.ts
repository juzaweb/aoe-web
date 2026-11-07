import { Schema, type } from '@colyseus/schema';

/**
 * One 1x1 dirt road tile a player painted in their kingdom.
 *
 * Roads are addressed by position, so `id` is `"<gridX>,<gridY>"` (see
 * `roadTileKey`). That makes the id deterministic, prevents a second placement
 * of the same tile from duplicating state, and lets a client address a tile it
 * has not observed yet.
 */
export class RoadState extends Schema {
  @type('string') id: string = '';
  @type('string') ownerId: string = '';
  @type('number') gridX: number = 0;
  @type('number') gridY: number = 0;
}

import { RoadState } from '../schema/RoadState.js';
import { WorldState } from '../schema/WorldState.js';

/**
 * Lookup for the player-painted road network of one room.
 *
 * Roads are replicated state, not terrain: the only road tiles in the game are
 * the ones a player painted, so this grid is the single source of truth.
 * Everything that needs "is this tile a road" (movement speed, building
 * placement, portal search) goes through here.
 *
 * The grid is one byte per tile and is rebuilt only when the road count changes
 * or a writer calls {@link invalidate}: a kingdom is 12,100 cells, and
 * rebuilding that per query would show up in the tick budget. The count alone is
 * not enough (one stroke can remove a tile and add another inside the same
 * tick), which is why every mutation invalidates explicitly.
 */
export class RoadGrid {
  private grid: Uint8Array | null = null;
  private builtCount = -1;

  constructor(private readonly state: WorldState) {}

  /** Whether `gx, gy` holds a road tile. */
  isRoad(gx: number, gy: number): boolean {
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const { mapWidth, mapHeight } = this.state;
    if (ix < 0 || iy < 0 || ix >= mapWidth || iy >= mapHeight) return false;
    return this.getGrid()[iy * mapWidth + ix] === 1;
  }

  /** Forces the next query to rebuild the grid (a road was added or removed). */
  invalidate() {
    this.builtCount = -1;
  }

  private getGrid(): Uint8Array {
    if (this.grid && this.builtCount === this.state.roads.size) return this.grid;

    const { mapWidth, mapHeight } = this.state;
    const grid = this.grid ?? new Uint8Array(mapWidth * mapHeight);
    grid.fill(0);
    this.state.roads.forEach((road: RoadState) => {
      if (road.gridX < 0 || road.gridY < 0) return;
      if (road.gridX >= mapWidth || road.gridY >= mapHeight) return;
      grid[road.gridY * mapWidth + road.gridX] = 1;
    });

    this.grid = grid;
    this.builtCount = this.state.roads.size;
    return grid;
  }
}

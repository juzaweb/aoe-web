/**
 * Pure helpers for the road paint tool, kept out of the Phaser controller so
 * the geometry and the batching can be tested without a canvas.
 */

export interface RoadTile {
  x: number;
  y: number;
}

/**
 * Integer tiles on the straight line between two samples.
 *
 * A fast drag only produces one pointer sample every few tiles, so painting
 * just the sampled tiles would leave a dotted road. Bresenham fills the gap and
 * always includes both endpoints.
 */
export function lineTiles(from: RoadTile, to: RoadTile): RoadTile[] {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return [];

  const tiles: RoadTile[] = [];
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(to.x);
  const endY = Math.round(to.y);

  const dx = Math.abs(endX - x);
  const dy = Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx - dy;

  // Bounded by the Manhattan distance, so a long drag is at worst one pass
  // over the tiles between the two samples.
  for (let guard = 0; guard <= dx + dy + 1; guard++) {
    tiles.push({ x, y });
    if (x === endX && y === endY) break;
    const doubleError = error * 2;
    if (doubleError > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubleError < dx) {
      error += dx;
      y += stepY;
    }
  }
  return tiles;
}

/** Splits a stroke into messages the server accepts. */
export function batchTiles(tiles: RoadTile[], maxPerMessage: number): RoadTile[][] {
  if (maxPerMessage <= 0) return [];
  const batches: RoadTile[][] = [];
  for (let i = 0; i < tiles.length; i += maxPerMessage) {
    batches.push(tiles.slice(i, i + maxPerMessage));
  }
  return batches;
}

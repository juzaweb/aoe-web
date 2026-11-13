/**
 * A building footprint in grid tiles: top-left corner plus size.
 *
 * Structural rather than a schema class on purpose. The server hands over a
 * Colyseus `BuildingState`, the client hands over a plain snapshot of one, and
 * the economy, construction, combat and projectile code all need the same
 * distance to it — none of them should have to convert or duplicate the maths.
 */
export interface Footprint {
  gridX: number;
  gridY: number;
  sizeX: number;
  sizeY: number;
}

/**
 * Distance in tiles from a point to a footprint rectangle, `0` when the point is
 * inside it.
 *
 * Range checks against buildings have to use the footprint rather than the
 * footprint's centre: a Town Center's centre is about two tiles inside its own
 * walls, so centre-based distance would put half the building outside its own
 * range. Lives in the shared package because both sides of the wire need the
 * same answer: the server decides a hit with it, and the client draws the arrow
 * for that hit with it.
 */
export function distanceToFootprint(x: number, y: number, footprint: Footprint): number {
  const dx = Math.max(footprint.gridX - x, 0, x - (footprint.gridX + footprint.sizeX));
  const dy = Math.max(footprint.gridY - y, 0, y - (footprint.gridY + footprint.sizeY));
  return Math.hypot(dx, dy);
}

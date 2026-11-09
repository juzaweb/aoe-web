import { getIsoDepth } from '@chien-quoc/shared';

/**
 * Draw-order offsets inside one isometric row.
 *
 * `getIsoDepth` multiplies `gridX + gridY` by 1000, so these only break ties
 * between objects that share a row; they never reorder two different rows.
 * Other bands (resources, buildings, gate, units) still live with their
 * owners; `CitadelLayer` and `EntityRenderer` share this one pair so a
 * player-painted segment and the capital's ring sort identically.
 *
 * Wall art deliberately outranks building art. Both a wall block and a
 * building sheet paint well above their own tile, and a house standing flush
 * against the ring shares a row with the wall tiles it touches. With the wall
 * on a lower offset the house won that tie and its over-wide roof was drawn
 * across the wall cap. Walls win now, which is the only safe side: a wall is
 * terrain and must never be painted over by a neighbour.
 */
export const WALL_DEPTH_OFFSET = 16;
export const BUILDING_DEPTH_OFFSET = 15;

/** Depth key for one wall segment (citadel ring or player-painted). */
export function wallDepth(gridX: number, gridY: number): number {
  return getIsoDepth(gridX, gridY, WALL_DEPTH_OFFSET);
}

/** A building footprint plus the type the draw order needs to know. */
interface BuildingDepthInput {
  type?: string;
  gridX: number;
  gridY: number;
  sizeX: number;
  sizeY: number;
}

/**
 * Depth key for one building.
 *
 * A wall segment is a 1x1 building, so it goes through {@link wallDepth} and
 * matches the citadel ring exactly.
 *
 * Every other footprint is keyed on its *near corner* — the last row and column
 * it occupies — never one past it. Keying on `gridX + sizeX, gridY + sizeY`
 * overshoots by two rows, which let a 2x2 house outrank the wall tile bordering
 * it; a sheet wider than its footprint then painted its roof across the wall.
 * The near corner is the front-most tile the building actually covers, so
 * anything in front of it (a wall, a unit, a resource) sorts in front of it.
 */
export function buildingDepth(building: BuildingDepthInput): number {
  if (building.type === 'WALL') {
    return wallDepth(building.gridX, building.gridY);
  }
  return getIsoDepth(
    building.gridX + building.sizeX - 1,
    building.gridY + building.sizeY - 1,
    BUILDING_DEPTH_OFFSET
  );
}

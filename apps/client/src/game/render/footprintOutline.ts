import { TILE_HEIGHT, TILE_WIDTH } from '@chien-quoc/shared';

/**
 * The four corners of a building footprint, relative to the footprint centre.
 *
 * A footprint is a rectangle in grid space, so on screen it is a **parallelogram**,
 * not a diamond: the north corner shifts horizontally by `32 * (sizeY - sizeX)`
 * and the east/west corners sit at different heights. Only a square footprint
 * (`sizeX === sizeY`) happens to be symmetric, which is why drawing the outline
 * as `halfW = sizeX * TILE_WIDTH / 2`, `halfH = sizeY * TILE_HEIGHT / 2` looked
 * right on a 2x2 house and dropped the Town Center (4x6) outline well below its
 * walls.
 *
 * The origin is the point `EntityRenderer` puts a building container on:
 * `gridToScreen(gridX + sizeX / 2 - 0.5, gridY + sizeY / 2 - 0.5)`, the centre
 * of the footprint. Callers that draw in a container's local space can use the
 * numbers as-is; callers that draw in scene space add the container position.
 *
 * Numbers, for a 4x6 Town Center: north `(64, -160)`, east `(320, -32)`,
 * south `(-64, 160)`, west `(-320, 32)` — 640 px wide, 320 px tall, matching the
 * ten-tile diagonal of a 4x6 footprint on the 2:1 tile grid.
 */
export interface FootprintOutline {
  north: { x: number; y: number };
  east: { x: number; y: number };
  south: { x: number; y: number };
  west: { x: number; y: number };
}

/** Half a tile's width: the horizontal step of one diff of `gridX - gridY`. */
const HALF_TILE_WIDTH = TILE_WIDTH / 2;
/** Half a tile's height: the vertical step of one sum of `gridX + gridY`. */
const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;

/**
 * Corners of a `sizeX x sizeY` footprint, relative to its centre.
 *
 * Each corner is one tile corner of the footprint: the north corner is the top
 * corner of the `(gridX, gridY)` tile, the south corner the bottom corner of
 * `(gridX+sizeX-1, gridY+sizeY-1)`, and the east/west corners are the side
 * corners of the tiles at the other two corners of the rectangle. On a 2:1 grid
 * a tile corner is `±HALF_TILE_HEIGHT` away on the `gridX - gridY` axis and
 * `±HALF_TILE_WIDTH` on the `gridX + gridY` axis, which is where the factors
 * below come from.
 */
export function footprintOutline(sizeX: number, sizeY: number): FootprintOutline {
  const span = sizeX + sizeY;
  // Half extents: the outline runs corner to corner across the whole footprint,
  // so both axes contribute to each one.
  const halfWidth = (HALF_TILE_WIDTH * span) / 2;
  const halfHeight = (HALF_TILE_HEIGHT * span) / 2;
  // Skew: how far a non-square footprint leans off the symmetric diamond. Zero
  // when `sizeX === sizeY`, which is why the old symmetric outline looked right
  // on every 2x2 building and wrong on the 4x6 Town Center.
  const skewX = (HALF_TILE_WIDTH * (sizeY - sizeX)) / 2;
  const skewY = (HALF_TILE_HEIGHT * (sizeX - sizeY)) / 2;

  // `-0 === 0` in arithmetic but not in `Object.is`, and these numbers end up in
  // tests and debug logs; normalise the sign so a square footprint reports 0.
  const southX = skewX === 0 ? 0 : -skewX;
  const westY = skewY === 0 ? 0 : -skewY;

  return {
    north: { x: skewX, y: -halfHeight },
    east: { x: halfWidth, y: skewY },
    south: { x: southX, y: halfHeight },
    west: { x: -halfWidth, y: westY }
  };
}

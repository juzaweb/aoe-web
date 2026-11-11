import { HexPosition, WORLD_MAP_RADIUS, hexGridSize, hexTileAt } from '@chien-quoc/shared';

/**
 * Geometry of the world map overlay.
 *
 * Pointy-top hexes in axial coordinates (`q`, `r`). Everything here is a pure
 * function so the layout can be unit-tested without a DOM, and so the same
 * numbers drive both the drawn grid and hit-testing.
 */

/** Distance from a hex centre to a corner, in CSS pixels. */
export const HEX_SIZE = 34;

/** Horizontal distance between adjacent columns. */
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
/** Vertical distance between rows. */
const HEX_HEIGHT = 1.5 * HEX_SIZE;

/**
 * Relief painting of the continent, drawn behind the hex grid.
 *
 * The dimming lives in the overlay's scrim, not in the PNG, so the painting can
 * be replaced on its own. `?v` busts the cache when it is.
 */
export const WORLD_MAP_BACKGROUND_URL = '/assets/worldmap/world_map.png?v=1';

export interface Point {
  x: number;
  y: number;
}

/** Centre of a hex in overlay pixels. */
export function hexToPixel(hex: HexPosition, size = HEX_SIZE): Point {
  const width = Math.sqrt(3) * size;
  return {
    x: width * (hex.q + hex.r / 2),
    y: 1.5 * size * hex.r
  };
}

/** Rounds fractional cube coordinates to the nearest whole hex. */
export function hexRound(q: number, r: number): HexPosition {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;

  return { q: rq, r: rr };
}

/** The hex under a pixel position; the inverse of {@link hexToPixel}. */
export function pixelToHex(point: Point, size = HEX_SIZE): HexPosition {
  const q = ((Math.sqrt(3) / 3) * point.x - point.y / 3) / size;
  const r = ((2 / 3) * point.y) / size;
  return hexRound(q, r);
}

/** `points` attribute for an SVG polygon at `hex`. */
export function hexPolygonPoints(hex: HexPosition, size = HEX_SIZE): string {
  const centre = hexToPixel(hex, size);
  const corners: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push(
      `${(centre.x + size * Math.cos(angle)).toFixed(2)},${(centre.y + size * Math.sin(angle)).toFixed(2)}`
    );
  }
  return corners.join(' ');
}

/** Bounding box of the whole grid, used to size the SVG viewBox. */
export function worldMapBounds(size = HEX_SIZE, radius = WORLD_MAP_RADIUS) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < hexGridSize(radius); index++) {
    const centre = hexToPixel(hexTileAt(index, radius), size);
    minX = Math.min(minX, centre.x - size);
    maxX = Math.max(maxX, centre.x + size);
    minY = Math.min(minY, centre.y - size);
    maxY = Math.max(maxY, centre.y + size);
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * UIX-01: the signed level delta printed on a hex, e.g. `-2`, `=` or `+3`.
 *
 * A colour-only tile is unreadable in grayscale and for a colour-blind player,
 * and the legend alone does not tell them which neighbour is which. The label
 * is the secondary cue; the fill colour stays the primary one.
 */
export function levelDeltaLabel(delta: number): string {
  if (delta === 0) return '=';
  return delta > 0 ? `+${delta}` : String(delta);
}

/** Colour of a neighbour relative to the player's own Town Center level. */
export function levelDeltaColor(delta: number, canAttack: boolean): string {
  if (!canAttack) return '#475569';
  if (delta < 0) return '#22c55e';
  if (delta > 0) return '#ef4444';
  return '#eab308';
}

/**
 * Distributes empires over distinct tiles.
 *
 * Two accounts can hash to the same tile, which would hide one behind the
 * other, so later collisions slide to the next free tile of the grid.
 */
export function assignHexTiles(userIds: string[], radius = WORLD_MAP_RADIUS): Map<string, HexPosition> {
  const taken = new Set<string>();
  const assigned = new Map<string, HexPosition>();
  const size = hexGridSize(radius);

  for (const userId of userIds) {
    let index = hashUserId(userId, size);
    for (let attempt = 0; attempt < size; attempt++) {
      const tile = hexTileAt(index % size, radius);
      const key = `${tile.q},${tile.r}`;
      if (!taken.has(key)) {
        taken.add(key);
        assigned.set(userId, tile);
        break;
      }
      index += 1;
    }
  }

  return assigned;
}

/** Same FNV-1a hash the shared `hexPositionOf` uses, kept local to avoid a round trip. */
function hashUserId(userId: string, size: number): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

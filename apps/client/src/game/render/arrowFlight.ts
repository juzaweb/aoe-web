import { TILE_HEIGHT, TILE_WIDTH } from '@chien-quoc/shared';

/**
 * FX-01: the geometry of one arrow in flight, kept free of Phaser.
 *
 * The projectile layer draws a dozen arrows at a time and needs three things
 * from each of them every frame: how long the trip takes, where the arrow is
 * right now, and what angle to draw it at. All three are plain arithmetic on the
 * isometric projection, so they live here where they can be unit-tested without
 * a renderer — the same split `unitMotion.ts` uses for unit smoothing.
 */

/** Screen-space distance covered by one grid tile, in pixels. */
const HALF_TILE_WIDTH = TILE_WIDTH / 2;
const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;

/**
 * How long an arrow spends in the air, per tile of ground distance.
 *
 * A watch tower shoots eight tiles and an archer five, so a constant speed would
 * make tower arrows crawl for over half a second while archer arrows snapped.
 * At 60 ms/tile the tower shot takes ~0.5 s and the archer shot ~0.3 s, both
 * comfortably inside the shorter of the two cooldowns (1400 ms), so a shooter
 * never has two arrows in the air.
 */
export const ARROW_MS_PER_TILE = 60;

/**
 * Bounds on that duration. The floor stops a point-blank shot from teleporting
 * (which reads as a hit with no arrow at all), the ceiling stops a stray shot at
 * the edge of a tower's range from hanging in the sky long enough to look stuck.
 */
export const ARROW_MIN_TRAVEL_MS = 140;
export const ARROW_MAX_TRAVEL_MS = 520;

/**
 * Height of the flight arc at its midpoint, in pixels.
 *
 * A straight line reads as a laser bolt. Arcing the arrow over the ground is
 * what makes it legible as a *loosed* arrow, and it also keeps the projectile
 * clear of the units standing between the shooter and the target.
 */
export const ARROW_ARC_PX = 46;

/** A point in world screen space (the scene's untransformed coordinates). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Isometric projection of a grid position into screen space.
 *
 * Deliberately inlined here instead of calling `gridToScreen` from the shared
 * package: that helper allocates a point per call and this runs for every arrow
 * on every frame, so callers can hand in a scratch object.
 */
export function gridToScreenPoint(
  gridX: number,
  gridY: number,
  out: ScreenPoint = { x: 0, y: 0 }
): ScreenPoint {
  out.x = (gridX - gridY) * HALF_TILE_WIDTH;
  out.y = (gridX + gridY) * HALF_TILE_HEIGHT;
  return out;
}

/**
 * Time in the air for a shot that crosses `gridDistance` tiles.
 *
 * Measured on the ground, not on screen: the isometric projection already
 * squashes the vertical axis, and deriving the duration from the projected
 * length would make north-south shots visibly faster than east-west ones.
 */
export function flightDurationMs(gridDistance: number): number {
  const ms = gridDistance * ARROW_MS_PER_TILE;
  return Math.min(ARROW_MAX_TRAVEL_MS, Math.max(ARROW_MIN_TRAVEL_MS, ms));
}

/**
 * Where the arrow is at `t` (0 = released, 1 = landed).
 *
 * The horizontal component is a straight interpolation between the endpoints;
 * only the vertical gets the arc, so the arrow stays exactly on the line between
 * shooter and target and lands on the target rather than near it.
 */
export function arrowPositionAt(
  from: ScreenPoint,
  to: ScreenPoint,
  t: number,
  arcPx: number = ARROW_ARC_PX,
  out: ScreenPoint = { x: 0, y: 0 }
): ScreenPoint {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = from.x + (to.x - from.x) * clamped;
  out.y = from.y + (to.y - from.y) * clamped - Math.sin(Math.PI * clamped) * arcPx;
  return out;
}

/**
 * Draw angle for the arrow sprite, in radians.
 *
 * Taken from the step the arrow just made rather than from the straight line to
 * the target, so the sprite noses over at the top of the arc and comes down
 * pointing at the target — an arrow drawn along the chord would look like it is
 * flying backwards on the way down.
 */
export function arrowAngle(from: ScreenPoint, to: ScreenPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

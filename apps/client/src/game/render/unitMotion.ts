import { SERVER_TICK_RATE, TILE_HEIGHT, TILE_WIDTH } from '@chien-quoc/shared';
import {
  DEFAULT_DIRECTION_INDEX,
  directionAngle,
  quantizeDirection,
  shortestAngleDelta
} from './unitDirections.js';

/**
 * Client-side motion smoothing for units (MOV-01).
 *
 * The authoritative simulation runs at 20 Hz, so a walking unit's replicated
 * position changes once every 50 ms and then jumps by roughly a tenth of a tile.
 * Drawing the newest sample directly reads as a stutter, and chasing it with a
 * per-frame lerp factor makes the result depend on the machine's frame rate (a
 * 144 Hz client converges 2.4x faster than a 60 Hz one and visibly overshoots).
 *
 * Instead, each unit keeps the last two authoritative samples and the sprite is
 * drawn at a fixed offset behind wall-clock time. Between two samples the
 * position is a straight line, so the sprite moves at the constant velocity the
 * server simulated — the frame rate no longer enters the maths at all, only the
 * sampling of that line does.
 *
 * Everything here is pure and clock-parameterised, which is what makes it
 * testable without a Phaser instance.
 */

/** Nominal time between two authoritative snapshots, in ms. */
export const SNAPSHOT_INTERVAL_MS = 1000 / SERVER_TICK_RATE;

/**
 * How far behind wall-clock time units are drawn, in ms.
 *
 * Exactly one snapshot interval. A sample that lands at `t` is then interpolated
 * in from the sample before it across [t, t + interval], so the sprite finishes
 * the segment just as the next sample arrives: constant-velocity motion with one
 * tick of lag.
 *
 * The residual cost of keeping only two samples is that a *late* sample makes the
 * sprite sit still for the remainder of the segment (alpha clamps at 1) before
 * the next one resumes it. That stall is bounded by the arrival jitter, usually
 * under a frame; removing it entirely would need a third sample and a delay of
 * 1.5-2 ticks, i.e. twice the input lag, which an RTS cannot spend.
 */
export const RENDER_DELAY_MS = SNAPSHOT_INTERVAL_MS;

/**
 * A gap larger than this means the unit was parked rather than walking. The
 * server only replicates a property when it changes, so a unit that stood still
 * for seconds produces no samples at all and the first step afterwards would
 * otherwise be interpolated across the whole pause (a teleport).
 */
export const MAX_SNAPSHOT_GAP_MS = SNAPSHOT_INTERVAL_MS * 3;

/** Two positions closer than this (in tiles) are the same position. */
export const POSITION_EPSILON = 0.01;

/** Below this speed (tiles/second) a unit is standing, not walking. */
export const MIN_MOVING_SPEED = 0.2;

/**
 * Speed the walk cycles were drawn for, in tiles/second (the villager's). The
 * animation frame rate is scaled from here, so cavalry — four tiles/second
 * against the villager's 2.2 — no longer slides along the ground.
 */
export const WALK_REFERENCE_SPEED = 2.2;

/** Bounds on that scale; beyond them the cycle reads as broken, not fast. */
const MIN_WALK_TIME_SCALE = 0.6;
const MAX_WALK_TIME_SCALE = 2.5;

/** How fast a unit may swing its facing while walking, in radians per second. */
export const TURN_RATE_RAD_PER_S = 12;

/** Two consecutive authoritative samples of one unit's position. */
export interface MotionSegment {
  fromX: number;
  fromY: number;
  /** Scene-clock time (ms) the `from` sample was observed. */
  fromAt: number;
  toX: number;
  toY: number;
  /** Scene-clock time (ms) the `to` sample was observed. */
  toAt: number;
}

/** A parked unit: both ends of the segment sit on the same position. */
export function createMotionSegment(x: number, y: number, at: number): MotionSegment {
  return { fromX: x, fromY: y, fromAt: at, toX: x, toY: y, toAt: at };
}

function samePosition(aX: number, aY: number, bX: number, bY: number): boolean {
  return Math.abs(aX - bX) < POSITION_EPSILON && Math.abs(aY - bY) < POSITION_EPSILON;
}

/**
 * Folds this frame's authoritative position into the unit's segment.
 *
 * Returns the previous segment untouched while the position has not changed, so
 * `toAt` keeps meaning "when the unit last moved" instead of being refreshed
 * every frame — that is what lets a long pause be recognised as a pause.
 */
export function advanceMotionSegment(
  previous: MotionSegment,
  x: number,
  y: number,
  at: number
): MotionSegment {
  if (samePosition(x, y, previous.toX, previous.toY)) return previous;

  const gap = at - previous.toAt;
  // A pause (or a non-monotonic clock, which a reloaded tab can produce) gives a
  // span that is not a tick; clamp it so the first step after it still takes one
  // tick to draw instead of snapping across the whole gap.
  const fromAt = gap > MAX_SNAPSHOT_GAP_MS || gap <= 0 ? at - SNAPSHOT_INTERVAL_MS : previous.toAt;

  return {
    fromX: previous.toX,
    fromY: previous.toY,
    fromAt,
    toX: x,
    toY: y,
    toAt: at
  };
}

/**
 * Grid position of the unit at `renderTime`.
 *
 * Clamped at both ends: before the segment starts the unit is still at `from`,
 * and once the segment is spent it stays at `to` until a new sample arrives.
 * Extrapolating past `to` was rejected because the last sample before an arrival
 * still carries velocity — overshooting it would slide the unit past its
 * destination and then snap it back.
 *
 * `out` exists because this runs once per unit per frame: the caller can hand in a
 * scratch point instead of allocating one per sample.
 */
export function sampleMotionSegment(
  segment: MotionSegment,
  renderTime: number,
  out: { x: number; y: number } = { x: 0, y: 0 }
): { x: number; y: number } {
  const span = segment.toAt - segment.fromAt;
  if (span <= 0) {
    out.x = segment.toX;
    out.y = segment.toY;
    return out;
  }

  const alpha = Math.min(1, Math.max(0, (renderTime - segment.fromAt) / span));
  out.x = segment.fromX + (segment.toX - segment.fromX) * alpha;
  out.y = segment.fromY + (segment.toY - segment.fromY) * alpha;
  return out;
}

/** Speed of the segment, in tiles per second. */
export function motionSpeed(segment: MotionSegment): number {
  const span = segment.toAt - segment.fromAt;
  if (span <= 0) return 0;
  return Math.hypot(segment.toX - segment.fromX, segment.toY - segment.fromY) / (span / 1000);
}

/**
 * Screen-space heading of the segment, in radians, or null when it does not
 * represent travel.
 *
 * The sheet rows are compass directions *on screen*, and the isometric
 * projection turns a one-tile grid step into a half-width/half-height screen
 * step, so the grid delta is projected before the angle is taken. Keeping this
 * out of the renderer is what lets facing and the animation row share one
 * definition.
 */
export function motionHeading(segment: MotionSegment): number | null {
  const deltaX = segment.toX - segment.fromX;
  const deltaY = segment.toY - segment.fromY;
  if (Math.abs(deltaX) < POSITION_EPSILON && Math.abs(deltaY) < POSITION_EPSILON) return null;

  const screenX = (deltaX - deltaY) * (TILE_WIDTH / 2);
  const screenY = (deltaX + deltaY) * (TILE_HEIGHT / 2);
  return Math.atan2(screenY, screenX);
}

/** Rotates `current` toward `target` by at most `maxStep`, shortest way round. */
export function rotateTowards(current: number, target: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

/**
 * Playback rate for the walk cycle of a unit travelling at `speed` tiles/second.
 *
 * Units in this game move between 2.2 and 4.0 tiles/second while every walk sheet
 * was drawn at one rate, so an unscaled cycle makes the fastest units skate.
 */
export function walkTimeScale(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_WALK_TIME_SCALE, Math.max(MIN_WALK_TIME_SCALE, speed / WALK_REFERENCE_SPEED));
}

/** What the scene has to draw for one unit on one frame. */
export interface MotionStep {
  /** Grid position to draw the unit at. */
  x: number;
  y: number;
  /** Compass row of the sheet to play. */
  facing: number;
  /** Smoothed screen-space heading, for mirroring single-facing art. */
  heading: number;
  /** Whether the sprite is still travelling on this frame. */
  gliding: boolean;
}

/**
 * The motion state of one unit (MOV-01).
 *
 * Heading and compass row are kept apart on purpose: the row is quantized, so the
 * angle is what makes a turn look like a turn and the row is only what picks the
 * artwork.
 *
 * Deliberately free of Phaser: the whole per-frame rule — how far the sprite has
 * glided, when it still counts as walking, how far it may swing round — is
 * exercised by the unit tests in `unitMotion.test.ts` without a canvas.
 */
export class UnitMotion {
  private segment: MotionSegment;
  private headingRad: number;
  private facingRow: number;

  /**
   * Scratch result, reused every frame: this is called once per unit per frame, and
   * allocating a fresh step there would hand the garbage collector thousands of
   * short-lived objects a second. Callers must read it before their next `update`.
   */
  private readonly step: MotionStep;

  constructor(x: number, y: number, at: number) {
    this.segment = createMotionSegment(x, y, at);
    // Spawn facing the viewer, like the art's default row.
    this.headingRad = directionAngle(DEFAULT_DIRECTION_INDEX);
    this.facingRow = DEFAULT_DIRECTION_INDEX;
    this.step = {
      x,
      y,
      facing: this.facingRow,
      heading: this.headingRad,
      gliding: false
    };
  }

  /**
   * Folds this frame's authoritative position in and answers what to draw.
   *
   * The returned object is reused across calls — read it immediately, do not keep
   * it.
   *
   * @param x authoritative grid position of the unit this frame
   * @param y authoritative grid position of the unit this frame
   * @param now scene-clock time of this frame, in ms
   * @param renderTime clock the world is drawn at — `now - RENDER_DELAY_MS`
   * @param dtSeconds frame duration, which bounds how fast a sprite may turn
   */
  update(
    x: number,
    y: number,
    now: number,
    renderTime: number,
    dtSeconds: number
  ): Readonly<MotionStep> {
    this.segment = advanceMotionSegment(this.segment, x, y, now);
    sampleMotionSegment(this.segment, renderTime, this.step);

    const heading = motionHeading(this.segment);
    // The sprite keeps travelling until its segment has been played out, even if
    // the server already moved on (arrival, harvest, build): `renderTime` is
    // behind `now`, so the segment is still drawing motion that happened.
    const gliding = motionSpeed(this.segment) >= MIN_MOVING_SPEED && renderTime < this.segment.toAt;

    if (gliding && heading !== null) {
      this.headingRad = rotateTowards(this.headingRad, heading, TURN_RATE_RAD_PER_S * dtSeconds);
      this.facingRow = quantizeDirection(this.headingRad, this.facingRow);
    }

    this.step.facing = this.facingRow;
    this.step.heading = this.headingRad;
    this.step.gliding = gliding;
    return this.step;
  }
}

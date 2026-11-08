import { describe, expect, it } from 'vitest';
import { TILE_HEIGHT, TILE_WIDTH } from '@chien-quoc/shared';
import {
  MAX_SNAPSHOT_GAP_MS,
  MIN_MOVING_SPEED,
  RENDER_DELAY_MS,
  SNAPSHOT_INTERVAL_MS,
  TURN_RATE_RAD_PER_S,
  UnitMotion,
  advanceMotionSegment,
  createMotionSegment,
  motionHeading,
  motionSpeed,
  rotateTowards,
  sampleMotionSegment,
  visualActionState,
  walkTimeScale
} from './unitMotion.js';

/** One tick of a villager's walk, in tiles (2.2 tiles/s at 20 Hz). */
const TICK_DISTANCE = 0.11;

describe('sampleMotionSegment', () => {
  const segment = {
    fromX: 10,
    fromY: 10,
    fromAt: 1000,
    toX: 11,
    toY: 10,
    toAt: 1000 + SNAPSHOT_INTERVAL_MS
  };

  it('draws the exact midpoint halfway through the segment', () => {
    const position = sampleMotionSegment(segment, 1000 + SNAPSHOT_INTERVAL_MS / 2);

    expect(position.x).toBeCloseTo(10.5);
    expect(position.y).toBeCloseTo(10);
  });

  it('holds the previous sample until the render clock reaches it', () => {
    // This is the whole point of the render delay: the newest sample exists, but
    // the sprite has not started drawing it yet.
    expect(sampleMotionSegment(segment, 900)).toEqual({ x: 10, y: 10 });
    expect(sampleMotionSegment(segment, 1000)).toEqual({ x: 10, y: 10 });
  });

  it('holds the newest sample instead of extrapolating past it', () => {
    // The last sample before an arrival still carries velocity; overshooting it
    // would slide the unit past its destination and snap it back.
    expect(sampleMotionSegment(segment, 5000)).toEqual({ x: 11, y: 10 });
  });

  it('treats a zero-length segment as a stationary unit', () => {
    const parked = createMotionSegment(4, 7, 500);

    expect(sampleMotionSegment(parked, 250)).toEqual({ x: 4, y: 7 });
    expect(sampleMotionSegment(parked, 900)).toEqual({ x: 4, y: 7 });
  });
});

describe('advanceMotionSegment', () => {
  it('shifts the two samples and keeps the arrival times', () => {
    const first = advanceMotionSegment(createMotionSegment(0, 0, 1000), 0.11, 0, 1050);

    expect(first).toEqual({ fromX: 0, fromY: 0, fromAt: 1000, toX: 0.11, toY: 0, toAt: 1050 });
  });

  it('returns the same segment while the unit has not moved', () => {
    const moving = advanceMotionSegment(createMotionSegment(0, 0, 1000), 0.11, 0, 1050);
    const parked = advanceMotionSegment(moving, 0.11, 0, 1100);

    // Identity, not just equality: `toAt` must keep meaning "when the unit last
    // moved", otherwise a long pause looks like a slow walk.
    expect(parked).toBe(moving);
    expect(parked.toAt).toBe(1050);
  });

  it('clamps a long pause to one tick so the unit does not teleport', () => {
    let segment = createMotionSegment(0, 0, 1000);
    segment = advanceMotionSegment(segment, 0.11, 0, 2000);

    expect(segment.toAt - segment.fromAt).toBe(SNAPSHOT_INTERVAL_MS);
    // At render time the sprite is still one tick behind: at the old position.
    expect(sampleMotionSegment(segment, 2000 - RENDER_DELAY_MS)).toEqual({ x: 0, y: 0 });
  });

  it('clamps a non-monotonic clock instead of inverting the segment', () => {
    const segment = advanceMotionSegment(createMotionSegment(0, 0, 5000), 0.11, 0, 100);

    expect(segment.toAt - segment.fromAt).toBe(SNAPSHOT_INTERVAL_MS);
  });

  it('ignores sub-epsilon jitter in a replicated position', () => {
    const parked = createMotionSegment(3, 3, 1000);

    expect(advanceMotionSegment(parked, 3.0000001, 3, 1050)).toBe(parked);
  });
});

describe('motionSpeed', () => {
  it('recovers the simulated speed from one tick of travel', () => {
    const segment = {
      fromX: 0,
      fromY: 0,
      fromAt: 0,
      toX: TICK_DISTANCE,
      toY: 0,
      toAt: SNAPSHOT_INTERVAL_MS
    };

    expect(motionSpeed(segment)).toBeCloseTo(2.2);
    expect(motionSpeed(segment)).toBeGreaterThan(MIN_MOVING_SPEED);
  });

  it('is zero for a parked unit', () => {
    expect(motionSpeed(createMotionSegment(2, 2, 0))).toBe(0);
  });
});

describe('motionHeading', () => {
  it('projects a grid step into screen space before taking the angle', () => {
    const eastward = {
      fromX: 0,
      fromY: 0,
      fromAt: 0,
      toX: 1,
      toY: 0,
      toAt: SNAPSHOT_INTERVAL_MS
    };

    // One tile along +x is a half-width / half-height step on screen: south-east.
    expect(motionHeading(eastward)).toBeCloseTo(Math.atan2(TILE_HEIGHT / 2, TILE_WIDTH / 2));
  });

  it('has no heading for a segment that did not travel', () => {
    expect(motionHeading(createMotionSegment(2, 2, 0))).toBeNull();
  });
});

describe('rotateTowards', () => {
  it('lands exactly on the target once it is in reach', () => {
    expect(rotateTowards(0, 0.1, 0.5)).toBe(0.1);
  });

  it('takes the short way round across the -pi/pi seam', () => {
    // 350° toward 10° must cross zero, not travel 340° the other way.
    const start = (350 * Math.PI) / 180;
    const target = (10 * Math.PI) / 180;
    const steered = rotateTowards(start, target, (10 * Math.PI) / 180);

    expect(steered).toBeGreaterThan(Math.PI);
    expect((steered * 180) / Math.PI).toBeCloseTo(360, 5);
  });

  it('does not overshoot when the step is smaller than the gap', () => {
    const steered = rotateTowards(0, Math.PI / 2, 0.2);

    expect(steered).toBeCloseTo(0.2);
  });
});

describe('walkTimeScale', () => {
  it('leaves the reference-speed walk cycle alone', () => {
    expect(walkTimeScale(2.2)).toBeCloseTo(1);
  });

  it('speeds the cycle up for faster units and clamps the extreme', () => {
    expect(walkTimeScale(4.0)).toBeCloseTo(4.0 / 2.2);
    expect(walkTimeScale(20)).toBe(2.5);
    expect(walkTimeScale(0.1)).toBe(0.6);
  });

  it('falls back to normal playback for a missing speed', () => {
    expect(walkTimeScale(0)).toBe(1);
    expect(walkTimeScale(Number.NaN)).toBe(1);
  });
});

/** 60 fps, the frame rate the smoothness fix is judged at. */
const FRAME_MS = 1000 / 60;
/** How far the smoothed heading may swing in one frame. */
const TURN_STEP_RAD = TURN_RATE_RAD_PER_S * (FRAME_MS / 1000);

interface DrawnFrame {
  at: number;
  x: number;
  heading: number;
  facing: number;
  gliding: boolean;
}

/**
 * Plays a unit walking along +x at `speed` tiles/second the way the client sees
 * it: position replicated at 20 Hz, sampled on every rendered frame.
 */
function walkFrames(motion: UnitMotion, speed: number, frames: number, from = 0): DrawnFrame[] {
  const drawn: DrawnFrame[] = [];

  for (let frame = 0; frame < frames; frame++) {
    const at = from + frame * FRAME_MS;
    const tick = Math.floor(at / SNAPSHOT_INTERVAL_MS);
    const replicatedX = speed * ((tick * SNAPSHOT_INTERVAL_MS) / 1000);
    const step = motion.update(replicatedX, 0, at, at - RENDER_DELAY_MS, FRAME_MS / 1000);
    drawn.push({ at, ...step });
  }

  return drawn;
}

describe('UnitMotion', () => {
  it('draws the same distance on every frame instead of stepping at 20 Hz', () => {
    // The regression this module exists for: drawing the newest replicated
    // position moves the sprite a whole tick on one frame and nothing the next.
    const drawn = walkFrames(new UnitMotion(0, 0, 0), 2.2, 60);
    // Skip the first frames, where the sprite is still one snapshot behind.
    const positions = drawn.slice(20).map((frame) => frame.x);
    const deltas = positions.slice(1).map((x, index) => x - positions[index]);

    expect(Math.min(...deltas)).toBeGreaterThan(0); // no stalled frame
    expect(Math.max(...deltas) / Math.min(...deltas)).toBeLessThan(1.02);
  });

  it('advances at the simulated speed, one tick behind', () => {
    const drawn = walkFrames(new UnitMotion(0, 0, 0), 2.2, 120);
    const first = drawn[30];
    const last = drawn[100];

    expect((last.x - first.x) / ((last.at - first.at) / 1000)).toBeCloseTo(2.2, 1);
    expect(last.x).toBeLessThan(2.2 * (last.at / 1000)); // lag, never lead
  });

  it('keeps the last facing and stops walking once the unit is parked', () => {
    const motion = new UnitMotion(0, 0, 0);
    const walking = walkFrames(motion, 2.2, 40);
    const before = walking[walking.length - 1];

    // +x on the grid is south-east on screen, so a settled walk shows row 1.
    expect(before.facing).toBe(1);

    // The server keeps reporting the arrival position, as it does for a stopped
    // unit, so no further samples arrive.
    const stillDrawingTheLeg = motion.update(before.x, 0, 700, 700 - RENDER_DELAY_MS, FRAME_MS / 1000);
    expect(stillDrawingTheLeg.gliding).toBe(true);

    const parked = motion.update(before.x, 0, 1400, 1400 - RENDER_DELAY_MS, FRAME_MS / 1000);
    expect(parked.gliding).toBe(false);
    expect(parked.x).toBeCloseTo(before.x);
    expect(parked.facing).toBe(before.facing); // never resets to the default row
  });

  it('swings round at a bounded rate and only then commits a new row', () => {
    const motion = new UnitMotion(0, 0, 0);
    const walking = walkFrames(motion, 2.2, 40);
    const settled = walking[walking.length - 1];

    // Reversal: the unit now walks along -x, a 180° turn on screen.
    const reversing = walkFrames(motion, -2.2, 20, 700);
    const turnInFirstFrame = reversing[0].heading - settled.heading;

    expect(reversing[0].facing).toBe(settled.facing); // not in one frame
    expect(turnInFirstFrame).toBeGreaterThan(0);
    expect(turnInFirstFrame).toBeLessThanOrEqual(TURN_STEP_RAD + 1e-9);
    // West is row 4, once the heading has actually got there.
    expect(reversing[reversing.length - 1].facing).toBe(4);
  });

  it('reuses one step object instead of allocating on every frame', () => {
    const motion = new UnitMotion(0, 0, 0);
    const first = motion.update(1, 0, 100, 100 - RENDER_DELAY_MS, FRAME_MS / 1000);
    const second = motion.update(1.11, 0, 150, 150 - RENDER_DELAY_MS, FRAME_MS / 1000);

    // The scene reads the step straight away; callers must never hold on to it.
    expect(second).toBe(first);
  });

  it('does not teleport after the unit was parked for a long time', () => {
    const motion = new UnitMotion(0, 0, 0);
    const walking = walkFrames(motion, 2.2, 40);
    const parkedAt = walking[walking.length - 1].x;

    // Two seconds parked, then ordered one tick's distance further away.
    motion.update(parkedAt, 0, 2000, 2000 - RENDER_DELAY_MS, FRAME_MS / 1000);
    const resumed = motion.update(
      parkedAt + 0.11,
      0,
      2050,
      2050 - RENDER_DELAY_MS,
      FRAME_MS / 1000
    );

    // Drawing restarts from where the unit stood, not from the middle of the gap.
    expect(resumed.x).toBeCloseTo(parkedAt);
    expect(resumed.gliding).toBe(true);
  });
});

describe('visualActionState', () => {
  it('walks while gliding, whatever order the server has moved on to', () => {
    // A gather order flips the server to HARVESTING before the villager has
    // finished walking, so the walk clip must win until the segment is spent.
    expect(visualActionState('HARVESTING', true)).toBe('MOVING');
    expect(visualActionState('BUILDING', true)).toBe('MOVING');
    expect(visualActionState('ATTACKING', true)).toBe('MOVING');
    expect(visualActionState('RETURNING', true)).toBe('MOVING');
  });

  it('uses the replicated state once the sprite is parked', () => {
    expect(visualActionState('HARVESTING', false)).toBe('HARVESTING');
    expect(visualActionState('BUILDING', false)).toBe('BUILDING');
    expect(visualActionState('IDLE', false)).toBe('IDLE');
  });
});

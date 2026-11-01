import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIRECTION_INDEX,
  DIRECTION_HYSTERESIS_RAD,
  DIRECTION_NAMES,
  DIRECTION_STEP_RAD,
  directionAngle,
  directionIndex,
  directionIndexFromAngle,
  quantizeDirection,
  shortestAngleDelta
} from './unitDirections.js';

const deg = (degrees: number) => (degrees * Math.PI) / 180;

/** Boundary between two rows plus the hold margin: the first angle that flips. */
const FLIP_ANGLE = DIRECTION_STEP_RAD / 2 + DIRECTION_HYSTERESIS_RAD;

describe('directionIndex', () => {
  it('keeps the compass-from-east row order the sheets are stored in', () => {
    expect(DIRECTION_NAMES[0]).toBe('E');
    expect(directionIndex(1, 0)).toBe(0);
    expect(directionIndex(1, 1)).toBe(1);
    expect(directionIndex(0, 1)).toBe(2);
    expect(directionIndex(-1, 0)).toBe(4);
    expect(directionIndex(0, -1)).toBe(6);
  });

  it('falls back to the default facing for a non-moving delta', () => {
    expect(directionIndex(0, 0)).toBe(DEFAULT_DIRECTION_INDEX);
  });
});

describe('directionIndexFromAngle', () => {
  it('round-trips every row centre', () => {
    for (let index = 0; index < DIRECTION_NAMES.length; index++) {
      expect(directionIndexFromAngle(directionAngle(index))).toBe(index);
    }
  });

  it('wraps negative headings into the 0..7 range', () => {
    expect(directionIndexFromAngle(deg(-90))).toBe(6);
    expect(directionIndexFromAngle(deg(-1))).toBe(0);
    expect(directionIndexFromAngle(deg(360))).toBe(0);
  });
});

describe('quantizeDirection', () => {
  it('holds the current row just past the boundary', () => {
    // 25° is inside the next 45° sector but not clear of the hold band, so a
    // heading jittering around the boundary cannot flicker between two rows.
    expect(quantizeDirection(deg(25), 0)).toBe(0);
    expect(quantizeDirection(deg(-25), 0)).toBe(0);
  });

  it('switches once the heading is decisively in the next sector', () => {
    expect(quantizeDirection(FLIP_ANGLE + 0.001, 0)).toBe(1);
    expect(quantizeDirection(-FLIP_ANGLE - 0.001, 0)).toBe(7);
  });

  it('never moves more than one row for a heading inside one sector', () => {
    const heading = deg(40);

    expect(quantizeDirection(heading, 0)).toBe(1);
    // A stale row two sectors away corrects itself immediately, since the hold
    // band is measured from the current row's centre.
    expect(quantizeDirection(heading, 4)).toBe(1);
  });
});

describe('shortestAngleDelta', () => {
  it('crosses the seam instead of walking the long way round', () => {
    expect(shortestAngleDelta(deg(350), deg(10))).toBeCloseTo(deg(20));
    expect(shortestAngleDelta(deg(10), deg(350))).toBeCloseTo(deg(-20));
  });

  it('is zero for identical angles', () => {
    expect(shortestAngleDelta(1.25, 1.25)).toBe(0);
  });
});

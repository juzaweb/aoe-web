import { describe, expect, it } from 'vitest';
import { TILE_HEIGHT, TILE_WIDTH } from '@chien-quoc/shared';
import {
  ARROW_ARC_PX,
  ARROW_MAX_TRAVEL_MS,
  ARROW_MIN_TRAVEL_MS,
  ARROW_MS_PER_TILE,
  arrowAngle,
  arrowPositionAt,
  flightDurationMs,
  gridToScreenPoint
} from './arrowFlight.js';

describe('gridToScreenPoint (FX-01)', () => {
  it('projects a grid position the same way the entity renderer does', () => {
    const point = gridToScreenPoint(3, 2);
    expect(point.x).toBe((3 - 2) * (TILE_WIDTH / 2));
    expect(point.y).toBe((3 + 2) * (TILE_HEIGHT / 2));
  });

  it('puts the map origin at the screen origin', () => {
    expect(gridToScreenPoint(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('writes into the scratch point it is handed', () => {
    const scratch = { x: 0, y: 0 };
    const result = gridToScreenPoint(1, 1, scratch);
    expect(result).toBe(scratch);
    expect(scratch).toEqual({ x: 0, y: TILE_HEIGHT });
  });
});

describe('flightDurationMs (FX-01)', () => {
  it('scales with the ground distance above the floor', () => {
    expect(flightDurationMs(4)).toBe(4 * ARROW_MS_PER_TILE);
  });

  it('never drops below the floor, so a point-blank shot still shows an arrow', () => {
    expect(flightDurationMs(0)).toBe(ARROW_MIN_TRAVEL_MS);
    expect(flightDurationMs(0.5)).toBe(ARROW_MIN_TRAVEL_MS);
  });

  it('caps a long shot so a stray arrow does not hang in the air', () => {
    expect(flightDurationMs(40)).toBe(ARROW_MAX_TRAVEL_MS);
  });
});

describe('arrowPositionAt (FX-01)', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 40 };

  it('starts exactly at the shooter', () => {
    expect(arrowPositionAt(from, to, 0)).toEqual({ x: 0, y: 0 });
  });

  it('lands exactly on the target', () => {
    const landed = arrowPositionAt(from, to, 1);
    expect(landed.x).toBe(100);
    // `sin(PI)` is not exactly 0 in floating point, so the landing height is
    // compared with a tolerance instead of for bit equality.
    expect(landed.y).toBeCloseTo(40);
  });

  it('arcs above the straight line at the midpoint', () => {
    const midpoint = arrowPositionAt(from, to, 0.5);
    expect(midpoint.x).toBe(50);
    // Straight-line y at the midpoint is 20; the arc lifts the arrow above it.
    expect(midpoint.y).toBe(20 - ARROW_ARC_PX);
  });

  it('keeps the horizontal component linear, so the arrow lands on the target', () => {
    expect(arrowPositionAt(from, to, 0.25).x).toBe(25);
    expect(arrowPositionAt(from, to, 0.75).x).toBe(75);
  });

  it('clamps out-of-range progress instead of overshooting', () => {
    expect(arrowPositionAt(from, to, -1)).toEqual({ x: 0, y: 0 });
    const overshot = arrowPositionAt(from, to, 2);
    expect(overshot.x).toBe(100);
    expect(overshot.y).toBeCloseTo(40);
  });

  it('flies flat when the arc is zero, as reduced motion asks', () => {
    expect(arrowPositionAt(from, to, 0.5, 0)).toEqual({ x: 50, y: 20 });
  });
});

describe('arrowAngle (FX-01)', () => {
  it('points along the step the arrow just took', () => {
    expect(arrowAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(arrowAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
    expect(arrowAngle({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(Math.PI);
  });
});

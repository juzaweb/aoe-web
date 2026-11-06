import { describe, expect, it } from 'vitest';
import {
  HEX_SIZE,
  assignHexTiles,
  hexPolygonPoints,
  hexRound,
  hexToPixel,
  levelDeltaColor,
  pixelToHex,
  worldMapBounds
} from './worldMapArt.js';

describe('hex geometry', () => {
  it('round-trips a hex through its pixel centre', () => {
    for (const hex of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -5, r: 5 },
      { q: 12, r: -12 }
    ]) {
      expect(pixelToHex(hexToPixel(hex))).toEqual(hex);
    }
  });

  it('round-trips a point near a hex centre', () => {
    const centre = hexToPixel({ q: 2, r: -1 });
    expect(pixelToHex({ x: centre.x + 3, y: centre.y - 2 })).toEqual({ q: 2, r: -1 });
  });

  it('rounds fractional cube coordinates to a whole hex', () => {
    expect(hexRound(0.1, 0.1)).toEqual({ q: 0, r: 0 });
    expect(hexRound(1.4, -0.4)).toEqual({ q: 1, r: 0 });
  });

  it('draws six corners around the centre', () => {
    const points = hexPolygonPoints({ q: 0, r: 0 }).split(' ');
    expect(points).toHaveLength(6);
    // First corner sits at 60 * 0 - 30 degrees, i.e. above-right of the centre.
    const [x, y] = points[0].split(',').map(Number);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeLessThan(0);
  });

  it('produces a bounded viewBox that contains the centre tile', () => {
    const bounds = worldMapBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(bounds.width * 0.7);
  });

  it('keeps hex size configurable', () => {
    expect(hexToPixel({ q: 1, r: 0 }, HEX_SIZE * 2).x).toBeCloseTo(hexToPixel({ q: 1, r: 0 }).x * 2);
  });
});

describe('level colour', () => {
  it('marks a blocked target grey regardless of level', () => {
    expect(levelDeltaColor(-3, false)).toBe('#475569');
    expect(levelDeltaColor(3, false)).toBe('#475569');
  });

  it('greens weaker targets, reds stronger ones and yellows equals', () => {
    expect(levelDeltaColor(-1, true)).toBe('#22c55e');
    expect(levelDeltaColor(1, true)).toBe('#ef4444');
    expect(levelDeltaColor(0, true)).toBe('#eab308');
  });
});

describe('assignHexTiles', () => {
  it('gives every account a tile', () => {
    const tiles = assignHexTiles(['a', 'b', 'c', 'd']);
    expect(tiles.size).toBe(4);
  });

  it('never stacks two accounts on one tile', () => {
    const ids = Array.from({ length: 60 }, (_, index) => `user-${index}`);
    const tiles = assignHexTiles(ids);
    const keys = new Set(Array.from(tiles.values()).map((tile) => `${tile.q},${tile.r}`));
    expect(keys.size).toBe(ids.length);
  });

  it('is stable for the same input', () => {
    const first = assignHexTiles(['a', 'b']);
    const second = assignHexTiles(['a', 'b']);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
  });
});

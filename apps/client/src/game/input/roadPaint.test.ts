import { describe, expect, it } from 'vitest';
import { batchTiles, lineTiles } from './roadPaint.js';

describe('lineTiles', () => {
  it('includes both endpoints of a horizontal run', () => {
    const tiles = lineTiles({ x: 3, y: 5 }, { x: 7, y: 5 });
    expect(tiles[0]).toEqual({ x: 3, y: 5 });
    expect(tiles[tiles.length - 1]).toEqual({ x: 7, y: 5 });
    expect(tiles).toHaveLength(5);
  });

  it('fills a diagonal without gaps', () => {
    const tiles = lineTiles({ x: 0, y: 0 }, { x: 4, y: 4 });
    expect(tiles).toHaveLength(5);
    for (let i = 1; i < tiles.length; i++) {
      const step = Math.abs(tiles[i].x - tiles[i - 1].x) + Math.abs(tiles[i].y - tiles[i - 1].y);
      expect(step).toBeLessThanOrEqual(2);
    }
  });

  it('returns a single tile for a zero-length run', () => {
    expect(lineTiles({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it('ignores non-finite input instead of looping forever', () => {
    expect(lineTiles({ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 0, y: 0 })).toEqual([]);
    expect(lineTiles({ x: Number.NaN, y: 0 }, { x: 3, y: 0 })).toEqual([]);
  });
});

describe('batchTiles', () => {
  it('splits into messages of at most the cap', () => {
    const tiles = Array.from({ length: 7 }, (_, i) => ({ x: i, y: 0 }));
    const batches = batchTiles(tiles, 3);
    expect(batches.map((b) => b.length)).toEqual([3, 3, 1]);
  });

  it('returns nothing for a non-positive cap', () => {
    expect(batchTiles([{ x: 0, y: 0 }], 0)).toEqual([]);
  });
});

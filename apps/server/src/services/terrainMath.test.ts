import { describe, expect, it } from 'vitest';
import { isDirtRoadTile, MAP_GRID_HEIGHT, MAP_GRID_WIDTH } from '@chien-quoc/shared';

describe('isDirtRoadTile performance and correctness', () => {
  it('returns false for out of bounds coordinates', () => {
    expect(isDirtRoadTile(-1, 0)).toBe(false);
    expect(isDirtRoadTile(0, -1)).toBe(false);
    expect(isDirtRoadTile(MAP_GRID_WIDTH, 10)).toBe(false);
    expect(isDirtRoadTile(10, MAP_GRID_HEIGHT)).toBe(false);
  });

  it('correctly detects road at central crossroads hub (110, 110)', () => {
    expect(isDirtRoadTile(110, 110)).toBe(true);
    expect(isDirtRoadTile(111, 110)).toBe(true);
    expect(isDirtRoadTile(110, 111)).toBe(true);
  });

  it('correctly returns false for wilderness grass coordinates far from roads', () => {
    expect(isDirtRoadTile(10, 10)).toBe(false);
    expect(isDirtRoadTile(10, 50)).toBe(false);
    expect(isDirtRoadTile(50, 10)).toBe(false);
  });

  it('maintains expected road tile density and O(1) performance', () => {
    let roadCount = 0;
    const start = performance.now();
    for (let gy = 0; gy < MAP_GRID_HEIGHT; gy++) {
      for (let gx = 0; gx < MAP_GRID_WIDTH; gx++) {
        if (isDirtRoadTile(gx, gy)) {
          roadCount++;
        }
      }
    }
    const elapsed = performance.now() - start;

    // Road count across the 220x220 map
    expect(roadCount).toBe(2205);
    // 48,400 lookups should finish in under 50ms using the precomputed table
    expect(elapsed).toBeLessThan(50);
  });
});

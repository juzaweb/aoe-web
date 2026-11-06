import { describe, expect, it } from 'vitest';
import {
  KINGDOM_MAP_SIZE,
  MAP_GRID_HEIGHT,
  MAP_GRID_WIDTH,
  TERRAIN_BATTLEFIELD,
  TERRAIN_KINGDOM,
  isDirtRoadTile,
  isPlazaTile
} from '@chien-quoc/shared';

/** Centre tile of the kingdom map, which is where the Town Center is placed. */
const KINGDOM_CENTRE = Math.floor(KINGDOM_MAP_SIZE.width / 2);
/** Top-left corner of the 4x4 Town Center centred on that tile. */
const TOWN_CENTER_ORIGIN = KINGDOM_CENTRE - 2;

describe('isDirtRoadTile performance and correctness', () => {
  it('returns false for out of bounds coordinates', () => {
    expect(isDirtRoadTile(-1, 0, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isDirtRoadTile(0, -1, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isDirtRoadTile(MAP_GRID_WIDTH, 10, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isDirtRoadTile(10, MAP_GRID_HEIGHT, TERRAIN_BATTLEFIELD)).toBe(false);
  });

  it('correctly detects road at central crossroads hub (110, 110)', () => {
    expect(isDirtRoadTile(110, 110, TERRAIN_BATTLEFIELD)).toBe(true);
    expect(isDirtRoadTile(111, 110, TERRAIN_BATTLEFIELD)).toBe(true);
    expect(isDirtRoadTile(110, 111, TERRAIN_BATTLEFIELD)).toBe(true);
  });

  it('correctly returns false for wilderness grass coordinates far from roads', () => {
    expect(isDirtRoadTile(10, 10, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isDirtRoadTile(10, 50, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isDirtRoadTile(50, 10, TERRAIN_BATTLEFIELD)).toBe(false);
  });

  it('maintains expected road tile density and O(1) performance', () => {
    // Warm the lookup table so the one-time trig precompute is not counted.
    isDirtRoadTile(0, 0, TERRAIN_BATTLEFIELD);

    let roadCount = 0;
    const start = performance.now();
    for (let gy = 0; gy < MAP_GRID_HEIGHT; gy++) {
      for (let gx = 0; gx < MAP_GRID_WIDTH; gx++) {
        if (isDirtRoadTile(gx, gy, TERRAIN_BATTLEFIELD)) {
          roadCount++;
        }
      }
    }
    const elapsed = performance.now() - start;

    // Road count across the 220x220 battlefield
    expect(roadCount).toBe(2205);
    // 48,400 cached lookups are normally a few ms. The bound is deliberately
    // generous: a loaded dev machine can stretch the same work into ~100ms,
    // while a per-call trig recomputation would take seconds.
    expect(elapsed).toBeLessThan(250);
  });
});

describe('kingdom terrain layout', () => {
  it('starts with no roads at all', () => {
    let roadCount = 0;
    for (let gy = 0; gy < TERRAIN_KINGDOM.height; gy++) {
      for (let gx = 0; gx < TERRAIN_KINGDOM.width; gx++) {
        if (isDirtRoadTile(gx, gy, TERRAIN_KINGDOM)) roadCount++;
      }
    }
    expect(roadCount).toBe(0);
  });

  it('still keeps the plaza marker for spawn and resource placement', () => {
    // Town Center is 4x4 at the centre: (53,53)..(56,56) on a 110x110 map.
    expect(isPlazaTile(KINGDOM_CENTRE, KINGDOM_CENTRE, TERRAIN_KINGDOM)).toBe(true);
    expect(isDirtRoadTile(TOWN_CENTER_ORIGIN, TOWN_CENTER_ORIGIN, TERRAIN_KINGDOM)).toBe(false);
  });

  it('never reports a battlefield road inside the kingdom bounds', () => {
    // The east-west highway at y ~= 110 and the crossing axis do not exist here.
    expect(isDirtRoadTile(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height, TERRAIN_KINGDOM)).toBe(false);
    expect(isDirtRoadTile(KINGDOM_MAP_SIZE.width, 10, TERRAIN_KINGDOM)).toBe(false);
    expect(isDirtRoadTile(KINGDOM_CENTRE, KINGDOM_MAP_SIZE.height / 2, TERRAIN_KINGDOM)).toBe(false);
  });
});

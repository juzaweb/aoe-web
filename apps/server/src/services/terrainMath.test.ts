import { describe, expect, it } from 'vitest';
import {
  KINGDOM_MAP_SIZE,
  KINGDOM_PLAZA_RADIUS,
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
  it('keeps the map centre free of roads so the Town Center fits', () => {
    // Town Center is 4x4 at the centre: (53,53)..(56,56) on a 110x110 map.
    for (let gx = TOWN_CENTER_ORIGIN; gx < TOWN_CENTER_ORIGIN + 4; gx++) {
      for (let gy = TOWN_CENTER_ORIGIN; gy < TOWN_CENTER_ORIGIN + 4; gy++) {
        expect(isDirtRoadTile(gx, gy, TERRAIN_KINGDOM)).toBe(false);
      }
    }
    expect(isPlazaTile(KINGDOM_CENTRE, KINGDOM_CENTRE, TERRAIN_KINGDOM)).toBe(true);
  });

  it('routes both diagonals through the map', () => {
    // NW-SE: gy = gx + 3*sin(gx*0.09); NE-SW: gy = height-1-gx + 3*sin(gx*0.07).
    expect(isDirtRoadTile(20, 23, TERRAIN_KINGDOM)).toBe(true);
    expect(isDirtRoadTile(20, 92, TERRAIN_KINGDOM)).toBe(true);
  });

  it('cuts the diagonals into four arms around the plaza', () => {
    let roadCount = 0;
    for (let gy = 0; gy < TERRAIN_KINGDOM.height; gy++) {
      for (let gx = 0; gx < TERRAIN_KINGDOM.width; gx++) {
        if (isDirtRoadTile(gx, gy, TERRAIN_KINGDOM)) roadCount++;
        if (Math.hypot(gx - KINGDOM_CENTRE, gy - KINGDOM_CENTRE) <= KINGDOM_PLAZA_RADIUS) {
          expect(isDirtRoadTile(gx, gy, TERRAIN_KINGDOM)).toBe(false);
        }
      }
    }
    // Two diagonals across a 110x110 map, minus the plaza: a few hundred tiles.
    expect(roadCount).toBeGreaterThan(200);
    expect(roadCount).toBeLessThan(900);
  });

  it('ignores the battlefield roads and the battlefield bounds', () => {
    // The old east-west highway at y ~= 110 does not exist here, and the map is
    // no longer the battlefield's 220x220.
    expect(isDirtRoadTile(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height, TERRAIN_KINGDOM)).toBe(false);
    expect(isDirtRoadTile(KINGDOM_MAP_SIZE.width, 10, TERRAIN_KINGDOM)).toBe(false);
  });
});

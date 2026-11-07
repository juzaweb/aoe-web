import { describe, expect, it } from 'vitest';
import { TERRAIN_BATTLEFIELD, TERRAIN_KINGDOM } from '@chien-quoc/shared';
import {
  MAP_APRON_TILES,
  borderDecorAt,
  canopyDecor,
  decorAt,
  tileKey
} from './decorScatter.js';

/**
 * The scatter is a pure function of the tile, so these tests pin the three
 * properties the renderer relies on: determinism (no flicker between frames or
 * clients), exclusion (never on a blocked resource, building or road tile) and a
 * density low enough that the map still reads as terrain, not as a flower bed.
 */
const terrain = TERRAIN_BATTLEFIELD;
const EMPTY: ReadonlySet<string> = new Set<string>();

function sweep(size: number, blocked: ReadonlySet<string> = EMPTY) {
  let forbs = 0;
  let flowers = 0;
  let rocks = 0;
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      const choice = decorAt(gx, gy, terrain, blocked);
      if (!choice) continue;
      if (choice.category === 'rock') rocks++;
      else if (choice.category === 'forb') {
        forbs++;
        if ([1, 4, 12].includes(choice.variant)) flowers++;
      }
    }
  }
  return { forbs, flowers, rocks, total: size * size };
}

describe('decorAt', () => {
  it('is deterministic', () => {
    for (let gx = 0; gx < 20; gx++) {
      for (let gy = 0; gy < 20; gy++) {
        expect(decorAt(gx, gy, terrain, EMPTY)).toEqual(decorAt(gx, gy, terrain, EMPTY));
      }
    }
  });

  it('never grows on a blocked tile', () => {
    const blocked = new Set<string>();
    for (let gx = 0; gx < 30; gx++) blocked.add(tileKey(gx, 12));
    for (let gx = 0; gx < 30; gx++) {
      expect(decorAt(gx, 12, terrain, blocked)).toBeNull();
    }
  });

  it('stays inside the playable map', () => {
    expect(decorAt(-1, 5, terrain, EMPTY)).toBeNull();
    expect(decorAt(5, -1, terrain, EMPTY)).toBeNull();
    expect(decorAt(terrain.width, 5, terrain, EMPTY)).toBeNull();
    expect(decorAt(5, terrain.height, terrain, EMPTY)).toBeNull();
  });

  it('covers a few percent of the map, split into patches', () => {
    const stats = sweep(160);
    const forbRate = stats.forbs / stats.total;
    const rockRate = stats.rocks / stats.total;
    expect(forbRate).toBeGreaterThan(0.02);
    expect(forbRate).toBeLessThan(0.12);
    expect(rockRate).toBeGreaterThan(0.004);
    expect(rockRate).toBeLessThan(0.02);
    expect(stats.flowers).toBeGreaterThan(0);
    expect(stats.flowers).toBeLessThan(stats.forbs);
  });

  it('picks only variants that exist as textures', () => {
    const seen = new Set<string>();
    for (let gx = 0; gx < 120; gx++) {
      for (let gy = 0; gy < 120; gy++) {
        const choice = decorAt(gx, gy, terrain, EMPTY);
        if (!choice) continue;
        seen.add(choice.category);
        if (choice.category === 'forb') {
          expect(choice.variant).toBeGreaterThanOrEqual(1);
          expect(choice.variant).toBeLessThanOrEqual(12);
        }
        if (choice.category === 'rock') {
          expect(choice.variant).toBeGreaterThanOrEqual(1);
          expect(choice.variant).toBeLessThanOrEqual(6);
        }
      }
    }
    expect(seen.has('forb')).toBe(true);
    expect(seen.has('rock')).toBe(true);
  });
});

describe('borderDecorAt', () => {
  it('only returns trees outside the map', () => {
    for (let gx = -MAP_APRON_TILES - 2; gx < terrain.width + MAP_APRON_TILES + 2; gx += 3) {
      for (let gy = -MAP_APRON_TILES - 2; gy < terrain.height + MAP_APRON_TILES + 2; gy += 3) {
        const inside = gx >= 0 && gy >= 0 && gx < terrain.width && gy < terrain.height;
        const choice = borderDecorAt(gx, gy, terrain);
        if (inside) expect(choice).toBeNull();
        if (choice) expect(choice.category).toBe('border-tree');
      }
    }
  });

  it('thins out with distance from the edge', () => {
    const counts = [0, 0, 0, 0];
    const totals = [0, 0, 0, 0];
    for (let gx = -MAP_APRON_TILES; gx < 0; gx++) {
      for (let gy = 0; gy < terrain.height; gy++) {
        const ring = -gx;
        totals[ring - 1]++;
        if (borderDecorAt(gx, gy, terrain)) counts[ring - 1]++;
      }
    }
    for (let ring = 0; ring < 4; ring++) {
      const rate = counts[ring] / Math.max(1, totals[ring]);
      expect(rate).toBeLessThan(0.3);
    }
    expect(counts[0]).toBeGreaterThan(counts[2]);
    expect(counts[3]).toBeLessThanOrEqual(counts[2]);
  });

  it('is deterministic', () => {
    expect(borderDecorAt(-2, 40, terrain)).toEqual(borderDecorAt(-2, 40, terrain));
  });
});

describe('canopyDecor', () => {
  it('returns one or two tufts around a tree', () => {
    for (let i = 0; i < 50; i++) {
      const decor = canopyDecor(`tree-${i}`, i, i * 2);
      expect(decor.length).toBeGreaterThanOrEqual(1);
      expect(decor.length).toBeLessThanOrEqual(2);
      for (const choice of decor) {
        expect(choice.category).toBe('forb');
        expect(choice.variant).toBeGreaterThanOrEqual(1);
        expect(choice.variant).toBeLessThanOrEqual(12);
      }
    }
  });

  it('is stable per tree', () => {
    expect(canopyDecor('abc', 4, 9)).toEqual(canopyDecor('abc', 4, 9));
  });

  it('works on the kingdom layout too', () => {
    const choice = decorAt(10, 10, TERRAIN_KINGDOM, EMPTY);
    if (choice) expect(choice.category === 'forb' || choice.category === 'rock').toBe(true);
  });
});

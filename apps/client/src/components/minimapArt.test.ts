import { describe, expect, it } from 'vitest';
import { TERRAIN_BATTLEFIELD, TERRAIN_KINGDOM, isDirtRoadTile } from '@chien-quoc/shared';
import {
  MINIMAP_COLORS,
  MINIMAP_SIZE,
  buildGroundPixels,
  gridToMinimap,
  markerColor,
  minimapClusters,
  minimapToGrid
} from './minimapArt.js';

/**
 * The minimap used to draw a dark-green forest on a dark-green background
 * (1.66:1) and a squashed PNG per node; these tests pin the replacement: a
 * raster from the real tiles, a scale that survives both map sizes, and
 * clustering that turns 892 trees into ~77 readable shapes.
 */
describe('ground raster', () => {
  it('is a full-size RGBA buffer, fully opaque', () => {
    const pixels = buildGroundPixels(TERRAIN_KINGDOM);
    expect(pixels.length).toBe(MINIMAP_SIZE * MINIMAP_SIZE * 4);
    for (let i = 3; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(255);
    }
  });

  it('is deterministic', () => {
    expect(Array.from(buildGroundPixels(TERRAIN_KINGDOM))).toEqual(
      Array.from(buildGroundPixels(TERRAIN_KINGDOM))
    );
  });

  it('paints road tiles differently from grass', () => {
    const pixels = buildGroundPixels(TERRAIN_KINGDOM);
    const scale = TERRAIN_KINGDOM.width / MINIMAP_SIZE;
    let checked = 0;
    for (let py = 0; py < MINIMAP_SIZE && checked < 5; py += 3) {
      for (let px = 0; px < MINIMAP_SIZE && checked < 5; px += 3) {
        const gx = Math.min(TERRAIN_KINGDOM.width - 1, Math.floor(px * scale));
        const gy = Math.min(TERRAIN_KINGDOM.height - 1, Math.floor(py * scale));
        if (!isDirtRoadTile(gx, gy, TERRAIN_KINGDOM)) continue;
        const index = (py * MINIMAP_SIZE + px) * 4;
        expect([pixels[index], pixels[index + 1], pixels[index + 2]]).toEqual([
          MINIMAP_COLORS.road[0],
          MINIMAP_COLORS.road[1],
          MINIMAP_COLORS.road[2]
        ]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('handles both map sizes', () => {
    expect(buildGroundPixels(TERRAIN_BATTLEFIELD).length).toBe(MINIMAP_SIZE * MINIMAP_SIZE * 4);
  });
});

describe('coordinate mapping', () => {
  it('scales a 220 map to 280 pixels', () => {
    expect(gridToMinimap(0, 0, 220)).toEqual({ x: 0, y: 0 });
    expect(gridToMinimap(110, 110, 220)).toEqual({ x: 140, y: 140 });
    expect(gridToMinimap(220, 220, 220)).toEqual({ x: 280, y: 280 });
  });

  it('scales a 110 map to the same canvas', () => {
    expect(gridToMinimap(55, 55, 110)).toEqual({ x: 140, y: 140 });
    expect(gridToMinimap(110, 0, 110)).toEqual({ x: 280, y: 0 });
  });

  it('round-trips through minimapToGrid', () => {
    for (const width of [110, 220]) {
      const point = gridToMinimap(37, 61, width);
      const grid = minimapToGrid(point.x, point.y, width);
      expect(grid.gx).toBeCloseTo(37, 5);
      expect(grid.gy).toBeCloseTo(61, 5);
    }
  });
});

describe('minimapClusters', () => {
  it('merges adjacent trees into one cluster', () => {
    const clusters = minimapClusters([
      { gridX: 10, gridY: 10 },
      { gridX: 11, gridY: 10 },
      { gridX: 10, gridY: 11 },
      { gridX: 11, gridY: 11 }
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ minX: 10, minY: 10, maxX: 11, maxY: 11, count: 4 });
  });

  it('keeps distant groups apart', () => {
    const clusters = minimapClusters([
      { gridX: 10, gridY: 10 },
      { gridX: 30, gridY: 30 }
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.count)).toEqual([1, 1]);
  });

  it('bridges a one-tile gap at radius 2', () => {
    const clusters = minimapClusters([
      { gridX: 10, gridY: 10 },
      { gridX: 12, gridY: 10 }
    ]);
    expect(clusters).toHaveLength(1);
  });

  it('is deterministic and handles an empty map', () => {
    expect(minimapClusters([])).toEqual([]);
    const trees = [
      { gridX: 5, gridY: 5 },
      { gridX: 6, gridY: 5 }
    ];
    expect(minimapClusters(trees)).toEqual(minimapClusters(trees));
  });

  it('accounts for every tree exactly once', () => {
    const trees = Array.from({ length: 40 }, (_, i) => ({
      gridX: (i % 8) * 5,
      gridY: Math.floor(i / 8) * 5
    }));
    const clusters = minimapClusters(trees);
    const total = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
    expect(total).toBe(trees.length);
  });
});

describe('markerColor', () => {
  it('maps each resource to its palette entry', () => {
    expect(markerColor('GOLD_MINE')).toBe(MINIMAP_COLORS.gold);
    expect(markerColor('STONE_MINE')).toBe(MINIMAP_COLORS.stone);
    expect(markerColor('BERRY_BUSH')).toBe(MINIMAP_COLORS.berry);
    expect(markerColor('TREE')).toBe(MINIMAP_COLORS.forest);
  });
});

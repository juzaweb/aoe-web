import { describe, expect, it } from 'vitest';
import { TERRAIN_BATTLEFIELD, TERRAIN_KINGDOM } from '@chien-quoc/shared';
import {
  MINIMAP_COLORS,
  MINIMAP_SIZE,
  buildGroundPixels,
  citadelGlyphRects,
  gridToMinimap,
  markerColor,
  minimapClusters,
  minimapToGrid,
  paintCitadelGlyph,
  pointerToGrid,
  portalGlyphRects
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
    // One assertion over the whole alpha channel: 78k `expect` calls made this
    // test the slowest in the suite for no extra signal.
    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 255) transparent++;
    }
    expect(transparent).toBe(0);
  });

  it('is deterministic', () => {
    const a = buildGroundPixels(TERRAIN_KINGDOM);
    const b = buildGroundPixels(TERRAIN_KINGDOM);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 997) expect(a[i]).toBe(b[i]);
  });

  it('paints player-built road tiles differently from grass', () => {
    // A kingdom has no generated roads any more: the only road pixels on its
    // ground raster are the tiles the player painted.
    const roads = [] as Array<{ gridX: number; gridY: number }>;
    for (let i = 20; i < 40; i++) roads.push({ gridX: i, gridY: 30 });
    const pixels = buildGroundPixels(TERRAIN_KINGDOM, roads);
    const scale = TERRAIN_KINGDOM.width / MINIMAP_SIZE;
    let checked = 0;
    for (let py = 0; py < MINIMAP_SIZE && checked < 5; py += 3) {
      for (let px = 0; px < MINIMAP_SIZE && checked < 5; px += 3) {
        const gx = Math.min(TERRAIN_KINGDOM.width - 1, Math.floor(px * scale));
        const gy = Math.min(TERRAIN_KINGDOM.height - 1, Math.floor(py * scale));
        if (gx < 20 || gx >= 40 || gy !== 30) continue;
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

  it('leaves the kingdom raster free of roads when none are painted', () => {
    const pixels = buildGroundPixels(TERRAIN_KINGDOM);
    // One assertion over a count instead of one `expect` per pixel: the raster is
    // 200x200, so the old shape ran 160 000 matcher calls and took ~0.6 s on its
    // own — enough to blow the 5 s test timeout when the whole suite runs its 58
    // workers in parallel. Same guarantee, none of the load sensitivity.
    let roadPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        pixels[i] === MINIMAP_COLORS.road[0] &&
        pixels[i + 1] === MINIMAP_COLORS.road[1] &&
        pixels[i + 2] === MINIMAP_COLORS.road[2]
      ) {
        roadPixels += 1;
      }
    }
    expect(roadPixels).toBe(0);
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

describe('citadelGlyphRects', () => {
  // A 26-tile citadel on the 110-tile kingdom map: 26 * (280 / 110) = 66.2 px.
  const box = { x: 100, y: 80, w: 66, h: 66 };

  it('draws five wall segments and six towers', () => {
    const glyph = citadelGlyphRects(box);
    expect(glyph.walls).toHaveLength(5);
    expect(glyph.towers).toHaveLength(6);
  });

  it('keeps every wall and tower inside the footprint plus one tower overhang', () => {
    const glyph = citadelGlyphRects(box);
    for (const rect of [...glyph.walls, ...glyph.towers]) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(box.x - 4);
      expect(rect.y).toBeGreaterThanOrEqual(box.y - 4);
      expect(rect.x + rect.w).toBeLessThanOrEqual(box.x + box.w + 4);
      expect(rect.y + rect.h).toBeLessThanOrEqual(box.y + box.h + 4);
    }
  });

  it('leaves the courtyard open: no wall rect covers the centre', () => {
    const glyph = citadelGlyphRects(box);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    for (const rect of glyph.walls) {
      const inside =
        cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
      expect(inside).toBe(false);
    }
  });

  it('opens the east wall for the gate and centres that opening vertically', () => {
    const glyph = citadelGlyphRects(box);
    const [north, south, west, eastNorth, eastSouth] = glyph.walls;
    expect(west.x).toBe(box.x);
    expect(eastNorth.x + eastNorth.w).toBeCloseTo(box.x + box.w, 5);
    expect(eastSouth.x).toBeCloseTo(eastNorth.x, 5);
    // The gap between the two east segments is the doorway.
    const gap = eastSouth.y - (eastNorth.y + eastNorth.h);
    expect(gap).toBeGreaterThan(0);
    // Centred: the doorway is the same distance from the top and bottom corners.
    const gateMiddle = eastNorth.y + eastNorth.h + gap / 2;
    expect(gateMiddle).toBeCloseTo(box.y + box.h / 2, 5);
    // The north and south walls still cap the ring at the footprint edges.
    expect(north.y).toBe(box.y);
    expect(south.y).toBe(box.y + box.h - south.h);
  });

  it('takes the gate width from the world layout (3 of 26 tiles)', () => {
    const [, , , eastNorth, eastSouth] = citadelGlyphRects(box).walls;
    const gap = eastSouth.y - (eastNorth.y + eastNorth.h);
    // 3/26 of a 66 px wall is ~7.6 px: the doorway is a real opening, not a hairline.
    expect(gap).toBeGreaterThan(box.h * 0.08);
    expect(gap).toBeLessThan(box.h * 0.2);
  });

  it('makes the corner keeps read larger than the wall band', () => {
    const glyph = citadelGlyphRects(box);
    const wall = glyph.walls[0].h;
    for (const tower of glyph.towers) {
      expect(tower.w).toBeGreaterThan(wall);
      expect(tower.h).toBeGreaterThan(wall);
    }
  });

  it('stays a ring on a zoomed-out compound', () => {
    const glyph = citadelGlyphRects({ x: 0, y: 0, w: 33, h: 33 });
    for (const rect of [...glyph.walls, ...glyph.towers]) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
    const [, , , eastNorth, eastSouth] = glyph.walls;
    expect(eastSouth.y).toBeGreaterThan(eastNorth.y + eastNorth.h);
  });

  it('never inverts on a degenerate footprint', () => {
    const glyph = citadelGlyphRects({ x: 0, y: 0, w: 4, h: 4 });
    for (const rect of [...glyph.walls, ...glyph.towers]) {
      expect(rect.w).toBeGreaterThanOrEqual(0);
      expect(rect.h).toBeGreaterThanOrEqual(0);
    }
    // The gate clamp keeps at least one pixel of opening, never a negative run.
    const [, , , eastNorth, eastSouth] = glyph.walls;
    expect(eastSouth.y - (eastNorth.y + eastNorth.h)).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(citadelGlyphRects(box)).toEqual(citadelGlyphRects(box));
  });
});

describe('paintCitadelGlyph', () => {
  const box = { x: 100, y: 80, w: 66, h: 66 };

  /** A 2D context stand-in that records every fill, colour included. */
  const recorder = () => {
    const calls: Array<{ color: string; x: number; y: number; w: number; h: number }> = [];
    const ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'> = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push({ color: String(this.fillStyle), x, y, w, h });
      }
    };
    return { ctx, calls };
  };

  it('paints the dark halo under every wall and tower before the owner colour', () => {
    const glyph = citadelGlyphRects(box);
    const { ctx, calls } = recorder();
    paintCitadelGlyph(ctx, glyph, '#3b82f6');

    const parts = glyph.walls.length + glyph.towers.length;
    expect(calls).toHaveLength(parts * 2);
    expect(calls[0].color).toBe(MINIMAP_COLORS.outline);
    expect(calls[parts - 1].color).toBe(MINIMAP_COLORS.outline);
    expect(calls[parts].color).toBe('#3b82f6');
    expect(calls[calls.length - 1].color).toBe('#3b82f6');
  });

  it('expands the halo past the rect it protects', () => {
    const glyph = citadelGlyphRects(box);
    const { ctx, calls } = recorder();
    paintCitadelGlyph(ctx, glyph, '#3b82f6');
    const parts = glyph.walls.length + glyph.towers.length;
    for (let i = 0; i < parts; i++) {
      expect(calls[i].x).toBeLessThan(calls[parts + i].x);
      expect(calls[i].y).toBeLessThan(calls[parts + i].y);
      expect(calls[i].w).toBeGreaterThan(calls[parts + i].w);
      expect(calls[i].h).toBeGreaterThan(calls[parts + i].h);
    }
  });

  it('leaves the courtyard unpainted', () => {
    const glyph = citadelGlyphRects(box);
    const { ctx, calls } = recorder();
    paintCitadelGlyph(ctx, glyph, '#3b82f6');
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    for (const call of calls) {
      const covers =
        cx >= call.x && cx <= call.x + call.w && cy >= call.y && cy <= call.y + call.h;
      expect(covers).toBe(false);
    }
  });
});

describe('pointerToGrid', () => {
  // 140 CSS px content inside a 142 px border box, the real minimap geometry.
  const rect = { left: 10, top: 20, width: 142, height: 142 };
  const content = { width: 140, height: 140 };

  it('maps the content origin to tile 0, not the border', () => {
    expect(pointerToGrid({ clientX: 11, clientY: 21 }, rect, content, 110, 110)).toEqual({ gx: 0, gy: 0 });
  });

  it('maps the content centre to the map centre', () => {
    const grid = pointerToGrid({ clientX: 11 + 70, clientY: 21 + 70 }, rect, content, 110, 110);
    expect(grid.gx).toBeCloseTo(55, 5);
    expect(grid.gy).toBeCloseTo(55, 5);
  });

  it('does not stretch the last pixel of border into a tile', () => {
    // A naive rect-based mapping would return 110 here; the content edge is 109.
    const grid = pointerToGrid({ clientX: 11 + 140, clientY: 21 + 140 }, rect, content, 110, 110);
    expect(grid.gx).toBeLessThanOrEqual(109);
    expect(grid.gy).toBeLessThanOrEqual(109);
  });

  it('clamps a click on the border inside the map', () => {
    expect(pointerToGrid({ clientX: 0, clientY: 0 }, rect, content, 220, 220)).toEqual({ gx: 0, gy: 0 });
    const high = pointerToGrid({ clientX: 999, clientY: 999 }, rect, content, 220, 220);
    expect(high.gx).toBe(219);
    expect(high.gy).toBe(219);
  });

  it('scales a battlefield click correctly', () => {
    const grid = pointerToGrid({ clientX: 11 + 70, clientY: 21 + 70 }, rect, content, 220, 220);
    expect(grid.gx).toBeCloseTo(110, 5);
  });
});

describe('portalGlyphRects', () => {
  it('draws two pillars and a lintel', () => {
    const rects = portalGlyphRects(100, 100);
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  });

  it('leaves the doorway open between the pillars', () => {
    const [left, right] = portalGlyphRects(100, 100);
    const gap = right.x - (left.x + left.w);
    expect(gap).toBeGreaterThan(0.5);
  });

  it('puts the lintel on top of both pillars', () => {
    const [left, right, lintel] = portalGlyphRects(100, 100);
    expect(lintel.y + lintel.h).toBeCloseTo(left.y, 5);
    expect(lintel.y + lintel.h).toBeCloseTo(right.y, 5);
    expect(lintel.x).toBeCloseTo(left.x, 5);
    expect(lintel.x + lintel.w).toBeCloseTo(right.x + right.w, 5);
  });

  it('stays centred horizontally and keeps its base under the centre', () => {
    const rects = portalGlyphRects(140, 80, 2);
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    expect((minX + maxX) / 2).toBeCloseTo(140, 5);
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    expect(maxY).toBeGreaterThan(80);
  });

  it('fits inside a marker-sized box', () => {
    const rects = portalGlyphRects(0, 0);
    const width = Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x));
    expect(width).toBeLessThanOrEqual(8);
  });
});

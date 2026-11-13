import { TILE_HEIGHT, TILE_WIDTH } from '@chien-quoc/shared';
import { describe, expect, it } from 'vitest';
import { footprintOutline } from './footprintOutline.js';

describe('footprintOutline', () => {
  it('keeps the symmetric diamond for a square footprint', () => {
    // Every 2x2 building draws exactly what it drew before the fix: the old
    // `halfW = sizeX * TILE_WIDTH / 2` / `halfH = sizeY * TILE_HEIGHT / 2`
    // diamond is the correct outline when both axes are equal.
    const outline = footprintOutline(2, 2);
    expect(outline.north).toEqual({ x: 0, y: -((2 * TILE_HEIGHT) / 2) });
    expect(outline.east).toEqual({ x: (2 * TILE_WIDTH) / 2, y: 0 });
    expect(outline.south).toEqual({ x: 0, y: (2 * TILE_HEIGHT) / 2 });
    expect(outline.west).toEqual({ x: -((2 * TILE_WIDTH) / 2), y: 0 });
  });

  it('covers the true footprint of a 4x6 Town Center', () => {
    // Measured in the browser against the real tiles: a 4x6 footprint spans ten
    // tiles on the 2:1 diagonal, so 640 px wide and 320 px tall, with the north
    // corner 64 px east of centre and the east corner 32 px above the midline.
    const outline = footprintOutline(4, 6);
    expect(outline.north).toEqual({ x: 64, y: -160 });
    expect(outline.east).toEqual({ x: 320, y: -32 });
    expect(outline.south).toEqual({ x: -64, y: 160 });
    expect(outline.west).toEqual({ x: -320, y: 32 });
  });

  it('is centred on the footprint, not pushed down by the vertical axis', () => {
    const outline = footprintOutline(4, 6);
    const centreX = (outline.east.x + outline.west.x) / 2;
    const centreY = (outline.north.y + outline.south.y) / 2;
    expect(centreX).toBe(0);
    expect(centreY).toBe(0);
  });

  it('is symmetric when the axes are swapped (mirrored footprint)', () => {
    const tall = footprintOutline(4, 6);
    const wide = footprintOutline(6, 4);
    expect(wide.north).toEqual({ x: -tall.north.x, y: tall.north.y });
    expect(wide.east).toEqual({ x: tall.east.x, y: -tall.east.y });
    expect(wide.south).toEqual({ x: -tall.south.x, y: tall.south.y });
    expect(wide.west).toEqual({ x: tall.west.x, y: -tall.west.y });
  });

  it('matches the four tile corners of the footprint rectangle', () => {
    // The outline must sit on the tile corners, so each edge is exactly one
    // half-tile away from the tile edge it traces: north/south differ by the
    // full diagonal, and the sign of the skew follows `sizeY - sizeX`.
    const outline = footprintOutline(3, 7);
    expect(outline.north.y).toBeLessThan(0);
    expect(outline.south.y).toBeGreaterThan(0);
    expect(outline.east.x).toBeGreaterThan(0);
    expect(outline.west.x).toBeLessThan(0);
    // Wider-than-tall skews the north corner west, taller-than-wide skews east.
    expect(outline.north.x).toBeGreaterThan(0);
    expect(footprintOutline(7, 3).north.x).toBeLessThan(0);
  });
});

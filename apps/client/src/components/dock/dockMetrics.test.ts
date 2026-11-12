import { describe, expect, it } from 'vitest';
import { MINIMAP_CSS_SIZE } from '../minimapArt.js';
import {
  DOCK_BORDER_PX,
  DOCK_CARD_INNER_HEIGHT_PX,
  DOCK_CARD_WIDTH_PX,
  DOCK_COLUMNS,
  DOCK_GAP_PX,
  DOCK_GRID_HEIGHT_PX,
  DOCK_HEADER_PX,
  DOCK_HEIGHT_PX,
  DOCK_MINIMAP_PADDING_PX,
  DOCK_MINIMAP_PX,
  DOCK_ROWS,
  DOCK_SLOT_CAPACITY,
  DOCK_SLOT_PX
} from './dockMetrics.js';

/**
 * DOCK-01: the dock exists to shrink the bottom band, so its geometry is a
 * contract, not a styling preference. These assertions are what stop a later
 * "one more row" from quietly putting the 336 px build panel back on the map.
 */
describe('dock geometry', () => {
  it('keeps the whole dock under a fifth of a 768 px viewport', () => {
    expect(DOCK_HEIGHT_PX).toBeLessThanOrEqual(168);
    expect(DOCK_HEIGHT_PX / 768).toBeLessThan(0.21);
    expect(DOCK_HEIGHT_PX / 1080).toBeLessThan(0.15);
  });

  it('sizes the minimap panel to exactly the dock height', () => {
    // Derived, not copied: the radar raster is the one value that must move with
    // it, so the two constants are the same number by construction.
    expect(DOCK_MINIMAP_PX).toBe(MINIMAP_CSS_SIZE);
    expect(DOCK_MINIMAP_PX + 2 * (DOCK_MINIMAP_PADDING_PX + DOCK_BORDER_PX)).toBe(DOCK_HEIGHT_PX);
  });

  it('fits the header, gap and three slot rows inside the card', () => {
    expect(DOCK_GRID_HEIGHT_PX + DOCK_HEADER_PX + DOCK_GAP_PX).toBeLessThanOrEqual(
      DOCK_CARD_INNER_HEIGHT_PX
    );
  });

  it('holds the fifteen build commands in a 5x3 grid', () => {
    expect(DOCK_COLUMNS * DOCK_ROWS).toBe(DOCK_SLOT_CAPACITY);
    expect(DOCK_SLOT_CAPACITY).toBe(15);
  });

  it('keeps a slot big enough to hit but small enough to fit', () => {
    expect(DOCK_SLOT_PX).toBeGreaterThanOrEqual(36);
    expect(DOCK_SLOT_PX).toBeLessThanOrEqual(42);
  });

  it('derives the card width from the grid, not from a magic number', () => {
    expect(DOCK_CARD_WIDTH_PX).toBe(
      DOCK_COLUMNS * DOCK_SLOT_PX + (DOCK_COLUMNS - 1) * DOCK_GAP_PX + 2 * (DOCK_MINIMAP_PADDING_PX + DOCK_BORDER_PX)
    );
    expect(DOCK_CARD_WIDTH_PX).toBeLessThanOrEqual(260);
  });
});

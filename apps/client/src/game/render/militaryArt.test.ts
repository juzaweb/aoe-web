import { describe, expect, it } from 'vitest';
import { SHEET_OFFSET_Y, buildingArt, buildingHpBarY } from './buildingArt.js';

/**
 * MIL-01 split the military roster across three buildings. The two new types
 * ship on the barracks' 400x320 canvas, so they borrow its lift and its bar
 * height — but only once their own sheet exists. Until then the renderer must
 * draw the barracks silhouette rather than a blank tile, and the bar has to sit
 * where that silhouette's roof ends, not where the real sheet would end.
 */
describe('military building artwork (MIL-01)', () => {
  const NEW_TYPES = ['STABLE', 'ARCHERY_RANGE'] as const;

  for (const type of NEW_TYPES) {
    it(`${type} draws its own sheet when it was preloaded`, () => {
      expect(buildingArt(type, () => true)).toEqual({
        textureKey: `building_${type}`,
        offsetY: -96,
        scale: 1
      });
    });

    it(`${type} degrades to the barracks silhouette, not an empty tile`, () => {
      // No sheet in the repo yet: the generated art is not committed, so the
      // procedural barracks texture is the placeholder the player sees.
      expect(buildingArt(type, () => false)).toEqual({
        textureKey: 'b_barracks',
        offsetY: -70,
        scale: 1
      });
    });

    it(`${type} shares the barracks sheet offset`, () => {
      expect(SHEET_OFFSET_Y[type]).toBe(SHEET_OFFSET_Y.BARRACKS);
    });

    it(`${type} places its bar above the sheet it actually drew`, () => {
      // Two different answers, one per case: the real 400x320 sheet puts the bar
      // at the barracks' -260, while the small procedural placeholder puts it at
      // -126. A single shared number would float the bar over the placeholder.
      expect(buildingHpBarY(type, 1, () => true)).toBe(buildingHpBarY('BARRACKS', 1, () => true));
      expect(buildingHpBarY(type, 1, () => false)).toBe(
        buildingHpBarY('BARRACKS', 1, () => false)
      );
      expect(buildingHpBarY(type, 1, () => false)).not.toBe(buildingHpBarY(type, 1, () => true));
    });
  }
});

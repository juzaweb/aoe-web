import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHEET_OFFSET_Y, buildingArt, buildingHpBarY } from './buildingArt.js';

/**
 * MIL-01 split the military roster across three buildings. The two new types
 * ship on the barracks' 400x320 canvas, so they borrow its lift. Their own
 * OpenGameArt sheets crop to a different artwork height than the barracks sheet,
 * so each keeps its own measured health-bar height; only the procedural
 * fallback is still shared with the barracks.
 */
describe('military building artwork (MIL-01)', () => {
  const NEW_TYPES = ['STABLE', 'ARCHERY_RANGE'] as const;

  // Bar = sheet lift - canvasHeight/2 + topInset - 8, measured from the shipped
  // PNGs (`scripts/assets/build.py --report` prints the inset).
  const OWN_SHEET_BAR: Record<(typeof NEW_TYPES)[number], number> = {
    STABLE: -261,
    ARCHERY_RANGE: -235
  };

  for (const type of NEW_TYPES) {
    it(`${type} draws its own sheet when it was preloaded`, () => {
      expect(buildingArt(type, () => true)).toEqual({
        textureKey: `building_${type}`,
        offsetY: -96,
        scale: 1
      });
    });

    it(`${type} degrades to the barracks silhouette, not an empty tile`, () => {
      // A failed preload leaves no texture. The procedural barracks texture is
      // the placeholder the player sees, so the map never shows a blank tile.
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
      // Two different answers, one per case: the real 400x320 sheet uses its own
      // measured top inset, while the small procedural placeholder borrows the
      // barracks bar. A single shared number would float one of them.
      expect(buildingHpBarY(type, 1, () => true)).toBe(OWN_SHEET_BAR[type]);
      expect(buildingHpBarY(type, 1, () => false)).toBe(
        buildingHpBarY('BARRACKS', 1, () => false)
      );
      expect(buildingHpBarY(type, 1, () => false)).not.toBe(buildingHpBarY(type, 1, () => true));
    });
  }
});

describe('military building sheets (MIL-01)', () => {
  const ROOT = join(__dirname, '../../../../..');

  for (const name of ['stable', 'archery_range']) {
    it(`${name}.png is a shipped 400x320 sheet`, () => {
      const path = join(ROOT, 'apps/client/public/assets/buildings', `${name}.png`);
      expect(existsSync(path), `missing ${path}`).toBe(true);
      const buffer = readFileSync(path);
      expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }).toEqual({
        width: 400,
        height: 320
      });
    });
  }
});

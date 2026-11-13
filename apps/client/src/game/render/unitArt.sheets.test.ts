import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRECTION_NAMES } from './unitDirections.js';
import { UNIT_ART, unitArt, unitSheets } from './unitArt.js';

/**
 * Guards the one mistake the type system cannot catch: a sheet on disk whose
 * grid does not match what `unitArt.ts` claims. A wrong frame count does not
 * crash Phaser, it silently plays frames from the neighbouring direction row,
 * which is hard to spot by eye.
 *
 * Width/height are read straight out of the PNG IHDR chunk, so this needs no
 * image decoder and stays independent of how the sheets were produced.
 */
const ACTIONS_DIR = join(__dirname, '../../../public/assets/units/actions');

function pngSize(path: string): { width: number; height: number } | null {
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path);
  const isPng = buffer.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isPng) throw new Error(`${path} is not a PNG`);
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4).
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('unit sheets on disk', () => {
  const unitsWithArt = Object.keys(UNIT_ART).filter((type) => unitSheets(type).length > 0);

  it('has at least one unit with directional art', () => {
    expect(unitsWithArt.length).toBeGreaterThan(0);
  });

  for (const unitType of unitsWithArt) {
    describe(unitType, () => {
      const art = unitArt(unitType);

      for (const sheet of unitSheets(unitType)) {
        it(`${sheet.sheetAction} matches the configured cell size`, () => {
          const path = join(ACTIONS_DIR, `${unitType.toLowerCase()}_${sheet.sheetAction}.png`);
          const size = pngSize(path);
          expect(size, `missing sheet ${path}`).not.toBeNull();
          expect(size!.width % art.frameWidth, 'width is a whole number of columns').toBe(0);
          expect(size!.height, 'height is one row per compass direction').toBe(
            art.frameHeight * DIRECTION_NAMES.length
          );
          expect(size!.width / art.frameWidth, 'columns equal the configured frames').toBe(
            sheet.frames
          );
        });

        // TEAM-06: the accent layer is played frame-for-frame with the body, so a
        // sheet that disagrees by even one column slides the surcoat off the
        // figure. Same cell, same grid, same frame count - or the layer is not
        // usable at all.
        if (!art.accentSheet) continue;
        it(`${sheet.sheetAction} accent matches the body grid`, () => {
          const path = join(
            ACTIONS_DIR,
            `${unitType.toLowerCase()}_${sheet.sheetAction}_accent.png`
          );
          const size = pngSize(path);
          expect(size, `missing accent sheet ${path}`).not.toBeNull();
          expect(size!.width, 'accent width equals the body width').toBe(
            sheet.frames * art.frameWidth
          );
          expect(size!.height, 'one accent row per compass direction').toBe(
            art.frameHeight * DIRECTION_NAMES.length
          );
        });
      }
    });
  }
});

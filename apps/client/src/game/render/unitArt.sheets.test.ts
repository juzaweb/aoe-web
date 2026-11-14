import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIRECTION_NAMES } from './unitDirections.js';
import { UNIT_ART, hasTeamAccent, unitArt, unitSheets } from './unitArt.js';
import { pngSize } from '../../test/png.js';

/**
 * Guards the one mistake the type system cannot catch: a sheet on disk whose
 * grid does not match what `unitArt.ts` claims. A wrong frame count does not
 * crash Phaser, it silently plays frames from the neighbouring direction row,
 * which is hard to spot by eye.
 */
const ACTIONS_DIR = join(__dirname, '../../../public/assets/units/actions');

/** Size of a sheet, or `null` when the file is not on disk. */
function sheetSize(path: string): { width: number; height: number } | null {
  return existsSync(path) ? pngSize(path) : null;
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
          const size = sheetSize(path);
          expect(size, `missing sheet ${path}`).not.toBeNull();
          expect(size!.width % art.frameWidth, 'width is a whole number of columns').toBe(0);
          expect(size!.height, 'height is one row per compass direction').toBe(
            art.frameHeight * DIRECTION_NAMES.length
          );
          expect(size!.width / art.frameWidth, 'columns equal the configured frames').toBe(
            sheet.frames
          );
        });
      }

      // The accent is drawn over the body clip frame for frame, so a grid that
      // drifts by a column would tint the neighbouring pose's tunic.
      describe.runIf(hasTeamAccent(unitType))('team-colour layer', () => {
        for (const sheet of unitSheets(unitType)) {
          it(`${sheet.sheetAction} matches the body grid`, () => {
            const path = join(
              ACTIONS_DIR,
              `${unitType.toLowerCase()}_${sheet.sheetAction}_accent.png`
            );
            const size = sheetSize(path);
            expect(size, `missing accent sheet ${path}`).not.toBeNull();
            expect(size!.width, 'accent columns equal the body columns').toBe(
              sheet.frames * art.frameWidth
            );
            expect(size!.height, 'accent rows equal the body rows').toBe(
              art.frameHeight * DIRECTION_NAMES.length
            );
          });
        }
      });
    });
  }
});

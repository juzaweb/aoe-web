import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNIT_ART, unitArt } from './unitArt.js';
import { pngSize } from '../../test/png.js';

/**
 * Guards the mistake that shipped twice: a unit's portrait staying on the art
 * the unit used to be drawn with.
 *
 * The portraits are generated, not painted, by
 * `scripts/build_unit_portrait.py`, and that script records the sheet hash it
 * read plus the portrait hash it wrote in `scripts/assets/unit_portraits.lock.json`.
 * Comparing both hashes here means a redrawn sheet cannot sit next to a stale
 * portrait: the failure names the unit and the command to rerun.
 *
 * A hash, not a pixel comparison, on purpose - the portrait is a scaled, cropped
 * derivative, and the only question worth asking is whether it was built from
 * the sheet that is on disk now.
 */
const LOCK_PATH = join(__dirname, '../../../../../scripts/assets/unit_portraits.lock.json');
const UNITS_DIR = join(__dirname, '../../../public/assets/units');

interface PortraitLock {
  out: string;
  source: string;
  sourceSha256: string;
  poseRow: number;
  frame: number;
  cell: [number, number];
  size: number;
  sha256: string;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const lock: { portraits: Record<string, PortraitLock> } = JSON.parse(
  readFileSync(LOCK_PATH, 'utf8')
);

describe('unit portraits', () => {
  const units = Object.keys(UNIT_ART);

  it('locks a portrait for every unit that ships art', () => {
    expect(units.length).toBeGreaterThan(0);
    expect(Object.keys(lock.portraits).sort()).toEqual([...units].sort());
  });

  for (const unitType of units) {
    describe(unitType, () => {
      const entry = lock.portraits[unitType];
      const sheetPath = join(UNITS_DIR, 'actions', `${unitType.toLowerCase()}_idle.png`);
      const portraitPath = join(UNITS_DIR, `${unitType.toLowerCase()}_idle.png`);

      it('was built from the idle sheet that is on disk', () => {
        expect(
          sha256(sheetPath),
          `${sheetPath} changed since the portrait was built, run: python scripts/build_unit_portrait.py ${unitType.toLowerCase()}`
        ).toBe(entry.sourceSha256);
      });

      it('is the file the lock recorded', () => {
        expect(existsSync(portraitPath), `missing portrait ${portraitPath}`).toBe(true);
        expect(sha256(portraitPath), `rebuild the portrait for ${unitType}`).toBe(entry.sha256);
      });

      it('is square, so the UI can box it without distortion', () => {
        const size = pngSize(portraitPath);
        expect(size.width).toBe(entry.size);
        expect(size.height).toBe(entry.size);
        expect(size.width).toBeGreaterThanOrEqual(64);
      });

      it('crops the cell size the renderer reads', () => {
        const art = unitArt(unitType);
        expect(entry.cell).toEqual([art.frameWidth, art.frameHeight]);
      });

      it('records a pose the sheet actually has', () => {
        expect(entry.poseRow).toBeGreaterThanOrEqual(0);
        expect(entry.poseRow).toBeLessThan(8);
        expect(entry.frame).toBeGreaterThanOrEqual(0);
      });
    });
  }
});

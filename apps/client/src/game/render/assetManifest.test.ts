import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHEET_OFFSET_Y, buildingHpBarY } from './buildingArt.js';
import { treeVariant } from './treeVariants.js';

/**
 * Guards the contract between the build pipeline and the client.
 *
 * `scripts/assets/build.py` writes `assets.lock.json` next to the manifest:
 * every shipped sprite with its canvas, sha256 and the license/author it came
 * from. This test fails when a PNG was edited by hand, when a sheet's size no
 * longer matches the renderer's assumptions, or when the attribution that the
 * license requires is missing from `CREDITS.md`.
 */
const REPO_ROOT = join(__dirname, '../../../../..');
const LOCK_PATH = join(REPO_ROOT, 'scripts/assets/assets.lock.json');
const CREDITS_PATH = join(REPO_ROOT, 'CREDITS.md');

interface LockEntry {
  out: string;
  canvas: [number, number];
  sha256: string;
  topInset: number;
  bottomInset: number;
  source: string;
  page: string;
  author: string;
  license: string;
}

interface LockFile {
  sources: Record<string, { author: string; license: string; page: string }>;
  targets: Record<string, LockEntry>;
}

function readLock(): LockFile {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as LockFile;
}

/** Width/height straight from the IHDR chunk, no image decoder needed. */
function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`${path} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('asset pipeline lock', () => {
  const lock = readLock();
  const credits = readFileSync(CREDITS_PATH, 'utf8');

  it('has at least one shipped target', () => {
    expect(Object.keys(lock.targets).length).toBeGreaterThan(0);
  });

  for (const [targetId, entry] of Object.entries(lock.targets)) {
    describe(targetId, () => {
      const path = join(REPO_ROOT, entry.out);

      it('ships the file recorded in the lock', () => {
        expect(existsSync(path), `missing ${entry.out}`).toBe(true);
      });

      it('matches the recorded hash', () => {
        const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
        expect(digest, `${entry.out} was regenerated outside the pipeline`).toBe(entry.sha256);
      });

      it('matches the recorded canvas', () => {
        expect(pngSize(path)).toEqual({ width: entry.canvas[0], height: entry.canvas[1] });
      });

      it('is bottom-anchored', () => {
        expect(entry.bottomInset).toBeGreaterThanOrEqual(0);
        expect(entry.bottomInset).toBeLessThanOrEqual(3);
      });

      it('carries a license, an author and a credited source', () => {
        expect(entry.license).toMatch(/^CC0-1\.0$|^CC-BY-(3|4)\.0$|^CC-BY-SA-3\.0$/);
        expect(entry.page).toMatch(/^https:\/\/opengameart\.org\//);
        expect(entry.author.length).toBeGreaterThan(0);
        expect(credits).toContain(entry.author);
      });
    });
  }
});

describe('building health bar heights', () => {
  const lock = readLock();
  const MIGRATED: Record<string, keyof typeof SHEET_OFFSET_Y> = {
    'building.town-center': 'TOWN_CENTER',
    'building.barracks': 'BARRACKS',
    'building.house': 'HOUSE',
    'building.lumber-camp': 'LUMBER_CAMP'
  };

  // `HP_BAR_Y` is hand-maintained, but its value is derivable: the bar sits 8 px
  // above the first visible row of art. Recomputing it from the lock means a
  // sprite swap without re-measuring the bar fails here instead of shipping a
  // bar floating over the roof.
  for (const [targetId, buildingType] of Object.entries(MIGRATED)) {
    it(`${buildingType} sits above the measured artwork`, () => {
      const entry = lock.targets[targetId];
      if (!entry) throw new Error(`missing lock target ${targetId}`);
      const offsetY = SHEET_OFFSET_Y[buildingType];
      if (offsetY === undefined) throw new Error(`missing sheet offset for ${buildingType}`);
      const expected = offsetY - entry.canvas[1] / 2 + entry.topInset - 8;
      expect(buildingHpBarY(buildingType)).toBe(expected);
    });
  }
});

describe('tree variants', () => {
  it('is stable and stays inside the shipped range', () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const variant = treeVariant(x, y);
        expect(variant).toBeGreaterThanOrEqual(1);
        expect(variant).toBeLessThanOrEqual(4);
        expect(treeVariant(x, y)).toBe(variant);
      }
    }
  });

  it('uses all four silhouettes across a small forest', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) seen.add(treeVariant(x, y));
    }
    expect(seen.size).toBe(4);
  });
});

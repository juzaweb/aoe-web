import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BuildingType } from '@chien-quoc/shared';
import { BUILDING_ACCENT_TYPES, buildingAccentKey } from './buildingArt.js';

/**
 * Guards the one mistake the type system cannot catch about the building accent
 * layers: that the list `buildingArt.ts` advertises and the PNGs on disk agree.
 *
 * A listed type with no file is harmless at runtime (the sprite falls back to
 * body-only), which is exactly why it would go unnoticed - the building would
 * silently lose its team colour. An unlisted file is worse: preload skips it, so
 * the art is paid for in the bundle and never drawn.
 *
 * Sizes are read straight out of the PNG IHDR chunk, like the unit sheet test, so
 * this needs no image decoder.
 */
const ART_DIR = join(__dirname, '../../../public/assets/buildings');

function pngSize(path: string): { width: number; height: number } | null {
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path);
  const isPng = buffer.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isPng) throw new Error(`${path} is not a PNG`);
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4).
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Accent files present in the buildings folder, by building type. */
function accentsOnDisk(): BuildingType[] {
  return readdirSync(ART_DIR)
    .filter((name) => name.endsWith('_accent.png'))
    .map((name) => name.replace(/_accent\.png$/, '').toUpperCase() as BuildingType);
}

describe('building accent layers', () => {
  it('derives the accent key from the body key', () => {
    expect(buildingAccentKey('building_HOUSE')).toBe('building_HOUSE_accent');
    // A tiered sheet keeps its own accent, and a procedural placeholder asks for
    // a key nobody loaded rather than borrowing another building's layer.
    expect(buildingAccentKey('building_HOUSE_2')).toBe('building_HOUSE_2_accent');
    expect(buildingAccentKey('b_house')).toBe('b_house_accent');
  });

  it('lists every accent file that ships', () => {
    expect([...BUILDING_ACCENT_TYPES].sort()).toEqual(accentsOnDisk().sort());
  });

  it('leaves the wall out: it borrows the citadel masonry, which has no accent', () => {
    expect(BUILDING_ACCENT_TYPES).not.toContain('WALL');
  });

  it('ships an accent file for every listed type', () => {
    expect(BUILDING_ACCENT_TYPES.length).toBeGreaterThan(0);
    for (const type of BUILDING_ACCENT_TYPES) {
      const path = join(ART_DIR, `${type.toLowerCase()}_accent.png`);
      expect(existsSync(path), `missing accent layer ${path}`).toBe(true);
    }
  });

  for (const type of BUILDING_ACCENT_TYPES) {
    it(`${type} accent sits on the same canvas as the body`, () => {
      // The accent is drawn on the body's offset and scale, not its own. A layer
      // that disagreed by a pixel would show as a ghosted rim around every roof.
      const body = pngSize(join(ART_DIR, `${type.toLowerCase()}.png`));
      const accent = pngSize(join(ART_DIR, `${type.toLowerCase()}_accent.png`));
      expect(body, `missing body art for ${type}`).not.toBeNull();
      expect(accent).toEqual(body);
    });
  }
});

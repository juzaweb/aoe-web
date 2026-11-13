import { describe, expect, it } from 'vitest';
import { floorTextureKey, floorVariantAt } from './citadelFloorVariants.js';

describe('citadel floor variants', () => {
  it('is a pure function of the grid position', () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        const first = floorVariantAt(x, y);
        expect(floorVariantAt(x, y)).toBe(first);
        // Order of calls must not matter: the renderer walks rows, columns, and
        // re-walks on every rebuild.
        expect(floorVariantAt(y, x)).toBe(floorVariantAt(y, x));
      }
    }
  });

  it('always returns one of the three shipped variants', () => {
    for (let x = -40; x < 40; x++) {
      for (let y = -40; y < 40; y++) {
        expect([0, 1, 2]).toContain(floorVariantAt(x, y));
      }
    }
  });

  it('uses all three variants across the interior of the 26x26 citadel', () => {
    const seen = new Set<number>();
    for (let x = 1; x <= 24; x++) {
      for (let y = 1; y <= 24; y++) seen.add(floorVariantAt(x, y));
    }
    expect(seen.size).toBe(3);
  });

  it('does not paint diagonal stripes', () => {
    // `(x + y) % 3` is constant along every anti-diagonal. A hashed pick has to
    // break that across the compound: no more than a couple of the 47 interior
    // diagonals may collapse to a single variant (a hash leaves ~2), where the
    // striped rule leaves all 47.
    let constant = 0;
    for (let diagonal = 2; diagonal <= 48; diagonal++) {
      const values = new Set<number>();
      for (let x = 1; x <= 24; x++) {
        const y = diagonal - x;
        if (y < 1 || y > 24) continue;
        values.add(floorVariantAt(x, y));
      }
      if (values.size === 1) constant++;
    }
    expect(constant).toBeLessThanOrEqual(4);
  });

  it('maps variants onto the shipped texture keys', () => {
    expect(floorTextureKey(0)).toBe('citadel_floor');
    expect(floorTextureKey(1)).toBe('citadel_floor_1');
    expect(floorTextureKey(2)).toBe('citadel_floor_2');
  });
});

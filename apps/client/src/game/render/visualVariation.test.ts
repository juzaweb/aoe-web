import { describe, expect, it } from 'vitest';
import {
  fbm,
  grassTextureIndex,
  grassTint,
  hash2,
  hashString,
  resourceLook,
  roadStampLook
} from './visualVariation.js';

/**
 * These functions are the whole anti-stripe fix: the old tile picker was
 * `(gx * 7 + gy * 13) % 3`, which is `(gx + gy) % 3` and paints diagonals.
 * A regression here is visible across the entire map, so the tests assert the
 * statistical shape (uniform variants, no diagonal correlation) rather than a
 * handful of golden values.
 */
describe('hash2', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let x = -50; x < 50; x += 7) {
      for (let y = -50; y < 50; y += 3) {
        const value = hash2(x, y, 1);
        expect(value).toBe(hash2(x, y, 1));
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('separates seeds', () => {
    expect(hash2(4, 9, 1)).not.toBe(hash2(4, 9, 2));
  });
});

describe('fbm', () => {
  it('stays inside [0, 1] and varies across the map', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 200; x += 5) {
      for (let y = 0; y < 200; y += 5) {
        const value = fbm(x / 40, y / 40, 0x51ed);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        seen.add(Math.round(value * 100));
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('grassTextureIndex', () => {
  it('returns only the three shipped variants', () => {
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 30; y++) {
        expect([1, 2, 3]).toContain(grassTextureIndex(x, y));
      }
    }
  });

  it('is deterministic', () => {
    expect(grassTextureIndex(17, 23)).toBe(grassTextureIndex(17, 23));
  });

  it('has no diagonal correlation (the old stripe bug)', () => {
    let same = 0;
    let total = 0;
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        total++;
        if (grassTextureIndex(x, y) === grassTextureIndex(x + 1, y + 1)) same++;
      }
    }
    // Random picks agree 1/3 of the time; the striped version agreed 100%.
    expect(same / total).toBeGreaterThan(0.25);
    expect(same / total).toBeLessThan(0.42);
  });

  it('spreads the three variants evenly', () => {
    const counts = [0, 0, 0];
    const total = 120 * 120;
    for (let x = 0; x < 120; x++) {
      for (let y = 0; y < 120; y++) counts[grassTextureIndex(x, y) - 1]++;
    }
    for (const count of counts) {
      expect(count / total).toBeGreaterThan(0.25);
      expect(count / total).toBeLessThan(0.42);
    }
  });
});

describe('grassTint', () => {
  it('keeps every channel within 12% of white', () => {
    for (let x = 0; x < 80; x += 3) {
      for (let y = 0; y < 80; y += 3) {
        const tint = grassTint(x, y);
        const r = (tint >> 16) & 0xff;
        const g = (tint >> 8) & 0xff;
        const b = tint & 0xff;
        for (const channel of [r, g, b]) {
          expect(channel).toBeGreaterThanOrEqual(Math.floor(255 * 0.88));
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('produces more than one field value', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 200; x += 10) {
      for (let y = 0; y < 200; y += 10) seen.add(grassTint(x, y));
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('roadStampLook', () => {
  it('stays inside the documented ranges', () => {
    for (let i = 0; i < 200; i++) {
      const look = roadStampLook(i * 0.35, i * 0.7, 0.4, i);
      expect(look.angle).toBeGreaterThan(0.4 - 0.061);
      expect(look.angle).toBeLessThan(0.4 + 0.061);
      expect(look.scale).toBeGreaterThanOrEqual(0.92);
      expect(look.scale).toBeLessThanOrEqual(1.12);
      expect(Math.hypot(look.offsetX, look.offsetY)).toBeLessThanOrEqual(5.001);
      const channels = [(look.tint >> 16) & 0xff, (look.tint >> 8) & 0xff, look.tint & 0xff];
      for (const channel of channels) {
        expect(channel).toBeGreaterThanOrEqual(204);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('gives roughly a quarter of the stamps a shoulder', () => {
    let shoulders = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      if (roadStampLook(i * 0.35, i * 0.7, 0, i).shoulderScale !== null) shoulders++;
    }
    expect(shoulders / total).toBeGreaterThan(0.18);
    expect(shoulders / total).toBeLessThan(0.32);
  });

  it('offsets perpendicular to the road', () => {
    // A horizontal road must move stamps vertically, not along it.
    for (let i = 0; i < 200; i++) {
      const look = roadStampLook(i * 0.35, i * 0.7, 0, i);
      expect(Math.abs(look.offsetX)).toBeLessThan(1e-9);
    }
  });
});

describe('resourceLook', () => {
  it('varies trees more than ore', () => {
    const tree = resourceLook('node-1', 'TREE');
    const gold = resourceLook('node-1', 'GOLD_MINE');
    expect(tree.scale).toBeGreaterThanOrEqual(0.9);
    expect(tree.scale).toBeLessThanOrEqual(1.15);
    expect(gold.scale).toBeGreaterThanOrEqual(0.96);
    expect(gold.scale).toBeLessThanOrEqual(1.05);
    expect(gold.tint).toBe(0xffffff);
    expect(gold.flipX).toBe(false);
  });

  it('mirrors about half the trees and tints them subtly', () => {
    let flips = 0;
    const total = 500;
    for (let i = 0; i < total; i++) {
      const look = resourceLook(`tree-${i}`, 'TREE');
      if (look.flipX) flips++;
      const r = (look.tint >> 16) & 0xff;
      expect(r).toBeGreaterThanOrEqual(207);
      expect(r).toBeLessThanOrEqual(255);
    }
    expect(flips / total).toBeGreaterThan(0.4);
    expect(flips / total).toBeLessThan(0.6);
  });

  it('is stable per node id', () => {
    expect(resourceLook('abc', 'TREE')).toEqual(resourceLook('abc', 'TREE'));
    expect(hashString('abc')).toBe(hashString('abc'));
  });
});

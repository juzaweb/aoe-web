import { describe, expect, it } from 'vitest';
import {
  RAID_LEVEL_RANGE,
  RAID_LOOT_CAP_PER_RESOURCE,
  RAID_LOOT_PERCENT,
  RAID_TOWN_CENTER_HP_THRESHOLD,
  clampRaidTownCenterHp,
  computeRaidLoot,
  hexGridSize,
  hexPositionOf,
  hexTileAt,
  isRaidLevelInRange,
  isRaidTownCenterBreached
} from '@chien-quoc/shared';

describe('raid level range', () => {
  it('accepts a gap up to the configured range on both sides', () => {
    expect(isRaidLevelInRange(3, 3)).toBe(true);
    expect(isRaidLevelInRange(3, 3 + RAID_LEVEL_RANGE)).toBe(true);
    expect(isRaidLevelInRange(3 + RAID_LEVEL_RANGE, 3)).toBe(true);
  });

  it('rejects a gap one level past the range', () => {
    expect(isRaidLevelInRange(3, 3 + RAID_LEVEL_RANGE + 1)).toBe(false);
    expect(isRaidLevelInRange(3 + RAID_LEVEL_RANGE + 1, 3)).toBe(false);
  });

  it('never matches an empire without a Town Center', () => {
    expect(isRaidLevelInRange(0, 5)).toBe(false);
    expect(isRaidLevelInRange(5, 0)).toBe(false);
    expect(isRaidLevelInRange(Number.NaN, 5)).toBe(false);
  });
});

describe('raid loot', () => {
  it('takes the configured share of every stock', () => {
    const loot = computeRaidLoot({ wood: 100, food: 50, gold: 20, stone: 0 });
    expect(loot).toEqual({
      wood: Math.floor(100 * RAID_LOOT_PERCENT),
      food: Math.floor(50 * RAID_LOOT_PERCENT),
      gold: Math.floor(20 * RAID_LOOT_PERCENT),
      stone: 0
    });
  });

  it('caps one resource at the configured ceiling', () => {
    const huge = RAID_LOOT_CAP_PER_RESOURCE * 100;
    const loot = computeRaidLoot({ wood: huge, food: huge, gold: huge, stone: huge });
    expect(loot.wood).toBe(RAID_LOOT_CAP_PER_RESOURCE);
    expect(loot.food).toBe(RAID_LOOT_CAP_PER_RESOURCE);
    expect(loot.gold).toBe(RAID_LOOT_CAP_PER_RESOURCE);
    expect(loot.stone).toBe(RAID_LOOT_CAP_PER_RESOURCE);
  });

  it('never returns a fraction or a negative amount', () => {
    const loot = computeRaidLoot({ wood: 7, food: -10, gold: 0, stone: Number.NaN });
    expect(loot).toEqual({ wood: 1, food: 0, gold: 0, stone: 0 });
    for (const value of Object.values(loot)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('raid town center threshold', () => {
  it('is breached at or below the configured share', () => {
    expect(isRaidTownCenterBreached(100, 100)).toBe(false);
    expect(isRaidTownCenterBreached(26, 100)).toBe(false);
    expect(isRaidTownCenterBreached(25, 100)).toBe(true);
    expect(isRaidTownCenterBreached(1, 100)).toBe(true);
  });

  it('does not report a destroyed building as a breach', () => {
    // Zero means "gone", which the room handles as a defender win instead.
    expect(isRaidTownCenterBreached(0, 100)).toBe(false);
    expect(isRaidTownCenterBreached(10, 0)).toBe(false);
  });

  it('clamps damage at the threshold, never below it', () => {
    const floor = Math.ceil(1000 * RAID_TOWN_CENTER_HP_THRESHOLD);
    expect(clampRaidTownCenterHp(10, 1000)).toBe(floor);
    expect(clampRaidTownCenterHp(400, 1000)).toBe(400);
  });
});

describe('world map hex grid', () => {
  it('has 1 + 3r(r+1) tiles', () => {
    expect(hexGridSize(0)).toBe(1);
    expect(hexGridSize(1)).toBe(7);
    expect(hexGridSize(2)).toBe(19);
    expect(hexGridSize(12)).toBe(469);
  });

  it('starts at the centre and wraps around the grid', () => {
    expect(hexTileAt(0)).toEqual({ q: 0, r: 0 });
    expect(hexTileAt(hexGridSize())).toEqual({ q: 0, r: 0 });
    expect(hexTileAt(-1)).toEqual(hexTileAt(hexGridSize() - 1));
  });

  it('keeps every tile inside the radius', () => {
    const size = hexGridSize();
    for (let index = 0; index < size; index++) {
      const { q, r } = hexTileAt(index);
      const distance = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      expect(distance).toBeLessThanOrEqual(12);
    }
  });

  it('is stable per account and independent of call order', () => {
    const first = hexPositionOf('user-1');
    const again = hexPositionOf('user-1');
    expect(again).toEqual(first);
    expect(hexPositionOf('user-2')).not.toEqual(first);
  });
});

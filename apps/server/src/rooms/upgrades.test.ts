import { describe, expect, it } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  MAX_UNIT_LEVEL,
  UNIT_BLUEPRINTS,
  getBuildingLevelStats,
  getBuildingMaxLevel,
  getBuildingUpgradeCost,
  getBuildingUpgradeTimeMs,
  getPlayerUnitLevel,
  getUnitLevelStats,
  getUnitUpgradeCost,
  getUnitUpgradeTimeMs
} from '@chien-quoc/shared';
import { parseUnitLevels, serializeUnitLevels } from '../services/playerLevels.js';
import { PlayerState } from '../schema/PlayerState.js';

describe('player level defaults', () => {
  it('starts every unit type at level 1', () => {
    const player = new PlayerState();
    expect(Array.from(player.unitLevels)).toEqual([1, 1, 1, 1]);
    expect(player.researchUnitType).toBe('');
  });
});

describe('level stats', () => {
  it('keeps level 1 identical to the blueprint', () => {
    expect(getBuildingLevelStats('TOWN_CENTER', 1)).toEqual({
      maxHp: BUILDING_BLUEPRINTS.TOWN_CENTER.maxHp,
      attackPower: BUILDING_BLUEPRINTS.TOWN_CENTER.attackPower,
      populationProvided: BUILDING_BLUEPRINTS.TOWN_CENTER.populationProvided
    });
    expect(getUnitLevelStats('SPEARMAN', 1)).toEqual({
      maxHp: UNIT_BLUEPRINTS.SPEARMAN.maxHp,
      attackPower: UNIT_BLUEPRINTS.SPEARMAN.attackPower,
      carryCapacity: UNIT_BLUEPRINTS.SPEARMAN.carryCapacity
    });
  });

  it('uses 100 levels for the Town Center and 10 for everything else', () => {
    expect(getBuildingMaxLevel('TOWN_CENTER')).toBe(100);
    expect(getBuildingMaxLevel('HOUSE')).toBe(10);
    expect(getBuildingMaxLevel('TOWER')).toBe(10);
  });

  it('scales building HP and population linearly, clamping to the cap', () => {
    expect(getBuildingLevelStats('TOWN_CENTER', 100)).toMatchObject({
      maxHp: 7152,
      populationProvided: 114
    });
    // An unknown level still resolves against the type's maximum.
    expect(getBuildingLevelStats('TOWN_CENTER', 999).maxHp).toBe(7152);
    expect(getBuildingLevelStats('TOWN_CENTER', -3).maxHp).toBe(2400);
    // A house gains its one extra point when 2%/level rounds 5 up to 6.
    expect(getBuildingLevelStats('HOUSE', 5).populationProvided).toBe(5);
    expect(getBuildingLevelStats('HOUSE', 6).populationProvided).toBe(6);
    expect(getBuildingLevelStats('HOUSE', 10).populationProvided).toBe(6);
  });

  it('scales unit HP, attack and carry capacity', () => {
    expect(getUnitLevelStats('SPEARMAN', 10)).toEqual({
      maxHp: 131,
      attackPower: 11.6,
      carryCapacity: 0
    });
    expect(getUnitLevelStats('VILLAGER', 10).carryCapacity).toBe(15);
    expect(getUnitLevelStats('CAVALRY', 10).maxHp).toBe(203);
    expect(getUnitLevelStats('SPEARMAN', 999).maxHp).toBe(131);
  });
});

describe('upgrade prices', () => {
  it('charges the documented Town Center entry price', () => {
    expect(getBuildingUpgradeCost('TOWN_CENTER', 1)).toEqual({
      wood: 138,
      food: 0,
      gold: 0,
      stone: 50
    });
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 1)).toBe(7500);
  });

  it('increases monotonically with level', () => {
    for (let level = 1; level < 100; level++) {
      const current = getBuildingUpgradeCost('TOWN_CENTER', level);
      const next = getBuildingUpgradeCost('TOWN_CENTER', level + 1);
      expect(next.wood).toBeGreaterThan(current.wood);
      expect(getBuildingUpgradeTimeMs('TOWN_CENTER', level + 1)).toBeGreaterThan(
        getBuildingUpgradeTimeMs('TOWN_CENTER', level)
      );
    }
  });

  it('adds the research gold surcharge on top of the unit price', () => {
    expect(getUnitUpgradeCost('SPEARMAN', 1)).toEqual({
      wood: 18,
      food: 36,
      gold: 25,
      stone: 0
    });
    expect(getUnitUpgradeTimeMs('SPEARMAN', 1)).toBe(3500);
    // Level 9 -> 10 is the last step and the most expensive one.
    expect(getUnitUpgradeCost('CAVALRY', 9).gold).toBe(555);
    expect(getUnitUpgradeTimeMs('CAVALRY', 9)).toBe(31400);
  });
});

describe('persisted unit levels', () => {
  it('round-trips one level per type in UNIT_UPGRADE_ORDER', () => {
    const levels = [1, 4, 2, 3];
    expect(parseUnitLevels(serializeUnitLevels(levels))).toEqual(levels);
    expect(serializeUnitLevels(levels)).toBe('1,4,2,3');
  });

  it('defaults and clamps malformed rows', () => {
    expect(parseUnitLevels('')).toEqual([1, 1, 1, 1]);
    expect(parseUnitLevels(null)).toEqual([1, 1, 1, 1]);
    expect(parseUnitLevels('0,99,bad')).toEqual([1, MAX_UNIT_LEVEL, 1, 1]);
    expect(serializeUnitLevels([0, 99, 2, 3])).toBe('1,10,2,3');
  });

  it('reads a type level by its upgrade index', () => {
    expect(getPlayerUnitLevel([1, 4, 2, 3], 'SPEARMAN')).toBe(4);
    expect(getPlayerUnitLevel([1, 4, 2, 3], 'CAVALRY')).toBe(3);
    expect(getPlayerUnitLevel(undefined, 'ARCHER')).toBe(1);
  });
});

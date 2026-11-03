import { describe, expect, it } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  MAX_CORE_BUILDING_LEVEL,
  MAX_UNIT_LEVEL,
  UNIT_BLUEPRINTS,
  getBuildingLevelStats,
  getBuildingMaxLevel,
  getBuildingUpgradeCost,
  getBuildingUpgradeTimeMs,
  getCoreLevelGaps,
  getPlayerUnitLevel,
  getRequiredCoreLevel,
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

  it('uses 100 levels for the Town Center and the core buildings, 10 for drop-offs', () => {
    expect(getBuildingMaxLevel('TOWN_CENTER')).toBe(100);
    expect(getBuildingMaxLevel('HOUSE')).toBe(100);
    expect(getBuildingMaxLevel('BARRACKS')).toBe(100);
    expect(getBuildingMaxLevel('FARM')).toBe(100);
    expect(getBuildingMaxLevel('TOWER')).toBe(100);
    expect(getBuildingMaxLevel('LUMBER_CAMP')).toBe(10);
    expect(getBuildingMaxLevel('MILL')).toBe(10);
    expect(getBuildingMaxLevel('MINING_CAMP')).toBe(10);
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

describe('two-phase progression curve (LVL2)', () => {
  it('keeps levels 1-10 in minutes and restarts the ramp at one hour', () => {
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 1)).toBe(7_500);
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 10)).toBe(2_420_158);
    // Level 11 is the documented "1 hour" anchor, not a continuation of 1.9x.
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 11)).toBe(3_600_000);
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 12)).toBe(3_780_000);
    // Duration follows each blueprint's own build time: 5s House -> 20m.
    expect(getBuildingUpgradeTimeMs('HOUSE', 11)).toBe(1_200_000);
  });

  it('has no ceiling: the last Town Center step is 73 hours', () => {
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 99)).toBe(263_609_355);
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 99)).toBeGreaterThan(70 * 3_600_000);
  });

  it('prices the first step and the phase boundary as documented', () => {
    expect(getBuildingUpgradeCost('TOWN_CENTER', 1)).toEqual({
      wood: 138,
      food: 0,
      gold: 0,
      stone: 50
    });
    expect(getBuildingUpgradeCost('TOWN_CENTER', 10)).toEqual({
      wood: 253,
      food: 0,
      gold: 0,
      stone: 92
    });
    expect(getBuildingUpgradeCost('TOWN_CENTER', 11)).toEqual({
      wood: 273,
      food: 0,
      gold: 0,
      stone: 99
    });
    expect(getBuildingUpgradeCost('TOWN_CENTER', 99)).toEqual({
      wood: 238_490,
      food: 0,
      gold: 0,
      stone: 86_724
    });
  });

  it('clamps every type at its own cap', () => {
    expect(getBuildingUpgradeTimeMs('HOUSE', 500)).toBe(
      getBuildingUpgradeTimeMs('HOUSE', MAX_CORE_BUILDING_LEVEL)
    );
    expect(getBuildingUpgradeTimeMs('MILL', 500)).toBe(getBuildingUpgradeTimeMs('MILL', 10));
    expect(getBuildingUpgradeCost('HOUSE', 500)).toEqual(
      getBuildingUpgradeCost('HOUSE', MAX_CORE_BUILDING_LEVEL)
    );
  });
});

describe('Town Center gate (LVL2)', () => {
  it('steps the requirement every five Town Center levels and asks nothing below 5', () => {
    expect([1, 4].map(getRequiredCoreLevel)).toEqual([0, 0]);
    expect(getRequiredCoreLevel(5)).toBe(5);
    expect(getRequiredCoreLevel(9)).toBe(5);
    expect(getRequiredCoreLevel(10)).toBe(10);
    expect(getRequiredCoreLevel(49)).toBe(45);
    expect(getRequiredCoreLevel(99)).toBe(95);
  });

  it('reports each pillar as met or missing, in a stable order', () => {
    expect(getCoreLevelGaps({ HOUSE: 10, BARRACKS: 4, FARM: 10 }, 10)).toEqual([
      { type: 'HOUSE', current: 10, required: 10, met: true },
      { type: 'BARRACKS', current: 4, required: 10, met: false },
      { type: 'FARM', current: 10, required: 10, met: true },
      { type: 'TOWER', current: 0, required: 10, met: false }
    ]);
  });

  it('treats a missing or broken level map as "nothing built"', () => {
    expect(getCoreLevelGaps(undefined, 5).every((gap) => !gap.met)).toBe(true);
    expect(getCoreLevelGaps({ HOUSE: Number.NaN }, 5)[0].current).toBe(0);
    // Below the first step every gap is already met, gate or not.
    expect(getCoreLevelGaps(undefined, 4).every((gap) => gap.met)).toBe(true);
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

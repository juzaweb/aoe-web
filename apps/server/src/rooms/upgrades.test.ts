import { describe, expect, it } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  CORE_BUILDING_TYPES,
  MAX_BUILDING_LEVEL,
  MAX_UNIT_LEVEL,
  UNIT_BLUEPRINTS,
  buildingTypeForUnit,
  getBuildingLevelStats,
  getBuildingMaxLevel,
  getBuildingUpgradeCost,
  getBuildingUpgradeTimeMs,
  getBuildingVisualTier,
  getBuildingVisualTierCount,
  getBuildingVisualTierName,
  getBuildingVisualTierNameForTier,
  getCoreLevelGaps,
  getNextVisualTierLevel,
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

describe('military buildings (MIL-01)', () => {
  it('gives each unit line exactly one trainer', () => {
    expect(buildingTypeForUnit('VILLAGER')).toBe('TOWN_CENTER');
    expect(buildingTypeForUnit('SPEARMAN')).toBe('BARRACKS');
    expect(buildingTypeForUnit('ARCHER')).toBe('ARCHERY_RANGE');
    expect(buildingTypeForUnit('CAVALRY')).toBe('STABLE');
    expect(buildingTypeForUnit('DRAGON')).toBeNull();
  });

  it('trains one unit line per military building', () => {
    expect(BUILDING_BLUEPRINTS.BARRACKS.trainableUnits).toEqual(['SPEARMAN']);
    expect(BUILDING_BLUEPRINTS.STABLE.trainableUnits).toEqual(['CAVALRY']);
    expect(BUILDING_BLUEPRINTS.ARCHERY_RANGE.trainableUnits).toEqual(['ARCHER']);
  });

  it('counts all three military branches as Town Center pillars', () => {
    expect(CORE_BUILDING_TYPES).toEqual([
      'HOUSE',
      'BARRACKS',
      'STABLE',
      'ARCHERY_RANGE',
      'FARM',
      'TOWER'
    ]);
  });
});

describe('level stats', () => {
  it('keeps level 1 identical to the blueprint', () => {
    expect(getBuildingLevelStats('TOWN_CENTER', 1)).toEqual({
      maxHp: BUILDING_BLUEPRINTS.TOWN_CENTER.maxHp,
      attackPower: BUILDING_BLUEPRINTS.TOWN_CENTER.attackPower,
      populationProvided: BUILDING_BLUEPRINTS.TOWN_CENTER.populationProvided,
      gatherCapacity: 0
    });
    expect(getUnitLevelStats('SPEARMAN', 1)).toEqual({
      maxHp: UNIT_BLUEPRINTS.SPEARMAN.maxHp,
      attackPower: UNIT_BLUEPRINTS.SPEARMAN.attackPower,
      carryCapacity: UNIT_BLUEPRINTS.SPEARMAN.carryCapacity
    });
  });

  it('caps every building at ten levels', () => {
    expect(getBuildingMaxLevel('TOWN_CENTER')).toBe(10);
    expect(getBuildingMaxLevel('HOUSE')).toBe(10);
    expect(getBuildingMaxLevel('BARRACKS')).toBe(10);
    expect(getBuildingMaxLevel('FARM')).toBe(10);
    expect(getBuildingMaxLevel('TOWER')).toBe(10);
    expect(getBuildingMaxLevel('LUMBER_CAMP')).toBe(10);
    expect(getBuildingMaxLevel('MILL')).toBe(10);
    expect(getBuildingMaxLevel('MINING_CAMP')).toBe(10);
  });

  it('scales building HP and population linearly, clamping to the cap', () => {
    expect(getBuildingLevelStats('TOWN_CENTER', 10)).toMatchObject({
      maxHp: 2832,
      populationProvided: 24
    });
    // An unknown level still resolves against the type's maximum.
    expect(getBuildingLevelStats('TOWN_CENTER', 999).maxHp).toBe(2832);
    expect(getBuildingLevelStats('TOWN_CENTER', -3).maxHp).toBe(2400);
    // A house gains its one extra point when 2%/level rounds 5 up to 6.
    expect(getBuildingLevelStats('HOUSE', 5).populationProvided).toBe(5);
    expect(getBuildingLevelStats('HOUSE', 6).populationProvided).toBe(6);
    expect(getBuildingLevelStats('HOUSE', 10).populationProvided).toBe(6);
  });

  it('grows a farm harvest capacity by 10% per level', () => {
    const base = BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0;
    expect(getBuildingLevelStats('FARM', 1).gatherCapacity).toBe(base);
    expect(getBuildingLevelStats('FARM', 10).gatherCapacity).toBe(Math.round(base * 1.9));
    expect(getBuildingLevelStats('FARM', 999).gatherCapacity).toBe(Math.round(base * 1.9));
    // Only gatherable types hold a harvest.
    expect(getBuildingLevelStats('HOUSE', 10).gatherCapacity).toBe(0);
    expect(getBuildingLevelStats('TOWER', 5).gatherCapacity).toBe(0);
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
    for (let level = 1; level < 10; level++) {
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

describe('ten-level progression curve (LVL2)', () => {
  it('compounds every step by 3x, starting at 7.5s for the Town Center', () => {
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 1)).toBe(7_500);
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 2)).toBe(22_500);
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 3)).toBe(67_500);
    // Duration follows each blueprint's own build time: 5s House -> 2.5s.
    expect(getBuildingUpgradeTimeMs('HOUSE', 1)).toBe(2_500);
    // The last step of the ladder (level 9) is 13h40 for the Town Center.
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 9)).toBe(49_207_500);
  });

  it('caps the ladder instead of running out of road', () => {
    // Beyond level 10 the answer is the level-10 step, never an unbounded value.
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 100)).toBe(147_622_500);
    expect(getBuildingUpgradeTimeMs('TOWN_CENTER', 100)).toBe(
      getBuildingUpgradeTimeMs('TOWN_CENTER', 10)
    );
  });

  it('prices the first and last steps as documented', () => {
    expect(getBuildingUpgradeCost('TOWN_CENTER', 1)).toEqual({
      wood: 138,
      food: 0,
      gold: 0,
      stone: 50
    });
    expect(getBuildingUpgradeCost('TOWN_CENTER', 5)).toEqual({
      wood: 393,
      food: 0,
      gold: 0,
      stone: 143
    });
    expect(getBuildingUpgradeCost('TOWN_CENTER', 9)).toEqual({
      wood: 1_122,
      food: 0,
      gold: 0,
      stone: 408
    });
    expect(getBuildingUpgradeCost('TOWN_CENTER', 10)).toEqual({
      wood: 1_458,
      food: 0,
      gold: 0,
      stone: 530
    });
  });

  it('clamps every type at its own cap', () => {
    expect(getBuildingUpgradeTimeMs('HOUSE', 500)).toBe(
      getBuildingUpgradeTimeMs('HOUSE', MAX_BUILDING_LEVEL)
    );
    expect(getBuildingUpgradeTimeMs('MILL', 500)).toBe(getBuildingUpgradeTimeMs('MILL', 10));
    expect(getBuildingUpgradeCost('HOUSE', 500)).toEqual(
      getBuildingUpgradeCost('HOUSE', MAX_BUILDING_LEVEL)
    );
  });
});

describe('Town Center gate (LVL2)', () => {
  it('demands the Town Center level itself on every step', () => {
    expect(getRequiredCoreLevel(1)).toBe(1);
    expect(getRequiredCoreLevel(4)).toBe(4);
    expect(getRequiredCoreLevel(9)).toBe(9);
    expect(getRequiredCoreLevel(10)).toBe(10);
    // Out-of-range input clamps to the ladder, not to a made-up step.
    expect(getRequiredCoreLevel(0)).toBe(1);
    expect(getRequiredCoreLevel(99)).toBe(10);
  });

  it('reports each pillar as met or missing, in a stable order', () => {
    expect(getCoreLevelGaps({ HOUSE: 10, BARRACKS: 4, FARM: 10 }, 10)).toEqual([
      { type: 'HOUSE', current: 10, required: 10, met: true },
      { type: 'BARRACKS', current: 4, required: 10, met: false },
      { type: 'STABLE', current: 0, required: 10, met: false },
      { type: 'ARCHERY_RANGE', current: 0, required: 10, met: false },
      { type: 'FARM', current: 10, required: 10, met: true },
      { type: 'TOWER', current: 0, required: 10, met: false }
    ]);
  });

  it('treats a missing or broken level map as "nothing built"', () => {
    expect(getCoreLevelGaps(undefined, 5).every((gap) => !gap.met)).toBe(true);
    expect(getCoreLevelGaps({ HOUSE: Number.NaN }, 5)[0].current).toBe(0);
    // Every step is gated now, so a level-4 Town Center still needs every
    // pillar at level 4 — no free upgrade at the bottom of the ladder.
    expect(getCoreLevelGaps(undefined, 4).every((gap) => !gap.met)).toBe(true);
    expect(
      getCoreLevelGaps(
        { HOUSE: 4, BARRACKS: 4, STABLE: 4, ARCHERY_RANGE: 4, FARM: 4, TOWER: 4 },
        4
      ).every((gap) => gap.met)
    ).toBe(true);
  });
});

describe('visual tiers (LVL3)', () => {
  it('steps the house shape at its four milestones', () => {
    const expected: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
      [5, 3],
      [6, 4],
      [7, 4],
      [8, 5],
      [10, 5]
    ];
    for (const [level, tier] of expected) {
      expect(getBuildingVisualTier('HOUSE', level), `level ${level}`).toBe(tier);
    }
  });

  it('clamps out-of-range levels instead of asking for a missing sheet', () => {
    expect(getBuildingVisualTier('HOUSE', 0)).toBe(1);
    expect(getBuildingVisualTier('HOUSE', -7)).toBe(1);
    expect(getBuildingVisualTier('HOUSE', 100000)).toBe(5);
  });

  it('leaves every other building level-invariant', () => {
    for (const type of [
      'TOWN_CENTER',
      'BARRACKS',
      'STABLE',
      'ARCHERY_RANGE',
      'FARM',
      'TOWER'
    ] as const) {
      expect(getBuildingVisualTierCount(type)).toBe(1);
      expect(getBuildingVisualTier(type, 10)).toBe(1);
      expect(getBuildingVisualTierName(type, 10)).toBeNull();
      expect(getNextVisualTierLevel(type, 1)).toBeNull();
    }
  });

  it('names each house tier and reports when the next one arrives', () => {
    expect(getBuildingVisualTierCount('HOUSE')).toBe(5);
    expect(getBuildingVisualTierName('HOUSE', 1)).toBe('Thatched Hut');
    expect(getBuildingVisualTierName('HOUSE', 4)).toBe('Stone Cottage');
    expect(getBuildingVisualTierName('HOUSE', 8)).toBe('Manor');
    expect(getNextVisualTierLevel('HOUSE', 1)).toBe(2);
    expect(getNextVisualTierLevel('HOUSE', 3)).toBe(4);
    // The fifth shape arrives at level 8, inside the ten-level cap.
    expect(getNextVisualTierLevel('HOUSE', 10)).toBeNull();
  });

  it('names a tier by index so a degraded sprite keeps an honest label', () => {
    expect(getBuildingVisualTierNameForTier('HOUSE', 1)).toBe('Thatched Hut');
    expect(getBuildingVisualTierNameForTier('HOUSE', 5)).toBe('Manor');
    // Out of range and level-invariant types have no name.
    expect(getBuildingVisualTierNameForTier('HOUSE', 0)).toBeNull();
    expect(getBuildingVisualTierNameForTier('HOUSE', 6)).toBeNull();
    expect(getBuildingVisualTierNameForTier('HOUSE', Number.NaN)).toBeNull();
    expect(getBuildingVisualTierNameForTier('FARM', 1)).toBeNull();
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

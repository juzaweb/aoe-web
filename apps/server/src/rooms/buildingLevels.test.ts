import { describe, expect, it } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  UNIT_BLUEPRINTS,
  dropOffGatherMultiplier,
  dropOffRange,
  dropOffRangeFor,
  gatherIntervalMs,
  getEffectiveTrainTimeMs,
  getEffectiveUnitAttackPower,
  getEffectiveUnitMaxHp,
  getGatherBuildingType,
  getUnitTrainerBuilding,
  trainerSpeedMultiplier,
  trainerUnitBuffMultiplier,
  unitTrainerBuffMultiplier,
  unitTrainerSpeedMultiplier
} from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { WorldState } from '../schema/WorldState.js';
import {
  dropOffRangeOf,
  findBuildingLevel,
  findOwnerBuildingLevels,
  gatherMultiplierFor,
  trainerLevelFor
} from './buildingLevels.js';

function addBuilding(
  state: WorldState,
  options: {
    id: string;
    ownerId: string;
    type: BuildingType;
    level?: number;
    isConstructed?: boolean;
  }
): BuildingState {
  const building = new BuildingState();
  building.id = options.id;
  building.ownerId = options.ownerId;
  building.type = options.type;
  building.level = options.level ?? 1;
  building.isConstructed = options.isConstructed ?? true;
  state.buildings.set(building.id, building);
  return building;
}

describe('building level formulas (LVL4)', () => {
  it('starts at 1.0 on level 1 and clamps bad input', () => {
    for (const value of [1, 0, -5, Number.NaN]) {
      expect(trainerSpeedMultiplier(value)).toBe(1);
      expect(trainerUnitBuffMultiplier(value)).toBe(1);
      expect(dropOffGatherMultiplier(value)).toBe(1);
      expect(dropOffRangeFor('LUMBER_CAMP', value)).toBeCloseTo(1.5, 5);
    }
  });

  it('reaches the documented level-10 values', () => {
    expect(trainerSpeedMultiplier(10)).toBeCloseTo(0.73, 5);
    expect(trainerUnitBuffMultiplier(10)).toBeCloseTo(1.27, 5);
    expect(dropOffGatherMultiplier(10)).toBeCloseTo(1.45, 5);
    expect(dropOffRange(10)).toBeCloseTo(3.75, 5);
    // Several levels above the cap read as the cap, never as a stronger buff.
    expect(trainerSpeedMultiplier(100000)).toBeCloseTo(0.73, 5);
  });

  it('maps each unit to its trainer and each resource to its camp', () => {
    expect(getUnitTrainerBuilding('VILLAGER')).toBe('TOWN_CENTER');
    expect(getUnitTrainerBuilding('SPEARMAN')).toBe('BARRACKS');
    expect(getUnitTrainerBuilding('CAVALRY')).toBe('STABLE');
    expect(getUnitTrainerBuilding('ARCHER')).toBe('ARCHERY_RANGE');
    expect(getUnitTrainerBuilding('UNKNOWN')).toBeNull();

    expect(getGatherBuildingType('wood')).toBe('LUMBER_CAMP');
    expect(getGatherBuildingType('food')).toBe('MILL');
    expect(getGatherBuildingType('gold')).toBe('MINING_CAMP');
    expect(getGatherBuildingType('stone')).toBe('MINING_CAMP');
    expect(getGatherBuildingType('UNKNOWN')).toBeNull();
  });

  it('never applies the trainer multiplier to villagers', () => {
    expect(unitTrainerBuffMultiplier('VILLAGER', 10)).toBe(1);
    expect(unitTrainerSpeedMultiplier('VILLAGER', 10)).toBe(1);
    expect(unitTrainerBuffMultiplier('SPEARMAN', 10)).toBeCloseTo(1.27, 5);
    expect(unitTrainerSpeedMultiplier('SPEARMAN', 10)).toBeCloseTo(0.73, 5);
  });

  it('multiplies research, capital aura and trainer together', () => {
    expect(getEffectiveUnitMaxHp('SPEARMAN', 10, 10, 10)).toBe(
      Math.round(90 * 1.45 * 1.18 * 1.27)
    );
    expect(getEffectiveUnitAttackPower('SPEARMAN', 10, 10, 10)).toBeCloseTo(
      8 * 1.45 * 1.09 * 1.27,
      2
    );
    expect(getEffectiveUnitMaxHp('VILLAGER', 1, 10, 10)).toBe(
      Math.round(UNIT_BLUEPRINTS.VILLAGER.maxHp * 1.18)
    );
  });

  it('shortens training time by both factors and never goes negative', () => {
    expect(getEffectiveTrainTimeMs('SPEARMAN', 10, 10)).toBe(
      Math.round(UNIT_BLUEPRINTS.SPEARMAN.trainTimeMs * 0.82 * 0.73)
    );
    expect(getEffectiveTrainTimeMs('VILLAGER', 10, 10)).toBe(
      Math.round(UNIT_BLUEPRINTS.VILLAGER.trainTimeMs * 0.82)
    );
    expect(getEffectiveTrainTimeMs('SPEARMAN', 10, 10)).toBeGreaterThan(0);
  });

  it('folds the gather multiplier into the harvest interval', () => {
    expect(gatherIntervalMs('wood')).toBe(500);
    expect(gatherIntervalMs('wood', 1.45)).toBeCloseTo(1000 / 2.9, 6);
    // Bad multipliers are ignored rather than producing an infinite rate.
    expect(gatherIntervalMs('wood', 0)).toBe(500);
    expect(gatherIntervalMs('wood', Number.NaN)).toBe(500);
  });

  it('scales only the three camps, not the Town Center', () => {
    for (const camp of ['LUMBER_CAMP', 'MILL', 'MINING_CAMP'] as BuildingType[]) {
      expect(dropOffRangeFor(camp, 10)).toBeCloseTo(3.75, 5);
    }
    for (const type of ['TOWN_CENTER', 'HOUSE', 'TOWER'] as BuildingType[]) {
      expect(dropOffRangeFor(type, 10)).toBeCloseTo(1.5, 5);
    }
  });
});

describe('owner building levels (LVL4)', () => {
  it('reads the tallest finished building per type and ignores foundations', () => {
    const state = new WorldState();
    addBuilding(state, { id: 'b1', ownerId: 'a', type: 'BARRACKS', level: 4 });
    addBuilding(state, { id: 'b2', ownerId: 'a', type: 'BARRACKS', level: 8 });
    addBuilding(state, {
      id: 'b3',
      ownerId: 'a',
      type: 'BARRACKS',
      level: 10,
      isConstructed: false
    });
    addBuilding(state, { id: 'b4', ownerId: 'b', type: 'BARRACKS', level: 9 });

    expect(findBuildingLevel(state, 'a', 'BARRACKS')).toBe(8);
    expect(findOwnerBuildingLevels(state, 'a').BARRACKS).toBe(8);
    expect(findOwnerBuildingLevels(state, 'a').MILL).toBeUndefined();
  });

  it('turns owner levels into trainer and gather rules with level-1 fallbacks', () => {
    const levels = { BARRACKS: 10, LUMBER_CAMP: 10 };
    expect(trainerLevelFor(levels, 'SPEARMAN')).toBe(10);
    expect(trainerLevelFor(levels, 'ARCHER')).toBe(1);
    expect(trainerLevelFor(levels, 'VILLAGER')).toBe(1);
    expect(gatherMultiplierFor(levels, 'wood')).toBeCloseTo(1.45, 5);
    expect(gatherMultiplierFor(levels, 'food')).toBe(1);
  });

  it('reads a building-specific unload ring from its own level', () => {
    const state = new WorldState();
    const mill = addBuilding(state, {
      id: 'b_mill',
      ownerId: 'a',
      type: 'MILL',
      level: 10
    });
    const townCenter = addBuilding(state, {
      id: 'b_tc',
      ownerId: 'a',
      type: 'TOWN_CENTER',
      level: 10
    });

    expect(dropOffRangeOf(mill)).toBeCloseTo(dropOffRange(10), 5);
    expect(dropOffRangeOf(townCenter)).toBeCloseTo(1.5, 5);
    expect(BUILDING_BLUEPRINTS.MILL.dropOffs).toContain('food');
  });
});

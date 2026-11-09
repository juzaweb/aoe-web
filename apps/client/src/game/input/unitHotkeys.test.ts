import { describe, expect, it } from 'vitest';
import { BUILDING_BLUEPRINTS, type UnitType } from '@chien-quoc/shared';
import { UNIT_TRAINING_HOTKEYS, UNIT_TRAINING_HOTKEY_BY_TYPE } from './unitHotkeys.js';

describe('unit training hotkeys (UIX-04)', () => {
  it('binds each unit type to exactly one key', () => {
    const keys = UNIT_TRAINING_HOTKEYS.map((entry) => entry.key);
    const types = UNIT_TRAINING_HOTKEYS.map((entry) => entry.unitType);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it('only advertises unit types some building can actually train', () => {
    const trainable = new Set<UnitType>();
    Object.values(BUILDING_BLUEPRINTS).forEach((blueprint) => {
      blueprint.trainableUnits.forEach((unitType) => trainable.add(unitType));
    });
    UNIT_TRAINING_HOTKEYS.forEach(({ unitType }) => {
      expect(trainable.has(unitType)).toBe(true);
    });
  });

  it('exposes the reverse lookup the production panel renders', () => {
    UNIT_TRAINING_HOTKEYS.forEach(({ key, unitType }) => {
      expect(UNIT_TRAINING_HOTKEY_BY_TYPE[unitType]).toBe(key);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { BURN_HP_RATIO, isBuildingBurning } from './buildingFire.js';

const built = (hp: number, maxHp = 100) => ({
  isConstructed: true,
  hp,
  maxHp
});

describe('isBuildingBurning', () => {
  it('burns strictly below half health', () => {
    expect(BURN_HP_RATIO).toBe(0.5);
    expect(isBuildingBurning(built(49))).toBe(true);
    expect(isBuildingBurning(built(1))).toBe(true);
    expect(isBuildingBurning(built(0.01))).toBe(true);
  });

  it('does not burn at exactly half health or above', () => {
    expect(isBuildingBurning(built(50))).toBe(false);
    expect(isBuildingBurning(built(51))).toBe(false);
    expect(isBuildingBurning(built(100))).toBe(false);
  });

  it('never burns a foundation still under construction', () => {
    expect(isBuildingBurning({ isConstructed: false, hp: 10, maxHp: 100 })).toBe(false);
    expect(isBuildingBurning({ hp: 10, maxHp: 100 })).toBe(false);
  });

  it('never burns a destroyed or malformed building', () => {
    expect(isBuildingBurning(built(0))).toBe(false);
    expect(isBuildingBurning({ isConstructed: true, hp: 10, maxHp: 0 })).toBe(false);
    expect(isBuildingBurning({ isConstructed: true, hp: 10 })).toBe(false);
    expect(isBuildingBurning({ isConstructed: true, maxHp: 100 })).toBe(false);
    expect(isBuildingBurning({ isConstructed: true, hp: Number.NaN, maxHp: 100 })).toBe(false);
    expect(isBuildingBurning(null)).toBe(false);
    expect(isBuildingBurning(undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { shouldAlertOnBuildingRemoval } from './foundationRemoval.js';

describe('shouldAlertOnBuildingRemoval', () => {
  it('null building -> false', () => {
    expect(shouldAlertOnBuildingRemoval(null, 'me', false)).toBe(false);
  });

  it('undefined building -> false', () => {
    expect(shouldAlertOnBuildingRemoval(undefined, 'me', false)).toBe(false);
  });

  it('different owner -> false', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'enemy', isConstructed: false, hp: 1 }, 'me', false)).toBe(false);
  });

  it('empty myOwnerId -> false', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: false, hp: 1 }, '', false)).toBe(false);
  });

  it('cancelled -> false', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: false, hp: 1 }, 'me', true)).toBe(false);
  });

  it('constructed, hp>0 -> false', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: true, hp: 50 }, 'me', false)).toBe(false);
  });

  it('constructed, hp<=0 -> true', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: true, hp: 0 }, 'me', false)).toBe(true);
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: true, hp: -1 }, 'me', false)).toBe(true);
  });

  it('foundation, hp=1 -> true', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: false, hp: 1 }, 'me', false)).toBe(true);
  });

  it('foundation, cancelled -> false', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', isConstructed: false, hp: 1 }, 'me', true)).toBe(false);
  });

  it('unknown construction state treated as foundation -> true', () => {
    expect(shouldAlertOnBuildingRemoval({ ownerId: 'me', hp: 1 }, 'me', false)).toBe(true);
  });
});

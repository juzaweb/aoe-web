import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCENT_DEPTH_OFFSET,
  RecentOwnerIndex,
  accentActionKey,
  accentDepth,
  accentTexture,
  isAccentEnabled,
  resolveAccent,
  setAccentEnabled
} from './entityAccent.js';
import { OwnerColorRegistry, UNKNOWN_OWNER_COLOR } from './ownerColor.js';
import { DIRECTION_NAMES } from './unitDirections.js';

/**
 * TEAM-05: the accent layer is the second sprite that carries the team colour.
 *
 * The decisions are pure so they can be checked here instead of in a Phaser
 * scene: whether a unit gets the layer at all, and which colour it multiplies.
 */
describe('entityAccent', () => {
  const colors = new OwnerColorRegistry((ownerId) =>
    ({ alice: '#3b82f6', bob: '#ef4444' })[ownerId as 'alice' | 'bob']
  );

  afterEach(() => {
    setAccentEnabled(true);
  });

  it('names the accent sheet after the body sheet', () => {
    expect(accentTexture('SPEARMAN', 'walk')).toBe('unit_SPEARMAN_act_walk_accent');
    expect(accentTexture('SPEARMAN', 'death')).toBe('unit_SPEARMAN_act_death_accent');
  });

  it('names one accent clip per action and facing, in the sheet row order', () => {
    expect(accentActionKey('SPEARMAN', 'walk', 0)).toBe('spearman_walk_accent_E');
    expect(accentActionKey('SPEARMAN', 'walk', 3)).toBe('spearman_walk_accent_SW');
    expect(accentActionKey('SPEARMAN', 'attack', DIRECTION_NAMES.length - 1)).toBe(
      'spearman_attack_accent_NE'
    );
  });

  it('draws the accent one display step above the body', () => {
    expect(ACCENT_DEPTH_OFFSET).toBe(1);
    expect(accentDepth(1000)).toBe(1001);
    expect(accentDepth(-4)).toBe(-3);
  });

  it('enables the layer for a unit that ships an accent sheet', () => {
    const decision = resolveAccent(
      { unitType: 'SPEARMAN', ownerId: 'alice', sheetAvailable: true },
      colors
    );
    expect(decision).toEqual({ enabled: true, tint: 0x3b82f6 });
  });

  it('gives each owner its own tint', () => {
    const alice = resolveAccent(
      { unitType: 'SPEARMAN', ownerId: 'alice', sheetAvailable: true },
      colors
    );
    const bob = resolveAccent(
      { unitType: 'SPEARMAN', ownerId: 'bob', sheetAvailable: true },
      colors
    );
    expect(alice.tint).not.toBe(bob.tint);
  });

  it('tints an unknown owner with UNKNOWN_OWNER_COLOR instead of throwing', () => {
    const decision = resolveAccent(
      { unitType: 'SPEARMAN', ownerId: 'stranger', sheetAvailable: true },
      colors
    );
    expect(decision).toEqual({ enabled: true, tint: UNKNOWN_OWNER_COLOR });
  });

  it('stays off for a unit still drawn from painted sheets', () => {
    const decision = resolveAccent(
      { unitType: 'VILLAGER', ownerId: 'alice', sheetAvailable: true },
      colors
    );
    expect(decision.enabled).toBe(false);
  });

  it('falls back to the body alone when the accent sheet is missing', () => {
    const decision = resolveAccent(
      { unitType: 'SPEARMAN', ownerId: 'alice', sheetAvailable: false },
      colors
    );
    expect(decision.enabled).toBe(false);
  });

  it('is switchable off for a before/after comparison', () => {
    expect(isAccentEnabled()).toBe(true);
    setAccentEnabled(false);
    expect(isAccentEnabled()).toBe(false);
    expect(
      resolveAccent({ unitType: 'SPEARMAN', ownerId: 'alice', sheetAvailable: true }, colors)
        .enabled
    ).toBe(false);
  });

  it('gives a corpse the same accent as the unit it came from', () => {
    // A corpse is the same unit type and owner, drawn on the death sheet; nothing
    // in the decision changes with the action, which is why the fallen soldier
    // keeps its team colour (D8).
    const corpse = resolveAccent(
      { unitType: 'SPEARMAN', ownerId: 'bob', sheetAvailable: true },
      colors
    );
    expect(corpse).toEqual({ enabled: true, tint: 0xef4444 });
  });
});

describe('RecentOwnerIndex', () => {
  it('remembers an owner by unit id', () => {
    const index = new RecentOwnerIndex();
    index.remember('unit-1', 'alice');
    expect(index.ownerOf('unit-1')).toBe('alice');
  });

  it('answers an empty owner for a unit it never saw', () => {
    expect(new RecentOwnerIndex().ownerOf('unit-9')).toBe('');
  });

  it('ignores a unit with no owner', () => {
    const index = new RecentOwnerIndex();
    index.remember('unit-1', '');
    index.remember('', 'alice');
    expect(index.ownerOf('unit-1')).toBe('');
    expect(index.ownerOf('')).toBe('');
  });

  it('forgets one unit without touching the others', () => {
    const index = new RecentOwnerIndex();
    index.remember('unit-1', 'alice');
    index.remember('unit-2', 'bob');
    index.forget('unit-1');
    expect(index.ownerOf('unit-1')).toBe('');
    expect(index.ownerOf('unit-2')).toBe('bob');
  });

  it('clears every entry when the map changes', () => {
    const index = new RecentOwnerIndex();
    index.remember('unit-1', 'alice');
    index.clear();
    expect(index.ownerOf('unit-1')).toBe('');
  });

  it('drops the oldest entry past its capacity', () => {
    const index = new RecentOwnerIndex(2);
    index.remember('unit-1', 'alice');
    index.remember('unit-2', 'bob');
    index.remember('unit-3', 'carol');
    expect(index.ownerOf('unit-1')).toBe('');
    expect(index.ownerOf('unit-2')).toBe('bob');
    expect(index.ownerOf('unit-3')).toBe('carol');
  });
});

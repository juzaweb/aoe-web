import { describe, expect, it } from 'vitest';
import {
  BATTLEFIELD_MAP_SIZE,
  KINGDOM_MAP_SIZE,
  mapSizeForZone,
  zoneKindOf
} from '@chien-quoc/shared';
import { WorldState } from '../schema/WorldState.js';
import { terrainOf } from './mapLayout.js';

describe('zoneKindOf', () => {
  it('treats only kingdom-prefixed zones as kingdoms', () => {
    expect(zoneKindOf('kingdom:user-1')).toBe('kingdom');
    expect(zoneKindOf('battlefield')).toBe('battlefield');
    // Legacy snapshots and the bare test harness use `world`; they were 220x220.
    expect(zoneKindOf('world')).toBe('battlefield');
  });

  it('gives each zone the size of its map', () => {
    expect(mapSizeForZone('kingdom:user-1')).toEqual(KINGDOM_MAP_SIZE);
    expect(mapSizeForZone('battlefield')).toEqual(BATTLEFIELD_MAP_SIZE);
    expect(mapSizeForZone('world')).toEqual(BATTLEFIELD_MAP_SIZE);
  });
});

describe('terrainOf', () => {
  it('reads the size from the replicated state and the kind from the zone', () => {
    const state = new WorldState();
    state.zoneId = 'kingdom:user-1';
    state.mapWidth = KINGDOM_MAP_SIZE.width;
    state.mapHeight = KINGDOM_MAP_SIZE.height;

    expect(terrainOf(state)).toEqual({ ...KINGDOM_MAP_SIZE, kind: 'kingdom' });
  });

  it('trusts the state size over the zone default', () => {
    // A room whose state was restored before the size fields existed keeps the
    // size it actually simulates; the helper must not silently widen it.
    const state = new WorldState();
    state.zoneId = 'kingdom:user-1';
    state.mapWidth = 80;
    state.mapHeight = 80;

    expect(terrainOf(state)).toEqual({ width: 80, height: 80, kind: 'kingdom' });
  });
});

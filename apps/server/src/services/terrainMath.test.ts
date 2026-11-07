import { describe, expect, it } from 'vitest';
import {
  CITADEL_CLEAR_MARGIN,
  KINGDOM_MAP_SIZE,
  TERRAIN_BATTLEFIELD,
  TERRAIN_KINGDOM,
  citadelLayoutFor,
  citadelTownCenterFor,
  isPlazaTile,
  terrainForZone
} from '@chien-quoc/shared';

const ANCHOR = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);
const LAYOUT = citadelLayoutFor(ANCHOR.gridX, ANCHOR.gridY);

describe('terrainForZone', () => {
  it('picks the layout from the zone id', () => {
    expect(terrainForZone('kingdom:player-1')).toEqual(TERRAIN_KINGDOM);
    expect(terrainForZone('battlefield:player-1')).toEqual(TERRAIN_BATTLEFIELD);
  });
});

describe('isPlazaTile', () => {
  it('covers the centred citadel and stops at its margin', () => {
    expect(isPlazaTile(ANCHOR.gridX, ANCHOR.gridY, TERRAIN_KINGDOM)).toBe(true);
    expect(isPlazaTile(LAYOUT.originX, LAYOUT.originY, TERRAIN_KINGDOM)).toBe(true);
    expect(
      isPlazaTile(LAYOUT.originX - CITADEL_CLEAR_MARGIN - 1, ANCHOR.gridY, TERRAIN_KINGDOM)
    ).toBe(false);
    // The map centre is inside the citadel clearing, as it should be.
    expect(
      isPlazaTile(KINGDOM_MAP_SIZE.width / 2, KINGDOM_MAP_SIZE.height / 2, TERRAIN_KINGDOM)
    ).toBe(true);
  });

  it('never marks a battlefield tile', () => {
    const centre = TERRAIN_BATTLEFIELD.width / 2;
    expect(isPlazaTile(centre, centre, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isPlazaTile(0, 0, TERRAIN_BATTLEFIELD)).toBe(false);
  });
});

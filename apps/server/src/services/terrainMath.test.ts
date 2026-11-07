import { describe, expect, it } from 'vitest';
import {
  KINGDOM_MAP_SIZE,
  KINGDOM_PLAZA_RADIUS,
  TERRAIN_BATTLEFIELD,
  TERRAIN_KINGDOM,
  isPlazaTile,
  terrainForZone
} from '@chien-quoc/shared';

/** Centre tile of the kingdom map, which is where the Town Center is placed. */
const KINGDOM_CENTRE = Math.floor(KINGDOM_MAP_SIZE.width / 2);

describe('terrainForZone', () => {
  it('picks the layout from the zone id', () => {
    expect(terrainForZone('kingdom:player-1')).toEqual(TERRAIN_KINGDOM);
    expect(terrainForZone('battlefield:player-1')).toEqual(TERRAIN_BATTLEFIELD);
  });
});

describe('isPlazaTile', () => {
  it('covers the kingdom centre and stops at the plaza radius', () => {
    expect(isPlazaTile(KINGDOM_CENTRE, KINGDOM_CENTRE, TERRAIN_KINGDOM)).toBe(true);
    const inside = KINGDOM_PLAZA_RADIUS - 1;
    expect(isPlazaTile(KINGDOM_CENTRE + inside, KINGDOM_CENTRE, TERRAIN_KINGDOM)).toBe(true);
    const outside = KINGDOM_PLAZA_RADIUS + 1;
    expect(isPlazaTile(KINGDOM_CENTRE + outside, KINGDOM_CENTRE, TERRAIN_KINGDOM)).toBe(false);
  });

  it('never marks a battlefield tile', () => {
    const centre = TERRAIN_BATTLEFIELD.width / 2;
    expect(isPlazaTile(centre, centre, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isPlazaTile(0, 0, TERRAIN_BATTLEFIELD)).toBe(false);
  });
});

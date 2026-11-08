import { describe, expect, it } from 'vitest';
import {
  CITADEL_APPROACH_MARGIN,
  CITADEL_CLEAR_MARGIN,
  KINGDOM_MAP_SIZE,
  TERRAIN_BATTLEFIELD,
  TERRAIN_KINGDOM,
  citadelLayoutFor,
  citadelTownCenterFor,
  isCitadelAvenueTile,
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

  it('clears the avenue from the east gate to the map edge', () => {
    const gate = LAYOUT.gates[1];
    const avenueX = LAYOUT.originX + LAYOUT.sizeX + CITADEL_CLEAR_MARGIN + 1;

    expect(isPlazaTile(avenueX, gate.gridY, TERRAIN_KINGDOM)).toBe(true);
    expect(
      isPlazaTile(KINGDOM_MAP_SIZE.width - 1, gate.gridY, TERRAIN_KINGDOM)
    ).toBe(true);
    expect(
      isPlazaTile(avenueX, LAYOUT.gates[0].gridY - CITADEL_APPROACH_MARGIN - 1, TERRAIN_KINGDOM)
    ).toBe(false);
    expect(
      isPlazaTile(avenueX, LAYOUT.gates[2].gridY + CITADEL_APPROACH_MARGIN + 1, TERRAIN_KINGDOM)
    ).toBe(false);
    expect(isPlazaTile(LAYOUT.originX, gate.gridY, TERRAIN_KINGDOM)).toBe(true);
  });

  it('never marks a battlefield tile', () => {
    const centre = TERRAIN_BATTLEFIELD.width / 2;
    expect(isPlazaTile(centre, centre, TERRAIN_BATTLEFIELD)).toBe(false);
    expect(isPlazaTile(0, 0, TERRAIN_BATTLEFIELD)).toBe(false);
  });
});

describe('isCitadelAvenueTile', () => {
  it('covers the lane from the gate to the map edge only', () => {
    const gate = LAYOUT.gates[1];
    const avenueX = LAYOUT.originX + LAYOUT.sizeX;
    const gateMinY = Math.min(...LAYOUT.gates.map((g) => g.gridY));
    const gateMaxY = Math.max(...LAYOUT.gates.map((g) => g.gridY));

    expect(isCitadelAvenueTile(avenueX, gate.gridY, LAYOUT, KINGDOM_MAP_SIZE.width)).toBe(true);
    expect(
      isCitadelAvenueTile(KINGDOM_MAP_SIZE.width - 1, gate.gridY, LAYOUT, KINGDOM_MAP_SIZE.width)
    ).toBe(true);
    expect(
      isCitadelAvenueTile(
        avenueX,
        gateMinY - CITADEL_APPROACH_MARGIN,
        LAYOUT,
        KINGDOM_MAP_SIZE.width
      )
    ).toBe(true);

    // Outside the lane, behind the wall, and past the map edge are excluded.
    expect(
      isCitadelAvenueTile(
        avenueX,
        gateMinY - CITADEL_APPROACH_MARGIN - 1,
        LAYOUT,
        KINGDOM_MAP_SIZE.width
      )
    ).toBe(false);
    expect(
      isCitadelAvenueTile(
        avenueX,
        gateMaxY + CITADEL_APPROACH_MARGIN + 1,
        LAYOUT,
        KINGDOM_MAP_SIZE.width
      )
    ).toBe(false);
    expect(
      isCitadelAvenueTile(LAYOUT.originX - 1, gate.gridY, LAYOUT, KINGDOM_MAP_SIZE.width)
    ).toBe(false);
    expect(
      isCitadelAvenueTile(KINGDOM_MAP_SIZE.width, gate.gridY, LAYOUT, KINGDOM_MAP_SIZE.width)
    ).toBe(false);
  });
});

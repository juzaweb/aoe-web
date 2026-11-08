import { citadelLayoutFor, getIsoDepth } from '@chien-quoc/shared';
import { describe, expect, it } from 'vitest';
import { BUILDING_DEPTH_OFFSET, buildingDepth, wallDepth } from './isoDepth.js';

describe('draw order', () => {
  it('keys a building on its near corner, not one row past it', () => {
    const house = { type: 'HOUSE', gridX: 2, gridY: 23, sizeX: 2, sizeY: 2 };
    // (3,24) is the last tile the 2x2 footprint covers; (4,25) overshot it and
    // put the house in front of the wall tile bordering the compound.
    expect(buildingDepth(house)).toBe(getIsoDepth(3, 24, BUILDING_DEPTH_OFFSET));
  });

  it('sorts a player-painted wall exactly like the citadel ring', () => {
    expect(buildingDepth({ type: 'WALL', gridX: 7, gridY: 9, sizeX: 1, sizeY: 1 })).toBe(
      wallDepth(7, 9)
    );
  });

  it('draws the citadel south wall over the house standing against it', () => {
    const layout = citadelLayoutFor(50, 50);
    const houses = layout.slots.filter((slot) => slot.type === 'HOUSE');
    const last = houses[houses.length - 1];
    const southWallY = layout.originY + layout.sizeY - 1;

    // The house's wide artwork reaches the wall tiles on its own column and one
    // to the east, so both must outrank it.
    const facing = layout.walls.filter(
      (wall) =>
        wall.gridY === southWallY &&
        wall.gridX >= last.gridX &&
        wall.gridX < last.gridX + last.sizeX + 1
    );
    expect(facing.length).toBeGreaterThan(0);

    const houseDepth = buildingDepth(last);
    for (const wall of facing) {
      expect(wallDepth(wall.gridX, wall.gridY)).toBeGreaterThan(houseDepth);
    }
  });

  it('draws a player-painted wall over a house painted against it', () => {
    const house = buildingDepth({ type: 'HOUSE', gridX: 10, gridY: 10, sizeX: 2, sizeY: 2 });
    // The tiles immediately south of the footprint share the house's row.
    expect(wallDepth(10, 12)).toBeGreaterThan(house);
    expect(wallDepth(11, 12)).toBeGreaterThan(house);
  });

  it('keeps a unit standing in front of a building in front of it', () => {
    // The old key (`gridX + sizeX, gridY + sizeY`) put this unit behind the
    // house it stands beside.
    const house = buildingDepth({ type: 'HOUSE', gridX: 10, gridY: 10, sizeX: 2, sizeY: 2 });
    expect(getIsoDepth(11, 12, 25)).toBeGreaterThan(house);
  });
});

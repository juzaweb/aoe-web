import { describe, expect, it } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  CITADEL_HEIGHT,
  CITADEL_HP_THRESHOLD,
  CITADEL_WIDTH,
  citadelLayoutFor,
  citadelStatus,
  citadelTownCenterFor,
  getBuildingLevelStats,
  isCitadelBreached
} from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { WorldState } from '../schema/WorldState.js';
import {
  ensureCitadel,
  footprintTouchesCitadelWall,
  restoreCitadel,
  spawnMissingCitadelBuildings
} from './citadel.js';

const TC_X = 53;
const TC_Y = 53;

function addTownCenter(state: WorldState, ownerId = 'defender'): BuildingState {
  const stats = getBuildingLevelStats('TOWN_CENTER', 1);
  const townCenter = new BuildingState();
  townCenter.id = 'b-tc';
  townCenter.ownerId = ownerId;
  townCenter.type = 'TOWN_CENTER';
  townCenter.gridX = TC_X;
  townCenter.gridY = TC_Y;
  townCenter.sizeX = BUILDING_BLUEPRINTS.TOWN_CENTER.sizeX;
  townCenter.sizeY = BUILDING_BLUEPRINTS.TOWN_CENTER.sizeY;
  townCenter.hp = stats.maxHp;
  townCenter.maxHp = stats.maxHp;
  townCenter.level = 1;
  townCenter.isConstructed = true;
  townCenter.constructionProgress = 100;
  state.buildings.set(townCenter.id, townCenter);
  return townCenter;
}

function createKingdomState(ownerId = 'defender'): WorldState {
  const state = new WorldState();
  state.zoneId = `kingdom:${ownerId}`;
  state.mapWidth = 110;
  state.mapHeight = 110;
  return state;
}

function allBuildings(state: WorldState): BuildingState[] {
  return Array.from(state.buildings.values());
}

describe('citadel layout', () => {
  it('places one Town Center, two barracks and five houses', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    expect(layout.slots).toHaveLength(8);
    expect(layout.slots.filter((slot) => slot.type === 'TOWN_CENTER')).toHaveLength(1);
    expect(layout.slots.filter((slot) => slot.type === 'BARRACKS')).toHaveLength(2);
    expect(layout.slots.filter((slot) => slot.type === 'HOUSE')).toHaveLength(5);
    expect(layout.slots[0]).toMatchObject({ type: 'TOWN_CENTER', gridX: TC_X, gridY: TC_Y });
  });

  it('rings the compound with walls except at the single east gate', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    expect(layout.sizeX).toBe(CITADEL_WIDTH);
    expect(layout.sizeY).toBe(CITADEL_HEIGHT);
    // Square perimeter minus the three-tile gate in the east wall.
    expect(layout.walls).toHaveLength(2 * (CITADEL_WIDTH + CITADEL_HEIGHT) - 4 - 3);
    expect(layout.gates).toHaveLength(3);

    const wallKeys = new Set(layout.walls.map((tile) => `${tile.gridX},${tile.gridY}`));
    for (const gate of layout.gates) {
      expect(gate.gridX).toBe(layout.originX + layout.sizeX - 1);
      expect(wallKeys.has(`${gate.gridX},${gate.gridY}`)).toBe(false);
    }
  });

  it('groups the barracks north and the houses south of the walkway', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const barracks = layout.slots.filter((slot) => slot.type === 'BARRACKS');
    const houses = layout.slots.filter((slot) => slot.type === 'HOUSE');
    const townCenter = layout.slots.find((slot) => slot.type === 'TOWN_CENTER')!;

    // Every barracks tile is above the Town Center's walkway rows.
    for (const slot of barracks) {
      expect(slot.gridY + slot.sizeY).toBeLessThanOrEqual(townCenter.gridY);
    }
    // Every house tile is below it.
    for (const slot of houses) {
      expect(slot.gridY).toBeGreaterThanOrEqual(townCenter.gridY + townCenter.sizeY);
    }
  });

  it('stays a square after scaling up', () => {
    expect(CITADEL_WIDTH).toBe(CITADEL_HEIGHT);
  });

  it('keeps every building slot inside the inner courtyard', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    for (const slot of layout.slots) {
      expect(slot.gridX).toBeGreaterThanOrEqual(layout.innerMinX);
      expect(slot.gridY).toBeGreaterThanOrEqual(layout.innerMinY);
      expect(slot.gridX + slot.sizeX - 1).toBeLessThanOrEqual(layout.innerMaxX);
      expect(slot.gridY + slot.sizeY - 1).toBeLessThanOrEqual(layout.innerMaxY);
    }
  });

  it('keeps the Town Center taller than wide and the houses on the south wall', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const townCenter = layout.slots.find((slot) => slot.type === 'TOWN_CENTER')!;
    expect(townCenter.sizeX).toBe(BUILDING_BLUEPRINTS.TOWN_CENTER.sizeX);
    expect(townCenter.sizeY).toBe(BUILDING_BLUEPRINTS.TOWN_CENTER.sizeY);
    expect(townCenter.sizeY).toBeGreaterThan(townCenter.sizeX);

    for (const house of layout.slots.filter((slot) => slot.type === 'HOUSE')) {
      // Last row of the house footprint sits on the last inner row.
      expect(house.gridY + house.sizeY - 1).toBe(layout.innerMaxY);
    }
  });

  it('packs the five houses side by side at the rear of the compound', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const houses = layout.slots
      .filter((slot) => slot.type === 'HOUSE')
      .sort((a, b) => a.gridX - b.gridX);

    expect(houses[0].gridX).toBe(layout.innerMinX);
    for (let index = 1; index < houses.length; index++) {
      expect(houses[index].gridX).toBe(houses[index - 1].gridX + houses[index - 1].sizeX);
      expect(houses[index].gridY).toBe(houses[0].gridY);
    }
  });

  it('keeps the Town Center about four tiles from the rear wall', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const townCenter = layout.slots.find((slot) => slot.type === 'TOWN_CENTER')!;

    // `innerMinX` is the first interior tile, one step in from the west wall.
    // Four empty tiles sit between that wall and the Town Center's west edge.
    expect(townCenter.gridX - layout.innerMinX).toBe(4);
  });

  it('centres the compound in the middle of the map', () => {
    const target = citadelTownCenterFor(110, 110);
    const layout = citadelLayoutFor(target.gridX, target.gridY);

    const centredOriginX = Math.round((110 - CITADEL_WIDTH) / 2);
    const centredOriginY = Math.round((110 - CITADEL_HEIGHT) / 2);
    expect(layout.originX).toBe(centredOriginX);
    expect(layout.originY).toBe(centredOriginY);
  });
});

describe('citadel health', () => {
  it('is the sum of its eight buildings at full health', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    const status = citadelStatus(allBuildings(state), TC_X, TC_Y);
    const expectedMax =
      getBuildingLevelStats('TOWN_CENTER', 1).maxHp +
      2 * getBuildingLevelStats('BARRACKS', 1).maxHp +
      5 * getBuildingLevelStats('HOUSE', 1).maxHp;

    expect(status.maxHp).toBe(expectedMax);
    expect(status.hp).toBe(expectedMax);
    expect(status.ratio).toBe(1);
  });

  it('keeps the denominator fixed when a house is destroyed', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    spawnMissingCitadelBuildings(state, 'defender', townCenter);
    const full = citadelStatus(allBuildings(state), TC_X, TC_Y);

    const firstHouse = allBuildings(state).find((building) => building.type === 'HOUSE');
    expect(firstHouse).toBeDefined();
    state.buildings.delete(firstHouse!.id);

    const damaged = citadelStatus(allBuildings(state), TC_X, TC_Y);
    expect(damaged.maxHp).toBe(full.maxHp);
    expect(damaged.hp).toBe(full.hp - firstHouse!.maxHp);
    expect(damaged.ratio).toBeLessThan(1);
  });

  it('is breached at the configured share and not one point above it', () => {
    expect(CITADEL_HP_THRESHOLD).toBe(0.2);
    expect(isCitadelBreached(20, 100)).toBe(true);
    expect(isCitadelBreached(21, 100)).toBe(false);
    expect(isCitadelBreached(0, 100)).toBe(true);
    expect(isCitadelBreached(1, 0)).toBe(false);
  });
});

describe('citadel lifecycle', () => {
  it('retrofits the barracks and houses onto a Town-Center-only save', () => {
    const state = createKingdomState();
    addTownCenter(state);

    ensureCitadel(state, 'defender');

    const types = allBuildings(state).map((building) => building.type);
    expect(types.filter((type) => type === 'TOWN_CENTER')).toHaveLength(1);
    expect(types.filter((type) => type === 'BARRACKS')).toHaveLength(2);
    expect(types.filter((type) => type === 'HOUSE')).toHaveLength(5);
  });

  it('restores every building to full health after a raid', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    for (const building of allBuildings(state)) building.hp = 1;
    const house = allBuildings(state).find((building) => building.type === 'HOUSE')!;
    state.buildings.delete(house.id);

    restoreCitadel(state, 'defender');

    const buildings = allBuildings(state);
    expect(buildings).toHaveLength(8);
    for (const building of buildings) {
      expect(building.hp).toBe(building.maxHp);
    }
    const status = citadelStatus(buildings, TC_X, TC_Y);
    expect(status.ratio).toBe(1);
  });

  it('recentres a right-edge citadel and drops orphaned duplicates', () => {
    const state = createKingdomState();

    // The short-lived right-edge layout: TC at the legacy offset (12, 6).
    const stats = getBuildingLevelStats('TOWN_CENTER', 1);
    const rightEdgeTc = new BuildingState();
    rightEdgeTc.id = 'b-right-tc';
    rightEdgeTc.ownerId = 'defender';
    rightEdgeTc.type = 'TOWN_CENTER';
    rightEdgeTc.gridX = 110 - 6 - CITADEL_WIDTH + 12;
    rightEdgeTc.gridY = Math.floor((110 - CITADEL_HEIGHT) / 2) + 6;
    rightEdgeTc.sizeX = BUILDING_BLUEPRINTS.TOWN_CENTER.sizeX;
    rightEdgeTc.sizeY = BUILDING_BLUEPRINTS.TOWN_CENTER.sizeY;
    rightEdgeTc.hp = stats.maxHp;
    rightEdgeTc.maxHp = stats.maxHp;
    rightEdgeTc.level = 1;
    rightEdgeTc.isConstructed = true;
    rightEdgeTc.constructionProgress = 100;
    state.buildings.set(rightEdgeTc.id, rightEdgeTc);

    spawnMissingCitadelBuildings(state, 'defender', rightEdgeTc);

    // Orphaned houses from the original centre compound.
    for (let index = 0; index < 3; index++) {
      const orphan = new BuildingState();
      orphan.id = `b-orphan-${index}`;
      orphan.ownerId = 'defender';
      orphan.type = 'HOUSE';
      orphan.gridX = 49 + index * 3;
      orphan.gridY = 49;
      orphan.sizeX = BUILDING_BLUEPRINTS.HOUSE.sizeX;
      orphan.sizeY = BUILDING_BLUEPRINTS.HOUSE.sizeY;
      orphan.hp = getBuildingLevelStats('HOUSE', 1).maxHp;
      orphan.maxHp = orphan.hp;
      orphan.level = 1;
      orphan.isConstructed = true;
      orphan.constructionProgress = 100;
      state.buildings.set(orphan.id, orphan);
    }

    ensureCitadel(state, 'defender');

    const target = citadelTownCenterFor(110, 110);
    expect(rightEdgeTc.gridX).toBe(target.gridX);
    expect(rightEdgeTc.gridY).toBe(target.gridY);

    const buildings = allBuildings(state);
    expect(buildings.filter((building) => building.type === 'BARRACKS')).toHaveLength(2);
    expect(buildings.filter((building) => building.type === 'HOUSE')).toHaveLength(5);

    const layout = citadelLayoutFor(target.gridX, target.gridY);
    for (const slot of layout.slots) {
      expect(
        buildings.some(
          (building) =>
            building.type === slot.type &&
            building.gridX === slot.gridX &&
            building.gridY === slot.gridY
        )
      ).toBe(true);
    }
  });
});

describe('citadel walls', () => {
  it('block building footprints but leave the gates open', () => {
    const state = createKingdomState();
    addTownCenter(state);
    const layout = citadelLayoutFor(TC_X, TC_Y);

    const wall = layout.walls[0];
    expect(footprintTouchesCitadelWall(state, wall.gridX, wall.gridY, 1, 1)).toBe(true);

    const gate = layout.gates[0];
    expect(footprintTouchesCitadelWall(state, gate.gridX, gate.gridY, 1, 1)).toBe(false);

    expect(footprintTouchesCitadelWall(state, TC_X + 1, TC_Y + 1, 2, 2)).toBe(false);
  });

  it('does not exist on a battlefield', () => {
    const state = new WorldState();
    state.zoneId = 'battlefield';
    addTownCenter(state);

    expect(footprintTouchesCitadelWall(state, TC_X, TC_Y, 1, 1)).toBe(false);
  });
});

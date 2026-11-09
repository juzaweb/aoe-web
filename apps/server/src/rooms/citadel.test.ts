import { describe, expect, it } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  CITADEL_APPROACH_MARGIN,
  CITADEL_HEIGHT,
  CITADEL_HP_THRESHOLD,
  CITADEL_WIDTH,
  clearCitadelLayoutCache,
  citadelLayoutFor,
  citadelStatus,
  citadelTownCenterFor,
  getBuildingLevelStats,
  isCitadelBreached,
  isCitadelInteriorTile,
  isCitadelStairTile,
  isCitadelWallTopTile
} from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { UnitState } from '../schema/UnitState.js';
import { WorldState } from '../schema/WorldState.js';
import {
  clearCitadelResources,
  ensureCitadel,
  evictForeignUnitsFromCitadel,
  footprintTouchesCitadelWall,
  isInsideCitadelInterior,
  restoreCitadel,
  spawnMissingCitadelBuildings
} from './citadel.js';

const TC_X = 53;
const TC_Y = 53;

/**
 * Side of the square compound that shipped before the citadel was enlarged.
 *
 * The migration test simulates a save written under that layout, so it must not
 * follow `CITADEL_WIDTH`: resizing today's citadel would silently move the fake
 * save out of the region the migration has to find.
 */
const LEGACY_CITADEL_SIZE = 17;

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
  it('memoizes citadelLayoutFor calls across multiple invocations', () => {
    clearCitadelLayoutCache();
    const layout1 = citadelLayoutFor(TC_X, TC_Y);
    const layout2 = citadelLayoutFor(TC_X, TC_Y);
    expect(layout1).toBe(layout2);

    const layoutDifferent = citadelLayoutFor(TC_X + 1, TC_Y);
    expect(layoutDifferent).not.toBe(layout1);
    expect(layoutDifferent.originX).toBe(layout1.originX + 1);
  });

  it('places one Town Center, one barracks, one archery range and five houses', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    expect(layout.slots).toHaveLength(8);
    expect(layout.slots.filter((slot) => slot.type === 'TOWN_CENTER')).toHaveLength(1);
    expect(layout.slots.filter((slot) => slot.type === 'BARRACKS')).toHaveLength(1);
    expect(layout.slots.filter((slot) => slot.type === 'ARCHERY_RANGE')).toHaveLength(1);
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

  it('flanks the gate with two stair flights that land on the wall ring', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    expect(layout.stairs).toHaveLength(2);

    const firstGateY = layout.gates[0].gridY;
    const lastGateY = layout.gates[layout.gates.length - 1].gridY;

    for (const stair of layout.stairs) {
      // Both steps are inside the courtyard, one tile apart, directly under the
      // wall tile they serve.
      expect(isCitadelInteriorTile(layout, stair.bottom.gridX, stair.bottom.gridY)).toBe(true);
      expect(isCitadelInteriorTile(layout, stair.top.gridX, stair.top.gridY)).toBe(true);
      expect(stair.top.gridX).toBe(stair.bottom.gridX + 1);
      expect(stair.wall.gridX).toBe(stair.top.gridX + 1);
      expect(stair.wall.gridY).toBe(stair.top.gridY);
      expect(isCitadelWallTopTile(layout, stair.wall.gridX, stair.wall.gridY)).toBe(true);
      expect(isCitadelStairTile(layout, stair.bottom.gridX, stair.bottom.gridY)).toBe(true);
      expect(isCitadelStairTile(layout, stair.top.gridX, stair.top.gridY)).toBe(true);

      // Flights sit outside the six east-wall tiles the gatehouse covers.
      expect(stair.bottom.gridY < firstGateY - 1 || stair.bottom.gridY > lastGateY + 2).toBe(
        true
      );
    }

    // One flight north of the gatehouse, one south.
    expect(layout.stairs[0].bottom.gridY).toBeLessThan(firstGateY);
    expect(layout.stairs[1].bottom.gridY).toBeGreaterThan(lastGateY);
  });

  it('puts the trainers on the north wall and the houses near the west wall', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const trainers = layout.slots.filter(
      (slot) => slot.type === 'BARRACKS' || slot.type === 'ARCHERY_RANGE'
    );
    const houses = layout.slots.filter((slot) => slot.type === 'HOUSE');

    expect(trainers).toHaveLength(2);
    for (const slot of trainers) {
      expect(slot.gridY).toBe(layout.innerMinY);
    }
    for (const slot of houses) {
      // One tile of clearance: the artwork overhangs its footprint, so flush
      // against the wall the roof would cover the wall crest.
      expect(slot.gridX).toBe(layout.innerMinX + 1);
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

  it('keeps the Town Center taller than wide', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const townCenter = layout.slots.find((slot) => slot.type === 'TOWN_CENTER')!;
    expect(townCenter.sizeX).toBe(BUILDING_BLUEPRINTS.TOWN_CENTER.sizeX);
    expect(townCenter.sizeY).toBe(BUILDING_BLUEPRINTS.TOWN_CENTER.sizeY);
    expect(townCenter.sizeY).toBeGreaterThan(townCenter.sizeX);
  });

  it('keeps the building slots from overlapping one another', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);

    for (let i = 0; i < layout.slots.length; i++) {
      for (let j = i + 1; j < layout.slots.length; j++) {
        const a = layout.slots[i];
        const b = layout.slots[j];
        const overlapX = a.gridX < b.gridX + b.sizeX && b.gridX < a.gridX + a.sizeX;
        const overlapY = a.gridY < b.gridY + b.sizeY && b.gridY < a.gridY + a.sizeY;
        expect(
          overlapX && overlapY,
          `${a.type} at ${a.gridX},${a.gridY} overlaps ${b.type} at ${b.gridX},${b.gridY}`
        ).toBe(false);
      }
    }
  });

  it('packs the five houses in one column at the lower rear corner', () => {
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const houses = layout.slots
      .filter((slot) => slot.type === 'HOUSE')
      .sort((a, b) => a.gridY - b.gridY);

    const bottom = houses[houses.length - 1];
    expect(bottom.gridY + bottom.sizeY - 1).toBe(layout.innerMaxY);
    for (let index = 1; index < houses.length; index++) {
      expect(houses[index].gridY).toBe(houses[index - 1].gridY + houses[index - 1].sizeY);
      expect(houses[index].gridX).toBe(houses[0].gridX);
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
      getBuildingLevelStats('BARRACKS', 1).maxHp +
      getBuildingLevelStats('ARCHERY_RANGE', 1).maxHp +
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
    expect(CITADEL_HP_THRESHOLD).toBe(0);
    expect(isCitadelBreached(0, 100)).toBe(true);
    expect(isCitadelBreached(1, 100)).toBe(false);
    expect(isCitadelBreached(0, 0)).toBe(false);
  });
});

describe('citadel lifecycle', () => {
  it('retrofits the trainers and houses onto a Town-Center-only save', () => {
    const state = createKingdomState();
    addTownCenter(state);

    ensureCitadel(state, 'defender');

    const types = allBuildings(state).map((building) => building.type);
    expect(types.filter((type) => type === 'TOWN_CENTER')).toHaveLength(1);
    expect(types.filter((type) => type === 'BARRACKS')).toHaveLength(1);
    expect(types.filter((type) => type === 'ARCHERY_RANGE')).toHaveLength(1);
    expect(types.filter((type) => type === 'HOUSE')).toHaveLength(5);
  });

  it('steps houses off the west wall on saves written before the setback', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    // A canonical save: the Town Center already sits at the centred anchor, so
    // no full layout rebuild happens and the migration is the only mover.
    const anchor = citadelTownCenterFor(state.mapWidth, state.mapHeight);
    townCenter.gridX = anchor.gridX;
    townCenter.gridY = anchor.gridY;
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
    const houses = allBuildings(state).filter((building) => building.type === 'HOUSE');
    // The previous layout packed the column flush against the wall.
    for (const house of houses) house.gridX = layout.innerMinX;

    ensureCitadel(state, 'defender');

    for (const house of houses) {
      expect(house.gridX).toBe(layout.innerMinX + 1);
    }
  });

  it('moves a legacy building that sits on a citadel wall off it', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    const anchor = citadelTownCenterFor(state.mapWidth, state.mapHeight);
    townCenter.gridX = anchor.gridX;
    townCenter.gridY = anchor.gridY;
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
    // A house written by an older build straight onto the west wall.
    const house = new BuildingState();
    house.id = 'b-wall-house';
    house.ownerId = 'defender';
    house.type = 'HOUSE';
    house.gridX = layout.originX;
    house.gridY = layout.originY + 8;
    house.sizeX = BUILDING_BLUEPRINTS.HOUSE.sizeX;
    house.sizeY = BUILDING_BLUEPRINTS.HOUSE.sizeY;
    house.maxHp = getBuildingLevelStats('HOUSE', 1).maxHp;
    house.hp = house.maxHp;
    house.level = 1;
    house.isConstructed = true;
    state.buildings.set(house.id, house);

    ensureCitadel(state, 'defender');

    const wallKeys = new Set(layout.walls.map((tile) => `${tile.gridX},${tile.gridY}`));
    // The building must clear the wall by one tile, not just avoid covering it.
    for (let y = house.gridY - 1; y < house.gridY + house.sizeY + 1; y++) {
      for (let x = house.gridX - 1; x < house.gridX + house.sizeX + 1; x++) {
        expect(wallKeys.has(`${x},${y}`)).toBe(false);
      }
    }
    expect(house.gridX).toBeGreaterThanOrEqual(layout.originX + 2);
    expect(house.id).toBe('b-wall-house');
  });

  it('does not move a citadel house onto a building that took its setback slot', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    const anchor = citadelTownCenterFor(state.mapWidth, state.mapHeight);
    townCenter.gridX = anchor.gridX;
    townCenter.gridY = anchor.gridY;
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
    // The southernmost house has no other house below it, so a blocker east of
    // its new slot cannot touch anything else.
    const house = allBuildings(state)
      .filter((building) => building.type === 'HOUSE')
      .sort((a, b) => b.gridY - a.gridY)[0];
    // Old flush-against-the-wall position.
    house.gridX = layout.innerMinX;

    // A player building just east of the new slot, overlapping where the house
    // would land but not where it stands today.
    const blocker = new BuildingState();
    blocker.id = 'b-blocker';
    blocker.ownerId = 'defender';
    blocker.type = 'HOUSE';
    blocker.gridX = layout.innerMinX + 2;
    blocker.gridY = house.gridY;
    blocker.sizeX = BUILDING_BLUEPRINTS.HOUSE.sizeX;
    blocker.sizeY = BUILDING_BLUEPRINTS.HOUSE.sizeY;
    state.buildings.set(blocker.id, blocker);

    ensureCitadel(state, 'defender');

    // It stays where it is rather than overlapping the blocker.
    expect(house.gridX).toBe(layout.innerMinX);
    const overlapX =
      house.gridX < blocker.gridX + blocker.sizeX &&
      house.gridX + house.sizeX > blocker.gridX;
    const overlapY =
      house.gridY < blocker.gridY + blocker.sizeY &&
      house.gridY + house.sizeY > blocker.gridY;
    expect(overlapX && overlapY).toBe(false);
  });

  it('turns the second barracks of a legacy save into an archery range', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    // Saves written before the roster split field two barracks and no range.
    const range = allBuildings(state).find((building) => building.type === 'ARCHERY_RANGE')!;
    range.type = 'BARRACKS';

    ensureCitadel(state, 'defender');

    const military = allBuildings(state).filter(
      (building) => building.type === 'BARRACKS' || building.type === 'ARCHERY_RANGE'
    );
    expect(military.filter((building) => building.type === 'BARRACKS')).toHaveLength(1);
    expect(military.filter((building) => building.type === 'ARCHERY_RANGE')).toHaveLength(1);

    const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
    for (const slot of layout.slots.filter(
      (slot) => slot.type === 'BARRACKS' || slot.type === 'ARCHERY_RANGE'
    )) {
      expect(
        military.some(
          (building) =>
            building.type === slot.type &&
            building.gridX === slot.gridX &&
            building.gridY === slot.gridY
        )
      ).toBe(true);
    }
  });

  it('restores missing building slots after a raid without erasing damage', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    for (const building of allBuildings(state)) building.hp = 1;
    const house = allBuildings(state).find((building) => building.type === 'HOUSE')!;
    state.buildings.delete(house.id);
    const survivingIds = new Set(allBuildings(state).map((b) => b.id));

    restoreCitadel(state, 'defender');

    const buildings = allBuildings(state);
    const slotBuildings = buildings.filter((building) => building.type !== 'CITADEL');
    expect(slotBuildings).toHaveLength(8);
    expect(buildings.some((building) => building.type === 'CITADEL')).toBe(true);
    // Preserves existing damaged buildings instead of resetting them to maxHp
    const existing = buildings.filter((building) => survivingIds.has(building.id));
    for (const building of existing) {
      expect(building.hp).toBe(1);
    }
  });

  it('recentres a right-edge citadel and drops orphaned duplicates', () => {
    const state = createKingdomState();

    // The short-lived right-edge layout: TC at the legacy offset (12, 6).
    const stats = getBuildingLevelStats('TOWN_CENTER', 1);
    const rightEdgeTc = new BuildingState();
    rightEdgeTc.id = 'b-right-tc';
    rightEdgeTc.ownerId = 'defender';
    rightEdgeTc.type = 'TOWN_CENTER';
    rightEdgeTc.gridX = 110 - 6 - LEGACY_CITADEL_SIZE + 12;
    rightEdgeTc.gridY = Math.floor((110 - LEGACY_CITADEL_SIZE) / 2) + 6;
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
    expect(buildings.filter((building) => building.type === 'BARRACKS')).toHaveLength(1);
    expect(buildings.filter((building) => building.type === 'ARCHERY_RANGE')).toHaveLength(1);
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

  it('does not resurrect or reshuffle deleted citadel buildings on ensureCitadel', () => {
    const state = createKingdomState();
    const target = citadelTownCenterFor(110, 110);
    const townCenter = addTownCenter(state);
    townCenter.gridX = target.gridX;
    townCenter.gridY = target.gridY;
    spawnMissingCitadelBuildings(state, 'defender', townCenter);

    const houses = allBuildings(state).filter((b) => b.type === 'HOUSE');
    expect(houses).toHaveLength(5);
    const houseToDelete = houses[0];
    const otherHouse = houses[1];
    const originalX = otherHouse.gridX;
    const originalY = otherHouse.gridY;

    state.buildings.delete(houseToDelete.id);

    ensureCitadel(state, 'defender');

    expect(state.buildings.has(houseToDelete.id)).toBe(false);
    expect(allBuildings(state).filter((b) => b.type === 'HOUSE')).toHaveLength(4);
    expect(otherHouse.gridX).toBe(originalX);
    expect(otherHouse.gridY).toBe(originalY);
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

    for (const stair of layout.stairs) {
      expect(
        footprintTouchesCitadelWall(state, stair.bottom.gridX, stair.bottom.gridY, 1, 1)
      ).toBe(true);
    }

    expect(footprintTouchesCitadelWall(state, TC_X + 1, TC_Y + 1, 2, 2)).toBe(false);
  });

  it('pushes a foreign unit out of the sealed courtyard', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    ensureCitadel(state, 'defender');

    const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
    const intruder = new UnitState();
    intruder.id = 'u-intruder';
    intruder.ownerId = 'raider';
    intruder.type = 'SPEARMAN';
    intruder.x = layout.innerMinX + 4.5;
    intruder.y = layout.innerMinY + 4.5;
    state.units.set(intruder.id, intruder);

    expect(isInsideCitadelInterior(state, intruder.x, intruder.y)).toBe(true);
    expect(evictForeignUnitsFromCitadel(state)).toBe(1);

    expect(isInsideCitadelInterior(state, intruder.x, intruder.y)).toBe(false);
    expect(intruder.onWall).toBe(false);
  });

  it('does not exist on a battlefield', () => {
    const state = new WorldState();
    state.zoneId = 'battlefield';
    addTownCenter(state);

    expect(footprintTouchesCitadelWall(state, TC_X, TC_Y, 1, 1)).toBe(false);
  });
});

describe('citadel gate approach', () => {
  function addResource(state: WorldState, id: string, gridX: number, gridY: number): void {
    const node = new ResourceNodeState();
    node.id = id;
    node.type = 'TREE';
    node.resourceType = 'wood';
    node.gridX = gridX;
    node.gridY = gridY;
    node.remainingAmount = 200;
    node.maxAmount = 200;
    state.resourceNodes.set(id, node);
  }

  it('clears the avenue between the east gate and the map edge', () => {
    const state = createKingdomState();
    const townCenter = addTownCenter(state);
    const layout = citadelLayoutFor(TC_X, TC_Y);
    const gateY = layout.gates[1].gridY;
    const avenueX = layout.originX + layout.sizeX + 10;

    addResource(state, 'res-avenue', avenueX, gateY);
    addResource(state, 'res-avenue-side', avenueX, gateY - CITADEL_APPROACH_MARGIN - 2);
    addResource(state, 'res-behind-wall', layout.originX - 1, gateY);

    clearCitadelResources(state, townCenter);

    expect(state.resourceNodes.has('res-avenue')).toBe(false);
    expect(state.resourceNodes.has('res-avenue-side')).toBe(true);
    expect(state.resourceNodes.has('res-behind-wall')).toBe(true);
  });
});

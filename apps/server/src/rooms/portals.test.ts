import { beforeEach, describe, expect, it } from 'vitest';
import { BUILDING_BLUEPRINTS, mapSizeForZone } from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { WorldState } from '../schema/WorldState.js';
import { entityIds } from '../services/EntityIdAllocator.js';
import { arrivalPoint, ensurePortalFor, findOwnPortal } from './portals.js';

function createState(zone: string): WorldState {
  const state = new WorldState();
  state.zoneId = zone;
  // The room sets these in `onCreate`; a bare state would fall back to the
  // battlefield defaults and hide a kingdom-sized bug.
  const size = mapSizeForZone(zone);
  state.mapWidth = size.width;
  state.mapHeight = size.height;
  return state;
}

function addBuilding(
  state: WorldState,
  ownerId: string,
  type: keyof typeof BUILDING_BLUEPRINTS,
  gridX: number,
  gridY: number
): BuildingState {
  const blueprint = BUILDING_BLUEPRINTS[type];
  const building = new BuildingState();
  building.id = `b_${entityIds.nextId()}`;
  building.ownerId = ownerId;
  building.type = type;
  building.gridX = gridX;
  building.gridY = gridY;
  building.sizeX = blueprint.sizeX;
  building.sizeY = blueprint.sizeY;
  building.maxHp = blueprint.maxHp;
  building.hp = blueprint.maxHp;
  building.isConstructed = true;
  state.buildings.set(building.id, building);
  return building;
}

function addResource(state: WorldState, gridX: number, gridY: number): void {
  const node = new ResourceNodeState();
  node.id = `res_${entityIds.nextId()}`;
  node.type = 'TREE';
  node.resourceType = 'wood';
  node.gridX = gridX;
  node.gridY = gridY;
  node.remainingAmount = 200;
  node.maxAmount = 200;
  state.resourceNodes.set(node.id, node);
}

function overlaps(a: BuildingState, b: BuildingState): boolean {
  return (
    a.gridX < b.gridX + b.sizeX &&
    a.gridX + a.sizeX > b.gridX &&
    a.gridY < b.gridY + b.sizeY &&
    a.gridY + a.sizeY > b.gridY
  );
}

describe('ensurePortalFor', () => {
  beforeEach(() => entityIds.reset());

  it('places the kingdom portal on the right edge of the map', () => {
    const state = createState('kingdom:user-1');
    const townCenter = addBuilding(state, 'user-1', 'TOWN_CENTER', 40, 40);

    const portal = ensurePortalFor(state, 'user-1');

    expect(portal).not.toBeNull();
    expect(portal!.type).toBe('PORTAL');
    // Kingdom 110x110, portal 2x2, margin 5: the fixed column is x = 103.
    expect(portal!.gridX).toBe(state.mapWidth - 5 - portal!.sizeX);
    expect(portal!.gridY).toBe(Math.floor(state.mapHeight / 2) - Math.floor(portal!.sizeY / 2));
    expect(overlaps(portal!, townCenter)).toBe(false);
    expect(findOwnPortal(state, 'user-1')).toBe(portal);
  });

  it('moves an existing kingdom portal to the right edge', () => {
    const state = createState('kingdom:user-1');
    addBuilding(state, 'user-1', 'TOWN_CENTER', 40, 40);
    const oldPortal = addBuilding(state, 'user-1', 'PORTAL', 45, 40);

    const portal = ensurePortalFor(state, 'user-1');

    expect(portal).toBe(oldPortal);
    expect(portal!.gridX).toBe(state.mapWidth - 5 - portal!.sizeX);
  });

  it('is idempotent for one account', () => {
    const state = createState('kingdom:user-1');
    addBuilding(state, 'user-1', 'TOWN_CENTER', 40, 40);

    expect(ensurePortalFor(state, 'user-1')).toBe(ensurePortalFor(state, 'user-1'));
    expect(state.buildings.size).toBe(2);
  });

  it('gives the same account the same battlefield plot every time', () => {
    const first = createState('battlefield');
    const second = createState('battlefield');

    const a = ensurePortalFor(first, 'user-1')!;
    const b = ensurePortalFor(second, 'user-1')!;

    expect({ x: a.gridX, y: a.gridY }).toEqual({ x: b.gridX, y: b.gridY });
  });

  it('moves to another clear spot when the preferred plot is taken', () => {
    const probe = createState('battlefield');
    const preferred = ensurePortalFor(probe, 'user-1')!;

    const state = createState('battlefield');
    const blocker = addBuilding(state, 'user-2', 'TOWER', preferred.gridX, preferred.gridY);
    addResource(state, preferred.gridX + 3, preferred.gridY);

    const portal = ensurePortalFor(state, 'user-1')!;

    expect(portal).not.toBeNull();
    expect(overlaps(portal, blocker)).toBe(false);
    expect(portal.gridX).not.toBe(preferred.gridX);
  });

  it('does not create portals in the legacy world zone', () => {
    const state = createState('world');
    expect(ensurePortalFor(state, 'user-1')).toBeNull();
  });

  it('marks portals as untargetable', () => {
    expect(BUILDING_BLUEPRINTS.PORTAL.attackable).toBe(false);
  });
});

describe('arrivalPoint', () => {
  it('keeps arrivals inside the map and outside the portal footprint', () => {
    const state = createState('kingdom:user-1');
    addBuilding(state, 'user-1', 'TOWN_CENTER', 40, 40);
    const portal = ensurePortalFor(state, 'user-1')!;

    for (let index = 0; index < 40; index++) {
      const point = arrivalPoint(portal, index, state);
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(state.mapWidth);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(state.mapHeight);
      expect(point.y).toBeGreaterThanOrEqual(portal.gridY + portal.sizeY);
    }
  });

  it('moves arrivals out of a building placed below the portal', () => {
    const state = createState('kingdom:user-1');
    const portal = addBuilding(state, 'user-1', 'PORTAL', 60, 60);
    const blocker = addBuilding(state, 'user-1', 'TOWN_CENTER', 58, 62);

    const point = arrivalPoint(portal, 0, state);
    const insideBlocker =
      point.x >= blocker.gridX &&
      point.x < blocker.gridX + blocker.sizeX &&
      point.y >= blocker.gridY &&
      point.y < blocker.gridY + blocker.sizeY;

    expect(insideBlocker).toBe(false);
  });

  it('clamps arrivals at the bottom edge of the map', () => {
    const state = createState('kingdom:user-1');
    const portal = addBuilding(state, 'user-1', 'PORTAL', 10, state.mapHeight - 3);

    const point = arrivalPoint(portal, 95, state);
    expect(point.y).toBeLessThan(state.mapHeight);
    expect(point.x).toBeLessThan(state.mapWidth);
  });
});

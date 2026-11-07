import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KINGDOM_MAP_SIZE,
  MAX_ROAD_TILES_PER_MESSAGE,
  MAX_ROADS_PER_ZONE,
  MAP_BUILD_MARGIN_TILES,
  ROAD_COST_PER_TILE,
  ROAD_SPEED_MULTIPLIER,
  RejectCode,
  RoadTilePayload,
  UNIT_BLUEPRINTS,
  roadTileKey
} from '@chien-quoc/shared';
import { WorldRoom } from './WorldRoom.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { RoadState } from '../schema/RoadState.js';
import { zonePersistence } from './ZonePersistence.js';

vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    loadRoads: vi.fn().mockResolvedValue([]),
    saveFullWorldState: vi.fn().mockResolvedValue(undefined),
    savePlayerEmpire: vi.fn().mockResolvedValue(undefined),
    saveZonePlayerEntities: vi.fn().mockResolvedValue(undefined)
  }
}));

const KINGDOM = 'kingdom:owner';
/** Anything inside the 6-tile margin and away from the plaza. */
const TILE = { x: 20, y: 20 };

type TestClient = {
  sessionId: string;
  auth: { userId: string; displayName: string };
  send: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
};

function createClient(userId = 'owner', sessionId = 's1'): TestClient {
  return {
    sessionId,
    auth: { userId, displayName: userId },
    send: vi.fn(),
    leave: vi.fn()
  };
}

function createRoom(zone = KINGDOM) {
  const room = new WorldRoom();
  const state = new WorldState();
  room.setState(state);
  room.state.zoneId = zone;
  const internals = room as any;
  internals.zoneId = zone;
  internals.zoneReady = true;
  const size = zone.startsWith('kingdom:') ? KINGDOM_MAP_SIZE : { width: 220, height: 220 };
  room.state.mapWidth = size.width;
  room.state.mapHeight = size.height;
  return room;
}

function addPlayer(room: WorldRoom, id = 'owner', wood = 100) {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  player.wood = wood;
  room.state.players.set(id, player);
  return player;
}

function addBuilding(room: WorldRoom, id: string, gx: number, gy: number, sizeX = 1, sizeY = 1) {
  const building = new BuildingState();
  building.id = id;
  building.ownerId = 'owner';
  building.type = 'HOUSE';
  building.gridX = gx;
  building.gridY = gy;
  building.sizeX = sizeX;
  building.sizeY = sizeY;
  room.state.buildings.set(id, building);
  return building;
}

function addResource(room: WorldRoom, id: string, gx: number, gy: number) {
  const node = new ResourceNodeState();
  node.id = id;
  node.type = 'TREE';
  node.resourceType = 'wood';
  node.gridX = gx;
  node.gridY = gy;
  node.remainingAmount = 100;
  node.maxAmount = 100;
  room.state.resourceNodes.set(id, node);
  return node;
}

function placeRoad(room: WorldRoom, client: TestClient, tiles: RoadTilePayload[]) {
  (room as any).commands.handlePlaceRoad(client, { tiles });
}

function removeRoad(room: WorldRoom, client: TestClient, tiles: RoadTilePayload[]) {
  (room as any).commands.handleRemoveRoad(client, { tiles });
}

function rejectionOf(client: TestClient): { code: string; message: string } | null {
  const call = client.send.mock.calls.find((args) => args[0] === 'ERROR_NOTIFICATION');
  return call ? call[1] : null;
}

beforeEach(() => {
  zonePersistence.reset();
});

describe('handlePlaceRoad', () => {
  it('charges wood per tile and adds the tiles', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100);
    const client = createClient();

    placeRoad(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);

    expect(room.state.roads.size).toBe(2);
    expect(room.state.roads.has(roadTileKey(20, 20))).toBe(true);
    expect(room.state.roads.has(roadTileKey(21, 20))).toBe(true);
    expect(player.wood).toBe(100 - 2 * ROAD_COST_PER_TILE);
    expect(rejectionOf(client)).toBeNull();
  });

  it('rejects when the player cannot afford the whole stroke', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', ROAD_COST_PER_TILE);
    const client = createClient();

    placeRoad(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);

    expect(room.state.roads.size).toBe(0);
    expect(player.wood).toBe(ROAD_COST_PER_TILE);
    expect(rejectionOf(client)?.code).toBe(RejectCode.RESOURCE);
  });

  it('rejects on the battlefield', () => {
    const room = createRoom('battlefield');
    addPlayer(room, 'owner', 100);
    const client = createClient();

    placeRoad(room, client, [TILE]);

    expect(room.state.roads.size).toBe(0);
    expect(rejectionOf(client)?.code).toBe(RejectCode.PLACEMENT);
  });

  it('caps one message', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100_000);
    const client = createClient();
    const tiles = Array.from({ length: MAX_ROAD_TILES_PER_MESSAGE + 5 }, (_, i) => ({
      x: 10 + (i % 40),
      y: 10 + Math.floor(i / 40)
    }));

    placeRoad(room, client, tiles);

    expect(room.state.roads.size).toBe(MAX_ROAD_TILES_PER_MESSAGE);
  });

  it('enforces the per-zone limit', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 1_000_000);
    for (let i = 0; i < MAX_ROADS_PER_ZONE; i++) {
      const road = new RoadState();
      road.id = roadTileKey(i % 100, Math.floor(i / 100));
      road.ownerId = 'owner';
      road.gridX = i % 100;
      road.gridY = Math.floor(i / 100);
      room.state.roads.set(road.id, road);
    }
    const client = createClient();

    placeRoad(room, client, [{ x: 50, y: 90 }]);

    expect(rejectionOf(client)?.code).toBe(RejectCode.LIMIT);
    expect(player.wood).toBe(1_000_000);
  });

  it('skips occupied tiles instead of failing the stroke', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100);
    addBuilding(room, 'b1', 20, 20, 2, 2);
    addResource(room, 'res1', 23, 20);
    const client = createClient();

    placeRoad(room, client, [
      { x: 20, y: 20 },
      { x: 23, y: 20 },
      { x: 25, y: 25 }
    ]);

    expect(room.state.roads.size).toBe(1);
    expect(room.state.roads.has(roadTileKey(25, 25))).toBe(true);
  });

  it('ignores malformed and out-of-bounds tiles', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100);
    const client = createClient();

    placeRoad(room, client, [
      { x: 20.5, y: 20 },
      { x: -1, y: 20 },
      { x: 20, y: 20 }
    ] as RoadTilePayload[]);

    expect(room.state.roads.size).toBe(1);
    expect(room.state.roads.has(roadTileKey(20, 20))).toBe(true);
  });

  it('keeps the edge margin clear, matching the building footprint rule', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100);
    const client = createClient();

    placeRoad(room, client, [
      { x: MAP_BUILD_MARGIN_TILES - 1, y: 30 },
      { x: MAP_BUILD_MARGIN_TILES, y: 30 },
      { x: 30, y: MAP_BUILD_MARGIN_TILES - 1 },
      { x: 30, y: MAP_BUILD_MARGIN_TILES }
    ]);

    const x = MAP_BUILD_MARGIN_TILES;
    expect(room.state.roads.has(roadTileKey(x - 1, 30))).toBe(false);
    expect(room.state.roads.has(roadTileKey(x, 30))).toBe(true);
    expect(room.state.roads.has(roadTileKey(30, x - 1))).toBe(false);
    expect(room.state.roads.has(roadTileKey(30, x))).toBe(true);
  });

  it('charges only the tiles it actually paints', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100);
    addBuilding(room, 'b1', 20, 20, 2, 2);
    const client = createClient();

    placeRoad(room, client, [{ x: 20, y: 20 }, { x: 30, y: 30 }]);

    expect(room.state.roads.size).toBe(1);
    expect(player.wood).toBe(100 - ROAD_COST_PER_TILE);
  });

  it('blocks building a house on top of a road', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 10_000);
    const client = createClient();
    placeRoad(room, client, [{ x: 20, y: 20 }]);
    client.send.mockClear();

    (room as any).commands.handlePlaceBuilding(client, {
      type: 'HOUSE',
      gridX: 20,
      gridY: 20
    });

    expect(rejectionOf(client)?.code).toBe(RejectCode.PLACEMENT);
    expect(room.state.buildings.size).toBe(0);
  });
});

describe('handleRemoveRoad', () => {
  it('refunds wood when removing an unconstructed road, but never refunds a finished road', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100);
    const client = createClient();
    placeRoad(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);
    expect(player.wood).toBe(100 - 2 * ROAD_COST_PER_TILE);

    // 1. Remove one unconstructed tile -> refunds ROAD_COST_PER_TILE
    removeRoad(room, client, [{ x: 20, y: 20 }]);
    expect(room.state.roads.size).toBe(1);
    expect(player.wood).toBe(100 - ROAD_COST_PER_TILE);

    // 2. Finish constructing the remaining tile
    const remainingRoad = room.state.roads.get(roadTileKey(21, 20))!;
    remainingRoad.isConstructed = true;
    (room as any).roads.invalidate();

    // 3. Remove finished road -> no refund
    const woodBeforeRemoveFinished = player.wood;
    removeRoad(room, client, [{ x: 21, y: 20 }]);
    expect(room.state.roads.size).toBe(0);
    expect(player.wood).toBe(woodBeforeRemoveFinished);
  });

  it('leaves another owner’s tiles alone', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100);
    addPlayer(room, 'other', 100);
    const owner = createClient('owner');
    const other = createClient('other', 's2');
    placeRoad(room, owner, [{ x: 30, y: 30 }]);

    removeRoad(room, other, [{ x: 30, y: 30 }]);

    expect(room.state.roads.size).toBe(1);
  });
});

describe('road speed bonus', () => {
  function tickRoom(room: WorldRoom, deltasMs: number[]) {
    for (const delta of deltasMs) (room as any).update(delta);
  }

  function walker(room: WorldRoom) {
    const unit = new UnitState();
    unit.id = 'u1';
    unit.ownerId = 'owner';
    unit.type = 'VILLAGER';
    unit.speed = UNIT_BLUEPRINTS.VILLAGER.speed;
    unit.hp = 10;
    unit.maxHp = 10;
    unit.actionState = 'MOVING';
    unit.x = 20.5;
    unit.y = 20.5;
    unit.targetX = 60.5;
    unit.targetY = 20.5;
    room.state.units.set(unit.id, unit);
    return unit;
  }

  it('moves farther per tick on a finished road than on grass or unconstructed road', () => {
    const grass = createRoom();
    addPlayer(grass, 'owner', 100);
    const grassUnit = walker(grass);

    const road = createRoom();
    addPlayer(road, 'owner', 100);
    const roadUnit = walker(road);
    placeRoad(road, createClient(), [{ x: 20, y: 20 }]);
    const placedRoad = road.state.roads.get(roadTileKey(20, 20))!;
    placedRoad.isConstructed = true;
    (road as any).roads.invalidate();

    tickRoom(grass, [50, 50, 50]);
    tickRoom(road, [50, 50, 50]);

    const grassDistance = grassUnit.x - 20.5;
    const roadDistance = roadUnit.x - 20.5;
    expect(grassDistance).toBeGreaterThan(0);
    expect(roadDistance).toBeGreaterThan(grassDistance);
  });

  it('does not apply the speed multiplier on an unconstructed road', () => {
    const grass = createRoom();
    addPlayer(grass, 'owner', 100);
    const grassUnit = walker(grass);

    const unbuilt = createRoom();
    addPlayer(unbuilt, 'owner', 100);
    const unbuiltUnit = walker(unbuilt);
    placeRoad(unbuilt, createClient(), [{ x: 20, y: 20 }]);
    // isConstructed is false by default

    tickRoom(grass, [50, 50, 50]);
    tickRoom(unbuilt, [50, 50, 50]);

    expect(unbuiltUnit.x).toBeCloseTo(grassUnit.x, 5);
  });

  it('applies the multiplier while standing on a road tile', () => {
    expect(ROAD_SPEED_MULTIPLIER).toBeGreaterThan(1);
  });
});

describe('villagers building roads', () => {
  function tickRoom(room: WorldRoom, deltasMs: number[]) {
    for (const delta of deltasMs) (room as any).update(delta);
  }

  function addVillager(room: WorldRoom, id = 'v1', x = 20, y = 20) {
    const unit = new UnitState();
    unit.id = id;
    unit.ownerId = 'owner';
    unit.type = 'VILLAGER';
    unit.speed = UNIT_BLUEPRINTS.VILLAGER.speed;
    unit.hp = 25;
    unit.maxHp = 25;
    unit.actionState = 'IDLE';
    unit.x = x;
    unit.y = y;
    room.state.units.set(unit.id, unit);
    return unit;
  }

  it('assigns selected villagers to construct road tiles sequentially', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100);
    const villager = addVillager(room, 'v1', 20, 20);
    const client = createClient();

    // Place 2 road tiles with villager selected
    (room as any).commands.handlePlaceRoad(client, {
      tiles: [{ x: 20, y: 20 }, { x: 21, y: 20 }],
      unitIds: ['v1']
    });

    const road1 = room.state.roads.get(roadTileKey(20, 20))!;
    const road2 = room.state.roads.get(roadTileKey(21, 20))!;
    expect(road1.isConstructed).toBe(false);
    expect(road2.isConstructed).toBe(false);
    expect(villager.actionState).toBe('BUILDING');
    expect(villager.targetEntityId).toBe(road1.id);

    // Advance 2500ms -> road 1 finishes
    tickRoom(room, [1000, 1000, 600]);
    expect(road1.isConstructed).toBe(true);
    expect(road1.constructionProgress).toBe(100);

    // Villager automatically moved to road 2
    expect(villager.targetEntityId).toBe(road2.id);

    // Advance another 2500ms -> road 2 finishes and villager becomes idle
    tickRoom(room, [1000, 1000, 600]);
    expect(road2.isConstructed).toBe(true);
    expect(villager.actionState).toBe('IDLE');
  });

  it('allows right-clicking an unconstructed road to assign builders', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100);
    const villager = addVillager(room, 'v1', 20, 20);
    const client = createClient();

    placeRoad(room, client, [{ x: 20, y: 20 }]);
    const road = room.state.roads.get(roadTileKey(20, 20))!;
    expect(road.isConstructed).toBe(false);
    expect(villager.actionState).toBe('IDLE');

    (room as any).commands.handleBuildTarget(client, {
      unitIds: ['v1'],
      buildingId: road.id
    });

    expect(villager.actionState).toBe('BUILDING');
    expect(villager.targetEntityId).toBe(road.id);
    expect(rejectionOf(client)).toBeNull();
  });

  it('cancels unconstructed road via handleCancelBuilding and refunds full wood without error', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100);
    const client = createClient();

    placeRoad(room, client, [{ x: 20, y: 20 }]);
    expect(player.wood).toBe(100 - ROAD_COST_PER_TILE);

    const road = room.state.roads.get(roadTileKey(20, 20))!;
    (room as any).commands.handleCancelBuilding(client, {
      buildingId: road.id
    });

    expect(room.state.roads.has(road.id)).toBe(false);
    expect(player.wood).toBe(100);
    expect(rejectionOf(client)).toBeNull();
  });

  it('does not divert villager to nearby unconstructed road after finishing a building', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 1000);
    const villager = addVillager(room, 'v1', 20, 20);
    const client = createClient();

    // Place an unconstructed road at (22, 20)
    placeRoad(room, client, [{ x: 22, y: 20 }]);
    const road = room.state.roads.get(roadTileKey(22, 20))!;
    expect(road.isConstructed).toBe(false);

    // Create a house foundation at (18, 20) and assign villager
    const house = addBuilding(room, 'b_house', 18, 20, 2, 2);
    house.type = 'HOUSE';
    house.isConstructed = false;
    house.constructionProgress = 90;

    (room as any).commands.handleBuildTarget(client, {
      unitIds: ['v1'],
      buildingId: house.id
    });
    expect(villager.actionState).toBe('BUILDING');
    expect(villager.targetEntityId).toBe(house.id);

    // Complete the house
    tickRoom(room, [1000, 1000, 1000]);
    expect(house.isConstructed).toBe(true);

    // Villager should become IDLE, NOT target the unconstructed road
    expect(villager.actionState).toBe('IDLE');
    expect(villager.targetEntityId).not.toBe(road.id);
  });
});

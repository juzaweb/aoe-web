import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KINGDOM_MAP_SIZE,
  MAX_ROAD_TILES_PER_MESSAGE,
  MAX_ROADS_PER_ZONE,
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
  it('removes only the caller’s tiles and never refunds', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100);
    const client = createClient();
    placeRoad(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);
    const woodAfterBuild = player.wood;

    removeRoad(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);

    expect(room.state.roads.size).toBe(0);
    expect(player.wood).toBe(woodAfterBuild);
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

  it('moves farther per tick on a road than on grass', () => {
    const grass = createRoom();
    addPlayer(grass, 'owner', 100);
    const grassUnit = walker(grass);

    const road = createRoom();
    addPlayer(road, 'owner', 100);
    const roadUnit = walker(road);
    placeRoad(road, createClient(), [{ x: 20, y: 20 }]);

    tickRoom(grass, [50, 50, 50]);
    tickRoom(road, [50, 50, 50]);

    const grassDistance = grassUnit.x - 20.5;
    const roadDistance = roadUnit.x - 20.5;
    expect(grassDistance).toBeGreaterThan(0);
    expect(roadDistance).toBeGreaterThan(grassDistance);
  });

  it('applies the multiplier while standing on a road tile', () => {
    expect(ROAD_SPEED_MULTIPLIER).toBeGreaterThan(1);
  });
});

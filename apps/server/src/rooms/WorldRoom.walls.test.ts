import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  KINGDOM_MAP_SIZE,
  MAX_WALL_TILES_PER_MESSAGE,
  MAX_WALLS_PER_ZONE,
  RejectCode,
  RoadTilePayload,
  UNIT_BLUEPRINTS,
  citadelLayoutFor,
  citadelTownCenterFor,
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
const WALL_COST = BUILDING_BLUEPRINTS.WALL.cost;

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

function addPlayer(room: WorldRoom, id = 'owner', wood = 100, stone = 100) {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  player.wood = wood;
  player.stone = stone;
  room.state.players.set(id, player);
  return player;
}

function addBuilding(
  room: WorldRoom,
  id: string,
  gx: number,
  gy: number,
  type = 'HOUSE',
  ownerId = 'owner'
) {
  const building = new BuildingState();
  building.id = id;
  building.ownerId = ownerId;
  building.type = type;
  building.gridX = gx;
  building.gridY = gy;
  building.sizeX = type === 'WALL' ? 1 : 1;
  building.sizeY = type === 'WALL' ? 1 : 1;
  building.maxHp = type === 'WALL' ? 500 : 450;
  building.hp = building.maxHp;
  building.isConstructed = true;
  building.constructionProgress = 100;
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

function addRoad(room: WorldRoom, gx: number, gy: number) {
  const road = new RoadState();
  road.id = roadTileKey(gx, gy);
  road.ownerId = 'owner';
  road.gridX = gx;
  road.gridY = gy;
  road.isConstructed = true;
  road.constructionProgress = 100;
  room.state.roads.set(road.id, road);
  return road;
}

function placeWall(room: WorldRoom, client: TestClient, tiles: RoadTilePayload[], unitIds?: string[]) {
  (room as any).commands.handlePlaceWall(client, { tiles, unitIds });
}

function removeWall(room: WorldRoom, client: TestClient, tiles: RoadTilePayload[]) {
  (room as any).commands.handleRemoveWall(client, { tiles });
}

function wallsOf(room: WorldRoom): BuildingState[] {
  return Array.from(room.state.buildings.values()).filter(
    (building) => building.type === 'WALL'
  );
}

function rejectionOf(client: TestClient): { code: string; message: string } | null {
  const call = client.send.mock.calls.find((args) => args[0] === 'ERROR_NOTIFICATION');
  return call ? call[1] : null;
}

beforeEach(() => {
  zonePersistence.reset();
});

describe('handlePlaceWall', () => {
  it('charges wood and stone per tile and creates 1x1 foundations', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100, 100);
    const client = createClient();

    placeWall(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);

    const walls = wallsOf(room);
    expect(walls).toHaveLength(2);
    expect(player.wood).toBe(100 - 2 * WALL_COST.wood);
    expect(player.stone).toBe(100 - 2 * WALL_COST.stone);
    expect(rejectionOf(client)).toBeNull();

    for (const wall of walls) {
      expect(wall.sizeX).toBe(1);
      expect(wall.sizeY).toBe(1);
      expect(wall.isConstructed).toBe(false);
      expect(wall.constructionProgress).toBe(0);
      expect(wall.hp).toBe(1);
      expect(wall.maxHp).toBe(BUILDING_BLUEPRINTS.WALL.maxHp);
    }
  });

  it('rejects the battlefield', () => {
    const room = createRoom('battlefield');
    addPlayer(room, 'owner', 100, 100);
    const client = createClient();

    placeWall(room, client, [{ x: 20, y: 20 }]);

    expect(wallsOf(room)).toHaveLength(0);
    expect(rejectionOf(client)).toMatchObject({ code: RejectCode.PLACEMENT });
  });

  it('rejects a stroke the player cannot afford', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 4, 5);
    const client = createClient();

    placeWall(room, client, [{ x: 20, y: 20 }]);

    expect(wallsOf(room)).toHaveLength(0);
    expect(player.wood).toBe(4);
    expect(player.stone).toBe(5);
    expect(rejectionOf(client)).toMatchObject({ code: RejectCode.RESOURCE });
  });

  it('caps one message', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 10000, 10000);
    const client = createClient();

    const tiles = Array.from({ length: MAX_WALL_TILES_PER_MESSAGE + 25 }, (_, index) => ({
      x: 10 + (index % 100),
      y: 10 + Math.floor(index / 100)
    }));
    placeWall(room, client, tiles);

    expect(wallsOf(room)).toHaveLength(MAX_WALL_TILES_PER_MESSAGE);
  });

  it('enforces the per-zone limit', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    for (let i = 0; i < MAX_WALLS_PER_ZONE; i++) {
      addBuilding(room, `w_${i}`, 10 + (i % 100), 10 + Math.floor(i / 100), 'WALL');
    }

    placeWall(room, client, [{ x: 50, y: 50 }]);

    expect(wallsOf(room)).toHaveLength(MAX_WALLS_PER_ZONE);
    expect(rejectionOf(client)).toMatchObject({ code: RejectCode.LIMIT });
  });

  it('skips occupied tiles instead of failing the stroke', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    addBuilding(room, 'house', 20, 20);
    addResource(room, 'tree', 21, 20);
    addRoad(room, 22, 20);

    placeWall(room, client, [
      { x: 20, y: 20 },
      { x: 21, y: 20 },
      { x: 22, y: 20 },
      { x: 23, y: 20 }
    ]);

    expect(wallsOf(room)).toHaveLength(1);
    expect(wallsOf(room)[0].gridX).toBe(23);
    expect(player.wood).toBe(100 - WALL_COST.wood);
    expect(player.stone).toBe(100 - WALL_COST.stone);
  });

  it('cannot be painted over the citadel wall ring', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    const anchor = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);
    addBuilding(room, 'tc', anchor.gridX, anchor.gridY, 'TOWN_CENTER');
    const wallTile = citadelLayoutFor(anchor.gridX, anchor.gridY).walls[0];

    placeWall(room, client, [{ x: wallTile.gridX, y: wallTile.gridY }]);

    expect(wallsOf(room)).toHaveLength(0);
    expect(rejectionOf(client)).toMatchObject({ code: RejectCode.PLACEMENT });
  });

  it('sends selected villagers to build the wall line', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    const villager = new UnitState();
    villager.id = 'v1';
    villager.ownerId = 'owner';
    villager.type = 'VILLAGER';
    villager.x = 18.5;
    villager.y = 20.5;
    room.state.units.set(villager.id, villager);

    placeWall(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }], ['v1']);

    const walls = wallsOf(room);
    expect(villager.actionState).toBe('BUILDING');
    expect(walls.some((wall) => wall.id === villager.targetEntityId)).toBe(true);
  });
});

describe('handleRemoveWall', () => {
  it('refunds an unconstructed wall and never refunds a finished one', () => {
    const room = createRoom();
    const player = addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    placeWall(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);

    const walls = wallsOf(room);
    walls[0].isConstructed = true;
    walls[0].constructionProgress = 100;
    walls[1].constructionProgress = 50;

    const woodAfterPlace = player.wood;
    const stoneAfterPlace = player.stone;

    removeWall(room, client, [{ x: 20, y: 20 }, { x: 21, y: 20 }]);

    expect(wallsOf(room)).toHaveLength(0);
    // Finished segment: no refund. Unfinished at 50%: half (floored).
    expect(player.wood).toBe(woodAfterPlace + Math.floor(WALL_COST.wood * 0.5));
    expect(player.stone).toBe(stoneAfterPlace + Math.floor(WALL_COST.stone * 0.5));
  });

  it('leaves another owner’s walls alone', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    addBuilding(room, 'foreign-wall', 20, 20, 'WALL', 'other');

    removeWall(room, client, [{ x: 20, y: 20 }]);

    expect(room.state.buildings.has('foreign-wall')).toBe(true);
  });
});

describe('wall collision and destruction', () => {
  it('blocks a tile while standing and frees it when removed', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100, 100);
    const client = createClient();
    placeWall(room, client, [{ x: 30, y: 30 }]);

    const movement = (room as any).movement;
    expect(movement.isBlockedTile(30, 30)).toBe(true);

    removeWall(room, client, [{ x: 30, y: 30 }]);

    expect(movement.isBlockedTile(30, 30)).toBe(false);
  });

  it('lets an enemy destroy a wall segment and removes it', () => {
    const room = createRoom();
    addPlayer(room, 'owner', 100, 100);
    const wall = addBuilding(room, 'wall-1', 40, 40, 'WALL');
    wall.hp = UNIT_BLUEPRINTS.SPEARMAN.attackPower;

    const attacker = new UnitState();
    attacker.id = 'raider-1';
    attacker.ownerId = 'raider';
    attacker.type = 'SPEARMAN';
    attacker.x = 38.5;
    attacker.y = 40.5;
    attacker.actionState = 'ATTACKING';
    attacker.targetEntityId = wall.id;
    attacker.targetEntityType = 'building';
    room.state.units.set(attacker.id, attacker);

    (room as any).combat.updateUnitCombat(attacker, 5000);
    (room as any).combat.updateUnitCombat(attacker, 5000);

    expect(room.state.buildings.has('wall-1')).toBe(false);
    expect(attacker.actionState).not.toBe('ATTACKING');
  });
});

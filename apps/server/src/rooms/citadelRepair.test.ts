import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  CITADEL_AUTO_REPAIR_DURATION_MS,
  KINGDOM_MAP_SIZE,
  citadelTownCenterFor
} from '@chien-quoc/shared';
import { WorldRoom } from './WorldRoom.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ensureCitadelEntity, findCitadel, spawnMissingCitadelBuildings } from './citadel.js';

vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    loadRoads: vi.fn().mockResolvedValue([]),
    saveFullWorldState: vi.fn().mockResolvedValue(undefined),
    savePlayerEmpire: vi.fn().mockResolvedValue(undefined),
    saveZonePlayerEntities: vi.fn().mockResolvedValue(undefined),
    loadZoneEntities: vi.fn().mockResolvedValue([])
  }
}));

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

function createRoom(zone = 'kingdom:owner') {
  const room = new WorldRoom();
  const state = new WorldState();
  room.setState(state);
  room.state.zoneId = zone;
  const internals = room as any;
  internals.zoneId = zone;
  internals.zoneReady = true;
  room.state.mapWidth = KINGDOM_MAP_SIZE.width;
  room.state.mapHeight = KINGDOM_MAP_SIZE.height;
  return room;
}

function addPlayer(room: WorldRoom, id = 'owner') {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  room.state.players.set(id, player);
  return player;
}

function addTownCenter(room: WorldRoom, ownerId = 'owner') {
  const anchor = citadelTownCenterFor(room.state.mapWidth, room.state.mapHeight);
  const tc = new BuildingState();
  tc.id = 'b-tc';
  tc.ownerId = ownerId;
  tc.type = 'TOWN_CENTER';
  tc.gridX = anchor.gridX;
  tc.gridY = anchor.gridY;
  tc.sizeX = BUILDING_BLUEPRINTS.TOWN_CENTER.sizeX;
  tc.sizeY = BUILDING_BLUEPRINTS.TOWN_CENTER.sizeY;
  tc.hp = BUILDING_BLUEPRINTS.TOWN_CENTER.maxHp;
  tc.maxHp = tc.hp;
  tc.isConstructed = true;
  tc.constructionProgress = 100;
  room.state.buildings.set(tc.id, tc);
  return tc;
}

function addVillager(room: WorldRoom, id: string, ownerId: string, x: number, y: number) {
  const unit = new UnitState();
  unit.id = id;
  unit.ownerId = ownerId;
  unit.type = 'VILLAGER';
  unit.x = x;
  unit.y = y;
  unit.targetX = x;
  unit.targetY = y;
  unit.hp = 25;
  unit.maxHp = 25;
  unit.actionState = 'IDLE';
  room.state.units.set(id, unit);
  return unit;
}

describe('Citadel repair and 72h regeneration', () => {
  let room: WorldRoom;
  let client: TestClient;

  beforeEach(() => {
    room = createRoom();
    addPlayer(room, 'owner');
    client = createClient('owner');
  });

  it('protects Town Center and interior citadel buildings from direct attacks', () => {
    const tc = addTownCenter(room, 'owner');
    spawnMissingCitadelBuildings(room.state, 'owner', tc);
    ensureCitadelEntity(room.state, 'owner', tc);

    const enemy = new UnitState();
    enemy.id = 'u-enemy';
    enemy.ownerId = 'attacker';
    enemy.type = 'SPEARMAN';
    enemy.x = tc.gridX - 2;
    enemy.y = tc.gridY;
    room.state.units.set(enemy.id, enemy);

    const attackerClient = createClient('attacker', 's-attacker');
    (room as any).commands.handleAttackTarget(attackerClient, {
      unitIds: ['u-enemy'],
      targetType: 'building',
      targetEntityId: tc.id
    });

    expect(attackerClient.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Citadel structures are protected. Attack the Citadel walls!' })
    );
    expect(enemy.actionState).toBe('IDLE');
  });

  it('damages the Citadel entity when attacking citadel walls, while interior buildings stay at full HP', () => {
    const tc = addTownCenter(room, 'owner');
    spawnMissingCitadelBuildings(room.state, 'owner', tc);
    const citadel = ensureCitadelEntity(room.state, 'owner', tc);

    const enemy = new UnitState();
    enemy.id = 'u-enemy';
    enemy.ownerId = 'attacker';
    enemy.type = 'SPEARMAN';
    // Position enemy near the east gate wall
    enemy.x = citadel.gridX + citadel.sizeX - 0.5;
    enemy.y = citadel.gridY + citadel.sizeY / 2;
    enemy.actionState = 'ATTACKING';
    enemy.targetEntityType = 'building';
    enemy.targetEntityId = citadel.id;
    room.state.units.set(enemy.id, enemy);

    const initialCitadelHp = citadel.hp;
    const initialTcHp = tc.hp;

    (room as any).combat.updateUnitCombat(enemy, 1000);

    expect(citadel.hp).toBeLessThan(initialCitadelHp);
    // Interior Town Center must NOT take damage
    expect(tc.hp).toBe(initialTcHp);
  });

  it('keeps Citadel entity on the map at 0 HP instead of deleting it', () => {
    const tc = addTownCenter(room, 'owner');
    spawnMissingCitadelBuildings(room.state, 'owner', tc);
    const citadel = ensureCitadelEntity(room.state, 'owner', tc);

    const enemy = new UnitState();
    enemy.id = 'u-enemy';
    enemy.ownerId = 'attacker';
    enemy.type = 'SPEARMAN';
    enemy.x = citadel.gridX + citadel.sizeX - 0.5;
    enemy.y = citadel.gridY + citadel.sizeY / 2;
    enemy.actionState = 'ATTACKING';
    enemy.targetEntityType = 'building';
    enemy.targetEntityId = citadel.id;
    room.state.units.set(enemy.id, enemy);

    citadel.hp = 2;
    (room as any).combat.updateUnitCombat(enemy, 1000);

    expect(citadel.hp).toBe(0);
    // Citadel must NOT be deleted
    expect(room.state.buildings.has(citadel.id)).toBe(true);
    // Attacker should end attack order on the 0-HP building
    expect(enemy.actionState).toBe('IDLE');
  });

  it('allows villagers to repair damaged constructed buildings', () => {
    const tc = addTownCenter(room, 'owner');
    const citadel = ensureCitadelEntity(room.state, 'owner', tc);
    citadel.hp = 100; // Damaged

    const villager = addVillager(room, 'v1', 'owner', citadel.gridX + citadel.sizeX - 0.5, citadel.gridY + citadel.sizeY / 2);

    (room as any).commands.handleBuildTarget(client, {
      unitIds: ['v1'],
      buildingId: citadel.id
    });

    expect(villager.actionState).toBe('BUILDING');
    expect(villager.targetEntityId).toBe(citadel.id);

    (room as any).update(1000); // 1 second

    expect(citadel.hp).toBeGreaterThan(100);
  });

  it('passively regenerates citadel buildings over 72 hours online', () => {
    const tc = addTownCenter(room, 'owner');
    spawnMissingCitadelBuildings(room.state, 'owner', tc);
    const citadel = ensureCitadelEntity(room.state, 'owner', tc);
    citadel.hp = 0;

    // Simulate 36 hours (half of 72 hours)
    const thirtySixHoursMs = CITADEL_AUTO_REPAIR_DURATION_MS / 2;
    (room as any).update(thirtySixHoursMs);

    expect(citadel.hp).toBeCloseTo(citadel.maxHp / 2, 0);

    // Simulate remaining 36 hours
    (room as any).update(thirtySixHoursMs);
    expect(citadel.hp).toBe(citadel.maxHp);
  });

  it('restores offline passive regeneration when restoring entities from SQLite', () => {
    const tc = addTownCenter(room, 'owner');
    const updatedAt = new Date(Date.now() - CITADEL_AUTO_REPAIR_DURATION_MS / 4); // 18 hours ago

    const saved = [
      {
        id: 'owner',
        townCenterLevel: 1,
        buildings: [
          {
            id: 'b-tc',
            type: 'TOWN_CENTER',
            gridX: tc.gridX,
            gridY: tc.gridY,
            sizeX: tc.sizeX,
            sizeY: tc.sizeY,
            level: 1,
            hp: 0,
            maxHp: tc.maxHp,
            isConstructed: true,
            constructionProgress: 100,
            upgradeProgressMs: 0,
            upgradeTimeMs: 0,
            updatedAt
          }
        ],
        units: []
      }
    ];

    (room as any).restoreSavedEntities(saved);
    const restored = room.state.buildings.get('b-tc')!;
    expect(restored.hp).toBeCloseTo(tc.maxHp * 0.25, 0);
  });

  it('restores offline passive regeneration for Citadel compound entity when restoring from SQLite', () => {
    const tc = addTownCenter(room, 'owner');
    const citadel = ensureCitadelEntity(room.state, 'owner', tc);
    const updatedAt = new Date(Date.now() - CITADEL_AUTO_REPAIR_DURATION_MS / 4); // 18 hours ago

    const saved = [
      {
        id: 'owner',
        townCenterLevel: 1,
        buildings: [
          {
            id: citadel.id,
            type: 'CITADEL',
            gridX: citadel.gridX,
            gridY: citadel.gridY,
            sizeX: citadel.sizeX,
            sizeY: citadel.sizeY,
            level: 1,
            hp: 0,
            maxHp: citadel.maxHp,
            isConstructed: true,
            constructionProgress: 100,
            upgradeProgressMs: 0,
            upgradeTimeMs: 0,
            updatedAt
          }
        ],
        units: []
      }
    ];

    (room as any).restoreSavedEntities(saved);
    const restoredCitadel = room.state.buildings.get(citadel.id)!;
    expect(restoredCitadel.hp).toBeCloseTo(citadel.maxHp * 0.25, 0);
  });

  it('rejects attack command on 0-HP destroyed buildings', () => {
    const tc = addTownCenter(room, 'owner');
    const citadel = ensureCitadelEntity(room.state, 'owner', tc);
    citadel.hp = 0;

    const enemy = new UnitState();
    enemy.id = 'u-enemy';
    enemy.ownerId = 'attacker';
    enemy.type = 'SPEARMAN';
    enemy.x = citadel.gridX - 5;
    enemy.y = citadel.gridY;
    room.state.units.set(enemy.id, enemy);

    const attackerClient = createClient('attacker', 's-attacker');
    (room as any).commands.handleAttackTarget(attackerClient, {
      unitIds: ['u-enemy'],
      targetType: 'building',
      targetEntityId: citadel.id
    });

    expect(attackerClient.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Target is already destroyed' })
    );
    expect(enemy.actionState).toBe('IDLE');
  });

  it('rejects upgrade command on 0-HP destroyed buildings', () => {
    const tc = addTownCenter(room, 'owner');
    tc.hp = 0;

    (room as any).commands.handleUpgradeBuilding(client, {
      buildingId: tc.id
    });

    expect(client.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Cannot upgrade a destroyed building' })
    );
    expect(tc.upgradeTimeMs).toBe(0);
  });

  it('does not apply offline regeneration on non-citadel maps', () => {
    const worldRoom = createRoom('world');
    addPlayer(worldRoom, 'owner');
    const tc = addTownCenter(worldRoom, 'owner');
    const updatedAt = new Date(Date.now() - CITADEL_AUTO_REPAIR_DURATION_MS / 2);

    const saved = [
      {
        id: 'owner',
        townCenterLevel: 1,
        buildings: [
          {
            id: 'b-tc',
            type: 'TOWN_CENTER',
            gridX: tc.gridX,
            gridY: tc.gridY,
            sizeX: tc.sizeX,
            sizeY: tc.sizeY,
            level: 1,
            hp: 0,
            maxHp: tc.maxHp,
            isConstructed: true,
            constructionProgress: 100,
            upgradeProgressMs: 0,
            upgradeTimeMs: 0,
            updatedAt
          }
        ],
        units: []
      }
    ];

    (worldRoom as any).restoreSavedEntities(saved);
    const restored = worldRoom.state.buildings.get('b-tc')!;
    // On non-citadel map, hp stays 0
    expect(restored.hp).toBe(0);
  });
});

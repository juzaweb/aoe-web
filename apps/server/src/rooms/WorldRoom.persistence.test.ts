import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldRoom } from './WorldRoom.js';
import { WorldState } from '../schema/WorldState.js';
import { RESOURCE_REGROW_MS, getBuildingLevelStats, mapSizeForZone } from '@chien-quoc/shared';
import { DatabaseService } from '../services/DatabaseService.js';

vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    loadResources: vi.fn(),
    clearAllResources: vi.fn().mockResolvedValue(undefined),
    saveAllResources: vi.fn().mockResolvedValue(undefined),
    loadZoneEntities: vi.fn().mockResolvedValue([])
  }
}));

function createRoom(zone = 'battlefield') {
  const room = new WorldRoom();
  room.setState(new WorldState());
  const size = mapSizeForZone(zone);
  room.state.zoneId = zone;
  room.state.mapWidth = size.width;
  room.state.mapHeight = size.height;
  const internals = room as any;
  internals.zoneId = zone;
  internals.zoneReady = false;
  return { room, internals };
}

describe('WorldRoom.initializeWorldPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (DatabaseService as any).loadResources.mockResolvedValue([]);
    (DatabaseService as any).clearAllResources.mockResolvedValue(undefined);
    (DatabaseService as any).saveAllResources.mockResolvedValue(undefined);
    (DatabaseService as any).loadZoneEntities.mockResolvedValue([]);
  });

  it('P1 restores resources', async () => {
    const { room, internals } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([
      { id: 'res_1', zone: 'battlefield', type: 'TREE', resourceType: 'wood', gridX: 5, gridY: 6, remainingAmount: 7, maxAmount: 10 }
    ]);
    await internals.initializeWorldPersistence();
    expect(room.state.resourceNodes.has('res_1')).toBe(true);
    const node = room.state.resourceNodes.get('res_1')!;
    expect(node.remainingAmount).toBe(7);
    expect(node.maxAmount).toBe(10);
    expect(node.gridX).toBe(5);
    expect(node.gridY).toBe(6);
  });

  it('P2 restores building and unit', async () => {
    const { room } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([]);
    (DatabaseService as any).clearAllResources.mockResolvedValue(undefined);
    (DatabaseService as any).saveAllResources.mockResolvedValue(undefined);
    (DatabaseService as any).loadZoneEntities.mockResolvedValue([
      {
        id: 'player1',
        name: 'Player',
        buildings: [
          {
            id: 'b1',
            ownerId: 'player1',
            zone: 'battlefield',
            type: 'TOWN_CENTER',
            gridX: 2,
            gridY: 2,
            sizeX: 2,
            sizeY: 2,
            hp: 100,
            maxHp: 200,
            level: 1,
            upgradeProgressMs: 0,
            upgradeTimeMs: 0,
            isConstructed: true,
            constructionProgress: 100
          }
        ],
        units: [
          {
            id: 'u1',
            ownerId: 'player1',
            zone: 'battlefield',
            type: 'VILLAGER',
            x: 3,
            y: 3,
            speed: 2,
            level: 1,
            hp: 40,
            maxHp: 50,
            actionState: 'IDLE'
          }
        ]
      }
    ]);
    // empty resources triggers generate+save; but loadResources returns [] so branch generates.
    // To avoid relying on generation, instead provide resources? P3 covers generation. Here loadResources [] leads generate.
    await (room as any).initializeWorldPersistence();
    expect(room.state.buildings.has('b1')).toBe(true);
    expect(room.state.units.has('u1')).toBe(true);
    const b = room.state.buildings.get('b1')!;
    expect(b.ownerId).toBe('player1');
    const u = room.state.units.get('u1')!;
    expect(u.ownerId).toBe('player1');
  });

  it('P3 empty map generates fresh', async () => {
    const { room } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([]);
    (DatabaseService as any).loadZoneEntities.mockResolvedValue([]);
    await (room as any).initializeWorldPersistence();
    expect((DatabaseService as any).clearAllResources).toHaveBeenCalled();
    expect((DatabaseService as any).saveAllResources).toHaveBeenCalled();
    expect(room.state.resourceNodes.size).toBeGreaterThan(0);
  });

  it('P4 drops out-of-bounds rows', async () => {
    const { room } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([
      { id: 'res_oob', zone: 'battlefield', type: 'TREE', resourceType: 'wood', gridX: 999, gridY: 999, remainingAmount: 5, maxAmount: 10 }
    ]);
    (DatabaseService as any).loadZoneEntities.mockResolvedValue([
      {
        id: 'player1',
        name: 'Player',
        buildings: [
          {
            id: 'b_oob',
            ownerId: 'player1',
            zone: 'battlefield',
            type: 'TOWN_CENTER',
            gridX: 999,
            gridY: 999,
            sizeX: 2,
            sizeY: 2,
            hp: 100,
            maxHp: 200,
            level: 1,
            upgradeProgressMs: 0,
            upgradeTimeMs: 0,
            isConstructed: true,
            constructionProgress: 100
          }
        ],
        units: [
          {
            id: 'u_oob',
            ownerId: 'player1',
            zone: 'battlefield',
            type: 'VILLAGER',
            x: 999,
            y: 999,
            speed: 2,
            level: 1,
            hp: 40,
            maxHp: 50,
            actionState: 'IDLE'
          }
        ]
      }
    ]);
    await (room as any).initializeWorldPersistence();
    expect(room.state.resourceNodes.size).toBe(0);
    expect(room.state.buildings.size).toBe(0);
    expect(room.state.units.size).toBe(0);
  });

  it('P5 restores upgrade progress', async () => {
    const { room } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([]);
    (DatabaseService as any).clearAllResources.mockResolvedValue(undefined);
    (DatabaseService as any).saveAllResources.mockResolvedValue(undefined);
    (DatabaseService as any).loadZoneEntities.mockResolvedValue([
      {
        id: 'player1',
        name: 'Player',
        buildings: [
          {
            id: 'b1',
            ownerId: 'player1',
            zone: 'battlefield',
            type: 'TOWN_CENTER',
            gridX: 2,
            gridY: 2,
            sizeX: 2,
            sizeY: 2,
            hp: 100,
            maxHp: 200,
            level: 1,
            upgradeProgressMs: 1000,
            upgradeTimeMs: 5000,
            isConstructed: true,
            constructionProgress: 100
          }
        ],
        units: []
      }
    ]);
    await (room as any).initializeWorldPersistence();
    const b = room.state.buildings.get('b1')!;
    expect(b.upgradeProgressMs).toBe(1000);
    expect(b.upgradeTimeMs).toBe(5000);
  });

  it('P7 keeps a depleted node empty and resumes its stored deadline', async () => {
    const { room, internals } = createRoom('battlefield');
    const future = Date.now() + 120_000;
    (DatabaseService as any).loadResources.mockResolvedValue([
      { id: 'res_gold', zone: 'battlefield', type: 'GOLD_MINE', resourceType: 'gold', gridX: 5, gridY: 6, remainingAmount: 0, maxAmount: 800, respawnAt: future }
    ]);
    await internals.initializeWorldPersistence();

    const node = room.state.resourceNodes.get('res_gold')!;
    expect(node.remainingAmount).toBe(0);
    const respawnAt = internals.resourceRespawnAt as Map<string, number>;
    expect(respawnAt.get('res_gold')).toBe(future);
  });

  it('P8 refills a node whose deadline passed while the server was down', async () => {
    const { room, internals } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([
      { id: 'res_stone', zone: 'battlefield', type: 'STONE_MINE', resourceType: 'stone', gridX: 5, gridY: 6, remainingAmount: 0, maxAmount: 600, respawnAt: Date.now() - 1 }
    ]);
    await internals.initializeWorldPersistence();

    const node = room.state.resourceNodes.get('res_stone')!;
    expect(node.remainingAmount).toBe(600);
    const respawnAt = internals.resourceRespawnAt as Map<string, number>;
    expect(respawnAt.has('res_stone')).toBe(false);
  });

  it('P9 schedules a fresh delay for a depleted row with no stored deadline', async () => {
    const { room, internals } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([
      { id: 'res_wood', zone: 'battlefield', type: 'TREE', resourceType: 'wood', gridX: 5, gridY: 6, remainingAmount: 0, maxAmount: 200, respawnAt: null }
    ]);
    const before = Date.now();
    await internals.initializeWorldPersistence();

    const node = room.state.resourceNodes.get('res_wood')!;
    expect(node.remainingAmount).toBe(0);
    const respawnAt = internals.resourceRespawnAt as Map<string, number>;
    expect(respawnAt.get('res_wood')).toBeGreaterThanOrEqual(before + RESOURCE_REGROW_MS.wood);
  });

  it('P10 drops a depleted starter node instead of refilling it', async () => {
    const { room, internals } = createRoom('kingdom:player-a');
    (DatabaseService as any).loadResources.mockResolvedValue([
      { id: 'res_starter_1', zone: 'kingdom:player-a', type: 'TREE', resourceType: 'wood', gridX: 51, gridY: 52, remainingAmount: 0, maxAmount: 200, respawnAt: null }
    ]);
    await internals.initializeWorldPersistence();

    expect(room.state.resourceNodes.has('res_starter_1')).toBe(false);
    const respawnAt = internals.resourceRespawnAt as Map<string, number>;
    expect(respawnAt.has('res_starter_1')).toBe(false);
  });

  it('P11 clamps a stored level above the ten-level cap', async () => {
    const { room } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockResolvedValue([]);
    (DatabaseService as any).loadZoneEntities.mockResolvedValue([
      {
        id: 'player1',
        name: 'Player',
        buildings: [
          {
            id: 'b_high',
            ownerId: 'player1',
            zone: 'battlefield',
            type: 'TOWN_CENTER',
            gridX: 2,
            gridY: 2,
            sizeX: 4,
            sizeY: 4,
            hp: 5000,
            maxHp: 5000,
            level: 87,
            upgradeProgressMs: 0,
            upgradeTimeMs: 0,
            isConstructed: true,
            constructionProgress: 100
          }
        ],
        units: []
      }
    ]);
    await (room as any).initializeWorldPersistence();

    // The ladder ends at ten now, so a save written under the old cap cannot
    // load a level the game no longer has — and its HP has to follow.
    const building = room.state.buildings.get('b_high')!;
    expect(building.level).toBe(10);
    expect(building.maxHp).toBe(getBuildingLevelStats('TOWN_CENTER', 10).maxHp);
    expect(building.hp).toBe(building.maxHp);
  });

  it('P6 load error', async () => {
    const { internals } = createRoom('battlefield');
    (DatabaseService as any).loadResources.mockRejectedValue(new Error('boom'));
    await internals.initializeWorldPersistence();
    expect(internals.worldRestoreError).toBeInstanceOf(Error);
    expect(internals.zoneReady).toBe(false);
  });
});

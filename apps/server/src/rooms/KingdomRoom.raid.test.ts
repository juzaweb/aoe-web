import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessage, RejectCode } from '@chien-quoc/shared';
import { KingdomRoom } from './KingdomRoom.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { UNIT_BLUEPRINTS, getBuildingLevelStats } from '@chien-quoc/shared';

const settleRaid = vi.fn();
const findActiveRaidForDefender = vi.fn();
const findRaid = vi.fn();
const raidStatus = vi.fn();
const syncTownCenterLevel = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/RaidService.js', () => ({
  RaidError: class extends Error {},
  RaidService: {
    settleRaid: (...args: unknown[]) => settleRaid(...args),
    findActiveRaidForDefender: (...args: unknown[]) => findActiveRaidForDefender(...args),
    findRaid: (...args: unknown[]) => findRaid(...args),
    raidStatus: (...args: unknown[]) => raidStatus(...args),
    syncTownCenterLevel: (...args: unknown[]) => syncTownCenterLevel(...args)
  }
}));

// The base room's own persistence is irrelevant to these assertions.
vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    loadPlayerProfile: vi.fn().mockResolvedValue(null),
    savePlayerEmpire: vi.fn().mockResolvedValue(undefined),
    saveZonePlayerEntities: vi.fn().mockResolvedValue(undefined),
    saveFullWorldState: vi.fn().mockResolvedValue(undefined),
    loadForeignBaseline: vi.fn().mockResolvedValue({ unitCount: 0, buildings: [] }),
    consumeTravelTransfers: vi.fn().mockResolvedValue([]),
    commitTravel: vi.fn().mockResolvedValue(undefined),
    loadRoads: vi.fn().mockResolvedValue([]),
    loadZoneEntities: vi.fn().mockResolvedValue([])
  }
}));

const internals = (room: KingdomRoom) => room as any;

function createRoom(): KingdomRoom {
  const room = new KingdomRoom();
  room.setState(new WorldState());
  internals(room).ownerScope = 'defender';
  // A real room only ticks after `initializeWorldPersistence` finished; the
  // harness mirrors that so the restore guard does not hide every assertion.
  internals(room).zoneReady = true;
  internals(room).zoneId = 'kingdom:defender';
  room.state.zoneId = 'kingdom:defender';
  room.state.mapWidth = 110;
  room.state.mapHeight = 110;
  return room;
}

function createClient(userId: string) {
  return {
    sessionId: `s-${userId}`,
    auth: { userId, displayName: userId },
    send: vi.fn(),
    leave: vi.fn()
  };
}

function addPlayer(room: KingdomRoom, id: string) {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  room.state.players.set(id, player);
  return player;
}

function addUnit(room: KingdomRoom, id: string, ownerId: string) {
  const unit = new UnitState();
  unit.id = id;
  unit.ownerId = ownerId;
  unit.type = 'SPEARMAN';
  unit.x = 10;
  unit.y = 10;
  unit.targetX = 10;
  unit.targetY = 10;
  unit.speed = UNIT_BLUEPRINTS.SPEARMAN.speed;
  unit.hp = 100;
  unit.maxHp = 100;
  room.state.units.set(id, unit);
  return unit;
}

function addTownCenter(room: KingdomRoom, ownerId: string, hp?: number) {
  const stats = getBuildingLevelStats('TOWN_CENTER', 1);
  const building = new BuildingState();
  building.id = 'b-tc';
  building.ownerId = ownerId;
  building.type = 'TOWN_CENTER';
  building.gridX = 53;
  building.gridY = 53;
  building.sizeX = 4;
  building.sizeY = 4;
  building.level = 1;
  building.maxHp = stats.maxHp;
  building.hp = hp ?? stats.maxHp;
  building.isConstructed = true;
  building.constructionProgress = 100;
  room.state.buildings.set(building.id, building);
  return building;
}

function withRaid(room: KingdomRoom, attackerId = 'attacker') {
  internals(room).raidId = 'raid-1';
  internals(room).raidAttackerId = attackerId;
  internals(room).raidStartedAt = Date.now();
}

beforeEach(() => {
  settleRaid.mockReset();
  findActiveRaidForDefender.mockReset();
  findRaid.mockReset();
  raidStatus.mockReset();
  syncTownCenterLevel.mockClear();

  settleRaid.mockResolvedValue({
    attackerId: 'attacker',
    defenderId: 'defender',
    outcome: 'ATTACKER_WON',
    loot: { wood: 10, food: 10, gold: 10, stone: 10 }
  });
});

describe('KingdomRoom raid access', () => {
  it('lets the owner and the raider in, nobody else', () => {
    const room = createRoom();
    expect(room['canJoinOwner']('defender')).toBe(true);
    expect(room['canJoinOwner']('attacker')).toBe(false);

    withRaid(room);
    expect(room['canJoinOwner']('attacker')).toBe(true);
    expect(room['canJoinOwner']('stranger')).toBe(false);
  });

  it('only lets the defender manage the map', () => {
    const room = createRoom();
    withRaid(room);

    expect(room['canManageZone']('defender')).toBe(true);
    expect(room['canManageZone']('attacker')).toBe(false);
  });

  it('never spawns a starter base for a raider', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');

    await room['spawnZoneContent']('attacker');

    expect(room.state.buildings.size).toBe(0);
    expect(room.state.units.size).toBe(0);
  });

  it('still spawns the defender base', async () => {
    const room = createRoom();
    addPlayer(room, 'defender');

    await room['spawnZoneContent']('defender');

    const types = Array.from(room.state.buildings.values()).map((b: BuildingState) => b.type);
    expect(types).toContain('TOWN_CENTER');
  });
});

describe('KingdomRoom raid settlement', () => {
  it('never judges a raid before the map has been restored', async () => {
    const room = createRoom();
    internals(room).zoneReady = false;
    addPlayer(room, 'attacker');
    withRaid(room);

    room['afterTick']();
    await Promise.resolve();

    expect(settleRaid).not.toHaveBeenCalled();
  });

  it('declares the attacker the winner when the Town Center is breached', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    addUnit(room, 'u1', 'attacker');
    const townCenter = room.state.buildings.get('b-tc')!;
    townCenter.hp = Math.ceil(townCenter.maxHp * 0.25);
    withRaid(room);

    await room['evaluateRaid']();

    expect(settleRaid).toHaveBeenCalledTimes(1);
    expect(settleRaid.mock.calls[0][0]).toMatchObject({ raidId: 'raid-1', outcome: 'ATTACKER_WON' });
    // The Town Center is restored rather than left half-destroyed.
    expect(townCenter.hp).toBe(townCenter.maxHp);
    expect(internals(room).raidId).toBeNull();
  });

  it('declares the defender the winner when a wiped army is gone', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    withRaid(room);
    // The army was on the map and is now gone: a real wipe.
    internals(room).raidArmySeen = true;

    await room['evaluateRaid']();

    expect(settleRaid.mock.calls[0][0]).toMatchObject({ outcome: 'DEFENDER_WON' });
  });

  it('waits for the army when the raid was committed before the attacker joined', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    withRaid(room);

    // No attacker unit has ever been on this map: `/raid/start` has committed
    // the raid but the attacker socket has not arrived yet.
    await room['evaluateRaid']();

    expect(settleRaid).not.toHaveBeenCalled();
    expect(internals(room).raidId).toBe('raid-1');
  });

  it('declares the defender the winner when their Town Center is missing', async () => {
    const room = createRoom();
    addUnit(room, 'u1', 'attacker');
    withRaid(room);

    await room['evaluateRaid']();

    expect(settleRaid.mock.calls[0][0]).toMatchObject({ outcome: 'DEFENDER_WON' });
  });

  it('leaves a healthy raid running', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    addUnit(room, 'u1', 'attacker');
    withRaid(room);

    await room['evaluateRaid']();

    expect(settleRaid).not.toHaveBeenCalled();
    expect(internals(room).raidId).toBe('raid-1');
  });

  it('tells the attacker with RAID_ENDED and removes their army from the map', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    addUnit(room, 'u1', 'attacker');
    const attackerClient = createClient('attacker');
    const defenderClient = createClient('defender');
    internals(room).clients = new Map([
      ['s-attacker', attackerClient],
      ['s-defender', defenderClient]
    ]);
    const townCenter = room.state.buildings.get('b-tc')!;
    townCenter.hp = 1;
    withRaid(room);

    await room['evaluateRaid']();

    expect(attackerClient.send).toHaveBeenCalledWith(
      NetworkMessage.RAID_ENDED,
      expect.objectContaining({ outcome: 'ATTACKER_WON', returnRoom: 'kingdom_room' })
    );
    expect(defenderClient.send).toHaveBeenCalledWith(
      NetworkMessage.SYSTEM_ANNOUNCEMENT,
      expect.objectContaining({ message: expect.stringContaining('bị tập kích') })
    );
    expect(room.state.units.size).toBe(0);
  });

  it('clears ghost soldiers when another path settled the raid first', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    addUnit(room, 'u1', 'attacker');
    room.state.buildings.get('b-tc')!.hp = 1;
    withRaid(room);
    internals(room).raidArmySeen = true;
    settleRaid.mockResolvedValue(null);

    await room['evaluateRaid']();

    expect(room.state.units.size).toBe(0);
    expect(internals(room).raidId).toBeNull();
  });

  it('does not settle twice when the tick fires again', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    addUnit(room, 'u1', 'attacker');
    const townCenter = room.state.buildings.get('b-tc')!;
    townCenter.hp = 1;
    withRaid(room);

    await room['evaluateRaid']();
    await room['evaluateRaid']();

    expect(settleRaid).toHaveBeenCalledTimes(1);
  });
});

describe('KingdomRoom retreat', () => {
  it('refuses a retreat from anyone but the raider', async () => {
    const room = createRoom();
    withRaid(room);
    const defenderClient = createClient('defender');

    await room['handleRetreat'](defenderClient as any);

    expect(settleRaid).not.toHaveBeenCalled();
    expect(defenderClient.send).toHaveBeenCalledWith(
      NetworkMessage.ERROR_NOTIFICATION,
      expect.objectContaining({ code: RejectCode.FORBIDDEN })
    );
  });

  it('settles as RETREATED for the raider', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addUnit(room, 'u1', 'attacker');
    withRaid(room);

    await room['handleRetreat'](createClient('attacker') as any);

    expect(settleRaid.mock.calls[0][0]).toMatchObject({
      raidId: 'raid-1',
      outcome: 'RETREATED',
      survivingUnitIds: ['u1']
    });
  });

  it('rejects a retreat when no raid is running', async () => {
    const room = createRoom();
    const client = createClient('attacker');

    await room['handleRetreat'](client as any);

    expect(settleRaid).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(
      NetworkMessage.ERROR_NOTIFICATION,
      expect.objectContaining({ code: RejectCode.FORBIDDEN })
    );
  });
});

describe('KingdomRoom raid restore', () => {
  it('pulls a raider army into a room that was already live', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    (DatabaseService.loadZoneEntities as any).mockResolvedValueOnce([
      {
        id: 'attacker',
        buildings: [],
        units: [
          {
            id: 'u-late',
            type: 'SPEARMAN',
            x: 20,
            y: 30,
            speed: 1,
            level: 1,
            hp: 90,
            maxHp: 100,
            actionState: 'IDLE'
          }
        ]
      }
    ]);

    await room['restoreRaiderArmy']('attacker');

    expect(room.state.units.has('u-late')).toBe(true);
    expect(room.state.players.get('attacker')!.population).toBe(1);
  });

  it('does not duplicate an army that is already in memory', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addUnit(room, 'u1', 'attacker');
    const calls = (DatabaseService.loadZoneEntities as any).mock.calls.length;

    await room['restoreRaiderArmy']('attacker');

    expect(room.state.units.size).toBe(1);
    expect((DatabaseService.loadZoneEntities as any).mock.calls.length).toBe(calls);
  });

  it('loads both owners when a raid survived a restart', async () => {
    const room = createRoom();
    findActiveRaidForDefender.mockResolvedValue({
      id: 'raid-1',
      attackerId: 'attacker',
      defenderId: 'defender',
      units: [],
      startedAt: Date.now()
    });

    const owners = await room['entityOwnersToLoad']();

    expect(owners).toEqual(['defender', 'attacker']);
    expect(internals(room).raidId).toBe('raid-1');
  });

  it('loads only the defender when there is no raid', async () => {
    const room = createRoom();
    findActiveRaidForDefender.mockResolvedValue(null);

    expect(await room['entityOwnersToLoad']()).toEqual(['defender']);
  });
});

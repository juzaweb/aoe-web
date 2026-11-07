import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessage, RejectCode } from '@chien-quoc/shared';
import { KingdomRoom } from './KingdomRoom.js';
import { resetSpectatorWatch } from './spectatorWatch.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { UNIT_BLUEPRINTS, getBuildingLevelStats } from '@chien-quoc/shared';

const settleRaid = vi.fn();
const findActiveRaidForDefender = vi.fn();
const findRaid = vi.fn();
const findSpectateTarget = vi.fn();
const raidStatus = vi.fn();
const syncTownCenterLevel = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/RaidService.js', () => ({
  RaidError: class extends Error {},
  RaidService: {
    settleRaid: (...args: unknown[]) => settleRaid(...args),
    findActiveRaidForDefender: (...args: unknown[]) => findActiveRaidForDefender(...args),
    findRaid: (...args: unknown[]) => findRaid(...args),
    findSpectateTarget: (...args: unknown[]) => findSpectateTarget(...args),
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

function addPortal(room: KingdomRoom, ownerId: string) {
  const portal = new BuildingState();
  portal.id = 'b-portal';
  portal.ownerId = ownerId;
  portal.type = 'PORTAL';
  // Matches `ensurePortalFor`'s fixed kingdom gateway: right edge, centred.
  portal.gridX = room.state.mapWidth - 5 - 2;
  portal.gridY = Math.floor(room.state.mapHeight / 2) - 1;
  portal.sizeX = 2;
  portal.sizeY = 2;
  portal.level = 1;
  portal.maxHp = 1000;
  portal.hp = 1000;
  portal.isConstructed = true;
  portal.constructionProgress = 100;
  room.state.buildings.set(portal.id, portal);
  return portal;
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
  findSpectateTarget.mockReset();
  resetSpectatorWatch();
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

  it('orders the army to the gate instead of settling immediately', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    const unit = addUnit(room, 'u1', 'attacker');
    addPortal(room, 'attacker');
    withRaid(room);

    await room['handleRetreat'](createClient('attacker') as any);

    expect(settleRaid).not.toHaveBeenCalled();
    expect(internals(room).raidRetreating).toBe(true);
    // The gate sits on the right edge, so the order must point there rather
    // than leaving the unit at its old position.
    expect(unit.actionState).toBe('MOVING');
    expect(unit.targetX).toBeGreaterThan(100);
  });

  it('settles as RETREATED only once every unit reaches the gate', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    const unitA = addUnit(room, 'u1', 'attacker');
    const unitB = addUnit(room, 'u2', 'attacker');
    addPortal(room, 'attacker');
    withRaid(room);

    await room['handleRetreat'](createClient('attacker') as any);

    // One unit is already at its slot, the other is still walking.
    unitA.x = unitA.targetX;
    unitA.y = unitA.targetY;
    unitA.actionState = 'IDLE';
    unitB.x = unitB.targetX + 10;

    await room['evaluateRaid']();
    expect(settleRaid).not.toHaveBeenCalled();

    unitB.x = unitB.targetX;
    unitB.y = unitB.targetY;
    unitB.actionState = 'IDLE';

    await room['evaluateRaid']();
    expect(settleRaid.mock.calls[0][0]).toMatchObject({
      raidId: 'raid-1',
      outcome: 'RETREATED',
      survivingUnitIds: ['u1', 'u2']
    });
  });

  it('does not treat a finished new order as reaching the gate', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addTownCenter(room, 'defender');
    const unit = addUnit(room, 'u1', 'attacker');
    addPortal(room, 'attacker');
    withRaid(room);

    await room['handleRetreat'](createClient('attacker') as any);

    // The player pulled the unit away after clicking retreat and that new
    // order finished somewhere else: matching its own target must not count.
    unit.x = 5;
    unit.y = 5;
    unit.targetX = 5;
    unit.targetY = 5;
    unit.actionState = 'IDLE';

    await room['evaluateRaid']();

    expect(settleRaid).not.toHaveBeenCalled();
    expect(internals(room).raidId).toBe('raid-1');
  });

  it('does not settle when the gate is missing', async () => {
    const room = createRoom();
    addPlayer(room, 'attacker');
    addUnit(room, 'u1', 'attacker');
    withRaid(room);
    const client = createClient('attacker');

    // The base room's `world` zone has no gates at all.
    room.state.zoneId = 'world';

    await room['handleRetreat'](client as any);

    expect(settleRaid).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(
      NetworkMessage.ERROR_NOTIFICATION,
      expect.objectContaining({ message: 'Không tìm thấy cổng rút quân.' })
    );
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

describe('KingdomRoom spectator joins', () => {
  const target = {
    id: 'defender',
    name: 'defender',
    color: '#38bdf8',
    townCenterLevel: 3
  };

  it('joins a watcher without a player row, starter base or session', async () => {
    const room = createRoom();
    addTownCenter(room, 'defender');
    findSpectateTarget.mockResolvedValue(target);
    const client = createClient('viewer');

    await room['onJoin'](client as any, { ownerId: 'defender', spectate: true });

    expect(internals(room).spectatorSessions.has(client.sessionId)).toBe(true);
    // The watcher is not a player: no PlayerState and no spawned empire.
    expect(room.state.players.has('viewer')).toBe(false);
    expect(room.state.buildings.size).toBe(1);
    expect(room.state.units.size).toBe(0);
  });

  it('refuses to watch your own kingdom', async () => {
    const room = createRoom();
    addTownCenter(room, 'defender');
    const client = createClient('defender');

    await expect(
      room['onJoin'](client as any, { ownerId: 'defender', spectate: true })
    ).rejects.toThrow('chính mình');
    expect(findSpectateTarget).not.toHaveBeenCalled();
  });

  it('refuses an account without a Town Center', async () => {
    const room = createRoom();
    findSpectateTarget.mockResolvedValue({ ...target, townCenterLevel: 0 });

    await expect(
      room['onJoin'](createClient('viewer') as any, { ownerId: 'defender', spectate: true })
    ).rejects.toThrow('không tồn tại hoặc chưa có');
  });

  it('refuses an unknown target', async () => {
    const room = createRoom();
    findSpectateTarget.mockResolvedValue(null);

    await expect(
      room['onJoin'](createClient('viewer') as any, { ownerId: 'ghost', spectate: true })
    ).rejects.toThrow('không tồn tại hoặc chưa có');
  });

  it('refuses a map that has no Town Center after restore', async () => {
    const room = createRoom();
    findSpectateTarget.mockResolvedValue(target);

    await expect(
      room['onJoin'](createClient('viewer') as any, { ownerId: 'defender', spectate: true })
    ).rejects.toThrow('không còn Nhà chính');
  });

  it('refuses a room that is no longer the live zone of that owner', async () => {
    const room = createRoom();
    addTownCenter(room, 'defender');
    findSpectateTarget.mockResolvedValue(target);
    internals(room).ownerScope = 'someone-else';

    await expect(
      room['onJoin'](createClient('viewer') as any, { ownerId: 'defender', spectate: true })
    ).rejects.toThrow('đã được thay thế');
  });

  it('drops the watcher from the room on leave without touching the empire', () => {
    const room = createRoom();
    const client = createClient('viewer');
    internals(room).spectatorSessions.add(client.sessionId);
    internals(room).spectatorViewers.set(client.sessionId, 'viewer');

    room['onLeave'](client as any);

    expect(internals(room).spectatorSessions.has(client.sessionId)).toBe(false);
    expect(internals(room).spectatorViewers.has(client.sessionId)).toBe(false);
    expect(client.leave).not.toHaveBeenCalled();
  });

  it('allows one watcher window per account and frees it on leave', async () => {
    const first = createRoom();
    addTownCenter(first, 'defender');
    findSpectateTarget.mockResolvedValue(target);
    const firstClient = createClient('viewer');
    await first['onJoin'](firstClient as any, { ownerId: 'defender', spectate: true });

    const second = createRoom();
    addTownCenter(second, 'defender');
    const secondClient = { ...createClient('viewer'), sessionId: 's-viewer-2' };
    await expect(
      second['onJoin'](secondClient as any, { ownerId: 'defender', spectate: true })
    ).rejects.toThrow('đang quan sát một vương quốc khác');

    first['onLeave'](firstClient as any);
    await second['onJoin'](secondClient as any, { ownerId: 'defender', spectate: true });
    expect(internals(second).spectatorSessions.has(secondClient.sessionId)).toBe(true);
  });

  it('refuses every command from a watcher at the room boundary', () => {
    const room = createRoom();
    const client = createClient('viewer');
    internals(room).spectatorSessions.add(client.sessionId);
    const handler = vi.fn();
    room['onCommandMessage'](NetworkMessage.MOVE_UNITS, handler);

    internals(room).onMessageEvents.emit(NetworkMessage.MOVE_UNITS, client, {});

    expect(handler).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(
      NetworkMessage.ERROR_NOTIFICATION,
      expect.objectContaining({ code: RejectCode.FORBIDDEN })
    );
  });

  it('still runs a command for a normal player', () => {
    const room = createRoom();
    const client = createClient('defender');
    const handler = vi.fn();
    room['onCommandMessage'](NetworkMessage.MOVE_UNITS, handler);

    internals(room).onMessageEvents.emit(NetworkMessage.MOVE_UNITS, client, {});

    expect(handler).toHaveBeenCalledWith(client, {});
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

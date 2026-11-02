import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  NetworkMessage,
  UNIT_BLUEPRINTS
} from '@chien-quoc/shared';
import { WorldRoom } from './WorldRoom.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { accountSessions } from './AccountSessions.js';
import { entityIds } from '../services/EntityIdAllocator.js';
import { resetTravelCooldowns } from './travelCooldowns.js';

vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    commitTravel: vi.fn().mockResolvedValue(undefined),
    saveZonePlayerEntities: vi.fn().mockResolvedValue(undefined),
    savePlayerEmpire: vi.fn().mockResolvedValue(undefined)
  }
}));

const OWNER = 'user-1';
const ZONE = 'kingdom:user-1';

function createRoom(): WorldRoom {
  const room = new WorldRoom();
  room.setState(new WorldState());
  room.state.zoneId = ZONE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = room as any;
  internals.zoneId = ZONE;
  internals.zoneReady = true;
  return room;
}

function createClient() {
  return {
    sessionId: 'session-1',
    auth: { userId: OWNER, displayName: 'Emperor' },
    send: vi.fn(),
    leave: vi.fn()
  };
}

function addPlayer(room: WorldRoom): PlayerState {
  const player = new PlayerState();
  player.id = OWNER;
  player.name = 'Emperor';
  room.state.players.set(OWNER, player);
  return player;
}

function addPortal(room: WorldRoom, type: 'PORTAL' | 'TOWER' = 'PORTAL'): BuildingState {
  const blueprint = BUILDING_BLUEPRINTS[type];
  const building = new BuildingState();
  building.id = type === 'PORTAL' ? 'b_portal' : 'b_tower';
  building.ownerId = OWNER;
  building.type = type;
  building.gridX = 50;
  building.gridY = 50;
  building.sizeX = blueprint.sizeX;
  building.sizeY = blueprint.sizeY;
  building.maxHp = blueprint.maxHp;
  building.hp = blueprint.maxHp;
  building.isConstructed = true;
  room.state.buildings.set(building.id, building);
  return building;
}

function addUnit(room: WorldRoom, id: string, ownerId = OWNER): UnitState {
  const unit = new UnitState();
  unit.id = id;
  unit.ownerId = ownerId;
  unit.type = 'VILLAGER';
  unit.x = 40;
  unit.y = 40;
  unit.targetX = 40;
  unit.targetY = 40;
  unit.speed = UNIT_BLUEPRINTS.VILLAGER.speed;
  unit.hp = UNIT_BLUEPRINTS.VILLAGER.maxHp;
  unit.maxHp = UNIT_BLUEPRINTS.VILLAGER.maxHp;
  room.state.units.set(id, unit);
  return unit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (room: WorldRoom) => room as any;

function readyMessages(client: ReturnType<typeof createClient>) {
  return client.send.mock.calls.filter(([message]) => message === NetworkMessage.TRAVEL_READY);
}

describe('WorldRoom.handleTravel', () => {
  beforeEach(() => {
    vi.mocked(DatabaseService.commitTravel).mockReset().mockResolvedValue(undefined);
    vi.mocked(DatabaseService.saveZonePlayerEntities).mockClear();
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();
    accountSessions.reset();
    entityIds.reset();
    resetTravelCooldowns();
  });

  it('moves only owned units into a transfer and acks the client', async () => {
    const room = createRoom();
    addPlayer(room);
    const portal = addPortal(room);
    addUnit(room, 'u_1');
    addUnit(room, 'u_2', 'someone-else');
    const client = createClient();

    await internals(room).handleTravel(client, {
      portalId: portal.id,
      unitIds: ['u_1', 'u_2']
    });

    expect(DatabaseService.commitTravel).toHaveBeenCalledTimes(1);
    const input = vi.mocked(DatabaseService.commitTravel).mock.calls[0][0];
    expect(input.fromZone).toBe(ZONE);
    expect(input.toZone).toBe('battlefield');
    expect(input.units.map((unit) => unit.id)).toEqual(['u_1']);

    expect(room.state.units.has('u_1')).toBe(false);
    expect(room.state.units.has('u_2')).toBe(true);

    const ready = readyMessages(client);
    expect(ready).toHaveLength(1);
    expect(ready[0][1]).toMatchObject({
      destination: 'battlefield',
      roomName: 'battlefield_room'
    });
  });

  it('travels alone when no units are selected', async () => {
    const room = createRoom();
    addPlayer(room);
    const portal = addPortal(room);
    const client = createClient();

    await internals(room).handleTravel(client, { portalId: portal.id, unitIds: [] });

    expect(DatabaseService.commitTravel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(DatabaseService.commitTravel).mock.calls[0][0].units).toEqual([]);
    expect(readyMessages(client)).toHaveLength(1);
  });

  it('refuses a building that is not an owned portal', async () => {
    const room = createRoom();
    addPlayer(room);
    const tower = addPortal(room, 'TOWER');
    const client = createClient();

    await internals(room).handleTravel(client, { portalId: tower.id, unitIds: [] });

    expect(DatabaseService.commitTravel).not.toHaveBeenCalled();
    expect(readyMessages(client)).toHaveLength(0);
  });

  it('leaves the units in place when the transaction fails', async () => {
    const room = createRoom();
    addPlayer(room);
    const portal = addPortal(room);
    addUnit(room, 'u_1');
    vi.mocked(DatabaseService.commitTravel).mockRejectedValueOnce(new Error('db down'));
    const client = createClient();

    await internals(room).handleTravel(client, { portalId: portal.id, unitIds: ['u_1'] });

    expect(room.state.units.has('u_1')).toBe(true);
    expect(readyMessages(client)).toHaveLength(0);
    expect(
      client.send.mock.calls.some(([message]) => message === NetworkMessage.ERROR_NOTIFICATION)
    ).toBe(true);
  });

  it('enforces the travel cooldown across rooms', async () => {
    const first = createRoom();
    addPlayer(first);
    const firstPortal = addPortal(first);
    const firstClient = createClient();
    await internals(first).handleTravel(firstClient, {
      portalId: firstPortal.id,
      unitIds: []
    });
    expect(DatabaseService.commitTravel).toHaveBeenCalledTimes(1);

    // A fresh room (the destination, or a reloaded source) must still see the
    // cooldown: it is account-wide, not per room.
    const second = createRoom();
    addPlayer(second);
    const secondPortal = addPortal(second);
    const secondClient = createClient();
    await internals(second).handleTravel(secondClient, {
      portalId: secondPortal.id,
      unitIds: []
    });

    expect(DatabaseService.commitTravel).toHaveBeenCalledTimes(1);
    expect(readyMessages(secondClient)).toHaveLength(0);
  });

  it('a leave caused by travel saves entities only, never the source account row', async () => {
    const room = createRoom();
    addPlayer(room);
    const portal = addPortal(room);
    addUnit(room, 'u_1');
    const client = createClient();
    accountSessions.activate(OWNER, client.sessionId, ZONE, () => undefined, () => true);

    await internals(room).handleTravel(client, {
      portalId: portal.id,
      unitIds: ['u_1']
    });
    await internals(room).onLeave(client);

    expect(DatabaseService.saveZonePlayerEntities).toHaveBeenCalledTimes(1);
    const [zone, ownerId, buildings, units] = vi.mocked(
      DatabaseService.saveZonePlayerEntities
    ).mock.calls[0];
    expect(zone).toBe(ZONE);
    expect(ownerId).toBe(OWNER);
    expect(buildings.map((building) => building.id)).toEqual([portal.id]);
    expect(units).toEqual([]);
    // Re-writing the account row here would roll the destination back to the
    // resources captured before the travel.
    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
  });

  it('caps the number of units in one order', async () => {
    const room = createRoom();
    addPlayer(room);
    const portal = addPortal(room);
    const client = createClient();

    await internals(room).handleTravel(client, {
      portalId: portal.id,
      unitIds: Array.from({ length: 121 }, (_, index) => `u_${index}`)
    });

    expect(DatabaseService.commitTravel).not.toHaveBeenCalled();
    expect(readyMessages(client)).toHaveLength(0);
  });
});

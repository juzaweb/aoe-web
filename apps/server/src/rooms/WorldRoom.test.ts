import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  MAP_GRID_WIDTH,
  MAX_SELECTION,
  NetworkMessage,
  RejectCode,
  SESSION_ALREADY_ACTIVE,
  SESSION_REPLACED_CLOSE,
  KINGDOM_MAP_SIZE,
  RESOURCE_REGROW_MS,
  TERRAIN_KINGDOM,
  UNIT_BLUEPRINTS,
  INITIAL_POPULATION_CAP,
  citadelTownCenterFor,
  getBuildingLevelStats,
  getEffectiveBuildingMaxHp,
  getEffectiveTrainTimeMs,
  getEffectiveUnitAttackPower,
  getEffectiveUnitMaxHp,
  isPlazaTile,
  getBuildingMaxLevel,
  getBuildingUpgradeCost,
  getBuildingUpgradeTimeMs,
  getPlayerUnitLevel,
  getUnitLevelStats,
  gatherIntervalMs,
  getUnitUpgradeCost,
  getUnitUpgradeTimeMs
} from '@chien-quoc/shared';
import { CORPSE_LINGER_MS, WorldRoom } from './WorldRoom.js';
import { STARTER_RESOURCE_PREFIX } from './resources.js';
import { isWithinBuildRange } from './construction.js';
import { generateWorldResources } from './worldGeneration.js';
import { clearUnitResearch, restoreBuildingUpgrade } from './upgrades.js';
import { citadelWallTileSet } from './citadel.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { accountSaves, accountSessions } from './AccountSessions.js';
import { zonePersistence } from './ZonePersistence.js';

// The join/leave ownership tests at the end of this file must never touch
// SQLite. Only the room's persistence entry points are stubbed; every other test
// here drives handlers that do not save.
vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    loadPlayerProfile: vi.fn().mockResolvedValue(null),
    savePlayerEmpire: vi.fn().mockResolvedValue(undefined),
    saveZonePlayerEntities: vi.fn().mockResolvedValue(undefined),
    saveFullWorldState: vi.fn().mockResolvedValue(undefined),
    loadForeignBaseline: vi.fn().mockResolvedValue({ unitCount: 0, buildings: [] }),
    consumeTravelTransfers: vi.fn().mockResolvedValue([]),
    commitTravel: vi.fn().mockResolvedValue(undefined),
    loadRoads: vi.fn().mockResolvedValue([])
  }
}));

// The session gate is process-wide now, so state must not leak between tests.
beforeEach(() => {
  accountSessions.reset();
  accountSaves.reset();
  zonePersistence.reset();
});

/**
 * These tests drive `WorldRoom` without `onCreate()`: that method wires the
 * simulation interval, the 30 s autosave and SQLite restore, none of which a
 * handler or a tick assertion needs. The room's own field initialisers already
 * build every map the handlers touch, so a bare instance plus a fresh
 * `WorldState` is the whole harness and a test calls `update()` by hand.
 */
type TestClient = {
  sessionId: string;
  auth: { userId: string; displayName: string };
  send: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
};

function createRoom() {
  const room = new WorldRoom();
  room.setState(new WorldState());
  return room;
}

/**
 * The command handlers and the tick are private. The tests call them the way
 * `onMessage` and the simulation interval do, so the escape hatch stays in one
 * place instead of being scattered through the file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (room: WorldRoom) => room as any;

/**
 * A joined client. `onAuth` always runs before a join, so every client carries
 * the verified account; the tests default both ids to the session id.
 */
function createClient(
  sessionId: string,
  account: { userId?: string; displayName?: string } = {}
): TestClient {
  return {
    sessionId,
    auth: {
      userId: account.userId ?? sessionId,
      displayName: account.displayName ?? sessionId
    },
    send: vi.fn(),
    leave: vi.fn()
  };
}

/** Runs `ms` of simulation in 100 ms steps, the room's own tick granularity. */
function simulate(room: WorldRoom, ms: number, tickMs = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += tickMs) internals(room).update(tickMs);
}

/**
 * ECO-02: time one villager needs to fill its carry slot from `resourceType`.
 *
 * Gathering is paid in whole units, so this is exact rather than approximate:
 * a load of `carryCapacity` takes that many harvest intervals.
 */
function fullLoadMs(resourceType: string): number {
  return gatherIntervalMs(resourceType) * UNIT_BLUEPRINTS.VILLAGER.carryCapacity;
}

function addPlayer(room: WorldRoom, sessionId: string, overrides: Partial<PlayerState> = {}) {
  const player = new PlayerState();
  player.id = sessionId;
  player.name = sessionId;
  Object.assign(player, overrides);
  room.state.players.set(sessionId, player);
  return player;
}

function addUnit(
  room: WorldRoom,
  options: {
    id: string;
    ownerId: string;
    type?: string;
    x?: number;
    y?: number;
    actionState?: string;
  }
) {
  const { id, ownerId, type = 'VILLAGER', x = 10, y = 10, actionState = 'IDLE' } = options;
  const blueprint = UNIT_BLUEPRINTS[type as keyof typeof UNIT_BLUEPRINTS];

  const unit = new UnitState();
  unit.id = id;
  unit.ownerId = ownerId;
  unit.type = type;
  unit.x = x;
  unit.y = y;
  unit.targetX = x;
  unit.targetY = y;
  unit.speed = blueprint.speed;
  unit.hp = blueprint.maxHp;
  unit.maxHp = blueprint.maxHp;
  unit.actionState = actionState;
  room.state.units.set(id, unit);
  return unit;
}

function addBuilding(
  room: WorldRoom,
  options: {
    id: string;
    ownerId: string;
    type?: string;
    gridX?: number;
    gridY?: number;
    isConstructed?: boolean;
  }
) {
  const {
    id,
    ownerId,
    type = 'TOWN_CENTER',
    gridX = 40,
    gridY = 40,
    isConstructed = true
  } = options;
  const blueprint = BUILDING_BLUEPRINTS[type as keyof typeof BUILDING_BLUEPRINTS];

  const building = new BuildingState();
  building.id = id;
  building.ownerId = ownerId;
  building.type = type;
  building.gridX = gridX;
  building.gridY = gridY;
  building.sizeX = blueprint.sizeX;
  building.sizeY = blueprint.sizeY;
  building.maxHp = blueprint.maxHp;
  building.hp = isConstructed ? blueprint.maxHp : 1;
  building.isConstructed = isConstructed;
  building.constructionProgress = isConstructed ? 100 : 0;
  room.state.buildings.set(id, building);
  return building;
}

/** Snapshot of the room's buildings, in insertion order. */
function listedBuildings(room: WorldRoom): BuildingState[] {
  const buildings: BuildingState[] = [];
  room.state.buildings.forEach((b: BuildingState) => buildings.push(b));
  return buildings;
}

function addResource(
  room: WorldRoom,
  options: { id: string; resourceType?: string; gridX?: number; gridY?: number; remainingAmount?: number }
) {
  const { id, resourceType = 'wood', gridX = 50, gridY = 50, remainingAmount = 100 } = options;
  const node = new ResourceNodeState();
  node.id = id;
  node.type = resourceType === 'wood' ? 'TREE' : 'GOLD_MINE';
  node.resourceType = resourceType;
  node.gridX = gridX;
  node.gridY = gridY;
  node.remainingAmount = remainingAmount;
  node.maxAmount = remainingAmount;
  room.state.resourceNodes.set(id, node);
  return node;
}

describe('handleMoveUnits', () => {
  it('ignores units the client does not own', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const foreign = addUnit(room, { id: 'u_1', ownerId: 'player-b', x: 12, y: 12 });
    const clientA = createClient('player-a');

    internals(room).commands.handleMoveUnits(clientA, { unitIds: ['u_1'], targetGridX: 60, targetGridY: 60 });

    expect(foreign.actionState).toBe('IDLE');
    expect(foreign.targetX).toBe(12);
    expect(foreign.targetY).toBe(12);
  });

  it('rejects a command that exceeds MAX_SELECTION', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const clientA = createClient('player-a');
    const unitIds = Array.from({ length: MAX_SELECTION + 1 }, (_, i) => `u_${i}`);

    internals(room).commands.handleMoveUnits(clientA, { unitIds, targetGridX: 60, targetGridY: 60 });

    expect(clientA.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Too many units in one command', code: RejectCode.LIMIT
    });
  });
});

describe('handleAttackTarget', () => {
  it('rejects a friendly target', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const own = addUnit(room, { id: 'u_1', ownerId: 'player-a' });
    const clientA = createClient('player-a');

    internals(room).commands.handleAttackTarget(clientA, {
      unitIds: ['u_1'],
      targetEntityId: 'u_1',
      targetType: 'unit'
    });

    expect(clientA.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Cannot attack your own units or buildings', code: RejectCode.FORBIDDEN
    });
    expect(own.actionState).toBe('IDLE');
    expect(own.targetEntityId).toBe('');
  });

  it('starts attacking an enemy unit and drops queued waypoints', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const attacker = addUnit(room, { id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN' });
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', x: 20, y: 10 });
    attacker.queueTargetX.push(99);
    attacker.queueTargetY.push(99);

    internals(room).commands.handleAttackTarget(createClient('player-a'), {
      unitIds: ['u_1'],
      targetEntityId: 'u_2',
      targetType: 'unit'
    });

    expect(attacker.actionState).toBe('ATTACKING');
    expect(attacker.targetEntityId).toBe('u_2');
    expect(attacker.queueTargetX.length).toBe(0);
  });
});

describe('handleTrainUnit', () => {
  it('deducts the blueprint cost and queues the unit', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { food: 500 });
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWN_CENTER' });
    const woodBefore = player.wood;

    internals(room).commands.handleTrainUnit(createClient('player-a'), {
      buildingId: 'b_1',
      unitType: 'VILLAGER'
    });

    const cost = UNIT_BLUEPRINTS.VILLAGER.cost;
    expect(player.food).toBe(500 - cost.food);
    expect(player.wood).toBe(woodBefore - cost.wood);
    expect(room.state.buildings.get('b_1')!.trainingQueue.length).toBe(1);
    expect(room.state.buildings.get('b_1')!.trainingQueue[0]).toBe('VILLAGER');
  });

  it('refuses the order when resources are short and charges nothing', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { food: 10 });
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWN_CENTER' });
    const clientA = createClient('player-a');

    internals(room).commands.handleTrainUnit(clientA, { buildingId: 'b_1', unitType: 'VILLAGER' });

    expect(clientA.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Insufficient resources to train unit', code: RejectCode.RESOURCE
    });
    expect(player.food).toBe(10);
    expect(room.state.buildings.get('b_1')!.trainingQueue.length).toBe(0);
  });

  // MIL-01: each military branch trains exactly one unit line.
  it('refuses a unit the building does not train', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { food: 500, gold: 500 });
    addBuilding(room, { id: 'b_barracks', ownerId: 'player-a', type: 'BARRACKS' });
    const client = createClient('player-a');

    internals(room).commands.handleTrainUnit(client, {
      buildingId: 'b_barracks',
      unitType: 'CAVALRY'
    });

    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Unit cannot be trained at this structure', code: RejectCode.PREREQUISITE
    });
    expect(player.food).toBe(500);
    expect(room.state.buildings.get('b_barracks')!.trainingQueue.length).toBe(0);
  });
});

describe('handlePlaceBuilding', () => {
  /**
   * Whether a point sits on a footprint, as opposed to beside it.
   *
   * The crew test asserts the *contract* — "stand outside the footprint, close
   * enough to work" — rather than the exact ring coordinate, so changing a
   * building size or the approach distance does not fail a test whose behaviour
   * did not change.
   */
  function isInsideFootprint(x: number, y: number, building: BuildingState) {
    return (
      x >= building.gridX &&
      x < building.gridX + building.sizeX &&
      y >= building.gridY &&
      y < building.gridY + building.sizeY
    );
  }

  it('refuses to build on top of an existing building and charges nothing', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 500 });
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWN_CENTER', gridX: 40, gridY: 40 });
    const clientA = createClient('player-a');
    const buildingsBefore = room.state.buildings.size;

    internals(room).commands.handlePlaceBuilding(clientA, { type: 'HOUSE', gridX: 41, gridY: 41 });

    expect(clientA.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Placement obstructed by existing structure or resource', code: RejectCode.PLACEMENT
    });
    expect(room.state.buildings.size).toBe(buildingsBefore);
    expect(player.wood).toBe(500);
  });

  it('refuses to build off the map', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 500 });
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE',
      gridX: MAP_GRID_WIDTH - 1,
      gridY: 10
    });

    expect(clientA.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Cannot build outside map bounds', code: RejectCode.PLACEMENT
    });
    expect(player.wood).toBe(500);
  });

  it('signs the villagers that were selected up to the new foundation (CMD-07)', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 500 });
    const villagerA = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 33, y: 33, actionState: 'HARVESTING' });
    const villagerB = addUnit(room, { id: 'u_2', ownerId: 'player-a', x: 34, y: 34 });
    // A queued waypoint from the old order must not survive the build order.
    villagerA.queueTargetX.push(60);
    villagerA.queueTargetY.push(60);
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE',
      gridX: 40,
      gridY: 40,
      unitIds: ['u_1', 'u_2']
    });

    const buildings: BuildingState[] = [];
    room.state.buildings.forEach((b: BuildingState) => buildings.push(b));
    expect(buildings.length).toBe(1);
    const foundation = buildings[0];
    expect(foundation.isConstructed).toBe(false);

    for (const villager of [villagerA, villagerB]) {
      expect(villager.actionState).toBe('BUILDING');
      expect(villager.targetEntityId).toBe(foundation.id);
      expect(villager.targetEntityType).toBe('building');

      // Walk target must be a spot they can actually work from: beside the
      // footprint, not on it (the building would displace them), and within the
      // build range the construction pass uses to count them as crew.
      expect(isInsideFootprint(villager.targetX, villager.targetY, foundation)).toBe(false);
      expect(
        isWithinBuildRange(
          { x: villager.targetX, y: villager.targetY } as unknown as UnitState,
          foundation
        )
      ).toBe(true);
    }

    expect(villagerA.queueTargetX.length).toBe(0);
    expect(villagerA.queueTargetY.length).toBe(0);
    // No error toast: the placement and its crew are one accepted command.
    expect(clientA.send).not.toHaveBeenCalled();
  });

  it('drops military, foreign and unknown units from the placement crew (CMD-07)', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 500 });
    addPlayer(room, 'player-b', { wood: 500 });
    const villager = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30 });
    const spearman = addUnit(room, { id: 'u_2', ownerId: 'player-a', type: 'SPEARMAN', x: 30, y: 31 });
    const foreignVillager = addUnit(room, { id: 'u_3', ownerId: 'player-b', x: 30, y: 32 });
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE',
      gridX: 40,
      gridY: 40,
      unitIds: ['u_1', 'u_2', 'u_3', 'u_missing']
    });

    expect(villager.actionState).toBe('BUILDING');
    expect(spearman.actionState).toBe('IDLE');
    expect(spearman.targetEntityId).toBe('');
    expect(foreignVillager.actionState).toBe('IDLE');
    expect(foreignVillager.targetEntityId).toBe('');
  });

  it('places the building with no crew when the payload carries no unit ids', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 500 });
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, { type: 'HOUSE', gridX: 40, gridY: 40 });

    expect(room.state.buildings.size).toBe(1);
    expect(player.wood).toBe(500 - BUILDING_BLUEPRINTS.HOUSE.cost.wood);
  });

  it('ignores a malformed crew list instead of failing the placement (CMD-07)', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 500 });
    const villager = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30 });
    const clientA = createClient('player-a');

    // `unitIds` comes from the client, so its shape is not a promise. A string
    // where an array is expected must cost the crew, never the placement.
    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE',
      gridX: 40,
      gridY: 40,
      unitIds: 'u_1'
    });

    expect(room.state.buildings.size).toBe(1);
    expect(villager.actionState).toBe('IDLE');
  });

  it('queues a shift-placed foundation behind the site a crew already builds', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 500 });
    const villager = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30 });
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 40, gridY: 40, unitIds: ['u_1'], queue: true
    });
    const first = listedBuildings(room)[0];
    expect(villager.targetEntityId).toBe(first.id);

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 44, gridY: 40, unitIds: ['u_1'], queue: true
    });
    const second = listedBuildings(room).find((b) => b.id !== first.id)!;

    // The crew stays on the first site; the second waits behind it.
    expect(villager.targetEntityId).toBe(first.id);
    expect(second.isConstructed).toBe(false);

    // Finishing the first site hands the villager the queued foundation.
    first.isConstructed = true;
    internals(room).update(16);

    expect(villager.actionState).toBe('BUILDING');
    expect(villager.targetEntityId).toBe(second.id);
  });

  it('skips a queued foundation that was cancelled before the crew reached it', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 500 });
    const villager = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30 });
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 40, gridY: 40, unitIds: ['u_1'], queue: true
    });
    const first = listedBuildings(room)[0];

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 44, gridY: 40, unitIds: ['u_1'], queue: true
    });
    const second = listedBuildings(room).find((b) => b.id !== first.id)!;
    room.state.buildings.delete(second.id);

    first.isConstructed = true;
    internals(room).update(16);

    // The vanished entry is dropped instead of stranding the villager on it.
    expect(villager.actionState).toBe('IDLE');
    expect(villager.targetEntityId).toBe('');
  });

  it('lets a plain drop replace the crew order and clear its build queue', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 500 });
    const villager = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30 });
    const clientA = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 40, gridY: 40, unitIds: ['u_1'], queue: true
    });
    const first = listedBuildings(room)[0];
    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 44, gridY: 40, unitIds: ['u_1'], queue: true
    });
    const queued = listedBuildings(room).find((b) => b.id !== first.id)!;

    internals(room).commands.handlePlaceBuilding(clientA, {
      type: 'HOUSE', gridX: 48, gridY: 40, unitIds: ['u_1']
    });
    const replacement = listedBuildings(room).find(
      (b) => b.id !== first.id && b.id !== queued.id
    )!;

    expect(villager.targetEntityId).toBe(replacement.id);

    // The stale queue entry must not pull the crew away once the first site is done.
    first.isConstructed = true;
    internals(room).update(16);
    expect(villager.targetEntityId).toBe(replacement.id);

    replacement.isConstructed = true;
    internals(room).update(16);
    expect(villager.actionState).toBe('IDLE');
    expect(villager.targetEntityId).toBe('');
  });
});

describe('update', () => {
  it('turns a MOVING unit that reached its target IDLE', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10, y: 10, actionState: 'MOVING' });
    unit.targetX = 10.1;
    unit.targetY = 10;

    internals(room).update(100);

    expect(unit.actionState).toBe('IDLE');
    expect(unit.x).toBe(10);
  });

  it('advances a MOVING unit by speed * deltaTime', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10, y: 10, actionState: 'MOVING' });
    unit.targetX = 50;
    unit.targetY = 10;

    internals(room).update(1000);

    expect(unit.x).toBeCloseTo(10 + UNIT_BLUEPRINTS.VILLAGER.speed, 5);
    expect(unit.actionState).toBe('MOVING');
  });

  it('finishes a foundation after buildTimeMs of one villager working', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const foundation = addBuilding(room, {
      id: 'b_1',
      ownerId: 'player-a',
      type: 'HOUSE',
      gridX: 40,
      gridY: 40,
      isConstructed: false
    });

    // Standing just outside the 2x2 footprint, signed up to the site.
    const builder = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 42.2, y: 41, actionState: 'BUILDING' });
    builder.targetEntityId = 'b_1';
    builder.targetEntityType = 'building';

    const buildTimeMs = BUILDING_BLUEPRINTS.HOUSE.buildTimeMs;
    const tickMs = 100;

    // The building pass runs before the unit pass, so the first tick only fills
    // the crew roster and work starts on the second one.
    internals(room).update(tickMs);
    expect(foundation.constructionProgress).toBe(0);

    for (let elapsed = tickMs; elapsed < buildTimeMs; elapsed += tickMs) {
      internals(room).update(tickMs);
      expect(foundation.isConstructed).toBe(false);
    }

    internals(room).update(tickMs);

    expect(foundation.isConstructed).toBe(true);
    expect(foundation.constructionProgress).toBe(100);
    expect(foundation.hp).toBe(foundation.maxHp);
    expect(foundation.builderUnitIds.length).toBe(0);
    expect(builder.actionState).toBe('IDLE');
  });

  it('does not advance a foundation nobody is working on', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const foundation = addBuilding(room, {
      id: 'b_1',
      ownerId: 'player-a',
      type: 'HOUSE',
      isConstructed: false
    });

    internals(room).update(2000);

    expect(foundation.constructionProgress).toBe(0);
    expect(foundation.isConstructed).toBe(false);
  });
});

describe('gathering and drop-off (SIM-02)', () => {
  /** A villager standing on a node, already ordered to harvest it. */
  function harvestScenario(options: { nodeAmount?: number; nodeType?: string; withTownCenter?: boolean } = {}) {
    const { nodeAmount = 100, nodeType = 'wood', withTownCenter = true } = options;
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 0 });
    const node = addResource(room, { id: 'res_1', resourceType: nodeType, gridX: 50, gridY: 41, remainingAmount: nodeAmount });

    if (withTownCenter) {
      addBuilding(room, { id: 'b_tc', ownerId: 'player-a', type: 'TOWN_CENTER', gridX: 40, gridY: 40 });
    } else {
      addBuilding(room, { id: 'b_barracks', ownerId: 'player-a', type: 'BARRACKS', gridX: 40, gridY: 40 });
    }

    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      x: 50.5,
      y: 41.5,
      actionState: 'HARVESTING'
    });
    unit.targetEntityId = node.id;
    unit.targetEntityType = 'resource';
    unit.targetX = node.gridX;
    unit.targetY = node.gridY;

    return { room, player, node, unit };
  }

  it('carries a full load instead of crediting the player directly', () => {
    const { room, player, node, unit } = harvestScenario();

    simulate(room, fullLoadMs('wood'));

    expect(unit.carryingAmount).toBe(UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
    expect(unit.carryingResourceType).toBe('wood');
    expect(node.remainingAmount).toBe(100 - UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
    expect(player.wood).toBe(0);
    expect(unit.actionState).toBe('RETURNING');
    expect(unit.dropOffId).toBe('b_tc');
  });

  it('takes one unit per gather interval rather than a load every second', () => {
    const { room, node, unit } = harvestScenario();

    // ECO-02: slower rates are the point of the pass, so a single second must
    // not come close to filling the slot.
    simulate(room, gatherIntervalMs('wood') * 2);

    expect(unit.carryingAmount).toBe(2);
    expect(node.remainingAmount).toBe(98);
  });

  it('banks the load at the town center and walks back to the node', () => {
    const { room, player, unit } = harvestScenario();
    const capacity = UNIT_BLUEPRINTS.VILLAGER.carryCapacity;

    simulate(room, fullLoadMs('wood'));
    expect(unit.actionState).toBe('RETURNING');

    let delivered = false;
    for (let i = 0; i < 400 && !delivered; i++) {
      internals(room).update(100);
      delivered = player.wood === capacity;
    }

    expect(delivered).toBe(true);
    expect(unit.carryingAmount).toBe(0);
    expect(unit.carryingResourceType).toBe('');
    expect(unit.dropOffId).toBe('');
    expect(unit.actionState).toBe('HARVESTING');
    expect(unit.targetEntityId).toBe('res_1');
  });

  it('never takes more than a nearly empty node holds in one tick', () => {
    const { room, node, unit } = harvestScenario({ nodeAmount: 1 });

    // A long tick (lag, or a resumed room) has room for several harvest
    // intervals; the node only has one unit left.
    internals(room).update(3000);

    expect(unit.carryingAmount).toBe(1);
    expect(node.remainingAmount).toBe(0);
    expect(room.state.resourceNodes.has(node.id)).toBe(true);
  });

  it('does not carry spare harvest time to a different node', () => {
    const { room, node, unit } = harvestScenario({ nodeAmount: 1 });
    const other = addResource(room, {
      id: 'res_2',
      resourceType: 'wood',
      gridX: 51,
      gridY: 41,
      remainingAmount: 100
    });

    // Three seconds on a one-unit node would otherwise bank ~2.6s of credit and
    // hand the next node almost a free load.
    internals(room).update(3000);
    expect(node.remainingAmount).toBe(0);

    unit.targetEntityId = other.id;
    unit.targetEntityType = 'resource';
    unit.targetX = other.gridX;
    unit.targetY = other.gridY;
    unit.actionState = 'HARVESTING';
    internals(room).update(50);

    // Only the 50 ms of this tick counts: the spare time is capped at one
    // interval, not banked into a free unit.
    expect(unit.carryingAmount).toBe(1);
    expect(other.remainingAmount).toBe(100);
  });

  it('banks a partial load when the node runs dry mid-gather', () => {
    const { room, player, node, unit } = harvestScenario({ nodeAmount: 4 });

    simulate(room, gatherIntervalMs('wood') * 4);

    expect(unit.carryingAmount).toBe(4);
    // MAPS: a depleted node stays in the snapshot as an empty slot so it can
    // respawn; the client hides it while `remainingAmount` is 0.
    expect(room.state.resourceNodes.has(node.id)).toBe(true);
    expect(node.remainingAmount).toBe(0);
    expect(unit.actionState).toBe('RETURNING');
    expect(player.wood).toBe(0);
  });

  it('gives up on a node another villager emptied before it arrived', () => {
    const { room, unit } = harvestScenario({ nodeAmount: 0 });

    internals(room).update(50);

    // The order must resolve on the first tick: a zero take cannot return early
    // or the villager stands at an empty stump forever.
    expect(unit.actionState).toBe('IDLE');
    expect(unit.targetEntityId).toBe('');
  });

  it('keeps the load when no drop-off accepts it', () => {
    const { room, player, unit } = harvestScenario({ withTownCenter: false });

    simulate(room, fullLoadMs('wood'));

    expect(unit.carryingAmount).toBe(UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
    expect(unit.actionState).toBe('IDLE');
    expect(player.wood).toBe(0);
  });

  it('does not pay out when the drop-off is destroyed mid-trip', () => {
    const { room, player, unit } = harvestScenario();
    const capacity = UNIT_BLUEPRINTS.VILLAGER.carryCapacity;

    simulate(room, fullLoadMs('wood'));
    expect(unit.actionState).toBe('RETURNING');

    room.state.buildings.delete('b_tc');
    internals(room).update(100);

    expect(player.wood).toBe(0);
    expect(unit.carryingAmount).toBe(capacity);
    expect(unit.actionState).toBe('IDLE');
  });

  it('banks a load of one type before gathering another', () => {
    const { room, player, node, unit } = harvestScenario({ nodeType: 'gold' });
    const capacity = UNIT_BLUEPRINTS.VILLAGER.carryCapacity;

    // Villager already holds wood and is now standing at a gold mine.
    unit.carryingResourceType = 'wood';
    unit.carryingAmount = capacity;

    internals(room).update(1000);

    expect(unit.actionState).toBe('RETURNING');
    expect(unit.carryingResourceType).toBe('wood');
    expect(node.remainingAmount).toBe(100);
    expect(player.wood).toBe(0);
  });
});

describe('farm gathering (ECO-01)', () => {
  /** A villager standing at a field's edge, already ordered to work it. */
  function farmScenario(options: { farmFood?: number; wood?: number } = {}) {
    const { farmFood = BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0, wood = 0 } = options;
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood, food: 0 });

    const farm = addBuilding(room, { id: 'b_farm', ownerId: 'player-a', type: 'FARM', gridX: 50, gridY: 50 });
    farm.resourceAmount = farmFood;
    farm.resourceCapacity = BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0;
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a', type: 'TOWN_CENTER', gridX: 40, gridY: 52 });

    // Just outside the 3x3 footprint, so the field is worked from its edge.
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      x: 49,
      y: 51.5,
      actionState: 'HARVESTING'
    });
    unit.targetEntityId = farm.id;
    unit.targetEntityType = 'farm';

    return { room, player, farm, unit, client: createClient('player-a') };
  }

  it('harvests food from the field instead of the ground', () => {
    const { room, player, farm, unit } = farmScenario();
    const capacity = UNIT_BLUEPRINTS.VILLAGER.carryCapacity;

    simulate(room, fullLoadMs('food'));

    expect(unit.carryingAmount).toBe(capacity);
    expect(unit.carryingResourceType).toBe('food');
    expect(farm.resourceAmount).toBe((BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0) - capacity);
    expect(player.food).toBe(0);
    expect(unit.actionState).toBe('RETURNING');
    expect(unit.dropOffId).toBe('b_tc');
  });

  it('banks the load at the town center and returns to the field', () => {
    const { room, player, unit } = farmScenario();
    const capacity = UNIT_BLUEPRINTS.VILLAGER.carryCapacity;

    simulate(room, fullLoadMs('food'));
    expect(unit.actionState).toBe('RETURNING');

    let delivered = false;
    for (let i = 0; i < 400 && !delivered; i++) {
      internals(room).update(100);
      delivered = player.food === capacity;
    }

    expect(delivered).toBe(true);
    expect(unit.actionState).toBe('HARVESTING');
    expect(unit.targetEntityId).toBe('b_farm');
    expect(unit.targetEntityType).toBe('farm');
  });

  it('re-sows an emptied field for the farm cost and keeps working', () => {
    const { room, player, farm, unit } = farmScenario({ farmFood: 5, wood: 60 });

    // Food comes off a field at 2.5/s, so five units is two seconds of work.
    simulate(room, 2000);

    // Five units left on the field, so five are carried and the field is paid for.
    expect(unit.carryingAmount).toBe(5);
    expect(player.wood).toBe(0);
    expect(farm.resourceAmount).toBe(BUILDING_BLUEPRINTS.FARM.gatherCapacity);
    expect(farm.resourceCapacity).toBe(BUILDING_BLUEPRINTS.FARM.gatherCapacity);
  });

  it('re-sows a levelled field to its own capacity, not the blueprint baseline', () => {
    const { room, player, farm } = farmScenario({ farmFood: 5, wood: 60 });
    farm.level = 4;
    const capacity = getBuildingLevelStats('FARM', 4).gatherCapacity;
    farm.resourceCapacity = capacity;

    simulate(room, 2000);

    expect(player.wood).toBe(0);
    expect(farm.resourceAmount).toBe(capacity);
    expect(farm.resourceCapacity).toBe(capacity);
    expect(capacity).toBeGreaterThan(BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0);
  });

  it('stop working a field it cannot re-sow, but keeps the load', () => {
    const { room, player, farm, unit } = farmScenario({ farmFood: 5, wood: 0 });

    simulate(room, 2000);
    // Empty and unaffordable: the load in hand is banked, not thrown away.
    internals(room).update(1000);

    expect(farm.resourceAmount).toBe(0);
    expect(player.wood).toBe(0);
    expect(unit.carryingAmount).toBe(5);
    expect(unit.actionState).toBe('RETURNING');
  });

  it('refuses a harvest order on an empty farm', () => {
    const { room, farm, client } = farmScenario({ farmFood: 0 });

    internals(room).economy.handleHarvestOrder(client, { unitIds: ['u_1'], buildingId: farm.id });

    expect(farm.resourceAmount).toBe(0);
    expect(client.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, { message: 'Farm is empty', code: RejectCode.RESOURCE });
  });

  it('refuses a harvest order on a farm owned by somebody else', () => {
    const { room, farm } = farmScenario();
    const stranger = createClient('player-b');

    internals(room).economy.handleHarvestOrder(stranger, { unitIds: ['u_1'], buildingId: farm.id });

    expect(stranger.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'That farm is not yours', code: RejectCode.FORBIDDEN
    });
  });

  it('banks the load and stops when the field is raised mid-harvest', () => {
    const { room, farm, unit } = farmScenario();
    unit.carryingAmount = 4;
    unit.carryingResourceType = 'food';
    room.state.buildings.delete(farm.id);

    internals(room).update(1000);

    // The load is banked; the target is kept so the resumed order can discover
    // the field is gone and retarget (see `startReturning`).
    expect(unit.actionState).toBe('RETURNING');
    expect(unit.carryingAmount).toBe(4);
    expect(unit.dropOffId).toBe('b_tc');
  });

  it('drops back to idle when an empty-handed field disappears', () => {
    const { room, farm, unit } = farmScenario();
    room.state.buildings.delete(farm.id);

    internals(room).update(1000);

    expect(unit.actionState).toBe('IDLE');
    expect(unit.targetEntityType).toBe('');
    expect(unit.targetEntityId).toBe('');
  });

  it('starts a finished farm full and leaves a foundation empty', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const foundation = addBuilding(room, {
      id: 'b_1',
      ownerId: 'player-a',
      type: 'FARM',
      gridX: 40,
      gridY: 40,
      isConstructed: false
    });
    const builder = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 42.2, y: 41, actionState: 'BUILDING' });
    builder.targetEntityId = 'b_1';
    builder.targetEntityType = 'building';

    internals(room).update(100);
    expect(foundation.resourceAmount).toBe(0);

    for (let elapsed = 0; elapsed < BUILDING_BLUEPRINTS.FARM.buildTimeMs + 500; elapsed += 100) {
      internals(room).update(100);
    }

    expect(foundation.isConstructed).toBe(true);
    expect(foundation.resourceAmount).toBe(BUILDING_BLUEPRINTS.FARM.gatherCapacity);
  });
});

describe('pathfinding (SIM-01)', () => {
  /** Runs ticks until `done()` or the budget runs out. */
  function tickUntil(room: WorldRoom, done: () => boolean, maxTicks = 600, tickMs = 100) {
    for (let i = 0; i < maxTicks; i++) {
      internals(room).update(tickMs);
      if (done()) return true;
    }
    return false;
  }

  it('routes a unit around a wall of buildings instead of through it', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');

    // A wall of towers at x=15 from y=8 to y=12; the only way past is around it.
    for (let y = 8; y <= 12; y++) {
      addBuilding(room, { id: `b_${y}`, ownerId: 'player-a', type: 'TOWER', gridX: 15, gridY: y });
    }

    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10.5, y: 10.5 });
    internals(room).commands.handleMoveUnits(createClient('player-a'), {
      unitIds: ['u_1'],
      targetGridX: 20,
      targetGridY: 10
    });

    internals(room).update(100);
    expect(unit.pathX.length).toBeGreaterThan(0);

    const visited: Array<{ x: number; y: number }> = [];
    const arrived = tickUntil(room, () => {
      visited.push({ x: unit.x, y: unit.y });
      return unit.actionState === 'IDLE';
    });

    expect(arrived).toBe(true);
    expect(unit.x).toBeCloseTo(20, 1);
    expect(unit.y).toBeCloseTo(10, 1);

    const walkedThrough = visited.filter((position) => {
      const gx = Math.floor(position.x);
      const gy = Math.floor(position.y);
      return gx === 15 && gy >= 8 && gy <= 12;
    });
    expect(walkedThrough).toEqual([]);
  });

  it('keeps walking straight when no route exists, instead of freezing', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');

    // Ring of towers boxing the target in: every neighbouring tile is blocked.
    const ring: Array<[number, number]> = [
      [19, 19], [20, 19], [21, 19],
      [19, 20], [21, 20],
      [19, 21], [20, 21], [21, 21]
    ];
    ring.forEach(([x, y], index) =>
      addBuilding(room, { id: `b_${index}`, ownerId: 'player-a', type: 'TOWER', gridX: x, gridY: y })
    );

    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10.5, y: 20.5 });
    internals(room).commands.handleMoveUnits(createClient('player-a'), {
      unitIds: ['u_1'],
      targetGridX: 20,
      targetGridY: 20
    });

    internals(room).update(100);
    expect(unit.pathX.length).toBe(0);

    const startX = unit.x;
    internals(room).update(1000);
    expect(unit.x).toBeGreaterThan(startX);
  });

  it('clears a stale route when a new order arrives', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10.5, y: 10.5 });
    const clientA = createClient('player-a');

    internals(room).commands.handleMoveUnits(clientA, { unitIds: ['u_1'], targetGridX: 30, targetGridY: 10 });
    internals(room).update(100);
    expect(unit.pathX.length).toBeGreaterThan(0);

    internals(room).commands.handleMoveUnits(clientA, { unitIds: ['u_1'], targetGridX: 10, targetGridY: 30 });
    expect(unit.pathX.length).toBe(0);

    internals(room).update(100);
    const last = unit.pathX.length - 1;
    expect(unit.pathX[last]).toBeCloseTo(10.5, 5);
    expect(unit.pathY[last]).toBeCloseTo(30.5, 5);
  });
});

describe('route invalidation (SIM-01 follow-up)', () => {
  it('re-routes when a building appears on the remaining path', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10.5, y: 10.5 });

    internals(room).commands.handleMoveUnits(createClient('player-a'), {
      unitIds: ['u_1'],
      targetGridX: 20,
      targetGridY: 10
    });
    internals(room).update(100);
    expect(unit.pathX.length).toBeGreaterThan(0);

    // A completed tower dropped exactly on the next waypoint's tile.
    const nextX = Math.floor(unit.pathX[0]);
    const nextY = Math.floor(unit.pathY[0]);
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWER', gridX: nextX, gridY: nextY });

    internals(room).update(100);

    // The stale route is dropped and a fresh search is queued; the tick's own
    // path batch already ran, so the new route arrives on the next tick.
    const movement = internals(room).movement;
    expect(unit.pathX.length).toBe(0);
    expect(movement.pendingPathIds.has('u_1')).toBe(true);

    internals(room).update(100);
    expect(unit.pathX.length).toBeGreaterThan(0);
    const reroutedOntoObstacle =
      Math.floor(unit.pathX[0]) === nextX && Math.floor(unit.pathY[0]) === nextY;
    expect(reroutedOntoObstacle).toBe(false);
  });

  it('does not touch a route that is still clear', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10.5, y: 10.5 });

    internals(room).commands.handleMoveUnits(createClient('player-a'), {
      unitIds: ['u_1'],
      targetGridX: 30,
      targetGridY: 10
    });
    internals(room).update(100);
    const pathLength = unit.pathX.length;
    expect(pathLength).toBeGreaterThan(0);

    internals(room).update(100);

    const movement = internals(room).movement;
    expect(movement.pendingPathIds.size).toBe(0);
    expect(movement.lastRepathAt.size).toBe(0);
    // Untouched: still the same route, not re-searched and not cleared.
    expect(unit.pathX.length).toBe(pathLength);
  });
});

describe('tower combat (SIM-03)', () => {
  it('damages an enemy unit inside its range and spares its owner units', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWER', gridX: 40, gridY: 40 });
    const friendly = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 42, y: 41 });
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', x: 45, y: 41 });

    internals(room).update(100);

    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp - BUILDING_BLUEPRINTS.TOWER.attackPower);
    expect(friendly.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp);
  });

  it('holds fire while the tower is still a foundation', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    addBuilding(room, {
      id: 'b_1',
      ownerId: 'player-a',
      type: 'TOWER',
      gridX: 40,
      gridY: 40,
      isConstructed: false
    });
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', x: 42, y: 41 });

    internals(room).update(100);

    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp);
  });

  it('waits out the cooldown between shots', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWER', gridX: 40, gridY: 40 });
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', x: 42, y: 41 });
    const maxHp = UNIT_BLUEPRINTS.VILLAGER.maxHp;
    const cooldown = BUILDING_BLUEPRINTS.TOWER.attackCooldownMs;

    internals(room).update(100);
    expect(enemy.hp).toBe(maxHp - 10);

    internals(room).update(cooldown - 200);
    expect(enemy.hp).toBe(maxHp - 10);

    internals(room).update(200);
    expect(enemy.hp).toBe(maxHp - 20);
  });
});

describe('unit auto-engagement', () => {
  it('lets an idle soldier pick up an enemy inside its aggro radius', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 14, y: 10 });

    internals(room).update(100);

    expect(soldier.actionState).toBe('ATTACKING');
    expect(soldier.targetEntityId).toBe(enemy.id);
    expect(soldier.targetEntityType).toBe('unit');
    // Out of weapon range this tick: it acquired the target, but did not hit.
    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp);
  });

  it('prefers an enemy soldier over a closer villager', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
    const enemySoldier = addUnit(room, {
      id: 'u_3', ownerId: 'player-b', type: 'SPEARMAN', x: 14, y: 10
    });

    internals(room).update(100);

    expect(soldier.targetEntityId).toBe(enemySoldier.id);
  });

  it('prefers a villager over a nearer building', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    addBuilding(room, {
      id: 'b_1', ownerId: 'player-b', type: 'HOUSE', gridX: 11, gridY: 9
    });
    const villager = addUnit(room, {
      id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 14, y: 10
    });

    internals(room).update(100);

    expect(soldier.targetEntityId).toBe(villager.id);
  });

  it('falls back to an enemy building when no unit is in range', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    const building = addBuilding(room, {
      id: 'b_1', ownerId: 'player-b', type: 'HOUSE', gridX: 12, gridY: 10
    });

    internals(room).update(100);

    expect(soldier.targetEntityId).toBe(building.id);
    expect(soldier.targetEntityType).toBe('building');
  });

  it('never auto-acquires the portal', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    addBuilding(room, {
      id: 'b_1', ownerId: 'player-b', type: 'PORTAL', gridX: 12, gridY: 10
    });

    internals(room).update(100);

    expect(soldier.actionState).toBe('IDLE');
    expect(soldier.targetEntityId).toBe('');
  });

  it('spares friendly units and buildings', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    addUnit(room, { id: 'u_2', ownerId: 'player-a', type: 'VILLAGER', x: 11, y: 10 });
    addBuilding(room, {
      id: 'b_1', ownerId: 'player-a', type: 'HOUSE', gridX: 12, gridY: 10
    });

    internals(room).update(100);

    expect(soldier.actionState).toBe('IDLE');
    expect(soldier.targetEntityId).toBe('');
  });

  it('keeps villagers out of fights they were not ordered into', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const villager = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'VILLAGER', x: 10, y: 10
    });
    addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'SPEARMAN', x: 12, y: 10 });

    internals(room).update(100);

    expect(villager.actionState).toBe('IDLE');
    expect(villager.targetEntityId).toBe('');
  });

  it('resumes a plain move after the auto-acquired fight ends', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const soldier = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10, actionState: 'MOVING'
    });
    soldier.targetX = 40;
    soldier.targetY = 10;
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 12, y: 10 });

    internals(room).update(100);
    expect(soldier.actionState).toBe('ATTACKING');
    expect(soldier.targetEntityId).toBe(enemy.id);

    room.state.units.delete(enemy.id);
    internals(room).update(100);

    expect(soldier.actionState).toBe('MOVING');
    expect(soldier.targetX).toBe(40);
    expect(soldier.x).toBeGreaterThan(10);
  });
});

describe('combat cooldown bookkeeping', () => {
  it('resumes the stored order on the tick its target dies', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const attacker = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10, actionState: 'ATTACKING'
    });
    attacker.previousActionState = 'ATTACK_MOVE';
    const victim = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
    victim.hp = 1;
    attacker.targetEntityId = victim.id;
    attacker.targetEntityType = 'unit';

    internals(room).update(100);

    expect(room.state.units.has(victim.id)).toBe(false);
    expect(attacker.actionState).toBe('ATTACK_MOVE');
    expect(attacker.targetEntityId).toBe('');
  });

  it('drops a unit cooldown when that unit is killed', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const enemy = addUnit(room, {
      id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10
    });
    // Keep the idle soldier from auto-acquiring the villager: this test is about
    // the villager's cooldown being dropped, not about auto-engagement.
    enemy.stance = 'NO_ATTACK';
    const victim = addUnit(room, {
      id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10, actionState: 'ATTACKING'
    });
    victim.targetEntityId = enemy.id;
    victim.targetEntityType = 'unit';

    // Tick 1: the villager lands its own hit, which is what puts it in the
    // cooldown map. Killing it in the same tick would not, because the tick
    // deletes it before its turn comes around.
    internals(room).update(100);
    const combat = internals(room).combat;
    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.SPEARMAN.maxHp - UNIT_BLUEPRINTS.VILLAGER.attackPower);
    expect(combat.attackTimers.has(victim.id)).toBe(true);

    // Tick 2: a tower finishes it off mid-cooldown.
    addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWER', gridX: 11, gridY: 9 });
    victim.hp = 1;
    internals(room).update(100);

    expect(room.state.units.has(victim.id)).toBe(false);
    expect(combat.attackTimers.has(victim.id)).toBe(false);
    // The villager was the only unit with a cooldown, so the map must be empty.
    expect(combat.attackTimers.size).toBe(0);
  });

  it('drops a tower cooldown when the tower is destroyed', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const tower = addBuilding(room, { id: 'b_1', ownerId: 'player-a', type: 'TOWER', gridX: 40, gridY: 40 });
    tower.hp = 1;
    // Standing on the tower's own tile (distance 0) so it is unambiguously the
    // target of the shot this tick.
    const bystander = addUnit(room, { id: 'u_2', ownerId: 'player-b', x: 40.5, y: 40.5 });
    const attacker = addUnit(room, {
      id: 'u_1', ownerId: 'player-b', type: 'SPEARMAN', x: 41, y: 42, actionState: 'ATTACKING'
    });
    attacker.targetEntityId = tower.id;
    attacker.targetEntityType = 'building';

    internals(room).update(100);

    const combat = internals(room).combat;
    // The tower fired first this tick, which is what puts it in the map.
    expect(bystander.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp - BUILDING_BLUEPRINTS.TOWER.attackPower);
    expect(room.state.buildings.has(tower.id)).toBe(false);
    expect(combat.towerTimers.has(tower.id)).toBe(false);
  });
});

describe('unit stance (CMB-01)', () => {
  it('sets the stance on owned units and leaves a foreign unit alone', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const mine = addUnit(room, { id: 'u_1', ownerId: 'player-a' });
    const theirs = addUnit(room, { id: 'u_2', ownerId: 'player-b' });
    const client = createClient('player-a');

    internals(room).commands.handleSetStance(client, {
      unitIds: [mine.id, theirs.id],
      stance: 'STAND_GROUND'
    });

    expect(mine.stance).toBe('STAND_GROUND');
    expect(theirs.stance).toBe('AGGRESSIVE');
  });

  it('rejects an unknown stance without writing it', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a' });
    const client = createClient('player-a');

    internals(room).commands.handleSetStance(client, {
      unitIds: [unit.id],
      stance: 'BERSERK'
    });

    expect(unit.stance).toBe('AGGRESSIVE');
    expect(client.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, expect.anything());
  });

  it('NO_ATTACK never picks its own fight', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACK_MOVE'
    });
    unit.stance = 'NO_ATTACK';
    // Walk somewhere, so the unit cannot arrive this tick and drop to IDLE.
    unit.targetX = 30;
    unit.targetY = 10;
    addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 12, y: 10 });

    internals(room).update(50);

    expect(unit.actionState).toBe('ATTACK_MOVE');
    expect(unit.targetEntityId).toBe('');
  });

  it('STAND_GROUND drops a target out of reach and does not take a step', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACKING'
    });
    unit.stance = 'STAND_GROUND';
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 20, y: 10 });
    unit.targetEntityId = enemy.id;
    unit.targetEntityType = 'unit';

    internals(room).update(100);

    expect(unit.actionState).toBe('IDLE');
    expect(unit.x).toBe(10);
    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp);
  });

  it('STAND_GROUND still strikes a target already inside its range', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACKING'
    });
    unit.stance = 'STAND_GROUND';
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
    unit.targetEntityId = enemy.id;
    unit.targetEntityType = 'unit';

    internals(room).update(100);

    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp - UNIT_BLUEPRINTS.SPEARMAN.attackPower);
    // It hit without walking: the stance holds the ground it stands on.
    expect(unit.x).toBe(10);
    expect(unit.actionState).toBe('ATTACKING');
  });

  it('NO_ATTACK gives up a fight it picked itself', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    // Auto-acquired: `previousActionState` still holds the attack-move that was
    // interrupted, which is the only marker that distinguishes it from a click.
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACKING'
    });
    unit.previousActionState = 'ATTACK_MOVE';
    unit.targetX = 40;
    unit.targetY = 10;
    unit.stance = 'NO_ATTACK';
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
    unit.targetEntityId = enemy.id;
    unit.targetEntityType = 'unit';

    internals(room).update(100);

    expect(unit.actionState).toBe('ATTACK_MOVE');
    expect(unit.targetEntityId).toBe('');
    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp);
  });

  it('NO_ATTACK still fights a target the player clicked', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    // An explicit attack order clears `previousActionState`, so the stance must
    // not touch it — the player asked for this fight by hand.
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACKING'
    });
    unit.stance = 'NO_ATTACK';
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
    unit.targetEntityId = enemy.id;
    unit.targetEntityType = 'unit';

    internals(room).update(100);

    expect(enemy.hp).toBe(UNIT_BLUEPRINTS.VILLAGER.maxHp - UNIT_BLUEPRINTS.SPEARMAN.attackPower);
    expect(unit.actionState).toBe('ATTACKING');
  });

  it('DEFENSIVE gives up once the chase passes its leash', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACK_MOVE'
    });
    unit.stance = 'DEFENSIVE';
    unit.targetX = 40;
    unit.targetY = 10;
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 15, y: 10 });

    // Tick 1: it picks the fight itself, which is what records the leash anchor.
    internals(room).update(100);
    expect(unit.actionState).toBe('ATTACKING');

    // The target runs: a defensive unit follows only four tiles from its post.
    enemy.x = 60;
    for (let i = 0; i < 200 && unit.actionState === 'ATTACKING'; i++) {
      internals(room).update(100);
    }

    expect(unit.actionState).toBe('ATTACK_MOVE');
    expect(Math.hypot(unit.x - 10, unit.y - 10)).toBeLessThan(5);
  });
});

describe('drop-off buildings (ECO)', () => {
  /**
   * A villager standing on a node, with one drop-off building placed next to it
   * and a town center pinned at the far end of the map, so "nearest drop-off"
   * is a real choice rather than the only option.
   */
  function campScenario(options: { campType: string; nodeType: string; isConstructed?: boolean }) {
    const { campType, nodeType, isConstructed = true } = options;
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 0, food: 0, gold: 0, stone: 0 });

    const node = addResource(room, {
      id: 'res_1',
      resourceType: nodeType,
      gridX: 50,
      gridY: 41,
      remainingAmount: 100
    });
    const camp = addBuilding(room, {
      id: 'b_camp',
      ownerId: 'player-a',
      type: campType,
      isConstructed,
      gridX: 50,
      gridY: 44
    });
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a', type: 'TOWN_CENTER', gridX: 5, gridY: 5 });

    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      x: 50.5,
      y: 41.5,
      actionState: 'HARVESTING'
    });
    unit.targetEntityId = node.id;
    unit.targetEntityType = 'resource';
    unit.targetX = node.gridX;
    unit.targetY = node.gridY;

    return { room, player, node, camp, unit };
  }

  /** Ticks until the load is banked or the villager gives up. */
  function bank(room: WorldRoom, done: () => boolean) {
    for (let i = 0; i < 400 && !done(); i++) {
      internals(room).update(100);
    }
  }

  it('lumber camp banks wood instead of the distant town center', () => {
    const { room, player, unit } = campScenario({ campType: 'LUMBER_CAMP', nodeType: 'wood' });

    simulate(room, fullLoadMs('wood'));
    expect(unit.actionState).toBe('RETURNING');
    expect(unit.dropOffId).toBe('b_camp');

    bank(room, () => player.wood > 0);
    expect(player.wood).toBe(UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
  });

  it('mill banks food', () => {
    const { room, player, unit } = campScenario({ campType: 'MILL', nodeType: 'food' });

    simulate(room, fullLoadMs('food'));
    expect(unit.dropOffId).toBe('b_camp');

    bank(room, () => player.food > 0);
    expect(player.food).toBe(UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
  });

  it('mining camp banks both gold and stone', () => {
    for (const resource of ['gold', 'stone'] as const) {
      const { room, player, unit } = campScenario({ campType: 'MINING_CAMP', nodeType: resource });

      simulate(room, fullLoadMs(resource));
      expect(unit.dropOffId, resource).toBe('b_camp');

      bank(room, () => player[resource] > 0);
      expect(player[resource], resource).toBe(UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
    }
  });

  it('an unfinished camp is not a drop-off', () => {
    // A lumber camp still under construction must not collect loads: the
    // villager walks past it to the town center instead.
    const { room, unit } = campScenario({
      campType: 'LUMBER_CAMP',
      nodeType: 'wood',
      isConstructed: false
    });

    simulate(room, fullLoadMs('wood'));

    expect(unit.actionState).toBe('RETURNING');
    expect(unit.dropOffId).toBe('b_tc');
  });

  it('a lumber camp refuses a load it does not handle', () => {
    // Only a lumber camp is nearby, so a gold load has nowhere to go: the
    // villager must keep it rather than walk to the wrong camp, and must not
    // walk across the map to the town center either.
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 0, gold: 0 });
    const node = addResource(room, {
      id: 'res_1',
      resourceType: 'gold',
      gridX: 50,
      gridY: 41,
      remainingAmount: 100
    });
    addBuilding(room, {
      id: 'b_camp',
      ownerId: 'player-a',
      type: 'LUMBER_CAMP',
      gridX: 50,
      gridY: 44
    });

    const unit = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      x: 50.5,
      y: 41.5,
      actionState: 'HARVESTING'
    });
    unit.targetEntityId = node.id;
    unit.targetEntityType = 'resource';

    simulate(room, fullLoadMs('gold'));

    expect(unit.carryingAmount).toBe(UNIT_BLUEPRINTS.VILLAGER.carryCapacity);
    expect(unit.carryingResourceType).toBe('gold');
    expect(unit.actionState).toBe('IDLE');
    expect(unit.dropOffId).toBe('');
    expect(player.gold).toBe(0);
  });
});

/**
 * Ownership is keyed by the account id (`Player.id`), never by the socket
 * session id. A refresh, a reconnect or a second tab opens a new session for the
 * same account, and the empire must survive all three: same base, one player
 * entry, and no database row ever deleted by a stale leave.
 */
describe('empire ownership by account (ACCT)', () => {
  /** Signs in a client of `userId`, matching what `onAuth` hands to `onJoin`. */
  function account(sessionId: string, userId = 'user-1', displayName = 'Emperor') {
    return createClient(sessionId, { userId, displayName });
  }

  /** Adds an empire owned by `ownerId`, as the boot loader would restore it. */
  function addEmpire(room: WorldRoom, ownerId: string) {
    const base = addBuilding(room, {
      id: 'b_1',
      ownerId,
      type: 'TOWN_CENTER',
      gridX: 40,
      gridY: 40
    });
    const villager = addUnit(room, { id: 'u_1', ownerId });
    return { base, villager };
  }

  it('spawns one starter base per account, not one per session', async () => {
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);
    const room = createRoom();

    await internals(room).onJoin(account('session-1'), {});
    await internals(room).onJoin(account('session-2'), {});

    const bases = Array.from(room.state.buildings.values()).filter(
      (b: BuildingState) => b.ownerId === 'user-1'
    );
    expect(bases).toHaveLength(1);
    expect(room.state.players.size).toBe(1);
    expect(room.state.players.get('user-1')?.name).toBe('Emperor');
  });

  it('reuses the empire already in memory instead of spawning a second base', async () => {
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue({
      id: 'user-1',
      name: 'Emperor',
      color: '#3b82f6',
      wood: 10,
      food: 20,
      gold: 30,
      stone: 40,
      population: 1,
      populationCap: 10,
      isOnline: true
    } as never);
    const room = createRoom();
    const { base } = addEmpire(room, 'user-1');
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await internals(room).onJoin(account('session-2'), {});

    expect(room.state.buildings.size).toBe(1);
    expect(room.state.buildings.get('b_1')).toBe(base);
    // Restored resources survive: the row is the authority on re-entry.
    expect(room.state.players.get('user-1')?.wood).toBe(10);
    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
  });

  it('a superseded socket leaves the live session and its empire alone', async () => {
    const room = createRoom();
    addEmpire(room, 'user-1');
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);
    await internals(room).onJoin(account('session-old'), {});
    await internals(room).onJoin(account('session-new'), {});
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await internals(room).onLeave(account('session-old'));

    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
    expect(room.state.players.get('user-1')).toBeDefined();
    expect(room.state.buildings.size).toBe(1);
  });

  it('saves the whole empire when the live session leaves', async () => {
    const room = createRoom();
    addEmpire(room, 'user-1');
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);
    await internals(room).onJoin(account('session-old'), {});
    await internals(room).onJoin(account('session-new'), {});
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await internals(room).onLeave(account('session-new'));

    expect(DatabaseService.savePlayerEmpire).toHaveBeenCalledTimes(1);
    const [saved, buildings, units] = vi.mocked(DatabaseService.savePlayerEmpire).mock.calls[0];
    expect(saved.id).toBe('user-1');
    expect(buildings.map((b: BuildingState) => b.id)).toContain('b_1');
    expect(units.map((u: UnitState) => u.id)).toContain('u_1');
    expect(room.state.players.get('user-1')).toBeUndefined();
  });

  it('rejects a second session while the first one is connected', async () => {
    const room = createRoom();
    const first = account('session-old');
    room.clients.push(first as never);
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);
    await internals(room).onJoin(first, {});
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await expect(internals(room).onJoin(account('session-new'), {})).rejects.toMatchObject({
      code: SESSION_ALREADY_ACTIVE
    });

    expect(room.state.players.size).toBe(1);
    expect(room.state.players.get('user-1')?.name).toBe('Emperor');
    expect(internals(room).sessions.activeSession('user-1')).toBe('session-old');
    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
  });

  it('reuses the live player entry instead of reloading the database on takeover', async () => {
    const room = createRoom();
    const first = account('session-old');
    room.clients.push(first as never);
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);
    await internals(room).onJoin(first, {});

    const live = room.state.players.get('user-1');
    expect(live).toBeDefined();
    live!.wood = 999;

    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue({
      id: 'user-1',
      name: 'Emperor',
      color: '#3b82f6',
      wood: 10,
      food: 20,
      gold: 30,
      stone: 40,
      population: 1,
      populationCap: 10,
      isOnline: true
    } as never);
    vi.mocked(DatabaseService.loadPlayerProfile).mockClear();
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await internals(room).onJoin(account('session-new'), { force: true });

    // D3: the in-memory entry is the authority, and it is not replaced.
    expect(room.state.players.get('user-1')).toBe(live);
    expect(room.state.players.get('user-1')?.wood).toBe(999);
    expect(DatabaseService.loadPlayerProfile).not.toHaveBeenCalled();
    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
    expect(first.leave).toHaveBeenCalledWith(SESSION_REPLACED_CLOSE, expect.any(String));
    expect(internals(room).sessions.activeSession('user-1')).toBe('session-new');
  });

  it('does not reload the database when a live player entry already exists', async () => {
    const room = createRoom();
    addEmpire(room, 'user-1');
    const live = addPlayer(room, 'user-1', { name: 'Emperor', wood: 999 });
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue({
      id: 'user-1',
      name: 'Emperor',
      color: '#3b82f6',
      wood: 10,
      food: 20,
      gold: 30,
      stone: 40,
      population: 1,
      populationCap: 10,
      isOnline: true
    } as never);
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await internals(room).onJoin(account('session-2'), {});

    expect(room.state.players.get('user-1')).toBe(live);
    expect(live.wood).toBe(999);
    expect(DatabaseService.loadPlayerProfile).not.toHaveBeenCalled();
    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
  });

  it('a rejected session leaving does not touch the live empire', async () => {
    const room = createRoom();
    const first = account('session-old');
    room.clients.push(first as never);
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);
    await internals(room).onJoin(first, {});

    const rejected = account('session-new');
    await expect(internals(room).onJoin(rejected, {})).rejects.toMatchObject({
      code: SESSION_ALREADY_ACTIVE
    });
    vi.mocked(DatabaseService.savePlayerEmpire).mockClear();

    await internals(room).onLeave(rejected);

    expect(DatabaseService.savePlayerEmpire).not.toHaveBeenCalled();
    expect(room.state.players.get('user-1')).toBeDefined();
  });

  it('waits for an in-flight leave before claiming the account', async () => {
    const room = createRoom();
    vi.mocked(DatabaseService.loadPlayerProfile).mockResolvedValue(null);

    let finishLeave!: () => void;
    const pendingLeave = new Promise<void>((resolve) => {
      finishLeave = resolve;
    });
    internals(room).leaveByUser.set('user-1', pendingLeave);

    const joining = internals(room).onJoin(account('session-2'), {});
    await Promise.resolve();

    expect(internals(room).sessions.activeSession('user-1')).toBeUndefined();
    expect(room.state.players.size).toBe(0);

    finishLeave();
    await joining;

    expect(internals(room).sessions.activeSession('user-1')).toBe('session-2');
    expect(room.state.players.size).toBe(1);
  });

  it('stamps new buildings and units with the account id', () => {
    const room = createRoom();
    addPlayer(room, 'user-1');
    addBuilding(room, { id: 'b_9', ownerId: 'user-1' });

    internals(room).commands.handlePlaceBuilding(account('session-1'), {
      type: 'HOUSE',
      gridX: 60,
      gridY: 60
    });

    const placed = Array.from(room.state.buildings.values()).find(
      (b: BuildingState) => b.type === 'HOUSE'
    );
    expect(placed?.ownerId).toBe('user-1');
  });
});

describe('starter base levels (LVL)', () => {
  it('spawns starter villagers at the researched villager level', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const player = room.state.players.get('player-a');
    expect(player).toBeDefined();
    player!.unitLevels[0] = 3;

    internals(room).spawnInitialBase('player-a');

    const villagers: UnitState[] = [];
    room.state.units.forEach((unit: UnitState) => {
      if (unit.type === 'VILLAGER') villagers.push(unit);
    });
    const stats = getUnitLevelStats('VILLAGER', 3);
    expect(villagers).toHaveLength(3);
    for (const villager of villagers) {
      expect(villager.level).toBe(3);
      expect(villager.maxHp).toBe(stats.maxHp);
    }
  });
});

describe('building upgrades (LVL)', () => {
  /**
   * The Town Center gate now asks for the Town Center's own level on every
   * step, so any test that upgrades a Town Center has to start with every
   * pillar already built.
   */
  function addGatePillars(room: WorldRoom, level = 1) {
    for (const type of ['HOUSE', 'BARRACKS', 'STABLE', 'ARCHERY_RANGE', 'FARM', 'TOWER']) {
      const pillar = addBuilding(room, { id: `b_${type}`, ownerId: 'player-a', type });
      pillar.level = level;
    }
  }

  it('charges the next level, ticks, and applies HP + population', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', {
      wood: 5000,
      food: 5000,
      gold: 5000,
      stone: 5000
    });
    addGatePillars(room);
    const townCenter = addBuilding(room, { id: 'b_1', ownerId: 'player-a' });
    const client = createClient('player-a');
    const cost = getBuildingUpgradeCost('TOWN_CENTER', 1);
    const duration = getBuildingUpgradeTimeMs('TOWN_CENTER', 1);
    // The gate pillars include a House, so the cap is the initial allowance plus
    // the Town Center and that House — not just the Town Center's own number.
    const populationBefore =
      INITIAL_POPULATION_CAP +
      getBuildingLevelStats('TOWN_CENTER', 1).populationProvided +
      getBuildingLevelStats('HOUSE', 1).populationProvided;

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_1' });

    expect(player.wood).toBe(5000 - cost.wood);
    expect(player.stone).toBe(5000 - cost.stone);
    expect(townCenter.level).toBe(1);
    expect(townCenter.upgradeTimeMs).toBe(duration);
    expect(client.send).not.toHaveBeenCalled();

    internals(room).update(duration);

    const expected = getEffectiveBuildingMaxHp('TOWN_CENTER', 2, 2);
    expect(townCenter.level).toBe(2);
    expect(townCenter.maxHp).toBe(expected);
    expect(townCenter.hp).toBe(expected);
    expect(townCenter.upgradeProgressMs).toBe(0);
    expect(townCenter.upgradeTimeMs).toBe(0);
    expect(player.populationCap).toBe(populationBefore + 1);
  });

  it('keeps missing HP missing when the upgrade lands', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, stone: 5000 });
    addGatePillars(room);
    const townCenter = addBuilding(room, { id: 'b_1', ownerId: 'player-a' });
    townCenter.hp = townCenter.maxHp - 500;
    const duration = getBuildingUpgradeTimeMs('TOWN_CENTER', 1);

    internals(room).commands.handleUpgradeBuilding(createClient('player-a'), { buildingId: 'b_1' });
    internals(room).update(duration);

    expect(townCenter.maxHp).toBe(getEffectiveBuildingMaxHp('TOWN_CENTER', 2, 2));
    expect(townCenter.hp).toBe(townCenter.maxHp - 500);
  });

  it('grows a farm harvest capacity when its upgrade lands', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, stone: 5000 });
    const farm = addBuilding(room, { id: 'b_farm', ownerId: 'player-a', type: 'FARM' });
    farm.level = 1;
    farm.resourceCapacity = BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0;
    farm.resourceAmount = 100;
    const duration = getBuildingUpgradeTimeMs('FARM', 1);

    internals(room).commands.handleUpgradeBuilding(createClient('player-a'), {
      buildingId: 'b_farm'
    });
    internals(room).update(duration);

    const before = BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0;
    const after = getBuildingLevelStats('FARM', 2).gatherCapacity;
    expect(farm.level).toBe(2);
    expect(farm.resourceCapacity).toBe(after);
    // The upgrade adds capacity without refilling what was already harvested.
    expect(farm.resourceAmount).toBe(100 + (after - before));
  });

  it('does not refill a fallow farm when its upgrade lands', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, stone: 5000 });
    const farm = addBuilding(room, { id: 'b_farm', ownerId: 'player-a', type: 'FARM' });
    farm.resourceAmount = 0;
    farm.resourceCapacity = BUILDING_BLUEPRINTS.FARM.gatherCapacity ?? 0;
    const duration = getBuildingUpgradeTimeMs('FARM', 1);

    internals(room).commands.handleUpgradeBuilding(createClient('player-a'), {
      buildingId: 'b_farm'
    });
    internals(room).update(duration);

    // Empty stays empty: the bigger field still has to be re-sown for its cost.
    expect(farm.resourceAmount).toBe(0);
    expect(farm.resourceCapacity).toBe(getBuildingLevelStats('FARM', 2).gatherCapacity);
  });

  it('rejects foundations, foreign buildings, max level and a second upgrade', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, stone: 5000 });
    addPlayer(room, 'player-b', { wood: 5000, stone: 5000 });
    const clientA = createClient('player-a');
    const foundation = addBuilding(room, {
      id: 'b_foundation',
      ownerId: 'player-a',
      isConstructed: false
    });
    const foreign = addBuilding(room, { id: 'b_foreign', ownerId: 'player-b' });
    const maxed = addBuilding(room, { id: 'b_maxed', ownerId: 'player-a', type: 'HOUSE' });
    maxed.level = getBuildingMaxLevel('HOUSE');
    const busy = addBuilding(room, { id: 'b_busy', ownerId: 'player-a', type: 'HOUSE' });
    busy.upgradeTimeMs = 1000;

    internals(room).commands.handleUpgradeBuilding(clientA, { buildingId: foundation.id });
    expect(clientA.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Building is still under construction', code: RejectCode.PREREQUISITE
    });

    internals(room).commands.handleUpgradeBuilding(clientA, { buildingId: foreign.id });
    expect(clientA.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Not your building', code: RejectCode.FORBIDDEN
    });

    internals(room).commands.handleUpgradeBuilding(clientA, { buildingId: maxed.id });
    expect(clientA.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Building is already at max level', code: RejectCode.LIMIT
    });

    internals(room).commands.handleUpgradeBuilding(clientA, { buildingId: busy.id });
    expect(clientA.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Building is already upgrading', code: RejectCode.BUSY
    });
  });

  it('rejects an upgrade the player cannot afford', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 0, stone: 0 });
    addGatePillars(room);
    addBuilding(room, { id: 'b_1', ownerId: 'player-a' });
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_1' });

    expect(client.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Insufficient resources to upgrade building', code: RejectCode.RESOURCE
    });
    expect(player.wood).toBe(0);
  });

  it('refunds the full price when the upgrade is cancelled', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', {
      wood: 5000,
      food: 5000,
      gold: 5000,
      stone: 5000
    });
    addGatePillars(room);
    const townCenter = addBuilding(room, { id: 'b_1', ownerId: 'player-a' });
    const client = createClient('player-a');
    const cost = getBuildingUpgradeCost('TOWN_CENTER', 1);

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_1' });
    internals(room).commands.handleCancelBuildingUpgrade(client, { buildingId: 'b_1' });

    expect(player.wood).toBe(5000);
    expect(player.stone).toBe(5000);
    expect(townCenter.upgradeProgressMs).toBe(0);
    expect(townCenter.upgradeTimeMs).toBe(0);
    expect(cost.wood).toBeGreaterThan(0);
  });

  it('ignores upgrade messages that arrive without a payload', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a');
    const client = createClient('player-a');

    expect(() => internals(room).commands.handleUpgradeBuilding(client, undefined)).not.toThrow();
    expect(() =>
      internals(room).commands.handleCancelBuildingUpgrade(client, undefined)
    ).not.toThrow();
    expect(() => internals(room).commands.handleUpgradeUnitType(client, undefined)).not.toThrow();
    expect(() => internals(room).commands.handleCancelUnitUpgrade(client, undefined)).not.toThrow();
    expect(player.researchUnitType).toBe('');
  });
});

describe('progression gate and slots (LVL2)', () => {
  const RICH = { wood: 2_000_000, food: 2_000_000, gold: 2_000_000, stone: 2_000_000 };

  /** Raises one owned core building to `level`, as a finished structure. */
  function addCore(room: WorldRoom, type: string, level: number, isConstructed = true) {
    const building = addBuilding(room, {
      id: `b_${type}`,
      ownerId: 'player-a',
      type,
      isConstructed
    });
    building.level = level;
    return building;
  }

  it('blocks the Town Center until the six pillars reach its level', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const townCenter = addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    townCenter.level = 4;
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_tc' });

    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message:
        'Town Center upgrade requires House level 4 (have 0), Barracks level 4 (have 0), ' +
        'Stable level 4 (have 0), Archery Range level 4 (have 0), ' +
        'Farm level 4 (have 0), Watch Tower level 4 (have 0)',
      code: RejectCode.PREREQUISITE
    });
    expect(townCenter.upgradeTimeMs).toBe(0);
  });

  it('lets the Town Center through once every pillar is at the step', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const townCenter = addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    townCenter.level = 9;
    for (const type of ['HOUSE', 'BARRACKS', 'STABLE', 'ARCHERY_RANGE', 'FARM', 'TOWER']) {
      addCore(room, type, 9);
    }
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_tc' });

    expect(client.send).not.toHaveBeenCalled();
    expect(townCenter.upgradeTimeMs).toBe(getBuildingUpgradeTimeMs('TOWN_CENTER', 9));
    expect(townCenter.upgradeTimeMs).toBe(49_207_500);
  });

  it('does not count a core foundation towards the gate', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const townCenter = addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    townCenter.level = 5;
    // The gate now asks for level 5, and this House is still a foundation.
    addCore(room, 'HOUSE', 5, false);
    addCore(room, 'BARRACKS', 5);
    addCore(room, 'STABLE', 5);
    addCore(room, 'ARCHERY_RANGE', 5);
    addCore(room, 'FARM', 5);
    addCore(room, 'TOWER', 5);
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_tc' });

    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Town Center upgrade requires House level 5 (have 0)', code: RejectCode.PREREQUISITE
    });
    expect(townCenter.upgradeTimeMs).toBe(0);
  });

  it('gates the very first Town Center upgrade on level-1 pillars', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const townCenter = addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    townCenter.level = 1;
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_tc' });

    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message:
        'Town Center upgrade requires House level 1 (have 0), Barracks level 1 (have 0), ' +
        'Stable level 1 (have 0), Archery Range level 1 (have 0), ' +
        'Farm level 1 (have 0), Watch Tower level 1 (have 0)',
      code: RejectCode.PREREQUISITE
    });
    expect(townCenter.upgradeTimeMs).toBe(0);
  });

  it('allows two upgrades at a time and frees a slot when one is cancelled', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const houses = ['h1', 'h2', 'h3'].map((id) =>
      addBuilding(room, { id, ownerId: 'player-a', type: 'HOUSE' })
    );
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'h1' });
    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'h2' });
    expect(houses[0].upgradeTimeMs).toBeGreaterThan(0);
    expect(houses[1].upgradeTimeMs).toBeGreaterThan(0);

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'h3' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Building upgrade limit reached (2 at a time)', code: RejectCode.LIMIT
    });
    expect(houses[2].upgradeTimeMs).toBe(0);

    // Cancelling refunds and clears the timer in the same call, so the slot is
    // free for the very next command instead of waiting for a tick.
    internals(room).commands.handleCancelBuildingUpgrade(client, { buildingId: 'h1' });
    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'h3' });
    expect(houses[2].upgradeTimeMs).toBeGreaterThan(0);
  });

  it('stops core buildings at level 10', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const house = addBuilding(room, { id: 'b_house', ownerId: 'player-a', type: 'HOUSE' });
    house.level = 10;
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_house' });

    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Building is already at max level', code: RejectCode.LIMIT
    });
  });

  it('continues a half-finished upgrade after a save and reload', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const house = addBuilding(room, { id: 'b_house', ownerId: 'player-a', type: 'HOUSE' });
    house.level = 8;
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeBuilding(client, { buildingId: 'b_house' });
    const duration = house.upgradeTimeMs;
    const half = Math.floor(duration / 2);
    internals(room).update(half);
    expect(house.upgradeProgressMs).toBe(half);

    // What `savePlayerEmpire` writes: the timer is mid-flight, not restarted.
    const saved = {
      level: house.level,
      progress: house.upgradeProgressMs,
      time: house.upgradeTimeMs
    };
    expect(saved.progress).toBe(half);

    // A later session restores the row through the boot loader's helper.
    const room2 = createRoom();
    addPlayer(room2, 'player-a', RICH);
    const restored = addBuilding(room2, { id: 'b_house', ownerId: 'player-a', type: 'HOUSE' });
    restored.level = saved.level;
    restoreBuildingUpgrade(restored, saved.progress, saved.time);

    internals(room2).update(saved.time - saved.progress - 1);
    expect(restored.level).toBe(saved.level);
    expect(restored.upgradeProgressMs).toBe(saved.time - 1);

    internals(room2).update(1);
    expect(restored.level).toBe(saved.level + 1);
  });

  it('drops a stale timer when the saved row has no duration', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const house = addBuilding(room, { id: 'b_house', ownerId: 'player-a', type: 'HOUSE' });

    restoreBuildingUpgrade(house, 5_000, 0);
    expect(house.upgradeProgressMs).toBe(0);
    expect(house.upgradeTimeMs).toBe(0);

    restoreBuildingUpgrade(house, Number.NaN, 10_000);
    expect(house.upgradeProgressMs).toBe(0);
    expect(house.upgradeTimeMs).toBe(10_000);
  });

  it('drops a timer saved for a building the new cap already maxed', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', RICH);
    const house = addBuilding(room, { id: 'b_house', ownerId: 'player-a', type: 'HOUSE' });
    // A save written under the old 100-level cap: level clamped to 10 on load,
    // but the upgrade row still says the building was climbing.
    house.level = getBuildingMaxLevel('HOUSE');

    restoreBuildingUpgrade(house, 1_000, 20_000);

    expect(house.level).toBe(10);
    expect(house.upgradeProgressMs).toBe(0);
    expect(house.upgradeTimeMs).toBe(0);
  });
});

describe('unit research (LVL)', () => {
  it('requires the finished building that trains the unit', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, food: 5000, gold: 5000 });
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'SPEARMAN' });

    expect(client.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Build a Barracks before researching this unit', code: RejectCode.PREREQUISITE
    });
  });

  it('rejects a foundation trainer and an unaffordable research', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 0, food: 0, gold: 0 });
    addBuilding(room, {
      id: 'b_foundation',
      ownerId: 'player-a',
      type: 'BARRACKS',
      isConstructed: false
    });
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'SPEARMAN' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Build a Barracks before researching this unit', code: RejectCode.PREREQUISITE
    });

    addBuilding(room, { id: 'b_ready', ownerId: 'player-a', type: 'BARRACKS' });
    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'SPEARMAN' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Insufficient resources to research unit upgrade', code: RejectCode.RESOURCE
    });
    expect(player.researchUnitType).toBe('');
  });

  // MIL-01: each military branch unlocks only its own unit line.
  it('rejects cavalry research without a Stable and archer research without a range', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, food: 5000, gold: 5000 });
    addBuilding(room, { id: 'b_barracks', ownerId: 'player-a', type: 'BARRACKS' });
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'CAVALRY' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Build a Stable before researching this unit', code: RejectCode.PREREQUISITE
    });

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'ARCHER' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Build an Archery Range before researching this unit',
      code: RejectCode.PREREQUISITE
    });

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'VILLAGER' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Build a Town Center before researching this unit', code: RejectCode.PREREQUISITE
    });
  });

  it('accepts research once the matching branch exists', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 5000, food: 5000, gold: 5000 });
    addBuilding(room, { id: 'b_stable', ownerId: 'player-a', type: 'STABLE' });
    addBuilding(room, { id: 'b_range', ownerId: 'player-a', type: 'ARCHERY_RANGE' });
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'CAVALRY' });
    expect(player.researchUnitType).toBe('CAVALRY');
    clearUnitResearch(player);

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'ARCHER' });
    expect(player.researchUnitType).toBe('ARCHER');
  });

  it('charges once, ticks, and upgrades every existing unit of that type', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', {
      wood: 5000,
      food: 5000,
      gold: 5000,
      stone: 5000
    });
    addBuilding(room, { id: 'b_barracks', ownerId: 'player-a', type: 'BARRACKS' });
    const spearmanA = addUnit(room, { id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN' });
    const spearmanB = addUnit(room, { id: 'u_2', ownerId: 'player-a', type: 'SPEARMAN' });
    const villager = addUnit(room, { id: 'u_3', ownerId: 'player-a', type: 'VILLAGER' });
    const cost = getUnitUpgradeCost('SPEARMAN', 1);
    const duration = getUnitUpgradeTimeMs('SPEARMAN', 1);
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'SPEARMAN' });

    expect(player.gold).toBe(5000 - cost.gold);
    expect(player.food).toBe(5000 - cost.food);
    expect(player.researchUnitType).toBe('SPEARMAN');
    expect(player.researchTimeMs).toBe(duration);

    internals(room).update(duration);

    const stats = getUnitLevelStats('SPEARMAN', 2);
    expect(getPlayerUnitLevel(player.unitLevels, 'SPEARMAN')).toBe(2);
    expect(spearmanA.level).toBe(2);
    expect(spearmanB.level).toBe(2);
    expect(spearmanA.maxHp).toBe(stats.maxHp);
    expect(spearmanB.maxHp).toBe(stats.maxHp);
    expect(villager.level).toBe(1);
    expect(player.researchUnitType).toBe('');
    expect(player.researchProgressMs).toBe(0);
  });

  it('still spawns new units at the researched level', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a');
    player.unitLevels[1] = 2;
    const barracks = addBuilding(room, {
      id: 'b_barracks',
      ownerId: 'player-a',
      type: 'BARRACKS'
    });
    barracks.trainingQueue.push('SPEARMAN');
    barracks.trainingProgressMs = UNIT_BLUEPRINTS.SPEARMAN.trainTimeMs;

    internals(room).update(1);

    const spawned = Array.from(room.state.units.values()).find(
      (unit: UnitState) => unit.type === 'SPEARMAN'
    );
    expect(spawned?.level).toBe(2);
    expect(spawned?.maxHp).toBe(getUnitLevelStats('SPEARMAN', 2).maxHp);
  });

  it('pauses an offline owner training queue instead of spawning level-1 units', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a');
    player.unitLevels[1] = 3;
    const barracks = addBuilding(room, {
      id: 'b_barracks',
      ownerId: 'player-a',
      type: 'BARRACKS'
    });
    barracks.trainingQueue.push('SPEARMAN');
    barracks.trainingProgressMs = UNIT_BLUEPRINTS.SPEARMAN.trainTimeMs;

    room.state.players.delete('player-a');
    internals(room).update(1);

    expect(room.state.units.size).toBe(0);
    expect(barracks.trainingQueue.length).toBe(1);

    const returning = addPlayer(room, 'player-a');
    returning.unitLevels[1] = 3;
    internals(room).update(1);

    const spawned = Array.from(room.state.units.values()).find(
      (unit: UnitState) => unit.type === 'SPEARMAN'
    );
    expect(spawned?.level).toBe(3);
    expect(spawned?.maxHp).toBe(getUnitLevelStats('SPEARMAN', 3).maxHp);
  });

  it('rejects max level, a second research, and an unknown type', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', {
      wood: 5000,
      food: 5000,
      gold: 5000,
      stone: 5000
    });
    addBuilding(room, { id: 'b_barracks', ownerId: 'player-a', type: 'BARRACKS' });
    addBuilding(room, { id: 'b_range', ownerId: 'player-a', type: 'ARCHERY_RANGE' });
    const client = createClient('player-a');

    player.unitLevels[1] = 10;
    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'SPEARMAN' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Unit type is already at max level', code: RejectCode.LIMIT
    });

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'DRAGON' as never });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Invalid unit type', code: RejectCode.INVALID
    });

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'ARCHER' });
    expect(player.researchUnitType).toBe('ARCHER');
    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'CAVALRY' });
    expect(client.send).toHaveBeenLastCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Another unit research is already in progress', code: RejectCode.BUSY
    });
  });

  it('refunds the full price when research is cancelled', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', {
      wood: 5000,
      food: 5000,
      gold: 5000,
      stone: 5000
    });
    addBuilding(room, { id: 'b_barracks', ownerId: 'player-a', type: 'BARRACKS' });
    addBuilding(room, { id: 'b_range', ownerId: 'player-a', type: 'ARCHERY_RANGE' });
    const client = createClient('player-a');

    internals(room).commands.handleUpgradeUnitType(client, { unitType: 'ARCHER' });
    internals(room).commands.handleCancelUnitUpgrade(client, { unitType: 'ARCHER' });

    expect(player.wood).toBe(5000);
    expect(player.food).toBe(5000);
    expect(player.gold).toBe(5000);
    expect(player.researchUnitType).toBe('');
    expect(player.researchProgressMs).toBe(0);
  });
});

describe('level-aware combat (LVL)', () => {
  it('scales unit damage by the researched level', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const attacker = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACKING'
    });
    attacker.level = 10;
    const victim = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
    attacker.targetEntityId = victim.id;
    attacker.targetEntityType = 'unit';

    internals(room).update(100);

    expect(victim.hp).toBe(
      UNIT_BLUEPRINTS.VILLAGER.maxHp - getUnitLevelStats('SPEARMAN', 10).attackPower
    );
  });

  it('scales tower damage by the building level', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const tower = addBuilding(room, {
      id: 'b_1',
      ownerId: 'player-a',
      type: 'TOWER',
      gridX: 40,
      gridY: 40
    });
    tower.level = 5;
    const enemy = addUnit(room, { id: 'u_2', ownerId: 'player-b', x: 42, y: 41 });

    internals(room).update(100);

    expect(enemy.hp).toBe(
      UNIT_BLUEPRINTS.VILLAGER.maxHp - getBuildingLevelStats('TOWER', 5).attackPower
    );
  });
});

describe('death corpses', () => {
  it('leaves a corpse where the unit fell and clears it after the linger', () => {
    vi.useFakeTimers();
    try {
      const room = createRoom();
      addPlayer(room, 'player-a');
      addPlayer(room, 'player-b');
      const attacker = addUnit(room, {
        id: 'u_1', ownerId: 'player-a', type: 'SPEARMAN', x: 10, y: 10, actionState: 'ATTACKING'
      });
      const victim = addUnit(room, { id: 'u_2', ownerId: 'player-b', type: 'VILLAGER', x: 11, y: 10 });
      victim.hp = 1;
      attacker.targetEntityId = victim.id;
      attacker.targetEntityType = 'unit';

      internals(room).update(100);

      // The unit is gone from the simulation immediately, as before.
      expect(room.state.units.has(victim.id)).toBe(false);
      const corpse = room.state.corpses.get(victim.id);
      expect(corpse).toBeDefined();
      expect(corpse!.unitType).toBe('VILLAGER');
      expect(corpse!.x).toBe(11);
      expect(corpse!.y).toBe(10);

      // The client plays the death clip off this entry, so it has to outlive the
      // clip and then go away on its own.
      room.clock.tick();
      expect(room.state.corpses.has(victim.id)).toBe(true);
      vi.setSystemTime(Date.now() + CORPSE_LINGER_MS + 100);
      room.clock.tick();
      expect(room.state.corpses.has(victim.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not leave a corpse for a unit that merely leaves the map', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 10, y: 10 });

    room.state.units.delete(unit.id);

    expect(room.state.corpses.size).toBe(0);
  });
});

describe('kingdom map layout (MAPS-V2)', () => {
  /** A kingdom room as `onCreate` would size it, without the SQLite boot. */
  function createKingdomRoom(ownerId = 'player-a') {
    const room = createRoom();
    room.state.zoneId = `kingdom:${ownerId}`;
    // `onCreate` sets this field from `resolveZoneId`; the bare harness does not.
    internals(room).zoneId = `kingdom:${ownerId}`;
    room.state.mapWidth = KINGDOM_MAP_SIZE.width;
    room.state.mapHeight = KINGDOM_MAP_SIZE.height;
    return room;
  }

  it('routes a chasing soldier around the citadel wall instead of through it', () => {
    const room = createKingdomRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'raider');
    internals(room).spawnInitialBase('player-a');

    const anchor = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);
    const originX = anchor.gridX - 5;
    const originY = anchor.gridY - 10;

    // Both on the north side of the compound, away from the east gate, so a
    // straight chase would cross the wall instead of walking through the gate.
    const defender = addUnit(room, {
      id: 'u-def',
      ownerId: 'player-a',
      type: 'VILLAGER',
      x: originX + 18.5,
      y: originY + 8.5
    });
    const attacker = addUnit(room, {
      id: 'u-atk',
      ownerId: 'raider',
      type: 'CAVALRY',
      x: originX + 30.5,
      y: originY + 8.5
    });

    internals(room).commands.handleAttackTarget(createClient('raider'), {
      unitIds: ['u-atk'],
      targetEntityId: 'u-def',
      targetType: 'unit'
    });

    const walls = citadelWallTileSet(room.state);
    const crossed = new Set<string>();
    for (let i = 0; i < 200; i++) {
      internals(room).update(100);
      const tile = `${Math.floor(attacker.x)},${Math.floor(attacker.y)}`;
      if (walls.has(tile)) crossed.add(tile);
      if (!room.state.units.has(defender.id)) break;
    }

    expect([...crossed]).toEqual([]);
    expect(room.state.units.has(defender.id)).toBe(false);
  });

  it('never lets a unit step through a citadel wall without a route', () => {
    const room = createKingdomRoom();
    addPlayer(room, 'player-a');
    internals(room).spawnInitialBase('player-a');

    const anchor = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);
    const originX = anchor.gridX - 5;
    const originY = anchor.gridY - 10;

    // Right against the inside of the east wall, north of the gate. No
    // `setWalkTarget`, so the unit is on the straight-line fallback a delayed or
    // failed path search produces.
    const unit = addUnit(room, {
      id: 'u-1',
      ownerId: 'player-a',
      type: 'VILLAGER',
      x: originX + 24.9,
      y: originY + 8.5
    });
    unit.targetX = originX + 28.5;
    unit.targetY = originY + 8.5;
    unit.actionState = 'MOVING';

    for (let i = 0; i < 20; i++) internals(room).update(100);

    expect(Math.floor(unit.x)).toBeLessThan(originX + 25);
  });

  it('spawns the Town Center inside the centred citadel', () => {
    const room = createKingdomRoom();
    addPlayer(room, 'player-a');

    internals(room).spawnInitialBase('player-a');

    const townCenter = Array.from(room.state.buildings.values()).find(
      (b: BuildingState) => b.type === 'TOWN_CENTER'
    );
    expect(townCenter).toBeDefined();
    // The compound is centred on the 110x110 kingdom; its Town Center sits at
    // the west end, with the single gate on the east wall.
    const anchor = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);
    expect(townCenter!.gridX).toBe(anchor.gridX);
    expect(townCenter!.gridY).toBe(anchor.gridY);

    // Phase 23: a kingdom has no gateway to a shared battlefield any more. The
    // only portal that may appear is a raider's retreat gate, created on join.
    const portal = Array.from(room.state.buildings.values()).find(
      (b: BuildingState) => b.type === 'PORTAL'
    );
    expect(portal).toBeUndefined();
  });

  it('keeps the kingdom plaza free of resources and roads', () => {
    const room = createKingdomRoom();
    generateWorldResources(room.state, TERRAIN_KINGDOM);

    let count = 0;
    room.state.resourceNodes.forEach((node: ResourceNodeState) => {
      count++;
      expect(isPlazaTile(node.gridX, node.gridY, TERRAIN_KINGDOM)).toBe(false);
      expect(node.gridX).toBeGreaterThanOrEqual(0);
      expect(node.gridX).toBeLessThan(KINGDOM_MAP_SIZE.width);
      expect(node.gridY).toBeGreaterThanOrEqual(0);
      expect(node.gridY).toBeLessThan(KINGDOM_MAP_SIZE.height);
    });

    // 25% of the battlefield's ~1.3k nodes, with generous bounds for randomness.
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(700);
  });

  it('keeps spawned resources out of the citadel plaza and gate approach', () => {
    const room = createKingdomRoom();
    addPlayer(room, 'player-a');

    internals(room).spawnInitialBase('player-a');

    room.state.resourceNodes.forEach((node: ResourceNodeState) => {
      expect(isPlazaTile(node.gridX, node.gridY, TERRAIN_KINGDOM)).toBe(false);
    });
  });

  it('reclaims the citadel anchor tile from a restored resource node', () => {
    const room = createKingdomRoom();
    addPlayer(room, 'player-a');
    const anchor = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);

    // A node saved from an older layout can sit exactly where the Town Center goes.
    const node = new ResourceNodeState();
    node.id = 'res_buried';
    node.type = 'TREE';
    node.resourceType = 'wood';
    node.gridX = anchor.gridX;
    node.gridY = anchor.gridY;
    node.remainingAmount = 200;
    node.maxAmount = 200;
    room.state.resourceNodes.set(node.id, node);

    internals(room).spawnInitialBase('player-a');

    const townCenter = Array.from(room.state.buildings.values()).find(
      (b: BuildingState) => b.type === 'TOWN_CENTER'
    );
    // The base keeps its anchor instead of being pushed off by the node.
    expect(townCenter!.gridX).toBe(anchor.gridX);
    expect(townCenter!.gridY).toBe(anchor.gridY);
    expect(room.state.resourceNodes.has('res_buried')).toBe(false);
  });

  it('refuses to build outside the 110x110 kingdom', () => {
    const room = createKingdomRoom();
    const player = addPlayer(room, 'player-a', { wood: 5000 });
    const client = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(client, {
      type: 'HOUSE',
      gridX: KINGDOM_MAP_SIZE.width - 1,
      gridY: 10
    });

    expect(client.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Cannot build outside map bounds', code: RejectCode.PLACEMENT
    });
    expect(player.wood).toBe(5000);
  });
});

describe('resource regrow (RES-02)', () => {
  function addNode(room: WorldRoom, id: string, type: string, resourceType: string) {
    const node = new ResourceNodeState();
    node.id = id;
    node.type = type;
    node.resourceType = resourceType;
    node.gridX = 10;
    node.gridY = 10;
    node.remainingAmount = 100;
    node.maxAmount = 200;
    room.state.resourceNodes.set(id, node);
    return node;
  }

  it('waits longer for gold than for wood', () => {
    const room = createRoom();
    const wood = addNode(room, 'res_wood', 'TREE', 'wood');
    const gold = addNode(room, 'res_gold', 'GOLD_MINE', 'gold');

    const before = Date.now();
    internals(room).scheduleResourceRespawn(wood);
    internals(room).scheduleResourceRespawn(gold);

    const respawnAt = internals(room).resourceRespawnAt as Map<string, number>;
    expect(respawnAt.get('res_wood')).toBeGreaterThanOrEqual(before + RESOURCE_REGROW_MS.wood);
    expect(respawnAt.get('res_gold')).toBeGreaterThanOrEqual(before + RESOURCE_REGROW_MS.gold);
    expect(respawnAt.get('res_gold')! - respawnAt.get('res_wood')!).toBeGreaterThan(
      RESOURCE_REGROW_MS.gold - RESOURCE_REGROW_MS.wood - 100
    );
  });

  it('refills a depleted node once its deadline passes and drops the entry', () => {
    const room = createRoom();
    const node = addNode(room, 'res_stone', 'STONE_MINE', 'stone');
    node.remainingAmount = 0;

    const respawnAt = new Map<string, number>([['res_stone', Date.now() - 1]]);
    internals(room).resourceRespawnAt = respawnAt;

    internals(room).scanResourceRespawns(Date.now());

    expect(node.remainingAmount).toBe(200);
    expect(respawnAt.has('res_stone')).toBe(false);
  });

  it('fells a starter node for good instead of refilling it', () => {
    const room = createRoom();
    const node = addNode(room, `${STARTER_RESOURCE_PREFIX}1`, 'TREE', 'wood');
    node.remainingAmount = 0;

    internals(room).scheduleResourceRespawn(node);

    // Unlike a generated node, the starter woodline next to the Town Center is a
    // one-off supply: it leaves the state, so the client drops the sprite and the
    // autosave sweep deletes the row.
    expect(room.state.resourceNodes.has(node.id)).toBe(false);
    const respawnAt = internals(room).resourceRespawnAt as Map<string, number>;
    expect(respawnAt.has(node.id)).toBe(false);
  });

  it('fells a legacy starter node by its plaza position', () => {
    const room = createRoom();
    // A save from before the starter prefix existed: the node sits in the
    // citadel clearing, which the generator never populates.
    room.state.zoneId = 'kingdom:player-a';
    internals(room).zoneId = 'kingdom:player-a';
    room.state.mapWidth = KINGDOM_MAP_SIZE.width;
    room.state.mapHeight = KINGDOM_MAP_SIZE.height;
    const anchor = citadelTownCenterFor(KINGDOM_MAP_SIZE.width, KINGDOM_MAP_SIZE.height);

    const node = addNode(room, 'res_legacy', 'TREE', 'wood');
    node.gridX = anchor.gridX;
    node.gridY = anchor.gridY;
    node.remainingAmount = 0;

    internals(room).scheduleResourceRespawn(node);

    expect(room.state.resourceNodes.has('res_legacy')).toBe(false);
  });

  it('still regrows a generated node away from the plaza', () => {
    const room = createRoom();
    room.state.zoneId = 'kingdom:player-a';
    internals(room).zoneId = 'kingdom:player-a';
    room.state.mapWidth = KINGDOM_MAP_SIZE.width;
    room.state.mapHeight = KINGDOM_MAP_SIZE.height;

    const node = addNode(room, 'res_edge', 'GOLD_MINE', 'gold');
    node.gridX = 10;
    node.gridY = 10;
    node.remainingAmount = 0;

    internals(room).scheduleResourceRespawn(node);

    expect(room.state.resourceNodes.has('res_edge')).toBe(true);
    const respawnAt = internals(room).resourceRespawnAt as Map<string, number>;
    expect(respawnAt.get('res_edge')).toBeGreaterThan(Date.now());
  });

  it('forgets a deadline whose node left the state', () => {
    const room = createRoom();
    const respawnAt = new Map<string, number>([['res_gone', Date.now() - 1]]);
    internals(room).resourceRespawnAt = respawnAt;

    internals(room).scanResourceRespawns(Date.now());

    expect(respawnAt.has('res_gone')).toBe(false);
  });
});

describe('unit separation (MOV-02)', () => {
  /**
   * The rule itself is covered by `unitSeparation.test.ts`; what a room test has
   * to prove is that the tick actually runs it, after every order has set a
   * position and before the next tick reads one.
   */
  it('runs the separation pass as part of the tick', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const a = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30 });
    const b = addUnit(room, { id: 'u_2', ownerId: 'player-a', x: 30, y: 30 });

    internals(room).update(50);

    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
  });

  it('does not turn a walking unit around or drop its order', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const unit = addUnit(room, { id: 'u_1', ownerId: 'player-a', x: 30, y: 30, actionState: 'MOVING' });
    unit.targetX = 50;
    unit.targetY = 30;
    addUnit(room, { id: 'u_2', ownerId: 'player-a', x: 30, y: 30 });

    internals(room).update(50);

    expect(unit.actionState).toBe('MOVING');
    expect(unit.targetX).toBe(50);
  });
});

describe('building level effects (LVL4)', () => {
  it('buffs living units of a trainer line when the trainer upgrades', () => {
    const room = createRoom();
    addPlayer(room, 'player-a', { wood: 5000, food: 5000, gold: 5000, stone: 5000 });
    const barracks = addBuilding(room, {
      id: 'b_barracks',
      ownerId: 'player-a',
      type: 'BARRACKS'
    });
    const spearman = addUnit(room, {
      id: 'u_spear',
      ownerId: 'player-a',
      type: 'SPEARMAN'
    });
    spearman.level = 1;
    spearman.maxHp = getEffectiveUnitMaxHp('SPEARMAN', 1, 1, 1);
    spearman.hp = spearman.maxHp - 10;
    const archer = addUnit(room, { id: 'u_archer', ownerId: 'player-a', type: 'ARCHER' });
    archer.level = 1;
    archer.maxHp = getEffectiveUnitMaxHp('ARCHER', 1, 1, 1);
    archer.hp = archer.maxHp;

    const duration = getBuildingUpgradeTimeMs('BARRACKS', 1);
    internals(room).commands.handleUpgradeBuilding(createClient('player-a'), {
      buildingId: 'b_barracks'
    });
    internals(room).update(duration);

    expect(barracks.level).toBe(2);
    expect(spearman.maxHp).toBe(getEffectiveUnitMaxHp('SPEARMAN', 1, 1, 2));
    // The buff is not a free heal: the 10 missing points stay missing.
    expect(spearman.hp).toBe(spearman.maxHp - 10);
    expect(archer.maxHp).toBe(getEffectiveUnitMaxHp('ARCHER', 1, 1, 1));
  });

  it('spawns a trained unit with its trainer level applied', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const barracks = addBuilding(room, {
      id: 'b_barracks',
      ownerId: 'player-a',
      type: 'BARRACKS'
    });
    barracks.level = 10;

    internals(room).spawnTrainedUnit(barracks, 'SPEARMAN');

    const spawned = Array.from(room.state.units.values())[0];
    expect(spawned.maxHp).toBe(getEffectiveUnitMaxHp('SPEARMAN', 1, 1, 10));
    expect(spawned.hp).toBe(spawned.maxHp);
  });

  it('scales live attack by the trainer level without touching other lines', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    const barracks = addBuilding(room, {
      id: 'b_barracks',
      ownerId: 'player-a',
      type: 'BARRACKS'
    });
    barracks.level = 10;
    const attacker = addUnit(room, {
      id: 'u_spear',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      actionState: 'ATTACKING'
    });
    attacker.level = 1;
    const victim = addUnit(room, {
      id: 'u_victim',
      ownerId: 'player-b',
      type: 'VILLAGER',
      x: 11,
      y: 10
    });
    attacker.targetEntityId = victim.id;
    attacker.targetEntityType = 'unit';

    internals(room).update(100);

    expect(victim.hp).toBe(
      UNIT_BLUEPRINTS.VILLAGER.maxHp -
        getEffectiveUnitAttackPower('SPEARMAN', 1, 1, 10)
    );
  });

  it('uses the tallest barracks and falls back when it is razed', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const tall = addBuilding(room, {
      id: 'b_tall',
      ownerId: 'player-a',
      type: 'BARRACKS'
    });
    tall.level = 8;
    const short = addBuilding(room, {
      id: 'b_short',
      ownerId: 'player-a',
      type: 'BARRACKS',
      gridX: 50,
      gridY: 50
    });
    short.level = 2;

    expect(internals(room).buildingLevelOf('player-a', 'BARRACKS')).toBe(8);

    room.state.buildings.delete(tall.id);
    internals(room).invalidateBuildingLevel('player-a', 'BARRACKS');

    expect(internals(room).buildingLevelOf('player-a', 'BARRACKS')).toBe(2);
  });

  it('reads the camp bonus for the resource it accepts', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const camp = addBuilding(room, {
      id: 'b_camp',
      ownerId: 'player-a',
      type: 'LUMBER_CAMP'
    });
    camp.level = 10;

    expect(internals(room).gatherMultiplierOf('player-a', 'wood')).toBeCloseTo(1.45, 2);
    // No mill yet: food stays on the baseline cadence.
    expect(internals(room).gatherMultiplierOf('player-a', 'food')).toBe(1);
  });

  it('shortens training time from the trainer level', () => {
    expect(getEffectiveTrainTimeMs('SPEARMAN', 1, 10)).toBe(
      Math.round(UNIT_BLUEPRINTS.SPEARMAN.trainTimeMs * 0.73)
    );
    // Villagers keep only the Town Center aura.
    expect(getEffectiveTrainTimeMs('VILLAGER', 10, 10)).toBe(
      Math.round(UNIT_BLUEPRINTS.VILLAGER.trainTimeMs * 0.82)
    );
  });

  describe('building demolition', () => {
    it('rejects deleting the default Town Center', () => {
      const room = createRoom();
      addPlayer(room, 'player-a');
      const client = createClient('player-a');
      const tc = addBuilding(room, {
        id: 'tc-default',
        ownerId: 'player-a',
        type: 'TOWN_CENTER',
        gridX: 48,
        gridY: 53
      });

      internals(room).commands.handleCancelBuilding(client, { buildingId: tc.id });

      expect(room.state.buildings.has(tc.id)).toBe(true);
      expect(client.send).toHaveBeenCalledWith(
        NetworkMessage.ERROR_NOTIFICATION,
        expect.objectContaining({
          message: expect.stringContaining('Cannot delete the default Town Center'),
          code: RejectCode.FORBIDDEN
        })
      );
    });

    it('rejects deleting a portal', () => {
      const room = createRoom();
      addPlayer(room, 'player-a');
      const client = createClient('player-a');
      const portal = addBuilding(room, {
        id: 'portal-1',
        ownerId: 'player-a',
        type: 'PORTAL',
        gridX: 10,
        gridY: 10
      });

      internals(room).commands.handleCancelBuilding(client, { buildingId: portal.id });

      expect(room.state.buildings.has(portal.id)).toBe(true);
      expect(client.send).toHaveBeenCalledWith(
        NetworkMessage.ERROR_NOTIFICATION,
        expect.objectContaining({
          message: expect.stringContaining('Portals cannot be deleted'),
          code: RejectCode.FORBIDDEN
        })
      );
    });

    it('deletes a completed non-TC building without refunding building cost, while refunding queue & upgrade', () => {
      const room = createRoom();
      const player = addPlayer(room, 'player-a', { wood: 100, food: 100, gold: 100, stone: 100 });
      const client = createClient('player-a');
      const barracks = addBuilding(room, {
        id: 'barracks-1',
        ownerId: 'player-a',
        type: 'BARRACKS',
        gridX: 20,
        gridY: 20
      });
      barracks.trainingQueue.push('SPEARMAN');
      barracks.upgradeTimeMs = 10000;
      barracks.upgradeProgressMs = 2000;
      barracks.level = 1;

      const upgradeCost = getBuildingUpgradeCost('BARRACKS', 1);
      const spearmanCost = UNIT_BLUEPRINTS.SPEARMAN.cost;

      internals(room).commands.handleCancelBuilding(client, { buildingId: barracks.id });

      expect(room.state.buildings.has(barracks.id)).toBe(false);
      // Food and wood refunded for spearman & upgrade, but 0 refund for barracks itself
      expect(player.food).toBe(100 + spearmanCost.food + upgradeCost.food);
      expect(player.wood).toBe(100 + spearmanCost.wood + upgradeCost.wood);
    });

    it('allows deleting a secondary Town Center when player owns multiple TCs', () => {
      const room = createRoom();
      addPlayer(room, 'player-a');
      const client = createClient('player-a');
      const tc1 = addBuilding(room, {
        id: 'tc-main',
        ownerId: 'player-a',
        type: 'TOWN_CENTER',
        gridX: 48,
        gridY: 53
      });
      const tc2 = addBuilding(room, {
        id: 'tc-secondary',
        ownerId: 'player-a',
        type: 'TOWN_CENTER',
        gridX: 10,
        gridY: 10
      });

      internals(room).commands.handleCancelBuilding(client, { buildingId: tc2.id });

      expect(room.state.buildings.has(tc2.id)).toBe(false);
      expect(room.state.buildings.has(tc1.id)).toBe(true);
    });
  });
});

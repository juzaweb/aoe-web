import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILDING_BLUEPRINTS,
  NetworkMessage,
  RejectCode,
  UNIT_BLUEPRINTS,
  getBuildingLevelStats,
  getBuildingUnlockLevel,
  getEffectiveBuildingMaxHp,
  getEffectiveTrainTimeMs,
  getEffectiveUnitAttackPower,
  getEffectiveUnitMaxHp,
  getUnitLevelStats,
  isBuildingUnlocked,
  townCenterAuraMultiplier,
  townCenterUnitAttackMultiplier
} from '@chien-quoc/shared';
import { WorldRoom } from './WorldRoom.js';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { accountSaves, accountSessions } from './AccountSessions.js';
import { zonePersistence } from './ZonePersistence.js';
import { applyUnitResearch } from './upgrades.js';

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

beforeEach(() => {
  accountSessions.reset();
  accountSaves.reset();
  zonePersistence.reset();
});

function createRoom() {
  const room = new WorldRoom();
  room.setState(new WorldState());
  return room;
}

const internals = (room: WorldRoom) => room as any;

function createClient(sessionId: string) {
  return {
    sessionId,
    auth: { userId: sessionId, displayName: sessionId },
    send: vi.fn(),
    leave: vi.fn()
  };
}

function addPlayer(room: WorldRoom, id: string, overrides: Partial<PlayerState> = {}) {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  Object.assign(player, overrides);
  room.state.players.set(id, player);
  return player;
}

function addBuilding(
  room: WorldRoom,
  options: {
    id: string;
    ownerId: string;
    type?: string;
    gridX?: number;
    gridY?: number;
    level?: number;
  }
) {
  const {
    id,
    ownerId,
    type = 'TOWN_CENTER',
    gridX = 40,
    gridY = 40,
    level = 1
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
  building.hp = blueprint.maxHp;
  building.level = level;
  building.isConstructed = true;
  building.constructionProgress = 100;
  room.state.buildings.set(id, building);
  return building;
}

function addUnit(
  room: WorldRoom,
  options: { id: string; ownerId: string; type?: string; x?: number; y?: number }
) {
  const { id, ownerId, type = 'VILLAGER', x = 10, y = 10 } = options;
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
  unit.actionState = 'IDLE';
  room.state.units.set(id, unit);
  return unit;
}

describe('town center aura formula (phase 25)', () => {
  it('scales HP and training linearly and attack on its own curve', () => {
    expect(townCenterAuraMultiplier(1)).toBe(1);
    expect(townCenterAuraMultiplier(10)).toBeCloseTo(1.18, 5);
    expect(townCenterUnitAttackMultiplier(10)).toBeCloseTo(1.09, 5);

    expect(getEffectiveBuildingMaxHp('HOUSE', 1, 10)).toBe(
      Math.round(getBuildingLevelStats('HOUSE', 1).maxHp * 1.18)
    );
    expect(getEffectiveUnitMaxHp('VILLAGER', 1, 10)).toBe(
      Math.round(getUnitLevelStats('VILLAGER', 1).maxHp * 1.18)
    );
    expect(getEffectiveUnitAttackPower('SPEARMAN', 10, 10)).toBeCloseTo(12.64, 2);
    expect(getEffectiveTrainTimeMs('VILLAGER', 10)).toBe(
      Math.round(UNIT_BLUEPRINTS.VILLAGER.trainTimeMs * 0.82)
    );
  });

  it('clamps missing or out-of-range capital data to level 1', () => {
    expect(townCenterAuraMultiplier(0)).toBe(1);
    expect(townCenterAuraMultiplier(-5)).toBe(1);
    expect(townCenterAuraMultiplier(Number.NaN)).toBe(1);
    expect(townCenterAuraMultiplier(999)).toBeCloseTo(1.18, 5);
  });

  it('unlocks the three camps at levels 1/2/3 and keeps the pillars open', () => {
    expect(getBuildingUnlockLevel('LUMBER_CAMP')).toBe(1);
    expect(getBuildingUnlockLevel('MILL')).toBe(2);
    expect(getBuildingUnlockLevel('MINING_CAMP')).toBe(3);

    expect(isBuildingUnlocked('LUMBER_CAMP', 1)).toBe(true);
    expect(isBuildingUnlocked('MILL', 1)).toBe(false);
    expect(isBuildingUnlocked('MILL', 2)).toBe(true);
    expect(isBuildingUnlocked('MINING_CAMP', 2)).toBe(false);
    expect(isBuildingUnlocked('MINING_CAMP', 3)).toBe(true);
    for (const type of ['HOUSE', 'BARRACKS', 'TOWER', 'FARM', 'STABLE', 'ARCHERY_RANGE'] as const) {
      expect(isBuildingUnlocked(type, 1)).toBe(true);
    }
  });
});

describe('town center aura refresh (phase 25)', () => {
  it('recomputes every owned asset and preserves missing HP', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    const tc = addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    const house = addBuilding(room, {
      id: 'b_house',
      ownerId: 'player-a',
      type: 'HOUSE',
      gridX: 20,
      gridY: 20
    });
    const villager = addUnit(room, { id: 'u_1', ownerId: 'player-a' });
    house.hp = 100;
    villager.hp = 30;

    internals(room).setTownCenterLevel('player-a', 10);

    expect(tc.level).toBe(1);
    expect(house.maxHp).toBe(getEffectiveBuildingMaxHp('HOUSE', 1, 10));
    expect(house.hp).toBe(house.maxHp - (BUILDING_BLUEPRINTS.HOUSE.maxHp - 100));
    expect(villager.maxHp).toBe(getEffectiveUnitMaxHp('VILLAGER', 1, 10));
    expect(villager.hp).toBe(villager.maxHp - (UNIT_BLUEPRINTS.VILLAGER.maxHp - 30));
  });

  it('keeps travel portals outside the aura', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    const portal = addBuilding(room, {
      id: 'b_portal',
      ownerId: 'player-a',
      type: 'PORTAL',
      gridX: 30,
      gridY: 30
    });
    const baseMaxHp = portal.maxHp;

    internals(room).setTownCenterLevel('player-a', 10);

    expect(portal.maxHp).toBe(baseMaxHp);
    expect(portal.hp).toBe(baseMaxHp);
  });

  it('does not leak one owner\u2019s aura into another owner', () => {    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    addBuilding(room, { id: 'b_tc_a', ownerId: 'player-a' });
    const foreignHouse = addBuilding(room, {
      id: 'b_house_b',
      ownerId: 'player-b',
      type: 'HOUSE',
      gridX: 60,
      gridY: 20
    });
    const foreignUnit = addUnit(room, { id: 'u_b', ownerId: 'player-b', x: 60, y: 20 });

    internals(room).setTownCenterLevel('player-a', 10);

    expect(foreignHouse.maxHp).toBe(getBuildingLevelStats('HOUSE', 1).maxHp);
    expect(foreignUnit.maxHp).toBe(getUnitLevelStats('VILLAGER', 1).maxHp);
  });

  it('folds the aura into research without healing the living unit', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a');
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    const spearman = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN'
    });
    spearman.hp = 40;

    applyUnitResearch(room.state, player, 'SPEARMAN', 10);

    expect(spearman.level).toBe(2);
    expect(spearman.maxHp).toBe(getEffectiveUnitMaxHp('SPEARMAN', 2, 10));
    expect(spearman.hp).toBe(
      spearman.maxHp - (getUnitLevelStats('SPEARMAN', 1).maxHp - 40)
    );
  });
});

describe('town center aura in the simulation (phase 25)', () => {
  it('adds the aura to unit attack on top of research', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    internals(room).setTownCenterLevel('player-a', 10);

    const attacker = addUnit(room, {
      id: 'u_1',
      ownerId: 'player-a',
      type: 'SPEARMAN',
      x: 10,
      y: 10
    });
    attacker.level = 10;
    attacker.actionState = 'ATTACKING';
    const victim = addUnit(room, {
      id: 'u_2',
      ownerId: 'player-b',
      x: 11,
      y: 10
    });
    attacker.targetEntityId = victim.id;
    attacker.targetEntityType = 'unit';

    internals(room).update(100);

    expect(victim.hp).toBe(
      UNIT_BLUEPRINTS.VILLAGER.maxHp - getEffectiveUnitAttackPower('SPEARMAN', 10, 10)
    );
  });

  it('leaves tower damage outside the unit aura', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addPlayer(room, 'player-b');
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    const tower = addBuilding(room, {
      id: 'b_tower',
      ownerId: 'player-a',
      type: 'TOWER',
      gridX: 40,
      gridY: 40
    });
    tower.level = 5;
    internals(room).setTownCenterLevel('player-a', 10);
    const enemy = addUnit(room, {
      id: 'u_2',
      ownerId: 'player-b',
      x: 42,
      y: 41
    });

    internals(room).update(100);

    expect(enemy.hp).toBe(
      UNIT_BLUEPRINTS.VILLAGER.maxHp - getBuildingLevelStats('TOWER', 5).attackPower
    );
  });

  it('rejects a locked camp and accepts it once the capital reaches its level', () => {
    const room = createRoom();
    const player = addPlayer(room, 'player-a', { wood: 5000, stone: 5000, gold: 5000 });
    const tc = addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    const client = createClient('player-a');

    internals(room).commands.handlePlaceBuilding(client, {
      type: 'MILL',
      gridX: 10,
      gridY: 10
    });
    expect(client.send).toHaveBeenCalledWith(NetworkMessage.ERROR_NOTIFICATION, {
      message: 'Requires Town Center level 2',
      code: RejectCode.PREREQUISITE
    });
    expect(player.wood).toBe(5000);

    tc.level = 2;
    internals(room).setTownCenterLevel('player-a', 2);
    internals(room).commands.handlePlaceBuilding(createClient('player-a'), {
      type: 'MILL',
      gridX: 10,
      gridY: 10
    });

    const mill = Array.from(room.state.buildings.values()).find(
      (building: BuildingState) => building.type === 'MILL'
    );
    expect(mill).toBeDefined();
    expect(mill!.maxHp).toBe(getEffectiveBuildingMaxHp('MILL', 1, 2));
  });

  it('finishes training on the shortened timer and spawns the buffed HP', () => {
    const room = createRoom();
    addPlayer(room, 'player-a');
    addBuilding(room, { id: 'b_tc', ownerId: 'player-a' });
    const barracks = addBuilding(room, {
      id: 'b_barracks',
      ownerId: 'player-a',
      type: 'BARRACKS',
      gridX: 20,
      gridY: 20
    });
    internals(room).setTownCenterLevel('player-a', 10);

    barracks.trainingQueue.push('VILLAGER');
    const effectiveMs = getEffectiveTrainTimeMs('VILLAGER', 10);
    barracks.trainingProgressMs = effectiveMs - 100;

    internals(room).update(100);

    const spawned = Array.from(room.state.units.values()).find(
      (unit: UnitState) => unit.type === 'VILLAGER'
    );
    expect(spawned).toBeDefined();
    expect(spawned!.maxHp).toBe(getEffectiveUnitMaxHp('VILLAGER', 1, 10));
    expect(spawned!.hp).toBe(spawned!.maxHp);
  });
});

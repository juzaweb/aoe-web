import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';

let DatabaseService: any;
let prisma: any;

const dbFile = path.join(os.tmpdir(), `cq-persist-${process.pid}-${Date.now()}.db`);

beforeAll(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbFile + suffix, { force: true }); } catch {}
  }
  process.env.DATABASE_FILE = dbFile;
  const mod = await import('./DatabaseService.js');
  DatabaseService = mod.DatabaseService;
  prisma = mod.prisma;
  await DatabaseService.initialize();
});

beforeEach(async () => {
  await prisma.unit.deleteMany();
  await prisma.building.deleteMany();
  await prisma.player.deleteMany();
  await prisma.worldResourceNode.deleteMany();
  await prisma.travelTransfer.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbFile + suffix, { force: true }); } catch {}
  }
  delete process.env.DATABASE_FILE;
});

function node(id: string, amount: number): ResourceNodeState {
  const n = new ResourceNodeState();
  n.id = id;
  n.type = 'TREE';
  n.resourceType = 'wood';
  n.gridX = 1;
  n.gridY = 2;
  n.remainingAmount = amount;
  n.maxAmount = 10;
  return n;
}

function parseStmts(logs: string[]): number {
  const msg = logs.find((l) => l.includes('auto-saved'));
  const m = msg?.match(/(\d+) stmts/);
  return Number(m?.[1]);
}

describe('saveZoneResources', () => {
  it('R1 empty', async () => {
    const stmts = { n: 0 };
    await (DatabaseService as any).saveZoneResources('test:zone', [], { stmts });
    expect(stmts.n).toBe(1);
    expect(await prisma.worldResourceNode.count()).toBe(0);
  });

  it('R2 new node', async () => {
    const stmts = { n: 0 };
    await (DatabaseService as any).saveZoneResources('test:zone', [node('res_1', 5)], { stmts });
    expect(stmts.n).toBe(3);
    const rows = await prisma.worldResourceNode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].remainingAmount).toBe(5);
  });

  it('R3 unchanged', async () => {
    await prisma.worldResourceNode.create({
      data: { id: 'res_1', zone: 'test:zone', type: 'TREE', resourceType: 'wood', gridX: 1, gridY: 2, remainingAmount: 5, maxAmount: 10 }
    });
    const stmts = { n: 0 };
    await (DatabaseService as any).saveZoneResources('test:zone', [node('res_1', 5)], { stmts });
    expect(stmts.n).toBe(2);
    const row = await prisma.worldResourceNode.findUnique({ where: { id: 'res_1' } });
    expect(row.remainingAmount).toBe(5);
  });

  it('R4 changed amount', async () => {
    await prisma.worldResourceNode.create({
      data: { id: 'res_1', zone: 'test:zone', type: 'TREE', resourceType: 'wood', gridX: 1, gridY: 2, remainingAmount: 5, maxAmount: 10 }
    });
    const stmts = { n: 0 };
    await (DatabaseService as any).saveZoneResources('test:zone', [node('res_1', 3)], { stmts });
    expect(stmts.n).toBe(3);
    const row = await prisma.worldResourceNode.findUnique({ where: { id: 'res_1' } });
    expect(row.remainingAmount).toBe(3);
  });

  it('R5 stale removed', async () => {
    await prisma.worldResourceNode.create({
      data: { id: 'res_old', zone: 'test:zone', type: 'TREE', resourceType: 'wood', gridX: 1, gridY: 2, remainingAmount: 1, maxAmount: 10 }
    });
    const n = node('res_new', 5);
    n.id = 'res_new';
    const stmts = { n: 0 };
    await (DatabaseService as any).saveZoneResources('test:zone', [n], { stmts });
    expect(stmts.n).toBe(3);
    const rows = await prisma.worldResourceNode.findMany();
    expect(rows.map((r: any) => r.id)).toEqual(['res_new']);
  });

  it('R6 mixed', async () => {
    await prisma.worldResourceNode.create({
      data: { id: 'res_keep', zone: 'test:zone', type: 'TREE', resourceType: 'wood', gridX: 1, gridY: 2, remainingAmount: 5, maxAmount: 10 }
    });
    await prisma.worldResourceNode.create({
      data: { id: 'res_drop', zone: 'test:zone', type: 'TREE', resourceType: 'wood', gridX: 1, gridY: 2, remainingAmount: 1, maxAmount: 10 }
    });
    const keep = node('res_keep', 4);
    keep.id = 'res_keep';
    const neu = node('res_new', 2);
    neu.id = 'res_new';
    const stmts = { n: 0 };
    await (DatabaseService as any).saveZoneResources('test:zone', [keep, neu], { stmts });
    expect(stmts.n).toBe(4);
    const rows = await prisma.worldResourceNode.findMany();
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r.remainingAmount]));
    expect(byId.res_keep).toBe(4);
    expect(byId.res_new).toBe(2);
    expect(byId.res_drop).toBeUndefined();
  });
});

describe('resource respawn persistence', () => {
  it('R7 stores the refill deadline of a depleted node', async () => {
    const state = new WorldState();
    state.zoneId = 'test:zone';
    const goldNode = node('res_gold', 0);
    goldNode.type = 'GOLD_MINE';
    goldNode.resourceType = 'gold';
    state.resourceNodes.set('res_gold', goldNode);

    const deadline = Date.now() + 240_000;
    await DatabaseService.saveFullWorldState(state, 'test:zone', {
      resourceRespawnAt: new Map([['res_gold', deadline]])
    });

    const row = await prisma.worldResourceNode.findUnique({ where: { id: 'res_gold' } });
    expect(row.remainingAmount).toBe(0);
    expect(row.respawnAt).toBe(deadline);
  });

  it('R8 clears the deadline once the node refills', async () => {
    await prisma.worldResourceNode.create({
      data: {
        id: 'res_wood',
        zone: 'test:zone',
        type: 'TREE',
        resourceType: 'wood',
        gridX: 1,
        gridY: 2,
        remainingAmount: 0,
        maxAmount: 10,
        respawnAt: Date.now() + 60_000
      }
    });

    const state = new WorldState();
    state.zoneId = 'test:zone';
    state.resourceNodes.set('res_wood', node('res_wood', 10));

    await DatabaseService.saveFullWorldState(state, 'test:zone');
    const row = await prisma.worldResourceNode.findUnique({ where: { id: 'res_wood' } });
    expect(row.remainingAmount).toBe(10);
    expect(row.respawnAt).toBeNull();
  });

  it('R9 rewrites a node whose deadline moved even with the same amount', async () => {
    const first = Date.now() + 60_000;
    await prisma.worldResourceNode.create({
      data: {
        id: 'res_wood',
        zone: 'test:zone',
        type: 'TREE',
        resourceType: 'wood',
        gridX: 1,
        gridY: 2,
        remainingAmount: 0,
        maxAmount: 10,
        respawnAt: first
      }
    });

    const state = new WorldState();
    state.zoneId = 'test:zone';
    state.resourceNodes.set('res_wood', node('res_wood', 0));

    const moved = first + 30_000;
    await DatabaseService.saveFullWorldState(state, 'test:zone', {
      resourceRespawnAt: new Map([['res_wood', moved]])
    });

    const row = await prisma.worldResourceNode.findUnique({ where: { id: 'res_wood' } });
    expect(row.respawnAt).toBe(moved);
  });

  it('R10 adds the respawn column to a database created before it existed', async () => {
    // `initialize` already ran on this file; the column is part of the DDL and
    // the additive migration, so a second boot must not fail and must keep rows.
    await prisma.worldResourceNode.create({
      data: {
        id: 'res_old',
        zone: 'test:zone',
        type: 'TREE',
        resourceType: 'wood',
        gridX: 1,
        gridY: 2,
        remainingAmount: 5,
        maxAmount: 10
      }
    });
    await DatabaseService.initialize();

    const columns: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      'PRAGMA table_info("world_resource_nodes")'
    );
    expect(columns.some((c) => c.name === 'respawn_at')).toBe(true);
    const row = await prisma.worldResourceNode.findUnique({ where: { id: 'res_old' } });
    expect(row.remainingAmount).toBe(5);
    expect(row.respawnAt).toBeNull();
  });
});

describe('saveFullWorldState', () => {
  it('F1 full save', async () => {
    const state = new WorldState();
    state.zoneId = 'test:zone';
    const player = new PlayerState();
    player.id = 'owner1';
    player.name = 'Owner';
    player.wood = 123;
    state.players.set('owner1', player);
    const building = new BuildingState();
    building.id = 'b1';
    building.ownerId = 'owner1';
    building.type = 'TOWN_CENTER';
    building.gridX = 1;
    building.gridY = 1;
    building.sizeX = 2;
    building.sizeY = 2;
    building.hp = 1000;
    building.maxHp = 1000;
    building.level = 1;
    building.isConstructed = true;
    state.buildings.set('b1', building);
    const unit = new UnitState();
    unit.id = 'u1';
    unit.ownerId = 'owner1';
    unit.type = 'VILLAGER';
    unit.x = 3;
    unit.y = 3;
    unit.speed = 2;
    unit.level = 1;
    unit.hp = 50;
    unit.maxHp = 50;
    unit.actionState = 'IDLE';
    state.units.set('u1', unit);
    const resNode = new ResourceNodeState();
    resNode.id = 'res1';
    resNode.type = 'TREE';
    resNode.resourceType = 'wood';
    resNode.gridX = 5;
    resNode.gridY = 5;
    resNode.remainingAmount = 10;
    resNode.maxAmount = 10;
    state.resourceNodes.set('res1', resNode);

    await DatabaseService.saveFullWorldState(state);

    expect(await prisma.player.count()).toBe(1);
    const p = await prisma.player.findUnique({ where: { id: 'owner1' } });
    expect(p.wood).toBe(123);
    expect(await prisma.building.count()).toBe(1);
    const b = await prisma.building.findUnique({ where: { id: 'b1' } });
    expect(b.type).toBe('TOWN_CENTER');
    expect(await prisma.unit.count()).toBe(1);
    const u = await prisma.unit.findUnique({ where: { id: 'u1' } });
    expect(u.type).toBe('VILLAGER');
    expect(await prisma.worldResourceNode.count()).toBe(1);
    const r = await prisma.worldResourceNode.findUnique({ where: { id: 'res1' } });
    expect(r.remainingAmount).toBe(10);
  });

  it('F2 multiple owners', async () => {
    const state = new WorldState();
    state.zoneId = 'test:zone';
    for (const id of ['o1', 'o2']) {
      const p = new PlayerState();
      p.id = id;
      p.name = id;
      state.players.set(id, p);
      const b = new BuildingState();
      b.id = `b_${id}`;
      b.ownerId = id;
      b.type = 'TOWN_CENTER';
      b.gridX = 1;
      b.gridY = 1;
      b.sizeX = 2;
      b.sizeY = 2;
      b.hp = 1000;
      b.maxHp = 1000;
      state.buildings.set(b.id, b);
    }
    await DatabaseService.saveFullWorldState(state);
    expect(await prisma.player.count()).toBe(2);
    expect(await prisma.building.count()).toBe(2);
    const buildings = await prisma.building.findMany();
    expect(buildings.map((b: any) => b.ownerId).sort()).toEqual(['o1', 'o2']);
  });

  it('F3 sweep old entity', async () => {
    const state1 = new WorldState();
    state1.zoneId = 'test:zone';
    const p = new PlayerState();
    p.id = 'owner1';
    p.name = 'Owner';
    state1.players.set('owner1', p);
    const b = new BuildingState();
    b.id = 'b_old';
    b.ownerId = 'owner1';
    b.type = 'TOWN_CENTER';
    b.gridX = 1;
    b.gridY = 1;
    b.sizeX = 2;
    b.sizeY = 2;
    b.hp = 1000;
    b.maxHp = 1000;
    state1.buildings.set('b_old', b);
    await DatabaseService.saveFullWorldState(state1);

    const state2 = new WorldState();
    state2.zoneId = 'test:zone';
    const p2 = new PlayerState();
    p2.id = 'owner1';
    p2.name = 'Owner';
    state2.players.set('owner1', p2);
    await DatabaseService.saveFullWorldState(state2);

    expect(await prisma.building.findUnique({ where: { id: 'b_old' } })).toBeNull();
  });

  it('F4 skipAccountFor', async () => {
    const state1 = new WorldState();
    state1.zoneId = 'test:zone';
    const p1 = new PlayerState();
    p1.id = 'owner1';
    p1.name = 'Owner';
    p1.wood = 100;
    state1.players.set('owner1', p1);
    await DatabaseService.saveFullWorldState(state1);

    const state2 = new WorldState();
    state2.zoneId = 'test:zone';
    const p2 = new PlayerState();
    p2.id = 'owner1';
    p2.name = 'Owner';
    p2.wood = 999;
    state2.players.set('owner1', p2);
    const b = new BuildingState();
    b.id = 'b1';
    b.ownerId = 'owner1';
    b.type = 'TOWN_CENTER';
    b.gridX = 1;
    b.gridY = 1;
    b.sizeX = 2;
    b.sizeY = 2;
    b.hp = 1000;
    b.maxHp = 1000;
    state2.buildings.set('b1', b);
    await DatabaseService.saveFullWorldState(state2, 'test:zone', { skipAccountFor: new Set(['owner1']) });

    const row = await prisma.player.findUnique({ where: { id: 'owner1' } });
    expect(row.wood).toBe(100);
    expect(await prisma.building.findUnique({ where: { id: 'b1' } })).not.toBeNull();
  });

  it('F6 resource delta plumbing', async () => {
    const make = (amount: number) => {
      const state = new WorldState();
      state.zoneId = 'test:zone';
      const n = new ResourceNodeState();
      n.id = 'res1';
      n.type = 'TREE';
      n.resourceType = 'wood';
      n.gridX = 5;
      n.gridY = 5;
      n.remainingAmount = amount;
      n.maxAmount = 10;
      state.resourceNodes.set('res1', n);
      return state;
    };
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
    await DatabaseService.saveFullWorldState(make(10));
    const stmts1 = parseStmts(logs);
    logs.length = 0;
    await DatabaseService.saveFullWorldState(make(10));
    const stmts2 = parseStmts(logs);
    spy.mockRestore();
    expect(stmts2).toBeLessThan(stmts1);
  });
});

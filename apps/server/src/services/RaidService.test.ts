import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  RAID_LEVEL_RANGE,
  RAID_LOOT_CAP_PER_RESOURCE,
  RAID_SHIELD_MS,
  zoneForOwner
} from '@chien-quoc/shared';

let RaidService: typeof import('./RaidService.js').RaidService;
let RaidError: typeof import('./RaidService.js').RaidError;
let prisma: any;
let DatabaseService: any;

const dbFile = path.join(os.tmpdir(), `cq-raid-${process.pid}-${Date.now()}.db`);

beforeAll(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbFile + suffix, { force: true }); } catch {}
  }
  process.env.DATABASE_FILE = dbFile;
  const mod = await import('./RaidService.js');
  RaidService = mod.RaidService;
  RaidError = mod.RaidError;
  ({ prisma, DatabaseService } = await import('./DatabaseService.js'));
  await DatabaseService.initialize();
});

beforeEach(async () => {
  await prisma.unit.deleteMany();
  await prisma.building.deleteMany();
  await prisma.raid.deleteMany();
  await prisma.raidLock.deleteMany();
  await prisma.player.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbFile + suffix, { force: true }); } catch {}
  }
  delete process.env.DATABASE_FILE;
});

async function addPlayer(id: string, overrides: Record<string, unknown> = {}) {
  return prisma.player.create({
    data: {
      id,
      name: id,
      townCenterLevel: 3,
      wood: 100,
      food: 100,
      gold: 100,
      stone: 100,
      ...overrides
    }
  });
}

async function addUnit(id: string, ownerId: string, zone?: string) {
  return prisma.unit.create({
    data: {
      id,
      ownerId,
      zone: zone ?? zoneForOwner(ownerId),
      type: 'SPEARMAN',
      x: 10,
      y: 10,
      speed: 1,
      level: 1,
      hp: 100,
      maxHp: 100
    }
  });
}

describe('RaidService.listNeighbors', () => {
  it('lists only empires inside the level range', async () => {
    await addPlayer('attacker', { townCenterLevel: 5 });
    await addPlayer('close-low', { townCenterLevel: 5 - RAID_LEVEL_RANGE + 1 });
    await addPlayer('close-high', { townCenterLevel: 5 + RAID_LEVEL_RANGE });
    await addPlayer('too-far', { townCenterLevel: 5 + RAID_LEVEL_RANGE + 1 });
    await addPlayer('no-base', { townCenterLevel: 0 });

    const map = await RaidService.listNeighbors('attacker');
    const ids = map.neighbors.map((entry) => entry.userId).sort();

    expect(map.self).toEqual({ userId: 'attacker', townCenterLevel: 5 });
    expect(ids).toEqual(['close-high', 'close-low']);
  });

  it('returns an empty map when the caller has no Town Center', async () => {
    await addPlayer('attacker', { townCenterLevel: 0 });
    await addPlayer('neighbour', { townCenterLevel: 1 });

    const map = await RaidService.listNeighbors('attacker');
    expect(map.neighbors).toEqual([]);
  });

  it('blocks a shielded defender and explains why', async () => {
    await addPlayer('attacker', { townCenterLevel: 3 });
    await addPlayer('shielded', { townCenterLevel: 3, shieldUntil: Date.now() + 60_000 });

    const map = await RaidService.listNeighbors('attacker');
    const entry = map.neighbors.find((n) => n.userId === 'shielded')!;
    expect(entry.canAttack).toBe(false);
    expect(entry.blockReason).toBe('Protected');
  });

  it('blocks a defender this attacker recently lost to', async () => {
    await addPlayer('attacker', { townCenterLevel: 3 });
    await addPlayer('rival', { townCenterLevel: 3 });
    await prisma.raidLock.create({
      data: { attackerId: 'attacker', defenderId: 'rival', unlockAt: Date.now() + 60_000 }
    });

    const map = await RaidService.listNeighbors('attacker');
    const entry = map.neighbors.find((n) => n.userId === 'rival')!;
    expect(entry.canAttack).toBe(false);
    expect(entry.blockReason).toBe('Recently defeated by you');
  });

  it('blocks a defender that is already being raided', async () => {
    await addPlayer('attacker', { townCenterLevel: 3 });
    await addPlayer('busy', { townCenterLevel: 3 });
    await addPlayer('other-attacker', { townCenterLevel: 3 });
    await prisma.raid.create({
      data: {
        id: 'raid-busy',
        attackerId: 'other-attacker',
        defenderId: 'busy',
        status: 'ACTIVE',
        units: '[]'
      }
    });

    const map = await RaidService.listNeighbors('attacker');
    const entry = map.neighbors.find((n) => n.userId === 'busy')!;
    expect(entry.canAttack).toBe(false);
    expect(entry.blockReason).toBe('Under attack by another empire');
  });
});

describe('RaidService.startRaid', () => {
  it('moves the chosen units into the defender zone and creates one ACTIVE raid', async () => {
    await addPlayer('attacker');
    await addPlayer('defender');
    await addUnit('u1', 'attacker');
    await addUnit('u2', 'attacker');
    await addUnit('home-extra', 'attacker');

    const { raidId } = await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1', 'u2', 'u2']
    });

    const raid = await prisma.raid.findUnique({ where: { id: raidId } });
    expect(raid.status).toBe('ACTIVE');
    expect(raid.attackerId).toBe('attacker');

    const moved = await prisma.unit.findMany({
      where: { zone: zoneForOwner('defender') },
      orderBy: { id: 'asc' }
    });
    expect(moved.map((u: any) => u.id)).toEqual(['u1', 'u2']);

    const stayed = await prisma.unit.findUnique({ where: { id: 'home-extra' } });
    expect(stayed.zone).toBe(zoneForOwner('attacker'));
  });

  it('refuses a target outside the level range', async () => {
    await addPlayer('attacker', { townCenterLevel: 1 });
    await addPlayer('defender', { townCenterLevel: 10 });
    await addUnit('u1', 'attacker');

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'defender', unitIds: ['u1'] })
    ).rejects.toBeInstanceOf(RaidError);
  });

  it('refuses attacking yourself', async () => {
    await addPlayer('attacker');
    await addUnit('u1', 'attacker');

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'attacker', unitIds: ['u1'] })
    ).rejects.toThrow('You cannot attack yourself.');
  });

  it('refuses a shielded defender and a locked pair', async () => {
    await addPlayer('attacker');
    await addPlayer('defender', { shieldUntil: Date.now() + 60_000 });
    await addUnit('u1', 'attacker');

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'defender', unitIds: ['u1'] })
    ).rejects.toThrow('This empire is protected');

    await prisma.player.update({ where: { id: 'defender' }, data: { shieldUntil: 0 } });
    await prisma.raidLock.create({
      data: { attackerId: 'attacker', defenderId: 'defender', unlockAt: Date.now() + 60_000 }
    });

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'defender', unitIds: ['u1'] })
    ).rejects.toThrow('wait for the lock to expire');
  });

  it('refuses an empty selection and a selection that is not in the home zone', async () => {
    await addPlayer('attacker');
    await addPlayer('defender');
    await addUnit('u1', 'attacker', zoneForOwner('defender'));

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'defender', unitIds: [] })
    ).rejects.toThrow('at least one unit');

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'defender', unitIds: ['u1'] })
    ).rejects.toThrow('No unit is ready to attack');
  });

  it('refuses a second raid on a defender that is already under attack', async () => {
    await addPlayer('attacker');
    await addPlayer('defender');
    await addUnit('u1', 'attacker');
    await addUnit('u2', 'attacker');

    await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1']
    });

    await expect(
      RaidService.startRaid({ attackerId: 'attacker', defenderId: 'defender', unitIds: ['u2'] })
    ).rejects.toThrow('already under attack');
  });
});

describe('RaidService.settleRaid', () => {
  async function startBasicRaid() {
    await addPlayer('attacker', { wood: 0, food: 0, gold: 0, stone: 0 });
    await addPlayer('defender', { wood: 1000, food: 500, gold: 100, stone: 40 });
    await addUnit('u1', 'attacker');
    await addUnit('u2', 'attacker');
    const { raidId } = await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1', 'u2']
    });
    return raidId;
  }

  it('pays the attacker, shields the defender and sends survivors home', async () => {
    const raidId = await startBasicRaid();

    const settled = await RaidService.settleRaid({
      raidId,
      outcome: 'ATTACKER_WON',
      survivingUnitIds: ['u1']
    });

    expect(settled?.loot).toEqual({ wood: 200, food: 100, gold: 20, stone: 8 });

    const attacker = await prisma.player.findUnique({ where: { id: 'attacker' } });
    expect(attacker.wood).toBe(200);
    const defender = await prisma.player.findUnique({ where: { id: 'defender' } });
    expect(defender.wood).toBe(800);
    expect(defender.shieldUntil).toBeGreaterThan(Date.now() + RAID_SHIELD_MS - 5000);

    // The casualty row is gone; the survivor is back in the attacker's kingdom.
    expect(await prisma.unit.findUnique({ where: { id: 'u2' } })).toBeNull();
    const survivor = await prisma.unit.findUnique({ where: { id: 'u1' } });
    expect(survivor.zone).toBe(zoneForOwner('attacker'));

    // A win does not lock the pair.
    expect(await prisma.raidLock.count()).toBe(0);
    const raid = await prisma.raid.findUnique({ where: { id: raidId } });
    expect(raid.status).toBe('ATTACKER_WON');
  });

  it('caps loot per resource', async () => {
    await addPlayer('attacker');
    await addPlayer('defender', {
      wood: RAID_LOOT_CAP_PER_RESOURCE * 10,
      food: RAID_LOOT_CAP_PER_RESOURCE * 10,
      gold: RAID_LOOT_CAP_PER_RESOURCE * 10,
      stone: RAID_LOOT_CAP_PER_RESOURCE * 10
    });
    await addUnit('u1', 'attacker');
    const { raidId } = await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1']
    });

    const settled = await RaidService.settleRaid({
      raidId,
      outcome: 'ATTACKER_WON',
      survivingUnitIds: ['u1']
    });
    expect(settled?.loot).toEqual({
      wood: RAID_LOOT_CAP_PER_RESOURCE,
      food: RAID_LOOT_CAP_PER_RESOURCE,
      gold: RAID_LOOT_CAP_PER_RESOURCE,
      stone: RAID_LOOT_CAP_PER_RESOURCE
    });
  });

  it('locks the pair for three days when the attacker loses', async () => {
    const raidId = await startBasicRaid();

    await RaidService.settleRaid({ raidId, outcome: 'DEFENDER_WON', survivingUnitIds: [] });

    const lock = await prisma.raidLock.findUnique({
      where: { attackerId_defenderId: { attackerId: 'attacker', defenderId: 'defender' } }
    });
    expect(lock).toBeTruthy();
    expect(lock.unlockAt).toBeGreaterThan(Date.now() + 2 * 24 * 60 * 60 * 1000);
  });

  it('is idempotent: a second settle changes nothing', async () => {
    const raidId = await startBasicRaid();

    const first = await RaidService.settleRaid({
      raidId,
      outcome: 'ATTACKER_WON',
      survivingUnitIds: ['u1', 'u2']
    });
    const second = await RaidService.settleRaid({
      raidId,
      outcome: 'ATTACKER_WON',
      survivingUnitIds: ['u1', 'u2']
    });

    expect(first).toBeTruthy();
    expect(second).toBeNull();

    const attacker = await prisma.player.findUnique({ where: { id: 'attacker' } });
    expect(attacker.wood).toBe(200);
  });

  it('returns null for an unknown raid id', async () => {
    expect(
      await RaidService.settleRaid({
        raidId: 'missing',
        outcome: 'RETREATED',
        survivingUnitIds: []
      })
    ).toBeNull();
  });
});

describe('RaidService.retreatRaid and reconcile', () => {
  it('retreats using survivors read from the database', async () => {
    await addPlayer('attacker');
    await addPlayer('defender');
    await addUnit('u1', 'attacker');
    const { raidId } = await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1']
    });

    const settled = await RaidService.retreatRaid(raidId, 'attacker');
    expect(settled?.outcome).toBe('RETREATED');

    const unit = await prisma.unit.findUnique({ where: { id: 'u1' } });
    expect(unit.zone).toBe(zoneForOwner('attacker'));
  });

  it('refuses to retreat a raid belonging to somebody else', async () => {
    await addPlayer('attacker');
    await addPlayer('defender');
    await addUnit('u1', 'attacker');
    const { raidId } = await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1']
    });

    expect(await RaidService.retreatRaid(raidId, 'defender')).toBeNull();
  });

  it('closes an abandoned raid on boot', async () => {
    await addPlayer('attacker');
    await addPlayer('defender');
    await addUnit('u1', 'attacker');
    const { raidId } = await RaidService.startRaid({
      attackerId: 'attacker',
      defenderId: 'defender',
      unitIds: ['u1']
    });
    // Pretend the raid started two hours ago.
    await prisma.raid.update({
      where: { id: raidId },
      data: { startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }
    });

    expect(await RaidService.reconcileStaleRaids()).toBe(1);
    const raid = await prisma.raid.findUnique({ where: { id: raidId } });
    expect(raid.status).toBe('RETREATED');
  });
});

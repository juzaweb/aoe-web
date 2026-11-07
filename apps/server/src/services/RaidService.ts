import {
  KINGDOM_MAP_SIZE,
  RAID_LOSS_LOCK_MS,
  RAID_MAX_UNITS,
  RAID_MIN_UNITS,
  RAID_RETREAT_TIMEOUT_MS,
  RAID_SHIELD_MS,
  Resources,
  RaidOutcome,
  WorldMapEntry,
  WorldMapPayload,
  computeRaidLoot,
  isRaidLevelInRange,
  zoneForOwner
} from '@chien-quoc/shared';
import { accountSessions } from '../rooms/AccountSessions.js';
import { DatabaseService, prisma } from './DatabaseService.js';

/**
 * Raid lifecycle: who may attack whom, what it costs to lose, and what a win
 * pays out.
 *
 * The room owns the fight; this service owns the durable side of it. Every
 * state change is a single transaction, so a crash can never leave an army in
 * two zones or loot granted twice.
 */

/** Public identity of a kingdom another account is allowed to watch. */
export interface SpectateTarget {
  id: string;
  name: string;
  color: string;
  townCenterLevel: number;
}

/** A rejection the HTTP layer can turn into a 4xx with a readable message. */
export class RaidError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'RaidError';
  }
}

export interface RaidStartInput {
  attackerId: string;
  defenderId: string;
  unitIds: string[];
}

export interface RaidStartResult {
  raidId: string;
  defenderId: string;
}

export interface SettleRaidInput {
  raidId: string;
  outcome: RaidOutcome;
  /**
   * Units of the attacker still standing, as known by the room. Rows outside
   * this list are deleted: combat only removes them from memory, so the
   * database still holds the casualties until a save catches up.
   */
  survivingUnitIds: string[];
}

export interface SettledRaid {
  attackerId: string;
  defenderId: string;
  outcome: RaidOutcome;
  loot: Resources;
}

/** One row of `raids`, parsed. */
export interface ActiveRaid {
  id: string;
  attackerId: string;
  defenderId: string;
  /** ACTIVE or the final outcome; a caller must not assume it is live. */
  status: string;
  units: Array<{ id: string; type: string; level: number; hp: number; maxHp: number; speed: number }>;
  startedAt: number;
}

const EMPTY_LOOT: Resources = { wood: 0, food: 0, gold: 0, stone: 0 };

/**
 * Upper bound on neighbours returned by one world-map call.
 *
 * The map is a full-screen grid, so an unbounded list would be both a heavy
 * payload and an unreadable screen once the server has thousands of accounts.
 * Every empire in range is still reachable by the level filter, not by paging.
 */
const MAX_WORLD_MAP_NEIGHBORS = 500;

/**
 * Where an attacking army appears: a loose block just inside the defender's
 * right edge, matching the side a retreat gate is placed on.
 *
 * Units do not collide, so a small fan is enough to keep them out of one pixel.
 */
function stagingPoint(index: number): { x: number; y: number } {
  const columns = 7;
  const spacing = 0.8;
  const { width, height } = KINGDOM_MAP_SIZE;
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: width - 8 + col * spacing,
    y: height / 2 + 2 + row * spacing
  };
}

function parseUnits(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class RaidService {
  /**
   * The world map for one account: every empire whose Town Center is within
   * `RAID_LEVEL_RANGE` levels, with the reason a raid is blocked (if any).
   *
   * Two flat queries rather than a per-row lookup: the neighbour list is small
   * but the map is opened often, and this path must stay cheap.
   */
  public static async listNeighbors(attackerId: string): Promise<WorldMapPayload> {
    await DatabaseService.initialize();

    const self = await prisma.player.findUnique({
      where: { id: attackerId },
      select: { id: true, townCenterLevel: true }
    });
    const selfLevel = self?.townCenterLevel ?? 0;

    const selfEntry = { userId: attackerId, townCenterLevel: selfLevel };
    if (selfLevel <= 0) return { self: selfEntry, neighbors: [] };

    const candidates = await prisma.player.findMany({
      where: { id: { not: attackerId }, townCenterLevel: { gt: 0 } },
      select: { id: true, name: true, color: true, townCenterLevel: true, shieldUntil: true },
      orderBy: { townCenterLevel: 'desc' },
      take: MAX_WORLD_MAP_NEIGHBORS
    });

    const inRange = candidates.filter((p) => isRaidLevelInRange(selfLevel, p.townCenterLevel));
    if (inRange.length === 0) return { self: selfEntry, neighbors: [] };

    const ids = inRange.map((p) => p.id);
    const now = Date.now();

    const [locks, contested] = await Promise.all([
      prisma.raidLock.findMany({
        where: { attackerId, defenderId: { in: ids } },
        select: { defenderId: true, unlockAt: true }
      }),
      prisma.raid.findMany({
        where: { defenderId: { in: ids }, status: 'ACTIVE' },
        select: { defenderId: true }
      })
    ]);

    const lockByDefender = new Map(locks.map((row) => [row.defenderId, row.unlockAt]));
    const contestedDefenders = new Set(contested.map((row) => row.defenderId));

    const neighbors: WorldMapEntry[] = inRange.map((p) => {
      // An expired timestamp is reported as "not blocked" rather than as a
      // zero-minute wait the overlay would still render.
      const lockAt = lockByDefender.get(p.id) ?? 0;
      const shieldAt = p.shieldUntil ?? 0;
      const lockedUntil = lockAt > now ? lockAt : 0;
      const shieldUntil = shieldAt > now ? shieldAt : 0;

      let blockReason: string | undefined;
      if (!accountSessions.hasLiveSession(p.id)) blockReason = 'Chủ thành đang ngoại tuyến';
      else if (shieldUntil > now) blockReason = 'Đang được bảo vệ';
      else if (lockedUntil > now) blockReason = 'Bạn vừa thua nước này';
      else if (contestedDefenders.has(p.id)) blockReason = 'Đang bị nước khác tấn công';

      return {
        userId: p.id,
        name: p.name,
        color: p.color,
        townCenterLevel: p.townCenterLevel,
        shieldUntil,
        lockedUntil,
        canAttack: blockReason === undefined,
        blockReason
      };
    });

    return { self: selfEntry, neighbors };
  }

  /**
   * Validates every rule and then moves the army in one transaction.
   *
   * Validation is repeated here even though `listNeighbors` already marks
   * blocked targets: the list is a UI hint, and a client is free to POST any
   * `defenderId` it likes.
   */
  public static async startRaid(input: RaidStartInput): Promise<RaidStartResult> {
    await DatabaseService.initialize();

    const { attackerId, defenderId } = input;
    if (!attackerId || !defenderId) throw new RaidError('Thiếu thông tin trận đánh.');
    if (attackerId === defenderId) throw new RaidError('Không thể tấn công chính mình.');

    const unitIds = Array.isArray(input.unitIds) ? [...new Set(input.unitIds)] : [];
    if (unitIds.length < RAID_MIN_UNITS) {
      throw new RaidError('Hãy chọn ít nhất một đơn vị để tấn công.');
    }
    if (unitIds.length > RAID_MAX_UNITS) {
      throw new RaidError(`Chỉ được mang tối đa ${RAID_MAX_UNITS} đơn vị mỗi trận.`);
    }

    const [attacker, defender] = await Promise.all([
      prisma.player.findUnique({
        where: { id: attackerId },
        select: { id: true, townCenterLevel: true }
      }),
      prisma.player.findUnique({
        where: { id: defenderId },
        select: { id: true, townCenterLevel: true, shieldUntil: true }
      })
    ]);

    if (!attacker) throw new RaidError('Không tìm thấy nước của bạn.', 404);
    if (!defender) throw new RaidError('Không tìm thấy nước cần tấn công.', 404);
    if (attacker.townCenterLevel <= 0) throw new RaidError('Bạn chưa có Nhà chính.');
    if (defender.townCenterLevel <= 0) throw new RaidError('Nước này chưa có Nhà chính.');

    if (!isRaidLevelInRange(attacker.townCenterLevel, defender.townCenterLevel)) {
      throw new RaidError('Chênh lệch cấp Nhà chính quá lớn để tập kích.');
    }

    // Only an empire whose owner is actually playing can be raided: an offline
    // base cannot fight back, so attacking it would be a free hit.
    if (!accountSessions.hasLiveSession(defenderId)) {
      throw new RaidError('Chủ thành đang ngoại tuyến, hãy chọn mục tiêu khác.');
    }

    const now = Date.now();
    if ((defender.shieldUntil ?? 0) > now) {
      throw new RaidError('Nước này đang được bảo vệ, hãy chọn mục tiêu khác.');
    }

    const lock = await prisma.raidLock.findUnique({
      where: { attackerId_defenderId: { attackerId, defenderId } }
    });
    if ((lock?.unlockAt ?? 0) > now) {
      throw new RaidError('Bạn vừa thua nước này; phải chờ hết thời gian khoá.');
    }

    const active = await prisma.raid.findFirst({
      where: { defenderId, status: 'ACTIVE' },
      select: { id: true }
    });
    if (active) throw new RaidError('Nước này đang bị tấn công.');

    const homeZone = zoneForOwner(attackerId);
    const units = await prisma.unit.findMany({
      where: { id: { in: unitIds }, ownerId: attackerId, zone: homeZone },
      select: { id: true, type: true, level: true, hp: true, maxHp: true, speed: true }
    });

    // Stale or foreign ids are dropped, the same way every other group order
    // treats them; the raid still happens with whoever is left.
    if (units.length === 0) {
      throw new RaidError('Không có đơn vị nào sẵn sàng để tấn công.');
    }

    const raidId = crypto.randomUUID();
    const raidZone = zoneForOwner(defenderId);
    const payload = units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      level: unit.level,
      hp: unit.hp,
      maxHp: unit.maxHp,
      speed: unit.speed
    }));

    try {
      await prisma.$transaction(async (tx) => {
        for (let index = 0; index < units.length; index++) {
          const point = stagingPoint(index);
          await tx.unit.update({
            where: { id: units[index].id },
            data: { zone: raidZone, x: point.x, y: point.y, actionState: 'IDLE' }
          });
        }

        await tx.raid.create({
          data: {
            id: raidId,
            attackerId,
            defenderId,
            status: 'ACTIVE',
            units: JSON.stringify(payload),
            startedAt: new Date()
          }
        });
      });
    } catch (err: any) {
      // The partial unique index is the last line of defence against two
      // simultaneous raids on one defender.
      if (err?.code === 'P2002') throw new RaidError('Nước này đang bị tấn công.');
      throw err;
    }

    // The attacker's own room is still closing while the destination join
    // arrives; the hand-off lets it claim the account without a takeover.
    accountSessions.beginHandoff(attackerId, raidZone);

    return { raidId, defenderId };
  }

  /** Closes a raid exactly once and applies its consequences. */
  public static async settleRaid(input: SettleRaidInput): Promise<SettledRaid | null> {
    await DatabaseService.initialize();
    const now = Date.now();

    return prisma.$transaction(async (tx) => {
      const raid = await tx.raid.findUnique({ where: { id: input.raidId } });
      if (!raid) return null;

      // `updateMany` filtered on ACTIVE is the idempotence guard: a second
      // settle call (retreat racing the tick, a restart) updates zero rows.
      const closed = await tx.raid.updateMany({
        where: { id: raid.id, status: 'ACTIVE' },
        data: { status: input.outcome, endedAt: new Date(now) }
      });
      if (closed.count === 0) return null;

      const { attackerId, defenderId } = raid;
      const raidZone = zoneForOwner(defenderId);
      const homeZone = zoneForOwner(attackerId);

      let loot: Resources = { ...EMPTY_LOOT };
      if (input.outcome === 'ATTACKER_WON') {
        const defender = await tx.player.findUnique({
          where: { id: defenderId },
          select: { wood: true, food: true, gold: true, stone: true }
        });
        if (defender) {
          loot = computeRaidLoot({
            wood: defender.wood,
            food: defender.food,
            gold: defender.gold,
            stone: defender.stone
          });
          await tx.player.update({
            where: { id: defenderId },
            data: {
              wood: { decrement: loot.wood },
              food: { decrement: loot.food },
              gold: { decrement: loot.gold },
              stone: { decrement: loot.stone }
            }
          });
          await tx.player.update({
            where: { id: attackerId },
            data: {
              wood: { increment: loot.wood },
              food: { increment: loot.food },
              gold: { increment: loot.gold },
              stone: { increment: loot.stone }
            }
          });
        }
      } else {
        // Losing (or retreating) locks the pair for three days: an army that
        // cannot win should not be able to keep retrying the same target.
        await tx.raidLock.upsert({
          where: { attackerId_defenderId: { attackerId, defenderId } },
          create: { attackerId, defenderId, unlockAt: now + RAID_LOSS_LOCK_MS },
          update: { unlockAt: now + RAID_LOSS_LOCK_MS }
        });
      }

      // The defender always gets peace after a raid, win or lose.
      await tx.player.update({
        where: { id: defenderId },
        data: { shieldUntil: now + RAID_SHIELD_MS }
      });

      // Army bookkeeping: casualties disappear, survivors go home. Rows the
      // room no longer knows about are casualties.
      const survivors = new Set(input.survivingUnitIds);
      const inRaidZone = await tx.unit.findMany({
        where: { ownerId: attackerId, zone: raidZone },
        select: { id: true }
      });

      const casualties = inRaidZone.filter((unit) => !survivors.has(unit.id)).map((unit) => unit.id);
      if (casualties.length > 0) {
        await tx.unit.deleteMany({ where: { id: { in: casualties } } });
      }

      let slot = 0;
      for (const unit of inRaidZone) {
        if (!survivors.has(unit.id)) continue;
        const point = stagingPoint(slot++);
        await tx.unit.update({
          where: { id: unit.id },
          data: { zone: homeZone, x: point.x, y: point.y, actionState: 'IDLE' }
        });
      }

      await tx.raid.update({ where: { id: raid.id }, data: { loot: JSON.stringify(loot) } });

      // The army is home again, so the follow-up join back to the attacker's
      // kingdom is a hand-off too.
      accountSessions.beginHandoff(attackerId, homeZone);

      return { attackerId, defenderId, outcome: input.outcome, loot };
    });
  }

  /**
   * Retreats a raid from outside the room.
   *
   * The room normally settles the retreat itself (it knows which soldiers are
   * still standing); this path exists for a client whose room socket is gone,
   * so it resolves survivors from the database instead.
   */
  public static async retreatRaid(raidId: string, attackerId: string): Promise<SettledRaid | null> {
    const raid = await this.findRaid(raidId);
    if (!raid || raid.attackerId !== attackerId) return null;

    const survivors = await prisma.unit.findMany({
      where: { ownerId: attackerId, zone: zoneForOwner(raid.defenderId) },
      select: { id: true }
    });

    return this.settleRaid({
      raidId,
      outcome: 'RETREATED',
      survivingUnitIds: survivors.map((unit) => unit.id)
    });
  }

  /**
   * Looks up a kingdom another account may watch.
   *
   * Watching is deliberately open to every logged-in account, so the only gate
   * is that the target really has a Town Center: an empire without one is not
   * on the world map and its map room would be an empty plain.
   */
  public static async findSpectateTarget(ownerId: string): Promise<SpectateTarget | null> {
    await DatabaseService.initialize();
    if (!ownerId) return null;

    const player = await prisma.player.findUnique({
      where: { id: ownerId },
      select: { id: true, name: true, color: true, townCenterLevel: true }
    });
    if (!player) return null;

    return {
      id: player.id,
      name: player.name,
      color: player.color ?? '#64748b',
      townCenterLevel: player.townCenterLevel ?? 0
    };
  }

  /** The live raid on a defender, if any. Used by the room when it boots. */
  public static async findActiveRaidForDefender(defenderId: string): Promise<ActiveRaid | null> {
    await DatabaseService.initialize();
    const raid = await prisma.raid.findFirst({
      where: { defenderId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' }
    });
    if (!raid) return null;

    return {
      id: raid.id,
      attackerId: raid.attackerId,
      defenderId: raid.defenderId,
      status: raid.status,
      units: parseUnits(raid.units),
      startedAt: raid.startedAt.getTime()
    };
  }

  /** A raid by id; the room verifies ownership before letting a client in. */
  public static async findRaid(raidId: string): Promise<ActiveRaid | null> {
    await DatabaseService.initialize();
    const raid = await prisma.raid.findUnique({ where: { id: raidId } });
    if (!raid) return null;

    return {
      id: raid.id,
      attackerId: raid.attackerId,
      defenderId: raid.defenderId,
      status: raid.status,
      units: parseUnits(raid.units),
      startedAt: raid.startedAt.getTime()
    };
  }

  /** Current status of a raid, or null when it never existed. */
  public static async raidStatus(raidId: string): Promise<string | null> {
    await DatabaseService.initialize();
    const raid = await prisma.raid.findUnique({ where: { id: raidId }, select: { status: true } });
    return raid?.status ?? null;
  }

  /**
   * Updates the cached Town Center level shown on the world map.
   *
   * Cheap enough to call from every save path; the value is a plain number, so
   * an unnecessary write is harmless.
   */
  public static async syncTownCenterLevel(ownerId: string, level: number): Promise<void> {
    await DatabaseService.initialize();
    const safe = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
    try {
      await prisma.player.updateMany({
        where: { id: ownerId, townCenterLevel: { not: safe } },
        data: { townCenterLevel: safe }
      });
    } catch (err) {
      // A missing account row is not an error here: the save that follows will
      // create it with the right value.
      console.warn(`[RaidService] Could not sync the Town Center level of ${ownerId}:`, err);
    }
  }

  /**
   * Closes raids abandoned by both sides (server restart, both sockets gone).
   *
   * Called once on boot: without it the defender stays locked out and their
   * kingdom room keeps an ACTIVE raid that no client can finish.
   */
  public static async reconcileStaleRaids(): Promise<number> {
    await DatabaseService.initialize();
    const cutoff = new Date(Date.now() - RAID_RETREAT_TIMEOUT_MS);

    const stale = await prisma.raid.findMany({
      where: { status: 'ACTIVE', startedAt: { lt: cutoff } },
      select: { id: true, attackerId: true, defenderId: true }
    });

    let closed = 0;
    for (const raid of stale) {
      const survivors = await prisma.unit.findMany({
        where: { ownerId: raid.attackerId, zone: zoneForOwner(raid.defenderId) },
        select: { id: true }
      });

      const settled = await this.settleRaid({
        raidId: raid.id,
        outcome: 'RETREATED',
        survivingUnitIds: survivors.map((unit) => unit.id)
      });
      if (settled) closed += 1;
    }

    if (closed > 0) {
      console.log(`⚔️  [RaidService] Closed ${closed} abandoned raid(s) on boot.`);
    }
    return closed;
  }
}

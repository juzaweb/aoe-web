import { Client, ErrorCode, ServerError } from '@colyseus/core';
import {
  NetworkMessage,
  RAID_RETREAT_TIMEOUT_MS,
  RaidEndedPayload,
  RejectCode,
  Resources,
  isRaidTownCenterBreached,
  zoneForOwner
} from '@chien-quoc/shared';
import { DatabaseService } from '../services/DatabaseService.js';
import { RaidService } from '../services/RaidService.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ensurePortalFor } from './portals.js';
import { WorldRoom } from './WorldRoom.js';
import type { RoomAuth } from './identity.js';

/**
 * One private map per account, plus an optional raid in progress.
 *
 * The room is registered with `filterBy(['ownerId'])`, so the matchmaker hands
 * a player back the same live room on a refresh. `onAuth` independently proves
 * the option names the authenticated account: filtering is matchmaking, not
 * authorization, and a room created for somebody else's id would otherwise load
 * their empire before `onJoin` could refuse it.
 *
 * Phase 23 adds exactly one exception: an attacker carrying a live `raidId` may
 * join the defender's room. That exception is verified against the database in
 * `onJoin`, never taken from the client's word.
 */
export class KingdomRoom extends WorldRoom {
  /** Live raid played in this room, if any. */
  private raidId: string | null = null;
  private raidAttackerId: string | null = null;
  private raidStartedAt = 0;
  /** Stops the tick and the retreat message from settling the same raid twice. */
  private raidSettling = false;
  private raidContextLoaded = false;
  /**
   * Whether the attacker's army has been seen in this room at least once.
   *
   * A raid is committed before the attacker's socket joins, and the defender's
   * room keeps ticking in between. Without this flag the empty unit list would
   * look like a wiped army and the first tick after `/raid/start` would settle
   * the raid as a defender win.
   */
  private raidArmySeen = false;

  static async onAuth(
    token: string | undefined,
    options?: { ownerId?: unknown; raidId?: unknown }
  ): Promise<RoomAuth> {
    const auth = await super.onAuth(token);

    // A raid join names the defender as `ownerId`, which the plain rule would
    // reject. This static hook has no room state, so the real proof happens in
    // `onJoin`; here the request is only let through to it.
    if (typeof options?.raidId === 'string' && options.raidId.length > 0) {
      return auth;
    }

    const ownerId = options?.ownerId;

    if (typeof ownerId !== 'string' || ownerId.length === 0 || ownerId !== auth.userId) {
      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        'Vương quốc này không thuộc tài khoản đang đăng nhập.'
      );
    }

    return auth;
  }

  onCreate(options: any) {
    super.onCreate(options);

    this.onMessage(NetworkMessage.RAID_RETREAT, (client: Client) => {
      void this.handleRetreat(client);
    });
  }

  async onJoin(client: Client, options: any) {
    const raidId = typeof options?.raidId === 'string' ? options.raidId : '';
    if (raidId) {
      const auth = client.auth as Partial<RoomAuth> | undefined;
      const defenderId = typeof options?.ownerId === 'string' ? options.ownerId : '';
      const raid = await RaidService.findRaid(raidId);

      // Three independent facts must hold: the raid is still live, this socket
      // owns the attacking side, and the room is the one being defended.
      if (!raid || raid.attackerId !== auth?.userId || raid.defenderId !== defenderId) {
        throw new ServerError(ErrorCode.AUTH_FAILED, 'Trận đánh này không còn hiệu lực.');
      }
      if ((await RaidService.raidStatus(raidId)) !== 'ACTIVE') {
        throw new ServerError(ErrorCode.AUTH_FAILED, 'Trận đánh này đã kết thúc.');
      }

      this.raidId = raid.id;
      this.raidAttackerId = raid.attackerId;
      this.raidStartedAt = raid.startedAt;
      this.raidArmySeen = raid.units.length > 0;
    }

    await super.onJoin(client, options);

    if (raidId && this.raidAttackerId) {
      // The defender's room may have been live before the raid began, in which
      // case boot never loaded the attacker's army. Pull it from SQLite now.
      await this.restoreRaiderArmy(this.raidAttackerId);
      // The raider needs a way home. Idempotent, so a refresh inside the raid
      // keeps the same gate instead of stacking a second one.
      ensurePortalFor(this.state, this.raidAttackerId);
    }
  }

  protected resolveOwnerScope(options: any): string | null {
    const ownerId = options?.ownerId;
    return typeof ownerId === 'string' && ownerId.length > 0 ? ownerId : null;
  }

  protected resolveZoneId(options: any): string {
    const ownerId = this.resolveOwnerScope(options);
    return ownerId ? zoneForOwner(ownerId) : 'world';
  }

  protected canJoinOwner(ownerId: string): boolean {
    return this.ownerScope === ownerId || this.raidAttackerId === ownerId;
  }

  /**
   * Only the defender manages this map. A raider may fight, walk and retreat,
   * but building or harvesting here would turn someone else's kingdom into a
   * colony (Phase 23/R14).
   */
  protected canManageZone(ownerId: string): boolean {
    return this.ownerScope === ownerId;
  }

  /**
   * A raider gets no starter base: they arrive as an army, not a settler.
   *
   * `spawnZoneContent` is called with the joining client's account id, so
   * without this guard a raider would be handed a Town Center and three
   * villagers inside the defender's kingdom.
   */
  protected async spawnZoneContent(ownerId: string): Promise<void> {
    if (ownerId !== this.ownerScope) return;
    await super.spawnZoneContent(ownerId);
  }

  /**
   * A raided kingdom must restore the raider's army too, otherwise a server
   * restart mid-raid would erase it from memory while the database still has it.
   */
  protected async entityOwnersToLoad(): Promise<string[] | null> {
    await this.loadRaidContext();
    if (!this.ownerScope) return null;
    return this.raidAttackerId ? [this.ownerScope, this.raidAttackerId] : [this.ownerScope];
  }

  /**
   * Picks up a raid that survived a restart, places the retreat gate and
   * refreshes the world-map cache for this empire.
   */
  protected async onWorldReady(): Promise<void> {
    await this.loadRaidContext();
    if (this.raidAttackerId) {
      ensurePortalFor(this.state, this.raidAttackerId);
    }
    if (this.ownerScope) {
      void RaidService.syncTownCenterLevel(this.ownerScope, this.townCenterLevelOf(this.ownerScope));
    }
  }

  protected afterTick(): void {
    if (!this.raidId || this.raidSettling) return;
    void this.evaluateRaid();
  }

  /** Keeps the world-map level cache in step with a Town Center upgrade. */
  protected onBuildingUpgraded(building: BuildingState): void {
    if (!this.ownerScope || building.ownerId !== this.ownerScope) return;
    if (building.type !== 'TOWN_CENTER') return;
    void RaidService.syncTownCenterLevel(this.ownerScope, building.level);
  }

  /**
   * Loads a raider's army into a room that was already running when the raid
   * started.
   *
   * A room created for the raid loads it at boot (`entityOwnersToLoad`); this
   * covers the other order, where the defender is online first. Without it the
   * raider would arrive with no units and the raid would end instantly.
   */
  private async restoreRaiderArmy(ownerId: string): Promise<void> {
    if (this.unitsOf(ownerId).length > 0) return;

    try {
      const rows = await DatabaseService.loadZoneEntities(this.zoneId, ownerId);
      if (rows.length === 0) return;
      this.restoreSavedEntities(rows);
      this.bumpEntityIdsFromState();
      this.updatePlayerPopulation(ownerId);
    } catch (err) {
      console.error(`❌ [KingdomRoom] Could not restore the army of ${ownerId}:`, err);
    }
  }

  /** Reads the live raid of this defender once per room lifetime. */
  private async loadRaidContext(): Promise<void> {
    if (this.raidContextLoaded) return;
    this.raidContextLoaded = true;

    const defenderId = this.ownerScope;
    if (!defenderId) return;

    try {
      const raid = await RaidService.findActiveRaidForDefender(defenderId);
      if (!raid) return;
      this.raidId = raid.id;
      this.raidAttackerId = raid.attackerId;
      this.raidStartedAt = raid.startedAt;
      this.raidArmySeen = raid.units.length > 0;
    } catch (err) {
      console.error(`❌ [KingdomRoom] Could not load the raid of ${defenderId}:`, err);
    }
  }

  /**
   * Closes the raid when an army is wiped, the Town Center is breached, or the
   * fight has been abandoned long enough to count as a retreat.
   */
  private async evaluateRaid(): Promise<void> {
    const raidId = this.raidId;
    const attackerId = this.raidAttackerId;
    const defenderId = this.ownerScope;
    if (!raidId || !attackerId || !defenderId) return;

    const attackerUnits = this.unitsOf(attackerId);
    if (attackerUnits.length > 0) this.raidArmySeen = true;
    if (this.raidArmySeen && attackerUnits.length === 0) {
      await this.settle(raidId, 'DEFENDER_WON');
      return;
    }

    const townCenter = this.townCenterOf(defenderId);
    if (!townCenter) {
      await this.settle(raidId, 'DEFENDER_WON');
      return;
    }

    if (isRaidTownCenterBreached(townCenter.hp, townCenter.maxHp)) {
      await this.settle(raidId, 'ATTACKER_WON');
      return;
    }

    if (Date.now() - this.raidStartedAt > RAID_RETREAT_TIMEOUT_MS) {
      await this.settle(raidId, 'RETREATED');
    }
  }

  /** `RAID_RETREAT` from the attacker's own retreat gate. */
  private async handleRetreat(client: Client): Promise<void> {
    const ownerId = (client.auth as Partial<RoomAuth> | undefined)?.userId;
    if (!this.raidId || ownerId !== this.raidAttackerId) {
      this.rejectCommand(client, 'Bạn không có quyền rút quân ở đây.', RejectCode.FORBIDDEN);
      return;
    }
    await this.settle(this.raidId, 'RETREATED');
  }

  /**
   * Persists the outcome exactly once, tells both sides and clears the raid.
   *
   * `RaidService.settleRaid` is itself idempotent; the local flag only avoids
   * paying for a duplicate transaction while the first one is in flight.
   */
  private async settle(
    raidId: string,
    outcome: 'ATTACKER_WON' | 'DEFENDER_WON' | 'RETREATED'
  ): Promise<void> {
    if (this.raidSettling) return;
    this.raidSettling = true;

    const attackerId = this.raidAttackerId;
    const defenderId = this.ownerScope;
    const surviving = attackerId
      ? this.unitsOf(attackerId).map((unit) => unit.id)
      : [];

    try {
      const settled = await RaidService.settleRaid({
        raidId,
        outcome,
        survivingUnitIds: surviving
      });

      this.raidId = null;
      this.raidAttackerId = null;

      if (!settled) {
        // Another path (the HTTP retreat fallback) already closed the raid and
        // moved the army home; drop the leftovers so the defender does not keep
        // seeing ghost soldiers.
        if (attackerId) this.removeUnitsOf(attackerId);
        return;
      }

      if (attackerId) {
        // Drop the army from this room's state *before* the client leaves, so
        // the leave save cannot write it back into the defender's zone.
        this.removeUnitsOf(attackerId);
        this.sendToOwner<RaidEndedPayload>(attackerId, NetworkMessage.RAID_ENDED, {
          outcome: settled.outcome,
          loot: settled.loot,
          returnRoom: 'kingdom_room'
        });
      }

      if (defenderId) {
        this.sendToOwner(defenderId, NetworkMessage.SYSTEM_ANNOUNCEMENT, {
          message: this.announcementFor(settled.outcome, settled.loot)
        });
      }

      // The Town Center is a score, not a ruin: it comes back at full strength
      // so one raid cannot leave the defender permanently half-destroyed.
      const townCenter = defenderId ? this.townCenterOf(defenderId) : null;
      if (townCenter) townCenter.hp = townCenter.maxHp;

      if (defenderId) {
        void RaidService.syncTownCenterLevel(defenderId, this.townCenterLevelOf(defenderId));
      }
    } catch (err) {
      console.error(`❌ [KingdomRoom] Could not settle raid ${raidId}:`, err);
      // Do not retry in a tight loop: a failing transaction would hammer SQLite
      // every tick. The boot reconciler closes the row later if it is stuck.
      this.raidId = null;
      this.raidAttackerId = null;
    } finally {
      this.raidSettling = false;
    }
  }

  private announcementFor(outcome: string, loot: Resources): string {
    if (outcome === 'ATTACKER_WON') {
      return (
        'Vương quốc bị tập kích! Mất ' +
        `${loot.wood} gỗ, ${loot.food} lương, ${loot.gold} vàng, ${loot.stone} đá.`
      );
    }
    if (outcome === 'DEFENDER_WON') return 'Bạn đã đẩy lùi cuộc tập kích.';
    return 'Quân tập kích đã rút lui.';
  }

  /** Sends a message to every socket of one account in this room. */
  private sendToOwner<T>(ownerId: string, type: NetworkMessage, payload: T): void {
    this.clients.forEach((client) => {
      const auth = client.auth as Partial<RoomAuth> | undefined;
      if (auth?.userId === ownerId) client.send(type, payload);
    });
  }

  private townCenterOf(ownerId: string): BuildingState | null {
    let found: BuildingState | null = null;
    this.state.buildings.forEach((building: BuildingState) => {
      if (found) return;
      if (building.ownerId === ownerId && building.type === 'TOWN_CENTER') found = building;
    });
    return found;
  }

  private townCenterLevelOf(ownerId: string): number {
    return this.townCenterOf(ownerId)?.level ?? 0;
  }

  private removeUnitsOf(ownerId: string): void {
    for (const unit of this.unitsOf(ownerId)) {
      this.state.units.delete(unit.id);
    }
  }

  private unitsOf(ownerId: string): UnitState[] {
    const units: UnitState[] = [];
    this.state.units.forEach((unit: UnitState) => {
      if (unit.ownerId === ownerId) units.push(unit);
    });
    return units;
  }
}


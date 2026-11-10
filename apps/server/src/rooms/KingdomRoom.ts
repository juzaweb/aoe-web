import { Client, ErrorCode, ServerError } from '@colyseus/core';
import {
  NetworkMessage,
  RAID_MAX_DURATION_MS,
  RAID_RETREAT_TIMEOUT_MS,
  RaidEndedPayload,
  RejectCode,
  Resources,
  citadelStatus,
  isCitadelBreached,
  zoneForOwner
} from '@chien-quoc/shared';
import { DatabaseService } from '../services/DatabaseService.js';
import { RaidService } from '../services/RaidService.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { arrivalPoint, ensurePortalFor, findOwnPortal } from './portals.js';
import {
  ensureCitadel,
  ensureCitadelEntity,
  evictForeignUnitsFromCitadel,
  restoreCitadel
} from './citadel.js';
import { claimSpectatorWatch } from './spectatorWatch.js';
import { WorldRoom } from './WorldRoom.js';
import { normalizeLocale, render, type Locale } from '../i18n/index.js';
import type { RoomAuth } from './identity.js';

/**
 * How close a unit must stand to its assigned point below the retreat gate to
 * count as withdrawn.
 *
 * Matches the movement step's own 0.15 arrival tolerance with room for the
 * separation shove, so a unit that has just arrived is never held back by a
 * few hundredths of a tile.
 */
const RETREAT_ARRIVAL_TOLERANCE = 0.35;

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
  /**
   * Whether the attacker has ordered a retreat and their army is walking to
   * the gate.
   *
   * A retreat is no longer an instant teleport: every surviving unit gets a
   * move order to the retreat gate, and the raid only closes once the whole
   * army stands there. This flag keeps the tick from settling early.
   */
  private raidRetreating = false;
  /**
   * The gate slot each retreating unit was ordered to.
   *
   * The unit's own `targetX/targetY` is not enough: a player can issue another
   * move after clicking retreat, and once that order finishes the target equals
   * the unit's position even though it is far from the gate. Keeping the slot
   * here means "at the gate" stays a question about the gate, not the last
   * order the unit received.
   */
  private readonly raidRetreatPoints = new Map<string, { x: number; y: number }>();

  static async onAuth(
    token: string | undefined,
    options?: { ownerId?: unknown; raidId?: unknown; spectate?: unknown }
  ): Promise<RoomAuth> {
    const auth = await super.onAuth(token);

    // A spectator names somebody else's kingdom. The static hook has no room
    // state, so the target and its Town Center are verified in `onJoin`.
    if (options?.spectate === true) {
      return auth;
    }

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
        'This kingdom belongs to a different account.'
      );
    }

    return auth;
  }

  onCreate(options: any) {
    super.onCreate(options);
    // I18N: `SET_LOCALE` is registered in `WorldRoom.onCreate` and stored in the
    // shared `localeBySession`, so this room is covered too.

    this.onCommandMessage(NetworkMessage.RAID_RETREAT, (client: Client) => {
      void this.handleRetreat(client);
    });
  }

  async onJoin(client: Client, options: any) {
    // I18N: remember the language before the first possible throw, so both the
    // raid and spectate paths can localize their refusals.
    const locale = normalizeLocale(options?.locale);
    if (locale) this.localeBySession.set(client.sessionId, locale);
    const raidId = typeof options?.raidId === 'string' ? options.raidId : '';

    // A watcher enters the same room as the defender, but takes no part in the
    // simulation: no player row, no starter base and no account session. That
    // separation is the whole feature, so it never falls through to the owner
    // path in `super.onJoin`.
    if (!raidId && options?.spectate === true) {
      await this.joinAsSpectator(client, options);
      return;
    }

    if (raidId) {
      const auth = client.auth as Partial<RoomAuth> | undefined;
      const defenderId = typeof options?.ownerId === 'string' ? options.ownerId : '';
      const raid = await RaidService.findRaid(raidId);

      // Three independent facts must hold: the raid is still live, this socket
      // owns the attacking side, and the room is the one being defended. The
      // status comes from the same row, so it cannot drift from the id check.
      //
      // APPLICATION_ERROR, not AUTH_FAILED: the token is fine, only the raid is
      // stale. A client that saw an auth code would drop the player's session
      // and send them back to the login screen.
      if (!raid || raid.attackerId !== auth?.userId || raid.defenderId !== defenderId) {
        throw new ServerError(
          ErrorCode.APPLICATION_ERROR,
          this.localizedFor(client, 'This raid is no longer valid.')
        );
      }
      if (raid.status !== 'ACTIVE') {
        throw new ServerError(
          ErrorCode.APPLICATION_ERROR,
          this.localizedFor(client, 'This raid has ended.')
        );
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

  /**
   * Read-only join for a spectator.
   *
   * The target is verified from the database rather than the client's word: the
   * account must exist, must have a Town Center, and must not be the viewer's
   * own kingdom. The room restore is awaited before the Town Center is checked,
   * so a stale cache cannot let a watcher into an empty map.
   */
  private async joinAsSpectator(client: Client, options: any): Promise<void> {
    const viewerId = (client.auth as Partial<RoomAuth> | undefined)?.userId;
    const ownerId = typeof options?.ownerId === 'string' ? options.ownerId : '';

    if (!viewerId || !ownerId) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'The kingdom to watch could not be resolved.')
      );
    }
    if (ownerId === viewerId) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'You are already in your own kingdom.')
      );
    }

    const target = await RaidService.findSpectateTarget(ownerId);
    if (!target || target.townCenterLevel <= 0) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'This kingdom does not exist or has no Town Center.')
      );
    }

    if (this.readyPromise) await this.readyPromise;
    if (this.worldRestoreError) {
      console.error('[KingdomRoom] World restore failed for spectator join:', this.worldRestoreError);
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'World restore failed. Please try again.')
      );
    }
    if (!this.isZoneOwner() || this.ownerScope !== ownerId) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'This map room has been replaced. Please rejoin.')
      );
    }
    if (!this.townCenterOf(ownerId)) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'This kingdom no longer has a Town Center to watch.')
      );
    }

    // Last check before committing: the account gets one watcher window, the
    // same way it gets one playing session. Taken after every throwable check so
    // a refused join never leaks the slot.
    if (!claimSpectatorWatch(viewerId, client.sessionId)) {
      throw new ServerError(
        ErrorCode.APPLICATION_ERROR,
        this.localizedFor(client, 'You are already watching another kingdom. Close that window first.')
      );
    }

    this.spectatorSessions.add(client.sessionId);
    this.spectatorViewers.set(client.sessionId, viewerId);
    console.log(`👁️  [KingdomRoom] ${viewerId} is spectating ${ownerId}.`);
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
      // A save from before the citadel existed gets its barracks and houses
      // retrofitted here, before any client can see the map.
      ensureCitadel(this.state, this.ownerScope);
      void RaidService.syncTownCenterLevel(this.ownerScope, this.townCenterLevelOf(this.ownerScope));
    }
  }

  protected afterTick(): void {
    // The simulation interval starts in `onCreate`, before the map has been
    // restored from SQLite. Judging a raid against an empty state would look
    // like a missing Town Center and settle it — deleting the attacker's army
    // from the database. Wait for the restore.
    if (!this.zoneReady) return;
    if (!this.raidId || this.raidSettling) return;
    void this.evaluateRaid();
  }

  /** Keeps the world-map level cache in step with a Town Center upgrade. */
  protected onBuildingUpgraded(building: BuildingState): void {
    if (!this.ownerScope || building.ownerId !== this.ownerScope) return;
    if (building.type === 'TOWN_CENTER') {
      void RaidService.syncTownCenterLevel(this.ownerScope, building.level);
    }
    const townCenter = this.townCenterOf(this.ownerScope);
    if (townCenter) {
      ensureCitadelEntity(this.state, this.ownerScope, townCenter);
    }
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
      // Phase 26: the raider's trainer and camp levels live in their own
      // kingdom rows, not in this room; load them before any unit maxHp is
      // derived so the army keeps the stats it was trained with.
      await this.hydrateBuildingLevels(ownerId);
      await this.hydrateTownCenterLevel(ownerId);
      const rows = await DatabaseService.loadZoneEntities(this.zoneId, ownerId);
      if (rows.length === 0) return;
      this.restoreSavedEntities(rows);
      this.bumpEntityIdsFromState();
      this.updatePlayerPopulation(ownerId);
      // The gate is sealed to non-owners: a raider army restored inside the
      // compound (an older save, or a raid that predates the rule) goes back out.
      evictForeignUnitsFromCitadel(this.state);
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

    // The raid scores the whole citadel: its eight buildings share one health
    // pool, and losing it at 20% is the attacker's win condition.
    const citadel = citadelStatus(
      Array.from(this.state.buildings.values()),
      townCenter.gridX,
      townCenter.gridY
    );
    if (isCitadelBreached(citadel.hp, citadel.maxHp)) {
      await this.settle(raidId, 'ATTACKER_WON');
      return;
    }

    // The whole army must reach the gate before it can leave; a single unit
    // still fighting or walking home keeps the raid open.
    if (this.raidRetreating && this.hasReachedRetreatGate(attackerId)) {
      await this.settle(raidId, 'RETREATED');
      return;
    }

    if (Date.now() - this.raidStartedAt >= (RAID_MAX_DURATION_MS ?? RAID_RETREAT_TIMEOUT_MS)) {
      await this.settle(raidId, 'RETREATED');
    }
  }

  /**
   * `RAID_RETREAT` from the attacker's own retreat gate.
   *
   * This only issues the march: every surviving unit walks to a slot below the
   * gate, and `evaluateRaid` closes the raid once the last one arrives. The
   * army is never deleted from a single click.
   */
  private async handleRetreat(client: Client): Promise<void> {
    const ownerId = (client.auth as Partial<RoomAuth> | undefined)?.userId;
    if (!this.raidId || ownerId !== this.raidAttackerId) {
      this.rejectCommand(client, 'You cannot retreat here.', RejectCode.FORBIDDEN);
      return;
    }

    const units = this.unitsOf(ownerId);
    if (units.length === 0) return;

    const portal =
      findOwnPortal(this.state, ownerId) ?? ensurePortalFor(this.state, ownerId);
    if (!portal) {
      this.rejectCommand(client, 'Retreat gate not found.', RejectCode.GONE);
      return;
    }

    this.raidRetreating = true;
    this.raidRetreatPoints.clear();
    units.forEach((unit, index) => {
      const point = arrivalPoint(portal, index, this.state);
      this.raidRetreatPoints.set(unit.id, point);
      this.moveUnitTo(unit, point.x, point.y);
    });
  }

  /** True when every surviving attacker unit stands at its gate slot. */
  private hasReachedRetreatGate(ownerId: string): boolean {
    const units = this.unitsOf(ownerId);
    if (units.length === 0) return false;

    return units.every((unit) => {
      const point = this.raidRetreatPoints.get(unit.id);
      if (!point) return false;
      return Math.hypot(unit.x - point.x, unit.y - point.y) <= RETREAT_ARRIVAL_TOLERANCE;
    });
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
      this.raidRetreating = false;
      this.raidRetreatPoints.clear();

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
          message: this.announcementFor(settled.outcome, settled.loot, defenderId)
        });
      }

      // The citadel is a score, not a ruin: every building comes back at full
      // strength so one raid cannot leave the defender permanently crippled.
      if (defenderId) {
        restoreCitadel(this.state, defenderId);
        void RaidService.syncTownCenterLevel(defenderId, this.townCenterLevelOf(defenderId));
      }
    } catch (err) {
      console.error(`❌ [KingdomRoom] Could not settle raid ${raidId}:`, err);
      // Do not retry in a tight loop: a failing transaction would hammer SQLite
      // every tick. The boot reconciler closes the row later if it is stuck.
      this.raidId = null;
      this.raidAttackerId = null;
      this.raidRetreating = false;
      this.raidRetreatPoints.clear();
    } finally {
      this.raidSettling = false;
    }
  }

  /**
   * I18N: raid announcements are looked up by outcome key and localized for the
   * defending side's session language; the English rendering is the fallback.
   */
  private announcementFor(outcome: string, loot: Resources, ownerId?: string): string {
    let locale: Locale | null = null;
    if (ownerId) {
      this.clients.forEach((client) => {
        if (locale) return;
        const auth = client.auth as Partial<RoomAuth> | undefined;
        if (auth?.userId === ownerId) locale = this.localeBySession.get(client.sessionId) ?? null;
      });
    }
    const fallback =
      outcome === 'ATTACKER_WON'
        ? `Your kingdom was raided! Lost ${loot.wood} wood, ${loot.food} food, ${loot.gold} gold, ${loot.stone} stone.`
        : outcome === 'DEFENDER_WON'
          ? 'You repelled the raid.'
          : 'The raiding army has withdrawn.';
    const key =
      outcome === 'ATTACKER_WON'
        ? 'raid.announce.attackerWon'
        : outcome === 'DEFENDER_WON'
          ? 'raid.announce.defenderWon'
          : 'raid.announce.retreated';
    return render(locale, {
      key,
      params: { wood: loot.wood, food: loot.food, gold: loot.gold, stone: loot.stone },
      fallback
    });
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


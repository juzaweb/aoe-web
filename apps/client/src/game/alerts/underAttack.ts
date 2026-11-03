/**
 * ATK-01: client-side detection of "this player is under attack".
 *
 * The server already replicates `hp` for units and buildings, so a loss of HP
 * can be detected entirely on the client by comparing the new value with the
 * last one seen for that entity. No protocol, schema or server change needed.
 *
 * This module is deliberately free of Phaser so it can be unit-tested in
 * isolation, like `render/ownerColor.ts`.
 */

export interface AttackPing {
  id: string;
  gx: number;
  gy: number;
  startedAt: number;
  until: number;
}

export interface DamageResult {
  damaged: boolean;
  ping: AttackPing | null;
  showBanner: boolean;
}

/**
 * Tracks HP per entity and decides when a hit on one of the player's own
 * entities should raise a banner and/or a minimap ping.
 */
export class UnderAttackTracker {
  private readonly lastHp = new Map<string, number>();
  private readonly pings = new Map<string, AttackPing>();
  private lastBannerAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly bannerCooldownMs: number = 4000,
    private readonly pingLifetimeMs: number = 4000
  ) {}

  /**
   * Record a (possibly new) HP value for an entity.
   *
   * The first call only stores the value; later calls compare. HP can go up
   * (construction finishing, upgrades) — only a strict decrease counts as damage.
   */
  record(
    entityId: string,
    ownerId: string,
    myOwnerId: string,
    hp: number,
    gx: number,
    gy: number,
    now: number
  ): DamageResult {
    const prev = this.lastHp.get(entityId);
    const damaged = prev !== undefined && hp < prev;

    // Always store, even for foreign owners and even before `myOwnerId` resolves,
    // so detection is correct once ownership is known.
    this.lastHp.set(entityId, hp);

    let ping: AttackPing | null = null;
    let showBanner = false;

    if (damaged && ownerId !== '' && ownerId === myOwnerId && myOwnerId !== '') {
      ping = {
        id: entityId,
        gx,
        gy,
        startedAt: now,
        until: now + this.pingLifetimeMs
      };
      // Overwrite any previous ping for the same entity.
      this.pings.set(entityId, ping);

      if (now - this.lastBannerAt >= this.bannerCooldownMs) {
        showBanner = true;
        this.lastBannerAt = now;
      }
    }

    return { damaged, ping, showBanner };
  }

  /** Drop tracking for one entity (on remove). */
  forget(entityId: string): void {
    this.lastHp.delete(entityId);
    this.pings.delete(entityId);
  }

  /** Active pings at `now`, pruning expired ones. */
  activePings(now: number): AttackPing[] {
    const result: AttackPing[] = [];
    for (const [id, ping] of this.pings) {
      if (ping.until > now) {
        result.push(ping);
      } else {
        this.pings.delete(id);
      }
    }
    return result;
  }

  /** Drop everything (room switch / reconnect). */
  clear(): void {
    this.lastHp.clear();
    this.pings.clear();
    this.lastBannerAt = Number.NEGATIVE_INFINITY;
  }
}

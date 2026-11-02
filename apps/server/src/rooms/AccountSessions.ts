export type ClaimOutcome = 'claimed' | 'occupied' | 'busy';

interface ActiveSession {
  sessionId: string;
  zone: string;
  closeSession: () => void;
  /**
   * Liveness is a property of the room that owns the session, not of the room
   * asking. Without this, a second tab in the other map would look at its own
   * (empty) client list, conclude the first session is dead, and take over.
   */
  isAlive: () => boolean;
}

/**
 * Which session currently owns each account, across every room.
 *
 * The old registry was per-room, which was correct while the whole game lived
 * in one `world_room`. Now an account can be in its kingdom room or the
 * battlefield room, and a second tab must not be able to hold the kingdom while
 * the first is on the battlefield. Keeping this process-wide also gives
 * takeover a way to close the superseded socket in whichever room holds it.
 */
export class AccountSessionCoordinator {
  private readonly activeByOwner = new Map<string, ActiveSession>();
  private readonly pendingByOwner = new Map<string, string>();
  /** Accounts whose client is in the middle of a room hand-off (travel). */
  private readonly handoffByOwner = new Map<string, string>();

  /**
   * Reserves the account for `sessionId`.
   *
   * `'occupied'` means another live session owns the account and no force
   * takeover was requested. `'busy'` means another join for the same account is
   * still in flight. A session that is no longer alive in its room is dropped
   * first, so a refresh never blocks itself.
   */
  claim(
    ownerId: string,
    sessionId: string,
    opts: { takeover: boolean; isAlive: (sessionId: string) => boolean; zone?: string }
  ): ClaimOutcome {
    const active = this.activeByOwner.get(ownerId);
    if (active && active.sessionId !== sessionId) {
      const activeAlive = active.isAlive ? active.isAlive() : opts.isAlive(active.sessionId);
      if (!activeAlive) this.activeByOwner.delete(ownerId);
    }

    const live = this.activeByOwner.get(ownerId);
    // Only the map the hand-off is heading to may claim without force.
    const handoff = opts.zone
      ? this.hasHandoff(ownerId, opts.zone)
      : this.handoffByOwner.has(ownerId);
    if (live && live.sessionId !== sessionId && !opts.takeover && !handoff) {
      return 'occupied';
    }

    const pending = this.pendingByOwner.get(ownerId);
    if (pending !== undefined && pending !== sessionId) {
      return 'busy';
    }

    this.pendingByOwner.set(ownerId, sessionId);
    return 'claimed';
  }

  /**
   * Commits the reservation. If another session owned the account, its close
   * callback runs after the swap, so its `onLeave` sees itself as superseded
   * and does not save over the new session's state.
   */
  activate(
    ownerId: string,
    sessionId: string,
    zone = '',
    closeSession: () => void = () => undefined,
    isAlive: () => boolean = () => true
  ): void {
    const previous = this.activeByOwner.get(ownerId);
    this.activeByOwner.set(ownerId, { sessionId, zone, closeSession, isAlive });
    this.pendingByOwner.delete(ownerId);
    this.handoffByOwner.delete(ownerId);

    if (previous && previous.sessionId !== sessionId) {
      try {
        previous.closeSession();
      } catch {
        // A socket already torn down is not an error for the new session.
      }
    }
  }

  release(ownerId: string, sessionId: string): void {
    if (this.pendingByOwner.get(ownerId) === sessionId) {
      this.pendingByOwner.delete(ownerId);
    }
    if (this.activeByOwner.get(ownerId)?.sessionId === sessionId) {
      this.activeByOwner.delete(ownerId);
    }
  }

  isActive(ownerId: string, sessionId: string): boolean {
    return this.activeByOwner.get(ownerId)?.sessionId === sessionId;
  }

  activeSession(ownerId: string): string | undefined {
    return this.activeByOwner.get(ownerId)?.sessionId;
  }

  activeZone(ownerId: string): string | undefined {
    return this.activeByOwner.get(ownerId)?.zone;
  }

  /**
   * Marks that this account is moving between rooms. The destination join may
   * then claim the account even if the source socket has not finished closing.
   */
  beginHandoff(ownerId: string, toZone: string): void {
    this.handoffByOwner.set(ownerId, toZone);
  }

  hasHandoff(ownerId: string, toZone: string): boolean {
    return this.handoffByOwner.get(ownerId) === toZone;
  }

  reset(): void {
    this.activeByOwner.clear();
    this.pendingByOwner.clear();
    this.handoffByOwner.clear();
  }
}

export const accountSessions = new AccountSessionCoordinator();

/**
 * The last save started by each account's room. A destination room awaits it
 * before reading the account, so a travel join can never observe a half-written
 * empire even if the source leave is still flushing.
 */
class AccountSaveTracker {
  private readonly pending = new Map<string, Promise<void>>();

  track(ownerId: string, save: Promise<void>): void {
    const current = this.pending.get(ownerId);
    const chained = current ? current.catch(() => undefined).then(() => save) : save;
    this.pending.set(ownerId, chained);
    void chained.finally(() => {
      if (this.pending.get(ownerId) === chained) this.pending.delete(ownerId);
    });
  }

  async awaitPending(ownerId: string): Promise<void> {
    await this.pending.get(ownerId)?.catch(() => undefined);
  }

  reset(): void {
    this.pending.clear();
  }
}

export const accountSaves = new AccountSaveTracker();

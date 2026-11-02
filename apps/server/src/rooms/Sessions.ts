export type ClaimOutcome = 'claimed' | 'occupied' | 'busy';

/**
 * Which session currently owns each account, and which join (if any) is
 * reserving it right now. One instance per room; all state is in memory, so a
 * room dispose clears it together with the world.
 */
export class SessionRegistry {
  private readonly activeByOwner = new Map<string, string>();
  private readonly pendingByOwner = new Map<string, string>();

  /**
   * Reserves the account for `sessionId`.
   *
   * - `'claimed'` — reservation held; the caller must call `activate()` or `release()`.
   * - `'occupied'` — another session owns the account and `takeover` is false (D1).
   * - `'busy'` — another join for the same account is mid-flight; retry later.
   *
   * `isAlive` lets the caller drop an owner whose socket is already gone (a
   * refresh closes the old socket before the new page joins), so a refresh is
   * never blocked by its own predecessor.
   */
  claim(
    ownerId: string,
    sessionId: string,
    opts: { takeover: boolean; isAlive: (sessionId: string) => boolean }
  ): ClaimOutcome {
    // A dead owner is no owner: clear it before deciding, so the next join is
    // treated as a plain re-entry rather than needing force takeover.
    const active = this.activeByOwner.get(ownerId);
    if (active !== undefined && active !== sessionId && !opts.isAlive(active)) {
      this.activeByOwner.delete(ownerId);
    }

    const live = this.activeByOwner.get(ownerId);
    if (live !== undefined && live !== sessionId && !opts.takeover) {
      return 'occupied';
    }

    const pending = this.pendingByOwner.get(ownerId);
    if (pending !== undefined && pending !== sessionId) {
      return 'busy';
    }

    this.pendingByOwner.set(ownerId, sessionId);
    return 'claimed';
  }

  /** Commits a reservation: `sessionId` becomes the account's live session. */
  activate(ownerId: string, sessionId: string): void {
    // Always overwrites: this is also the takeover path, where the previous
    // active session must lose the account before its socket is closed.
    this.activeByOwner.set(ownerId, sessionId);
    this.pendingByOwner.delete(ownerId);
  }

  /** Rolls a failed join back, or clears the entry when the active session leaves. */
  release(ownerId: string, sessionId: string): void {
    // Only the owner of an entry may clear it. A superseded session releasing
    // late must not delete the active entry that replaced it.
    if (this.pendingByOwner.get(ownerId) === sessionId) {
      this.pendingByOwner.delete(ownerId);
    }
    if (this.activeByOwner.get(ownerId) === sessionId) {
      this.activeByOwner.delete(ownerId);
    }
  }

  isActive(ownerId: string, sessionId: string): boolean {
    return this.activeByOwner.get(ownerId) === sessionId;
  }

  activeSession(ownerId: string): string | undefined {
    return this.activeByOwner.get(ownerId);
  }
}

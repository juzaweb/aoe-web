/**
 * One spectator window per account, process-wide.
 *
 * Spectating deliberately skips the account-session claim, because the viewer is
 * already playing their own kingdom in another room. That leaves nothing to stop
 * a logged-in client from opening a read-only room for every empire it can name,
 * and each of those rooms runs a simulation interval, an autosave timer and a
 * world restore. This registry restores the one-room-per-account ceiling for the
 * spectator side without touching the player session.
 *
 * Keyed by account id, not session id: a reconnect is still the same viewer.
 */
const watchedBy = new Map<string, string>();

/**
 * Reserves the viewer's single spectator slot.
 *
 * @returns false when another live session already holds it.
 */
export function claimSpectatorWatch(viewerId: string, sessionId: string): boolean {
  const current = watchedBy.get(viewerId);
  if (current !== undefined && current !== sessionId) return false;
  watchedBy.set(viewerId, sessionId);
  return true;
}

/** Releases the slot only when this session is the one holding it. */
export function releaseSpectatorWatch(viewerId: string, sessionId: string): void {
  if (watchedBy.get(viewerId) === sessionId) watchedBy.delete(viewerId);
}

/** Clears the registry. Used by tests; a live process owns its entries. */
export function resetSpectatorWatch(): void {
  watchedBy.clear();
}

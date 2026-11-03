/**
 * Whether an app that just came back to the foreground should rejoin its room.
 *
 * Phones lock their screen and switch apps constantly; every one of those
 * suspends the WebSocket, the server releases the account session, and the tab
 * comes back with no room. Rejoining automatically is the difference between
 * "the game paused" and "the game logged me out". It must never fight a session
 * that is genuinely someone else's, though, so every path where the account is
 * known to be taken or where the player deliberately left returns false.
 */
export interface ResumeState {
  /** The player is logged in (a token exists and was validated). */
  hasUser: boolean;
  /** A room is joined. */
  isJoined: boolean;
  /** A join is already in flight; a second one would be refused by the server. */
  isJoining: boolean;
  /** The server refused this account because another device holds it. */
  sessionTaken: boolean;
  /** The player pressed logout; a background rejoin would undo that. */
  isLeaving: boolean;
  /** The page is in the foreground. A hidden tab must not open sockets. */
  isVisible: boolean;
  /** A map switch is running; that path owns the join. */
  isSwitchingZone?: boolean;
  /** A failed map switch is on screen; retrying belongs to its own button. */
  hasSwitchError?: boolean;
}

/**
 * Number of join attempts a resume makes before giving up, and the delay between
 * them.
 *
 * Mobile check-in is not immediate: the server may still hold the previous socket
 * for a moment after the screen was locked, so the first join can be refused as
 * "session in use" when it is really the same phone coming back. Retrying briefly
 * avoids showing the takeover screen to the person who never left.
 */
export const RESUME_ATTEMPTS = 3;
export const RESUME_RETRY_DELAY_MS = 700;

export function shouldAutoReconnect(state: ResumeState): boolean {
  if (!state.hasUser) return false;
  if (!state.isVisible) return false;
  if (state.isJoined) return false;
  if (state.isJoining) return false;
  if (state.sessionTaken) return false;
  if (state.isLeaving) return false;
  if (state.isSwitchingZone) return false;
  if (state.hasSwitchError) return false;
  return true;
}

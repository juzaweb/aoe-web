import { describe, expect, it } from 'vitest';
import { RESUME_ATTEMPTS, RESUME_RETRY_DELAY_MS, shouldAutoReconnect } from './resume.js';

const base = {
  hasUser: true,
  isJoined: false,
  isJoining: false,
  sessionTaken: false,
  isLeaving: false,
  isVisible: true
};

describe('shouldAutoReconnect', () => {
  it('rejoins a logged-in player whose room dropped while the app was away', () => {
    expect(shouldAutoReconnect(base)).toBe(true);
  });

  it('does nothing while the tab is hidden', () => {
    expect(shouldAutoReconnect({ ...base, isVisible: false })).toBe(false);
  });

  it('does nothing for a player who never logged in', () => {
    expect(shouldAutoReconnect({ ...base, hasUser: false })).toBe(false);
  });

  it('does not race an existing join', () => {
    expect(shouldAutoReconnect({ ...base, isJoined: true })).toBe(false);
    expect(shouldAutoReconnect({ ...base, isJoining: true })).toBe(false);
  });

  it('never fights a session that another device owns', () => {
    // The takeover screen is the only way out of this state, by design.
    expect(shouldAutoReconnect({ ...base, sessionTaken: true })).toBe(false);
  });

  it('respects a deliberate logout', () => {
    expect(shouldAutoReconnect({ ...base, isLeaving: true })).toBe(false);
  });

  it('leaves a map switch and its error screen to their own buttons', () => {
    expect(shouldAutoReconnect({ ...base, isSwitchingZone: true })).toBe(false);
    expect(shouldAutoReconnect({ ...base, hasSwitchError: true })).toBe(false);
  });
});

describe('resume retry policy', () => {
  it('retries a few times with a delay long enough for the server to release the old socket', () => {
    expect(RESUME_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(RESUME_ATTEMPTS).toBeLessThanOrEqual(5);
    expect(RESUME_RETRY_DELAY_MS).toBeGreaterThanOrEqual(300);
  });
});

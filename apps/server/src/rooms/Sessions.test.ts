import { describe, expect, it } from 'vitest';
import { SessionRegistry } from './Sessions.js';

const alive = (...ids: string[]) => (sessionId: string) => ids.includes(sessionId);

describe('SessionRegistry', () => {
  it('reserves an account without activating it', () => {
    const sessions = new SessionRegistry();

    expect(sessions.claim('user-1', 'session-1', { takeover: false, isAlive: () => true })).toBe(
      'claimed'
    );
    expect(sessions.activeSession('user-1')).toBeUndefined();
  });

  it('rejects a second session while the first is active', () => {
    const sessions = new SessionRegistry();
    sessions.claim('user-1', 'session-1', { takeover: false, isAlive: alive('session-1') });
    sessions.activate('user-1', 'session-1');

    expect(sessions.claim('user-1', 'session-2', { takeover: false, isAlive: alive('session-1') })).toBe(
      'occupied'
    );
    expect(sessions.activeSession('user-1')).toBe('session-1');
  });

  it('lets force takeover reserve an occupied account and swap on activate', () => {
    const sessions = new SessionRegistry();
    sessions.claim('user-1', 'session-1', { takeover: false, isAlive: alive('session-1') });
    sessions.activate('user-1', 'session-1');

    expect(sessions.claim('user-1', 'session-2', { takeover: true, isAlive: alive('session-1') })).toBe(
      'claimed'
    );
    expect(sessions.activeSession('user-1')).toBe('session-1');

    sessions.activate('user-1', 'session-2');
    expect(sessions.activeSession('user-1')).toBe('session-2');
    expect(sessions.isActive('user-1', 'session-1')).toBe(false);
  });

  it('reports a concurrent join for the same account as busy', () => {
    const sessions = new SessionRegistry();

    expect(sessions.claim('user-1', 'session-1', { takeover: false, isAlive: () => true })).toBe(
      'claimed'
    );
    expect(sessions.claim('user-1', 'session-2', { takeover: false, isAlive: () => true })).toBe(
      'busy'
    );
  });

  it('releases the reservation of a failed join', () => {
    const sessions = new SessionRegistry();
    sessions.claim('user-1', 'session-1', { takeover: false, isAlive: () => true });
    sessions.release('user-1', 'session-1');

    expect(sessions.claim('user-1', 'session-2', { takeover: false, isAlive: () => true })).toBe(
      'claimed'
    );
  });

  it('does not clear the new active session when a superseded one releases', () => {
    const sessions = new SessionRegistry();
    sessions.claim('user-1', 'session-1', { takeover: false, isAlive: () => true });
    sessions.activate('user-1', 'session-1');
    sessions.claim('user-1', 'session-2', { takeover: true, isAlive: () => true });
    sessions.activate('user-1', 'session-2');

    sessions.release('user-1', 'session-1');

    expect(sessions.activeSession('user-1')).toBe('session-2');
  });

  it('allows a claim without takeover when the active socket is gone', () => {
    const sessions = new SessionRegistry();
    sessions.claim('user-1', 'session-1', { takeover: false, isAlive: () => true });
    sessions.activate('user-1', 'session-1');

    expect(sessions.claim('user-1', 'session-2', { takeover: false, isAlive: () => false })).toBe(
      'claimed'
    );
    sessions.activate('user-1', 'session-2');
    expect(sessions.activeSession('user-1')).toBe('session-2');
  });

  it('reports the active session only', () => {
    const sessions = new SessionRegistry();
    sessions.claim('user-1', 'session-1', { takeover: false, isAlive: () => true });
    sessions.activate('user-1', 'session-1');

    expect(sessions.isActive('user-1', 'session-1')).toBe(true);
    expect(sessions.isActive('user-1', 'session-2')).toBe(false);
    expect(sessions.isActive('user-2', 'session-1')).toBe(false);
  });
});

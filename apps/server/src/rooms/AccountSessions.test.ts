import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountSaves, accountSessions } from './AccountSessions.js';

const alive = () => true;
const dead = () => false;

describe('AccountSessionCoordinator', () => {
  beforeEach(() => {
    accountSessions.reset();
    accountSaves.reset();
  });

  it('rejects a second tab even when it sits in the other room', () => {
    accountSessions.claim('user-1', 'session-1', { takeover: false, isAlive: alive });
    // Registered by the kingdom room, not by the battlefield room asking now.
    accountSessions.activate('user-1', 'session-1', 'kingdom:user-1', () => undefined, alive);

    expect(
      accountSessions.claim('user-1', 'session-2', {
        takeover: false,
        isAlive: dead, // the battlefield room does not know this session
        zone: 'battlefield'
      })
    ).toBe('occupied');
    expect(accountSessions.activeSession('user-1')).toBe('session-1');
  });

  it('closes the superseded socket in whichever room owns it', () => {
    const close = vi.fn();
    accountSessions.activate('user-1', 'session-1', 'kingdom:user-1', close, alive);

    accountSessions.claim('user-1', 'session-2', { takeover: true, isAlive: alive });
    accountSessions.activate('user-1', 'session-2', 'battlefield', () => undefined, alive);

    expect(close).toHaveBeenCalledTimes(1);
    expect(accountSessions.activeZone('user-1')).toBe('battlefield');
  });

  it('lets a travel hand-off claim only the destination zone', () => {
    accountSessions.activate('user-1', 'session-1', 'kingdom:user-1', () => undefined, alive);
    accountSessions.beginHandoff('user-1', 'battlefield');

    expect(
      accountSessions.claim('user-1', 'session-2', {
        takeover: false,
        isAlive: alive,
        zone: 'battlefield'
      })
    ).toBe('claimed');
  });

  it('does not clear a successor when the old session releases late', () => {
    accountSessions.activate('user-1', 'session-1', 'kingdom:user-1', () => undefined, alive);
    accountSessions.activate('user-1', 'session-2', 'battlefield', () => undefined, alive);

    accountSessions.release('user-1', 'session-1');

    expect(accountSessions.activeSession('user-1')).toBe('session-2');
  });

  it('reports a live session only while its room says it is alive', () => {
    expect(accountSessions.hasLiveSession('user-1')).toBe(false);

    accountSessions.activate('user-1', 'session-1', 'kingdom:user-1', () => undefined, alive);
    expect(accountSessions.hasLiveSession('user-1')).toBe(true);

    accountSessions.activate('user-1', 'session-2', 'battlefield', () => undefined, dead);
    expect(accountSessions.hasLiveSession('user-1')).toBe(false);
    // A stale entry is dropped so a later join does not see a dead owner.
    expect(accountSessions.activeSession('user-1')).toBeUndefined();
  });
});

describe('accountSaves', () => {
  beforeEach(() => accountSaves.reset());

  it('awaits the last tracked save for an account', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    accountSaves.track('user-1', pending);

    let settled = false;
    const wait = accountSaves.awaitPending('user-1').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolve();
    await wait;
    expect(settled).toBe(true);
  });
});

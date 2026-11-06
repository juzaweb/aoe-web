import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStoredRaid, getStoredRaid, storeRaid } from './session.js';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
});

describe('raid session storage', () => {
  it('round-trips a raid for one account', () => {
    storeRaid('user-1', { raidId: 'raid-1', defenderId: 'user-2' });
    expect(getStoredRaid('user-1')).toEqual({ raidId: 'raid-1', defenderId: 'user-2' });
  });

  it('keeps accounts apart', () => {
    storeRaid('user-1', { raidId: 'raid-1', defenderId: 'user-2' });
    expect(getStoredRaid('user-9')).toBeNull();
  });

  it('ignores a malformed record instead of throwing', () => {
    store.set('cq_raid:user-1', '{"raidId":42}');
    expect(getStoredRaid('user-1')).toBeNull();
    store.set('cq_raid:user-1', 'not json');
    expect(getStoredRaid('user-1')).toBeNull();
  });

  it('clears only the requested account', () => {
    storeRaid('user-1', { raidId: 'raid-1', defenderId: 'user-2' });
    storeRaid('user-2', { raidId: 'raid-2', defenderId: 'user-1' });
    clearStoredRaid('user-1');
    expect(getStoredRaid('user-1')).toBeNull();
    expect(getStoredRaid('user-2')).toEqual({ raidId: 'raid-2', defenderId: 'user-1' });
  });
});

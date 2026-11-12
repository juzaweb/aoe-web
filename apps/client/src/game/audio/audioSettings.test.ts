import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setCommandSoundEnabled, setUnderAttackAlertEnabled } = vi.hoisted(() => ({
  setCommandSoundEnabled: vi.fn(),
  setUnderAttackAlertEnabled: vi.fn()
}));

// The settings module owns the wiring, so the voices are stubbed: this suite is
// about "does the switch reach both of them", not about Web Audio itself.
vi.mock('./commandSound.js', () => ({ setCommandSoundEnabled }));
vi.mock('./alertSound.js', () => ({ setUnderAttackAlertEnabled }));

import {
  SOUND_CHANGED_EVENT,
  SOUND_STORAGE_KEY,
  applySoundEnabled,
  isSoundEnabled,
  setSoundEnabled,
  subscribeSound
} from './audioSettings.js';

const store = new Map<string, string>();

/**
 * The module only touches `window.localStorage` and `window.dispatchEvent`, so
 * a stub with those two members is a faithful enough window for a node test.
 */
function installWindow(overrides: Record<string, unknown> = {}): Event[] {
  const events: Event[] = [];
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    },
    dispatchEvent: (event: Event) => {
      events.push(event);
      return true;
    },
    ...overrides
  });
  return events;
}

beforeEach(() => {
  store.clear();
  setCommandSoundEnabled.mockClear();
  setUnderAttackAlertEnabled.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared sound switch (UIX-16)', () => {
  it('defaults to enabled when nothing has been stored', () => {
    installWindow();
    expect(isSoundEnabled()).toBe(true);
  });

  it('defaults to enabled without a window, and muting never throws', () => {
    // SSR and node tests have no `window` at all.
    expect(isSoundEnabled()).toBe(true);
    expect(() => setSoundEnabled(false)).not.toThrow();
  });

  it('does not throw when window exists but storage is unavailable', () => {
    vi.stubGlobal('window', {});
    expect(isSoundEnabled()).toBe(true);
    expect(() => setSoundEnabled(false)).not.toThrow();
    expect(setCommandSoundEnabled).toHaveBeenLastCalledWith(false);
  });

  it('reads the stored choice back', () => {
    installWindow();
    store.set(SOUND_STORAGE_KEY, 'off');
    expect(isSoundEnabled()).toBe(false);
    store.set(SOUND_STORAGE_KEY, 'on');
    expect(isSoundEnabled()).toBe(true);
  });

  it('persists the choice so it survives a reload', () => {
    installWindow();
    setSoundEnabled(false);
    expect(store.get(SOUND_STORAGE_KEY)).toBe('off');
    expect(isSoundEnabled()).toBe(false);

    setSoundEnabled(true);
    expect(store.get(SOUND_STORAGE_KEY)).toBe('on');
    expect(isSoundEnabled()).toBe(true);
  });

  it('treats a damaged stored value as enabled rather than muting the game', () => {
    installWindow();
    store.set(SOUND_STORAGE_KEY, 'maybe');
    expect(isSoundEnabled()).toBe(true);
  });

  it('applies the change to both voices immediately', () => {
    installWindow();
    setSoundEnabled(false);
    expect(setCommandSoundEnabled).toHaveBeenLastCalledWith(false);
    expect(setUnderAttackAlertEnabled).toHaveBeenLastCalledWith(false);

    setSoundEnabled(true);
    expect(setCommandSoundEnabled).toHaveBeenLastCalledWith(true);
    expect(setUnderAttackAlertEnabled).toHaveBeenLastCalledWith(true);
  });

  it('still reaches the voices when storage writes throw', () => {
    installWindow({
      localStorage: {
        getItem: () => {
          throw new Error('storage disabled');
        },
        setItem: () => {
          throw new Error('quota exceeded');
        }
      }
    });
    expect(isSoundEnabled()).toBe(true);
    expect(() => setSoundEnabled(false)).not.toThrow();
    expect(setCommandSoundEnabled).toHaveBeenLastCalledWith(false);
    expect(setUnderAttackAlertEnabled).toHaveBeenLastCalledWith(false);
  });

  it('notifies subscribers of every change and stops after unsubscribe', () => {
    installWindow();
    const listener = vi.fn();
    const unsubscribe = subscribeSound(listener);

    setSoundEnabled(false);
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
    setSoundEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one subscriber throws', () => {
    installWindow();
    const good = vi.fn();
    subscribeSound(() => {
      throw new Error('subscriber exploded');
    });
    subscribeSound(good);
    expect(() => setSoundEnabled(false)).not.toThrow();
    expect(good).toHaveBeenCalledWith(false);
  });

  it('announces the change on the window so modules that do not import this file can follow', () => {
    const events = installWindow();
    setSoundEnabled(false);

    const announced = events.find((event) => event.type === SOUND_CHANGED_EVENT);
    expect(announced).toBeDefined();
    expect((announced as CustomEvent<{ enabled: boolean }>).detail).toEqual({ enabled: false });
  });

  it('exposes the wiring so it can be re-applied without touching storage', () => {
    installWindow();
    applySoundEnabled(false);
    expect(setCommandSoundEnabled).toHaveBeenLastCalledWith(false);
    expect(setUnderAttackAlertEnabled).toHaveBeenLastCalledWith(false);
    expect(store.has(SOUND_STORAGE_KEY)).toBe(false);
  });
});

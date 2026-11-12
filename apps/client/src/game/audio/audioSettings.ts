/**
 * One switch for every sound the client makes.
 *
 * The game has two independent SFX sources — order acknowledgements and the
 * under-attack alert — and each keeps its own `setEnabled` flag. Neither flag
 * had a call site, so a player could only be silenced from code, and only half
 * of the game at that. This module owns the preference, persists it, and pushes
 * it into both voices the moment it changes: no reload, and no wiring inside
 * the game loop.
 *
 * `cq:sound` is dispatched for modules that never import this file (a Phaser
 * scene, for instance) but still need to follow the choice.
 */
import { setUnderAttackAlertEnabled } from './alertSound.js';
import { setCommandSoundEnabled } from './commandSound.js';

/** Short key because the value is read on every HUD mount. */
export const SOUND_STORAGE_KEY = 'cq.sound';

/** Fired after the preference changes; `detail.enabled` carries the new value. */
export const SOUND_CHANGED_EVENT = 'cq:sound';

export type SoundListener = (enabled: boolean) => void;

const listeners = new Set<SoundListener>();

/**
 * Storage is missing under SSR and in tests, and throws in private mode when
 * the quota is zero. Every failure falls back to "on": losing the preference
 * must neither silence the game nor break a render.
 */
function readStored(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return readStored();
}

/**
 * Pushes the choice into both synthesized voices. Exported so the wiring is
 * inspectable (and testable) instead of hiding inside `setSoundEnabled`.
 */
export function applySoundEnabled(enabled: boolean): void {
  setCommandSoundEnabled(enabled);
  setUnderAttackAlertEnabled(enabled);
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // A failed write only costs the choice surviving a reload.
    }
  }

  applySoundEnabled(enabled);

  listeners.forEach((listener) => {
    try {
      listener(enabled);
    } catch {
      // One broken subscriber must not starve the others.
    }
  });

  dispatchSoundEvent(enabled);
}

function dispatchSoundEvent(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(SOUND_CHANGED_EVENT, { detail: { enabled } }));
  } catch {
    // Embeds without `CustomEvent` still got the local listener calls above.
  }
}

/**
 * Follows the switch without polling. The callback is not invoked on
 * subscribe, so a caller keeps whatever value it already read.
 */
export function subscribeSound(listener: SoundListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Seed the voices at load: their enabled flags live in module singletons, so a
// reload has to re-apply the stored choice before the first order is issued.
applySoundEnabled(isSoundEnabled());

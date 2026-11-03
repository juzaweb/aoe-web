import { useEffect, useState } from 'react';
import { detectInputMode, isPortraitViewport, type InputMode } from './inputMode.js';

/** Reads the browser facts `detectInputMode` needs. Guards for non-DOM test runs. */
function readHints() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { maxTouchPoints: 0, coarsePointer: false, width: 1280 };
  }
  return {
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer:
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false,
    width: window.innerWidth
  };
}

/**
 * The UI input mode for this page load.
 *
 * Resolved once per session on purpose: the compact HUD and the desktop HUD are
 * different layouts, and swapping them mid-game (a rotation, a resized window)
 * would remount the panels under the player's finger. The mode only changes when
 * the coarse-pointer media query itself flips — i.e. a device actually switched
 * its primary pointer.
 */
export function useInputMode(): InputMode {
  const [mode, setMode] = useState<InputMode>(() => detectInputMode(readHints()));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(pointer: coarse)');
    const sync = () => setMode(detectInputMode(readHints()));
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  return mode;
}

/**
 * Whether the viewport is currently taller than it is wide.
 *
 * Re-reads on `resize` and `orientationchange`: the second event is what fires on
 * a phone that rotated before the browser settled its new size, and the first
 * covers tablets/desktop windows. `visualViewport` is not used here because the
 * on-screen keyboard resizes it and must not be mistaken for a rotation.
 */
export function useIsPortrait(): boolean {
  const [portrait, setPortrait] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : isPortraitViewport(window.innerWidth, window.innerHeight)
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => setPortrait(isPortraitViewport(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  return portrait;
}

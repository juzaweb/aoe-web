/**
 * Which input model the UI should be built for.
 *
 * `'touch'` is not "a phone": it means the primary pointer is a finger, so the
 * desktop HUD (hover tooltips, right-click hints, 64 px build buttons, a 140 px
 * minimap dock) does not fit and the touch command bar replaces it.
 */
export type InputMode = 'touch' | 'mouse';

/** The browser facts `detectInputMode` needs; passed in so it stays pure. */
export interface InputModeHints {
  /** `navigator.maxTouchPoints`, or 0 when unknown. */
  maxTouchPoints?: number;
  /** `matchMedia('(pointer: coarse)')`: the primary pointer is a finger. */
  coarsePointer?: boolean;
  /** Viewport width in CSS pixels. */
  width?: number;
}

/**
 * Apple's HIG minimum and Material's comfortable target: anything smaller than
 * this is a mis-tap waiting to happen with a thumb.
 */
export const MOBILE_MIN_TAP_PX = 44;

/**
 * Multiplier applied to every world-space hit box while the input is a finger.
 *
 * A fingertip contact patch is roughly 8-10 mm, which at typical phone pixel
 * densities is far wider than the mouse cursor the unit body ellipses were sized
 * for. A flat 1.5x keeps a tap on a unit's edge selecting it without letting two
 * adjacent units both match: `SelectionController` still picks the topmost.
 */
export const TOUCH_PICK_SLACK = 1.5;

/**
 * True when the primary pointer is coarse enough that hover affordances are
 * meaningless. Kept separate from `detectInputMode` because some call sites only
 * need this one bit (e.g. whether to render a hover tooltip at all).
 */
export function isCoarsePointer(hints: InputModeHints): boolean {
  return hints.coarsePointer === true;
}

/**
 * Decides the UI mode from browser facts.
 *
 * A coarse primary pointer (phone, tablet) is the reliable signal: a Windows
 * touch-screen laptop with a trackpad reports `maxTouchPoints > 0` but a *fine*
 * primary pointer, and must keep the desktop HUD. `maxTouchPoints` is only a
 * fallback for browsers that do not implement the media query, and then only
 * below the smallest desktop breakpoint so a wide hybrid window stays desktop.
 *
 * @param hints Browser facts; every field is optional so a partial environment
 *   (SSR, tests) degrades to `'mouse'` instead of throwing.
 */
export function detectInputMode(hints: InputModeHints): InputMode {
  const touchPoints = hints.maxTouchPoints ?? 0;
  const width = hints.width ?? Number.POSITIVE_INFINITY;

  if (isCoarsePointer(hints)) return 'touch';
  if (touchPoints > 0 && width < 900) return 'touch';
  return 'mouse';
}

/**
 * A viewport taller than it is wide. Squares count as landscape: a landscape
 * lock on a square viewport is not worth an overlay.
 */
export function isPortraitViewport(width: number, height: number): boolean {
  return height > width;
}

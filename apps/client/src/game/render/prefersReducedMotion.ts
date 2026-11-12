/**
 * UIX-13: the media query a player flips in their OS to ask for less animation.
 * Exported so callers and tests name the query once instead of repeating the
 * literal and drifting apart from `index.css`.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the player asked for reduced motion.
 *
 * Read on every call instead of cached at module load: the OS setting can flip
 * while the tab is open, and Phaser keeps drawing decals after that. Guarded
 * because these render helpers also run under Node (no `window`) and because an
 * embedded webview can lack `matchMedia` — an absent API means "no preference",
 * not "animations are fine to force".
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

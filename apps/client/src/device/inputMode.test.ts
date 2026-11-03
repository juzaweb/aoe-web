import { describe, expect, it } from 'vitest';
import {
  MOBILE_MIN_TAP_PX,
  TOUCH_PICK_SLACK,
  detectInputMode,
  isCoarsePointer,
  isPortraitViewport
} from './inputMode.js';

/**
 * Regression guard for the mobile UI split: a phone in a narrow window and a
 * Windows touch-screen laptop with a trackpad can both report
 * `maxTouchPoints > 0`, so the coarse-pointer check has to win.
 */
describe('detectInputMode', () => {
  it('treats a coarse primary pointer as touch', () => {
    expect(detectInputMode({ coarsePointer: true, maxTouchPoints: 5, width: 1280 })).toBe('touch');
  });

  it('keeps a touch-screen laptop with a fine pointer on the desktop HUD', () => {
    expect(detectInputMode({ coarsePointer: false, maxTouchPoints: 10, width: 1440 })).toBe('mouse');
  });

  it('falls back to touch points only below the desktop breakpoint', () => {
    expect(detectInputMode({ maxTouchPoints: 5, width: 844 })).toBe('touch');
    expect(detectInputMode({ maxTouchPoints: 5, width: 1024 })).toBe('mouse');
  });

  it('degrades to mouse when nothing is known', () => {
    expect(detectInputMode({})).toBe('mouse');
  });

  it('is a boolean, not the raw media-query value', () => {
    expect(isCoarsePointer({ coarsePointer: true })).toBe(true);
    expect(isCoarsePointer({ coarsePointer: false })).toBe(false);
    expect(isCoarsePointer({})).toBe(false);
  });
});

describe('isPortraitViewport', () => {
  it('is true only when taller than wide', () => {
    expect(isPortraitViewport(390, 844)).toBe(true);
    expect(isPortraitViewport(844, 390)).toBe(false);
    expect(isPortraitViewport(768, 768)).toBe(false);
  });
});

describe('touch constants', () => {
  it('keeps the tap target and the hit slack in a usable range', () => {
    // Below 44 px the HIG/Material guidance is violated; below 1x the touch path
    // would be no more forgiving than the mouse one.
    expect(MOBILE_MIN_TAP_PX).toBeGreaterThanOrEqual(44);
    expect(TOUCH_PICK_SLACK).toBeGreaterThan(1);
    expect(TOUCH_PICK_SLACK).toBeLessThan(2);
  });
});

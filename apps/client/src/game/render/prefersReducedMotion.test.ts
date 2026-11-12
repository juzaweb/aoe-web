import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, prefersReducedMotion } from './prefersReducedMotion.js';

/**
 * UIX-13: the media query is the only source of truth for the render code, and
 * the helpers also run under Node, so both branches and both "no browser API"
 * fallbacks are stubbed rather than assumed.
 */
function stubWindow(value: unknown): void {
  vi.stubGlobal('window', value);
}

describe('prefersReducedMotion (UIX-13)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the browser for the reduced-motion media query', () => {
    const matchMedia = vi.fn((_query: string) => ({ matches: true }));
    stubWindow({ matchMedia });

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('reports false when the OS setting is off', () => {
    stubWindow({ matchMedia: () => ({ matches: false }) });

    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports false without a window, for the Node test run', () => {
    stubWindow(undefined);

    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports false when the webview has no matchMedia', () => {
    stubWindow({});

    expect(prefersReducedMotion()).toBe(false);
  });

  it('re-reads the setting on every call instead of caching the first answer', () => {
    let matches = false;
    stubWindow({ matchMedia: () => ({ matches }) });

    expect(prefersReducedMotion()).toBe(false);
    matches = true;
    expect(prefersReducedMotion()).toBe(true);
  });
});

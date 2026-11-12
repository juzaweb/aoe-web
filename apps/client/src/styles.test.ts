import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UIX-13 / UIX-17: both fixes are rules in `index.css` that nothing else in the
 * suite can observe, so scan the stylesheet the way a reviewer would. JSDOM
 * does not evaluate `@media` queries or cascade, so asserting the mapping here
 * is the cheapest enforceable gate — the same trade-off `typography.test.ts`
 * takes for Tailwind class names.
 */
const INDEX_CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

const REDUCED_MOTION_BLOCK = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/;

function reducedMotionBlock(): string {
  return INDEX_CSS.match(REDUCED_MOTION_BLOCK)?.[1] ?? '';
}

describe('reduced motion stylesheet (UIX-13)', () => {
  it('has a prefers-reduced-motion block', () => {
    expect(reducedMotionBlock()).not.toBe('');
  });

  it('targets exactly the three looping animations', () => {
    const selectors = Array.from(reducedMotionBlock().matchAll(/\.animate-[a-z]+/g)).map((match) => match[0]);

    expect(selectors).toEqual(['.animate-bounce', '.animate-pulse', '.animate-spin']);
  });

  it('stops the animation without hiding the element', () => {
    const block = reducedMotionBlock();

    expect(block).toMatch(/animation:\s*none/);
    // Final readable state, not a removed element: hiding these would delete
    // information (loading, a live threat, a refused order).
    expect(block).not.toMatch(/display:\s*none/);
    expect(block).not.toMatch(/visibility:\s*hidden/);
    expect(block).not.toMatch(/opacity:\s*0\b/);
  });

  it('does not blanket-disable every animation in the app', () => {
    expect(reducedMotionBlock()).not.toMatch(/(^|\s)\*\s*\{/);
  });
});

describe('focus-visible ring (UIX-17)', () => {
  it('draws a 2px amber outline offset by 2px', () => {
    expect(INDEX_CSS).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid #f59e0b;/);
    expect(INDEX_CSS).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*2px;/);
  });

  it('uses :focus-visible only, so a mouse click draws no ring', () => {
    expect(INDEX_CSS).not.toMatch(/:focus\s*\{/);
  });
});

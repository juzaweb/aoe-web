import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UIX-12 / UIX-17 on the two full-screen auth layers. Both fixes live in
 * Tailwind class strings, so a source scan is the enforceable gate: rendered
 * output is not available in the Node test environment, and a reviewer greps
 * for exactly these tokens.
 */
const COMPONENTS_DIR = dirname(fileURLToPath(import.meta.url));

const AUTH = readFileSync(join(COMPONENTS_DIR, 'AuthScreen.tsx'), 'utf8');
const BLOCKED = readFileSync(join(COMPONENTS_DIR, 'SessionBlocked.tsx'), 'utf8');

/** The class list of the block that introduces `marker`, taken from just before it. */
function blockBefore(source: string, marker: string): string {
  const index = source.indexOf(marker);
  expect(index).toBeGreaterThan(-1);
  return source.slice(Math.max(0, index - 300), index);
}

describe('auth surfaces — focus ring (UIX-17)', () => {
  it('lets the global :focus-visible ring through on every input', () => {
    // `focus:outline-none` outranks the global rule on specificity, so it would
    // silently leave keyboard players with no visible focus at all.
    expect(AUTH).not.toContain('focus:outline-none');
    expect(BLOCKED).not.toContain('focus:outline-none');
  });

  it('keeps the border-colour change as the secondary cue', () => {
    expect(AUTH.match(/focus:border-amber-400/g)).toHaveLength(3);
  });

  it('does not clip the outline: no overflow-hidden around the form', () => {
    // The ring is offset 2px + 2px wide; these panels scroll with `overflow-y-auto`
    // and pad the form, so the ring fits inside the padding box.
    expect(AUTH).not.toContain('overflow-hidden');
    expect(BLOCKED).not.toContain('overflow-hidden');
  });
});

describe('auth surfaces — contrast (UIX-12)', () => {
  it('uses no information-carrying text-slate-500', () => {
    expect(AUTH).not.toMatch(/text-slate-500/);
    expect(BLOCKED).not.toMatch(/text-slate-500/);
  });

  it('lifts the encrypted-password note to slate-400', () => {
    const block = blockBefore(AUTH, 'auth.passwordEncrypted');

    expect(block).toContain('text-slate-400');
    expect(block).not.toContain('text-slate-500');
  });

  it('lifts the session note to slate-400', () => {
    const block = blockBefore(BLOCKED, 'session.note');

    expect(block).toContain('text-slate-400');
    expect(block).not.toContain('text-slate-500');
  });

  it('leaves placeholder-slate-500 alone, a placeholder is not information', () => {
    expect(AUTH.match(/placeholder-slate-500/g)).toHaveLength(3);
  });
});

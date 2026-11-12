import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UIX-09 / UIX-14 / UIX-15 / UIX-12 regression guard.
 *
 * These four overlays are plain JSX with no renderer in this suite, so the gate
 * is a source scan — the same thing a reviewer would grep for, run on every
 * commit instead. Behaviour of the trap itself is covered in
 * `useModalFocus.test.ts`.
 */
const COMPONENTS_DIR = dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(resolve(COMPONENTS_DIR, name), 'utf8');
}

/** Counts non-overlapping occurrences without allocating a match array per call. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('overlay dialog semantics (UIX-09)', () => {
  it('every overlay drives its modal behaviour from the shared hook', () => {
    for (const name of [
      'WorldMapOverlay.tsx',
      'SpectatorOverlay.tsx',
      'BuildMenu.tsx',
      'Minimap.tsx'
    ]) {
      const text = source(name);
      expect(text, name).toContain("from './useModalFocus.js'");
      expect(text, name).toMatch(/useModalFocus\(/);
    }
  });

  it('the world map exposes a labelled modal dialog', () => {
    const text = source('WorldMapOverlay.tsx');

    expect(text).toContain('ref={containerRef}');
    expect(text).toContain('role="dialog"');
    expect(text).toContain('aria-modal="true"');
    expect(text).toContain('aria-labelledby={titleId}');
    // The label has to point at a real heading, not a copied string.
    expect(text).toContain('id={titleId}');
    expect(text).toMatch(/<h2\s+id=\{titleId\}/);
    expect(text).toContain('useModalFocus(containerRef, open, onClose)');
  });

  it('the spectator window exposes a labelled modal dialog', () => {
    const text = source('SpectatorOverlay.tsx');

    expect(text).toContain('ref={containerRef}');
    expect(text).toContain('role="dialog"');
    expect(text).toContain('aria-modal="true"');
    expect(text).toContain('aria-labelledby={titleId}');
    expect(text).toMatch(/<h2\s+id=\{titleId\}/);
    expect(text).toContain('useModalFocus(containerRef, true, onClose)');
  });

  it('the compact build sheet is a dialog only while it is open', () => {
    const text = source('BuildMenu.tsx');

    expect(text).toContain('ref={sheetRef}');
    expect(text).toContain('role="dialog"');
    expect(text).toContain('aria-modal="true"');
    expect(text).toContain('aria-labelledby={titleId}');
    expect(text).toMatch(/<h2\s+id=\{titleId\}/);
    expect(text).toContain('useModalFocus(sheetRef, open, () => setOpen(false))');
    // Mounted only inside `{open && (...)}`, which is what keeps the closed
    // sheet out of the accessibility tree.
    expect(text).toContain('{open && (');
  });

  it('the compact minimap panel is a dialog and the desktop radar is not', () => {
    const text = source('Minimap.tsx');

    expect(text).toContain('useModalFocus(panelRef, compact && open, () => setOpen(false))');
    expect(text).toContain('role="dialog"');
    expect(text).toContain('aria-modal="true"');
    expect(text).toContain('aria-labelledby={titleId}');
    expect(count(text, 'role="dialog"')).toBe(1);

    // Everything from the desktop return onwards is the dock tile: it must stay
    // a plain region, or the dock would announce itself as a modal dialog.
    const desktopBranch = text.slice(text.indexOf('data-minimap-desktop'));
    expect(desktopBranch.length).toBeGreaterThan(0);
    expect(desktopBranch).not.toContain('role="dialog"');
    expect(desktopBranch).not.toContain('aria-modal');
  });

  it('Escape is handled once, by the hook, instead of by a second listener', () => {
    for (const name of ['WorldMapOverlay.tsx', 'SpectatorOverlay.tsx']) {
      const text = source(name);
      expect(text, name).not.toContain("event.key === 'Escape'");
      expect(text, name).not.toContain("window.addEventListener('keydown'");
    }
  });
});

describe('compact tap targets (UIX-14)', () => {
  it('keeps the 36 px box but floors the minimap close button at 44 px', () => {
    const text = source('Minimap.tsx');

    expect(text).toContain('style={{ minHeight: 44, minWidth: 44 }}');
    expect(text).toContain('h-9 w-9');
  });

  it('floors the build sheet close button at 44 px', () => {
    const text = source('BuildMenu.tsx');

    expect(text).toContain('style={{ minHeight: 44, minWidth: 44 }}');
    expect(text).toContain('h-9 w-9');
  });

  it('raises both world map action buttons to 44 px', () => {
    const text = source('WorldMapOverlay.tsx');

    expect(count(text, 'min-h-[44px]')).toBe(2);
    expect(text).not.toContain('min-h-[42px]');
  });
});

describe('build sheet tooltips (UIX-15)', () => {
  it('opens the tooltip on hover, keyboard focus and a held finger', () => {
    const text = source('BuildMenu.tsx');

    expect(text).toContain('group-hover:opacity-100');
    expect(text).toContain('group-focus-within:opacity-100');
    expect(text).toContain('group-active:opacity-100');
  });

  it('wires the tooltip into the button as its description', () => {
    const text = source('BuildMenu.tsx');

    expect(text).toContain('aria-describedby={tooltipId}');
    expect(text).toContain('id={tooltipId}');
    expect(text).toContain('role="tooltip"');
    // The name is already the button's label; repeating it in the description
    // would make a screen reader say it twice.
    expect(text).toContain('aria-hidden="true"');
  });

  it('does not clip the tooltip on the sheet itself', () => {
    const text = source('BuildMenu.tsx');
    const sheetLine = text
      .split('\n')
      .find((line) => line.includes('aoe-panel absolute bottom-full'));

    expect(sheetLine).toBeDefined();
    // A scrolling or clipping sheet would swallow the tooltip that hangs above
    // the top row of tiles.
    expect(sheetLine).not.toContain('overflow-');
  });
});

describe('world map contrast (UIX-12)', () => {
  it('never uses slate-500 for informational text', () => {
    const text = source('WorldMapOverlay.tsx');
    // `disabled:text-slate-500` is the one legitimate use: a disabled control
    // is exempt from the AA contrast requirement.
    const informational = text.match(/(?<!disabled:)text-slate-500/g) ?? [];

    expect(informational).toEqual([]);
    expect(text).toContain('disabled:text-slate-500');
  });
});

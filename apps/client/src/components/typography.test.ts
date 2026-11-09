import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UIX-03 regression guard: the UI/UX plan raised every HUD label to an 11px
 * floor. A clamp in a shared component would be cleaner, but the HUD is plain
 * Tailwind classes, so the cheapest enforceable gate is a source scan — the same
 * thing a reviewer would grep for, run on every commit instead.
 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_FONT_PX = 11;

const TAILWIND_SIZE = /text-\[(\d+(?:\.\d+)?)px\]/g;
const SVG_FONT_SIZE = /fontSize=\{(\d+(?:\.\d+)?)\}/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [path] : [];
  });
}

function tooSmall(source: string, pattern: RegExp): number[] {
  return Array.from(source.matchAll(pattern))
    .map((match) => Number(match[1]))
    .filter((size) => size < MIN_FONT_PX);
}

describe('typography floor (UIX-03)', () => {
  const files = sourceFiles(SRC_ROOT).filter((path) => !path.endsWith('.test.ts'));

  it('has UI sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never sets a font below 11px in Tailwind classes', () => {
    const offenders = files
      .map((path) => ({ path, sizes: tooSmall(readFileSync(path, 'utf8'), TAILWIND_SIZE) }))
      .filter((entry) => entry.sizes.length > 0)
      .map((entry) => `${entry.path}: ${entry.sizes.join(', ')}`);

    expect(offenders).toEqual([]);
  });

  it('never sets an SVG font size below 11px', () => {
    const offenders = files
      .map((path) => ({ path, sizes: tooSmall(readFileSync(path, 'utf8'), SVG_FONT_SIZE) }))
      .filter((entry) => entry.sizes.length > 0)
      .map((entry) => `${entry.path}: ${entry.sizes.join(', ')}`);

    expect(offenders).toEqual([]);
  });
});

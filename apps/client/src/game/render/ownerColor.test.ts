import { beforeEach, describe, expect, it } from 'vitest';
import {
  OwnerColorRegistry,
  UNKNOWN_OWNER_COLOR,
  colorToCss,
  parseHexColor
} from './ownerColor.js';

describe('parseHexColor', () => {
  it('parses six-digit hex with and without the hash', () => {
    expect(parseHexColor('#3b82f6')).toBe(0x3b82f6);
    expect(parseHexColor('3b82f6')).toBe(0x3b82f6);
  });

  it('parses three-digit hex by doubling each digit', () => {
    expect(parseHexColor('#abc')).toBe(0xaabbcc);
    expect(parseHexColor('f0a')).toBe(0xff00aa);
  });

  it('accepts uppercase digits and surrounding whitespace', () => {
    expect(parseHexColor('  #EF4444 ')).toBe(0xef4444);
  });

  it('rejects anything that is not a plain hex colour', () => {
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor('   ')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#12')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#gggggg')).toBeNull();
    expect(parseHexColor('rgb(59, 130, 246)')).toBeNull();
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });
});

describe('colorToCss', () => {
  it('round-trips a parsed colour back to the six-digit form', () => {
    const parsed = parseHexColor('#3b82f6');
    expect(parsed).not.toBeNull();
    expect(colorToCss(parsed as number)).toBe('#3b82f6');
  });

  it('zero-pads dark colours', () => {
    expect(colorToCss(0x0000ff)).toBe('#0000ff');
  });
});

describe('OwnerColorRegistry', () => {
  let playerColors: Map<string, string>;

  beforeEach(() => {
    playerColors = new Map([
      ['alice', '#3b82f6'],
      ['bob', '#ef4444']
    ]);
  });

  const createRegistry = () => new OwnerColorRegistry((ownerId) => playerColors.get(ownerId));

  it('returns UNKNOWN for an owner that has never been seen', () => {
    const registry = createRegistry();
    expect(registry.colorOf('stranger')).toBe(UNKNOWN_OWNER_COLOR);
  });

  it('gives different owners their own colours', () => {
    const registry = createRegistry();
    expect(registry.colorOf('alice')).toBe(0x3b82f6);
    expect(registry.colorOf('bob')).toBe(0xef4444);
  });

  it('keeps the cached colour after the owner leaves the room', () => {
    const registry = createRegistry();
    expect(registry.colorOf('alice')).toBe(0x3b82f6);

    playerColors.delete('alice');
    expect(registry.colorOf('alice')).toBe(0x3b82f6);
  });

  it('resolves once and then serves the cached value', () => {
    let resolutions = 0;
    const registry = new OwnerColorRegistry((ownerId) => {
      resolutions++;
      return ownerId === 'alice' ? '#3b82f6' : null;
    });

    registry.colorOf('alice');
    registry.colorOf('alice');
    expect(resolutions).toBe(1);
  });

  it('re-resolves an owner that was unknown when first asked', () => {
    const colors = new Map<string, string>();
    const registry = new OwnerColorRegistry((ownerId) => colors.get(ownerId));

    expect(registry.colorOf('alice')).toBe(UNKNOWN_OWNER_COLOR);
    colors.set('alice', '#10b981');
    expect(registry.colorOf('alice')).toBe(0x10b981);
  });

  it('invalidate picks up a changed colour', () => {
    const registry = createRegistry();
    expect(registry.colorOf('alice')).toBe(0x3b82f6);

    playerColors.set('alice', '#f59e0b');
    registry.invalidate('alice');
    expect(registry.colorOf('alice')).toBe(0xf59e0b);
  });

  it('invalidateAll drops every cached owner', () => {
    const registry = createRegistry();
    expect(registry.colorOf('alice')).toBe(0x3b82f6);
    expect(registry.colorOf('bob')).toBe(0xef4444);

    registry.invalidateAll();
    playerColors.delete('alice');
    expect(registry.colorOf('alice')).toBe(UNKNOWN_OWNER_COLOR);
    expect(registry.colorOf('bob')).toBe(0xef4444);
  });

  it('falls back to UNKNOWN when the colour string is invalid', () => {
    const registry = new OwnerColorRegistry(() => 'not-a-colour');
    expect(registry.colorOf('alice')).toBe(UNKNOWN_OWNER_COLOR);
  });

  it('returns UNKNOWN for an empty owner id without throwing', () => {
    const registry = createRegistry();
    expect(() => registry.colorOf('')).not.toThrow();
    expect(registry.colorOf('')).toBe(UNKNOWN_OWNER_COLOR);
  });
});

import { describe, expect, it } from 'vitest';
import {
  accentClipKey,
  accentTint,
  createAccentSprite,
  paintAccent,
  syncAccent
} from './entityAccent.js';
import type { AccentHost, AccentSprite } from './entityAccent.js';
import { UNKNOWN_OWNER_COLOR } from './ownerColor.js';
import { unitActionAccentKey, unitActionAccentTexture, unitActionKey } from './unitDirections.js';

/** A sprite that records what the layer did to it, so the rules are observable. */
interface FakeSprite extends AccentSprite {
  plays: string[];
  tints: number[];
  scale: number;
}

function fakeSprite(): FakeSprite {
  return {
    visible: true,
    tintTopLeft: 0xffffff,
    anims: { currentAnim: null, timeScale: 1 },
    plays: [],
    tints: [],
    scale: 1,
    setVisible(visible: boolean) {
      this.visible = visible;
      return this;
    },
    setTint(color: number) {
      this.tintTopLeft = color;
      this.tints.push(color);
      return this;
    },
    setScale(scale: number) {
      this.scale = scale;
      return this;
    },
    play(key: string) {
      this.plays.push(key);
      this.anims.currentAnim = { key };
      return this;
    }
  };
}

function fakeHost(textures: string[], clips: string[]): AccentHost<FakeSprite> {
  return {
    textures: { exists: (key) => textures.includes(key) },
    anims: { exists: (key) => clips.includes(key) },
    add: { sprite: () => fakeSprite() }
  };
}

describe('accentClipKey', () => {
  it('suffixes the body clip so both read the same frame grid', () => {
    expect(accentClipKey(unitActionKey('ARCHER', 'walk', 0))).toBe('archer_walk_E_accent');
  });

  it('agrees with the key the loader registers for every action and facing', () => {
    for (const action of ['idle', 'walk', 'attack', 'death'] as const) {
      for (let direction = 0; direction < 8; direction += 1) {
        const body = unitActionKey('ARCHER', action, direction);
        const accent = accentClipKey(body);
        expect(accent).toBe(unitActionAccentKey('ARCHER', action, direction));
        expect(accent.startsWith(body)).toBe(true);
      }
    }
  });
});

describe('accentTint', () => {
  it('passes the owner colour straight through', () => {
    expect(accentTint(0xef4444)).toBe(0xef4444);
    expect(accentTint(0xffffff)).toBe(0xffffff);
  });

  it('falls back to the unknown-owner grey instead of leaving the mask white', () => {
    // An untinted accent is a white mask: without this the tunic would glow.
    expect(accentTint(undefined)).toBe(UNKNOWN_OWNER_COLOR);
    expect(accentTint(undefined)).not.toBe(0xffffff);
  });
});

describe('accent sheet naming', () => {
  it('puts the layer beside its body sheet, one suffix apart', () => {
    // WorldScene preloads this path and `assemble_archer_sheets.py` writes it;
    // the on-disk contract is `<unit>_<action>_accent.png`.
    expect(unitActionAccentTexture('ARCHER', 'walk')).toBe('unit_ARCHER_act_walk_accent');
  });
});

describe('createAccentSprite', () => {
  const texture = unitActionAccentTexture('ARCHER', 'idle');
  const clip = unitActionAccentKey('ARCHER', 'idle', 2);

  it('plays the first clip and seeds the tint from the owner', () => {
    const host = fakeHost([texture], [clip]);
    const sprite = createAccentSprite(host, 'ARCHER', 'idle', -58, 0.95, 0x3b82f6)!;
    expect(sprite.plays).toEqual([clip]);
    expect(sprite.tintTopLeft).toBe(0x3b82f6);
    expect(sprite.scale).toBe(0.95);
  });

  it('returns null when the unit ships no mask for that action', () => {
    expect(createAccentSprite(fakeHost([], []), 'ARCHER', 'idle', 0, 1, 0x3b82f6)).toBeNull();
  });

  it('never leaves the mask untinted', () => {
    const sprite = createAccentSprite(fakeHost([texture], [clip]), 'ARCHER', 'idle', 0, 1, undefined)!;
    expect(sprite.tintTopLeft).toBe(UNKNOWN_OWNER_COLOR);
  });
});

describe('paintAccent', () => {
  it('writes the tint once and skips repeats', () => {
    const accent = fakeSprite();
    paintAccent(accent, 0xef4444);
    paintAccent(accent, 0xef4444);
    expect(accent.tints).toEqual([0xef4444]);
  });

  it('repaints when the owner colour changes', () => {
    const accent = fakeSprite();
    paintAccent(accent, 0xef4444);
    paintAccent(accent, 0x22c55e);
    expect(accent.tintTopLeft).toBe(0x22c55e);
  });
});

describe('syncAccent', () => {
  const walk = unitActionKey('ARCHER', 'walk', 3);
  const walkAccent = accentClipKey(walk);

  it('plays the accent clip that mirrors the body clip', () => {
    const accent = fakeSprite();
    syncAccent(fakeHost([], [walkAccent]), accent, walk, 1);
    expect(accent.plays).toEqual([walkAccent]);
    expect(accent.visible).toBe(true);
  });

  it('does not restart a clip that is already playing', () => {
    const accent = fakeSprite();
    const host = fakeHost([], [walkAccent]);
    syncAccent(host, accent, walk, 1);
    syncAccent(host, accent, walk, 1);
    expect(accent.plays).toEqual([walkAccent]);
  });

  it('hides the layer when the body falls back to a clip with no mask', () => {
    // A unit drawn from the legacy single-facing sheet plays `archer_idle`,
    // which has no accent clip; a visible mask would leave a floating tunic.
    const accent = fakeSprite();
    syncAccent(fakeHost([], []), accent, 'archer_idle', 1);
    expect(accent.visible).toBe(false);
    expect(accent.plays).toEqual([]);
  });

  it('brings the layer back when the body returns to a masked clip', () => {
    const accent = fakeSprite();
    const host = fakeHost([], [walkAccent]);
    syncAccent(host, accent, 'archer_idle', 1);
    syncAccent(host, accent, walk, 1);
    expect(accent.visible).toBe(true);
  });

  it('copies the body playback rate so a speeding walk stays in step', () => {
    const accent = fakeSprite();
    syncAccent(fakeHost([], [walkAccent]), accent, walk, 1.7);
    expect(accent.anims.timeScale).toBe(1.7);
  });

  it('leaves the layer hidden while the body has no masked clip', () => {
    const accent = fakeSprite();
    accent.setVisible(false);
    const host = fakeHost([], []);
    syncAccent(host, accent, 'archer_idle', 1);
    expect(accent.visible).toBe(false);
  });
});

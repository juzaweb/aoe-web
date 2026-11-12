import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { HUD } from './HUD.js';
import i18n from '../i18n/index.js';

const CITADEL = { hp: 42.4, maxHp: 100, ratio: 0.424 };

function renderHud(overrides: Partial<React.ComponentProps<typeof HUD>> = {}): string {
  return renderToString(
    <HUD
      playerName="Emperor"
      playerColor="#3b82f6"
      zoneLabel="KINGDOM"
      wood={10}
      food={20}
      gold={30}
      stone={40}
      population={5}
      populationCap={20}
      isConnected
      idleVillagers={2}
      onSelectIdleVillager={() => {}}
      citadelStatus={CITADEL}
      {...overrides}
    />
  );
}

describe('HUD citadel label (UIX-11)', () => {
  it('renders the English label and tooltip', async () => {
    await i18n.changeLanguage('en');
    const html = renderHud();
    expect(html).toContain('CITADEL');
    // HP is rounded up: a citadel at 42.4 HP still has 43 points to chew through.
    expect(html).toContain('title="Citadel: 43 / 100 HP"');
  });

  it('renders the Vietnamese label and tooltip', async () => {
    await i18n.changeLanguage('vi');
    const html = renderHud();
    expect(html).toContain('THÀNH TRÌ');
    expect(html).toContain('title="Thành trì: 43 / 100 máu"');
  });

  it('keeps the low-health alert localized in both catalogs', async () => {
    // `CITADEL_HP_THRESHOLD` is 0: the warning icon marks a destroyed citadel.
    const destroyed = { hp: 0, maxHp: 100, ratio: 0 };

    await i18n.changeLanguage('en');
    const en = renderHud({ citadelStatus: destroyed });
    expect(en).toContain('aria-label="Citadel below the danger threshold"');

    await i18n.changeLanguage('vi');
    const vi = renderHud({ citadelStatus: destroyed });
    expect(vi).toContain('aria-label="Thành trì dưới ngưỡng nguy hiểm"');
  });
});

describe('HUD sound toggle (UIX-16)', () => {
  it('offers a pressed, labelled toggle in the desktop layout', async () => {
    await i18n.changeLanguage('en');
    const html = renderHud();
    expect(html).toContain('aria-label="Sound effects"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-sound-toggle="on"');
  });

  it('offers the same toggle in the compact layout, with a 44px tap target', async () => {
    await i18n.changeLanguage('en');
    const html = renderHud({ compact: true });
    expect(html).toContain('aria-label="Sound effects"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('min-width:44px');
  });

  it('localizes the toggle label', async () => {
    await i18n.changeLanguage('vi');
    const html = renderHud();
    expect(html).toContain('aria-label="Hiệu ứng âm thanh"');
  });

  it('shows the muted state, not just the stored flag', async () => {
    await i18n.changeLanguage('en');
    const on = renderHud();

    // `audioSettings` reads storage lazily on render, so a faked `window` is
    // enough to prove the icon and the pressed state follow the preference —
    // asserting only `data-sound-toggle` would pass even if the icon never
    // changed, which is the bug a player would actually notice.
    const singleton = globalThis as { window?: unknown };
    const previous = singleton.window;
    singleton.window = {
      localStorage: {
        getItem: (key: string) => (key === 'cq.sound' ? 'off' : null),
        setItem: () => {},
        removeItem: () => {}
      }
    };
    let off: string;
    try {
      off = renderHud();
    } finally {
      singleton.window = previous;
    }

    expect(off).toContain('data-sound-toggle="off"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('title="Turn sound on"');

    const icons = (html: string) => (html.match(/<svg[\s\S]*?<\/svg>/g) ?? []).join('');
    expect(icons(off)).not.toBe(icons(on));
  });
});

/**
 * Regression guard, same shape as `typography.test.ts`: the cheapest way to
 * keep a hardcoded Vietnamese label out of the HUD is to scan its source.
 */
describe('HUD source has no hardcoded Vietnamese (UIX-11)', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'HUD.tsx'), 'utf8');
  // Comments are allowed to mention the Vietnamese wording they explain.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('scans the real HUD source', () => {
    expect(source).toContain('export const HUD');
    expect(code).toContain("t('hud.citadel')");
    expect(code).toContain("t('hud.citadelTitle'");
  });

  it('keeps the citadel strings in the catalogs only', () => {
    expect(code).not.toMatch(/Thành trì/);
    expect(code).not.toMatch(/THÀNH TRÌ/);
  });

  it('leaves no Vietnamese literal anywhere in the component', () => {
    // Vietnamese-only letters: any hit outside a comment is a missed key.
    expect(code).not.toMatch(/[ăâđêôơư]/i);
  });
});

import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import i18n from '../i18n/index.js';
import { UnderAttackBanner } from './UnderAttackBanner.js';

describe('UnderAttackBanner live region (UIX-08)', () => {
  it('announces assertively, unlike the polite rejection toast', async () => {
    await i18n.changeLanguage('en');
    const html = renderToString(<UnderAttackBanner />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('data-under-attack-banner');
    expect(html).toContain('Under attack!');
  });

  it('keeps its icon out of the accessibility tree', async () => {
    await i18n.changeLanguage('en');
    const html = renderToString(<UnderAttackBanner />);

    expect(html).toContain('aria-hidden="true"');
  });

  it('follows the locale', async () => {
    await i18n.changeLanguage('vi');
    const html = renderToString(<UnderAttackBanner />);

    expect(html).toContain('Đang bị tấn công!');
  });

  it('does not swallow map clicks: it carries no control', async () => {
    await i18n.changeLanguage('en');
    const html = renderToString(<UnderAttackBanner />);

    // The band sits in the `pointer-events-none` stack. Nothing here is
    // pressable, so re-enabling pointer events would only create a dead zone
    // over the map for the four seconds the warning is up.
    expect(html).not.toContain('pointer-events-auto');
    expect(html).not.toContain('<button');
  });
});

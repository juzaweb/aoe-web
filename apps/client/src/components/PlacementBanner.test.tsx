import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { Resources } from '@chien-quoc/shared';
import i18n from '../i18n/index.js';
import { PlacementBanner } from './PlacementBanner.js';

const RICH: Resources = { wood: 500, food: 500, gold: 500, stone: 500 };

function renderRoad(compact = false): string {
  return renderToString(
    <PlacementBanner
      buildingType={null}
      roadMode="build"
      wallMode={null}
      resources={RICH}
      compact={compact}
      onCancel={vi.fn()}
    />
  );
}

describe('PlacementBanner live region scoping (UIX-08)', () => {
  it('keeps the Cancel button outside the announced region', async () => {
    await i18n.changeLanguage('en');
    const html = renderRoad();

    const liveStart = html.indexOf('aria-live="polite"');
    const buttonStart = html.indexOf('<button');
    expect(liveStart).toBeGreaterThan(-1);
    expect(buttonStart).toBeGreaterThan(liveStart);
    expect(html).toContain('role="status"');

    // Between the live region's attributes and the Cancel button every `<div>`
    // is closed again, plus the one that closes the live region itself. That is
    // what proves the control is a sibling of the region, not inside it.
    const between = html.slice(liveStart, buttonStart);
    const opens = (between.match(/<div\b/g) ?? []).length;
    const closes = (between.match(/<\/div>/g) ?? []).length;
    expect(closes).toBe(opens + 1);
  });

  it('hides the decorative icon from assistive technology', async () => {
    await i18n.changeLanguage('en');
    const html = renderRoad();

    expect(html).toMatch(/<span[^>]*aria-hidden="true"/);
    expect(html).toContain('data-placement-banner');
  });

  it('leaves positioning to TopOverlayStack', () => {
    const html = renderRoad();
    expect(html).not.toMatch(/\babsolute\b/);
  });

  it('keeps the 44px Cancel target on compact layouts', () => {
    expect(renderRoad(true)).toContain('min-height:44px');
    expect(renderRoad(false)).not.toContain('min-height:44px');
  });
});

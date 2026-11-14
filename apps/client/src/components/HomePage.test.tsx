import { describe, expect, it } from 'vitest';
import React from 'react';
import { HomePage } from './HomePage.js';
import i18n from '../i18n/index.js';
import { renderWithRouter } from '../test/renderWithRouter.js';

/** The landing page uses router links, so it needs a router in scope. */
function renderHome(): string {
  return renderWithRouter(<HomePage />);
}

describe('HomePage', () => {
  it('renders the English hero with an unprefixed homepage and /en/play links', async () => {
    await i18n.changeLanguage('en');
    const html = renderHome();

    expect(html).toContain('Build an empire.');
    expect(html).toContain('Conquer the world.');
    // English is the default locale: the homepage is `/`, the game is `/en/play`.
    expect(html).toContain('href="/en/play"');
    expect(html.match(/href="\/en\/play"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(html).toContain('href="/"');
  });

  it('renders the Vietnamese hero with the vi prefix and keeps the section anchors', async () => {
    await i18n.changeLanguage('vi');
    const html = renderHome();

    expect(html).toContain('Xây đế chế.');
    expect(html).toContain('Chinh phạt thiên hạ.');
    expect(html).toContain('href="/vi/play"');
    expect(html).toContain('href="/vi"');
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="#world"');
    expect(html).toContain('href="#how-to-play"');
  });

  it('uses the game art already shipped in public/assets', async () => {
    await i18n.changeLanguage('en');
    const html = renderHome();

    expect(html).toContain('/assets/buildings/town_center.png');
    expect(html).toContain('/assets/worldmap/world_map.png');
    expect(html).toContain('/assets/units/spearman_idle.png');
  });
});

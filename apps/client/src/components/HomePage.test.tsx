import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { HomePage } from './HomePage.js';
import i18n from '../i18n/index.js';

describe('HomePage', () => {
  it('renders the English hero and links every call to action to /play', async () => {
    await i18n.changeLanguage('en');
    const html = renderToString(<HomePage />);

    expect(html).toContain('Build an empire.');
    expect(html).toContain('Conquer the world.');
    expect(html).toContain('href="/play"');
    expect(html.match(/href="\/play"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('renders the Vietnamese hero and keeps the section anchors', async () => {
    await i18n.changeLanguage('vi');
    const html = renderToString(<HomePage />);

    expect(html).toContain('Xây đế chế.');
    expect(html).toContain('Chinh phạt thiên hạ.');
    expect(html).toContain('href="#features"');
    expect(html).toContain('href="#world"');
    expect(html).toContain('href="#how-to-play"');
  });

  it('uses the game art already shipped in public/assets', async () => {
    await i18n.changeLanguage('en');
    const html = renderToString(<HomePage />);

    expect(html).toContain('/assets/buildings/town_center.png');
    expect(html).toContain('/assets/worldmap/world_map.png');
    expect(html).toContain('/assets/units/spearman_idle.png');
  });
});

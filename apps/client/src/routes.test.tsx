import React from 'react';
import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { HomePage } from './components/HomePage.js';
import { routes } from './routes.js';

/** The id of the route the router would render for `path`, or null. */
function routeIdFor(path: string): string | null {
  return matchRoutes(routes, path)?.[0]?.route.id ?? null;
}

describe('route table', () => {
  it('serves the homepage in the locale the address names', () => {
    // `/` is a gate that forwards non-English visitors to their own homepage.
    expect(routeIdFor('/')).toBe('home:default');
    expect(routeIdFor('/vi')).toBe('home:vi');
  });

  it('serves the game in the locale the address names', () => {
    expect(routeIdFor('/en/play')).toBe('play:en');
    expect(routeIdFor('/vi/play')).toBe('play:vi');
  });

  it('routes the prefixed English homepage through the bare-root alias', () => {
    expect(routeIdFor('/en')).toBe('en-home-alias');
  });

  it('keeps the legacy unprefixed game link working', () => {
    expect(routeIdFor('/play')).toBe('legacy-play');
  });

  it('sends unknown paths to the fallback', () => {
    expect(routeIdFor('/unknown')).toBe('fallback');
    expect(routeIdFor('/vi/unknown')).toBe('fallback');
    expect(routeIdFor('/vi/play/extra')).toBe('fallback');
  });

  it('does not accept an unsupported locale as a screen', () => {
    expect(routeIdFor('/fr')).toBe('fallback');
    expect(routeIdFor('/fr/play')).toBe('fallback');
  });

  it('gives the bare root a gate rather than a fixed English page', () => {
    const root = routes.find((route) => route.id === 'home:default');

    // The landing page must not be the root element directly, and the root must
    // be a distinct component from the Vietnamese homepage's layout: the gate
    // has to decide the locale before anything is rendered.
    expect((root?.element as React.ReactElement).type).not.toBe(HomePage);
    expect((root?.element as React.ReactElement).type).not.toBe(
      (routes.find((route) => route.id === 'home:vi')?.element as React.ReactElement).type
    );
  });

  it('builds both game locales from the same element tree', () => {
    // Same component types in the same positions is what lets React update the
    // mounted tree in place when the language changes mid-game; a different
    // shape would remount `GameApp` and drop the Colyseus room.
    type Element = React.ReactElement<{ children?: React.ReactElement }>;
    const elementOf = (id: string) =>
      routes.find((route) => route.id === id)?.element as Element;

    expect(elementOf('play:vi').type).toBe(elementOf('play:en').type);
    expect(elementOf('play:vi').props.children?.type).toBe(
      elementOf('play:en').props.children?.type
    );
  });
});

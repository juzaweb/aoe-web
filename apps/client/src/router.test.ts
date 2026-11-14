import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_PATH,
  PLAY_PATH,
  ROUTE_CHANGED_EVENT,
  navigate,
  normalizePath,
  routeForPath
} from './router.js';

describe('route resolution', () => {
  it('maps the root path to the homepage', () => {
    expect(routeForPath('/')).toBe('home');
    expect(routeForPath('')).toBe('home');
  });

  it('maps /play to the game', () => {
    expect(routeForPath('/play')).toBe('play');
    expect(routeForPath('/play/')).toBe('play');
    expect(routeForPath('/play//')).toBe('play');
  });

  it('falls back to the homepage for unknown paths', () => {
    expect(routeForPath('/unknown')).toBe('home');
    expect(routeForPath('/player')).toBe('home');
  });

  it('exports the canonical paths', () => {
    expect(HOME_PATH).toBe('/');
    expect(PLAY_PATH).toBe('/play');
  });
});

describe('normalizePath', () => {
  it('keeps the root slash', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('///')).toBe('/');
  });

  it('trims trailing slashes from named paths', () => {
    expect(normalizePath('/play/')).toBe('/play');
    expect(normalizePath('/play')).toBe('/play');
  });
});

describe('navigate', () => {
  function stubWindow(pathname: string) {
    const pushState = vi.fn();
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname },
      history: { pushState, replaceState },
      dispatchEvent
    });
    return { pushState, replaceState, dispatchEvent };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushes the new path and notifies mounted views', () => {
    const { pushState, dispatchEvent } = stubWindow('/');

    navigate(PLAY_PATH);

    expect(pushState).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith({}, '', PLAY_PATH);
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(ROUTE_CHANGED_EVENT);
  });

  it('does nothing when the target is already current', () => {
    const { pushState, replaceState, dispatchEvent } = stubWindow('/play/');

    navigate(PLAY_PATH);

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('replaces the history entry when requested', () => {
    const { pushState, replaceState, dispatchEvent } = stubWindow('/play');

    navigate(HOME_PATH, { replace: true });

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith({}, '', HOME_PATH);
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});

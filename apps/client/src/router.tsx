/**
 * Minimal History-API router for the two public entry points.
 *
 * The client used to render the game at `/` with no routing layer at all.
 * Adding a whole router dependency for two paths would grow an already large
 * bundle (WATCH-02), so this keeps the contract small: `/` is the landing page,
 * `/play` is the game, and any other path falls back to the landing page.
 */
import React, { useEffect, useState } from 'react';

export type AppRoute = 'home' | 'play';

export const HOME_PATH = '/';
export const PLAY_PATH = '/play';

/** Dispatched after `navigate` so mounted views re-read the location. */
export const ROUTE_CHANGED_EVENT = 'cq:route-changed';

/** Strips a trailing slash so `/play/` and `/play` resolve to the same route. */
export function normalizePath(pathname: string): string {
  if (!pathname) return HOME_PATH;
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? HOME_PATH : trimmed;
}

export function routeForPath(pathname: string): AppRoute {
  return normalizePath(pathname) === PLAY_PATH ? 'play' : 'home';
}

/**
 * Client-side navigation. A no-op when the target is already current, so an
 * accidental double click does not add duplicate history entries.
 */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  if (normalizePath(window.location.pathname) === normalizePath(path)) return;

  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGED_EVENT));
}

/** Current route, kept in sync with back/forward and `navigate`. */
export function useRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === 'undefined' ? 'home' : routeForPath(window.location.pathname)
  );

  useEffect(() => {
    const sync = () => setRoute(routeForPath(window.location.pathname));
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_CHANGED_EVENT, sync);
    };
  }, []);

  return route;
}

type RouteLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
};

/**
 * An anchor that keeps the real `href` (middle click, open in new tab, SEO)
 * but navigates in place for an ordinary left click.
 */
export const RouteLink: React.FC<RouteLinkProps> = ({ to, onClick, ...rest }) => {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return <a href={to} onClick={handleClick} {...rest} />;
};

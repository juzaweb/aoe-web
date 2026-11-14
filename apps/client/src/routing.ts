/**
 * URL shape for the two public screens.
 *
 * English is the default locale, so its homepage is the bare root and every
 * other address carries a prefix. These helpers are pure so the router config
 * in `routes.tsx` stays declarative.
 */
import type { Language } from './i18n/index.js';

export type AppRoute = 'home' | 'play';

export const HOME_PATH = '/';
export const DEFAULT_LOCALE: Language = 'en';

/** Homepage address: `/` for the default locale, `/vi` otherwise. */
export function homePath(locale: Language): string {
  return locale === DEFAULT_LOCALE ? HOME_PATH : `/${locale}`;
}

/** Game address. The game is always prefixed, even in the default locale. */
export function playPath(locale: Language): string {
  return `/${locale}/play`;
}

export function localizedPath(locale: Language, route: AppRoute): string {
  return route === 'play' ? playPath(locale) : homePath(locale);
}

/**
 * Re-reads the current path under a different locale, keeping the screen.
 * Used when the language changes so the URL never disagrees with the copy.
 */
export function withLocale(pathname: string, locale: Language): string {
  return pathname.replace(/\/+$/, '').endsWith('/play') ? playPath(locale) : homePath(locale);
}

/**
 * Where a visitor of `locale` should be sent when they open the bare root.
 * The root always renders English, so anyone else is redirected to their own
 * homepage instead of being silently switched to English.
 */
export function homeRedirectFor(locale: Language): string | null {
  return locale === DEFAULT_LOCALE ? null : homePath(locale);
}

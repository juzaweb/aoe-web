/**
 * Server i18n.
 *
 * The user-facing source strings in the code are English — the fallback
 * language. Translation happens **at the last moment**: when a rejection, an
 * error response or an announcement leaves the server. Two consequences:
 *
 * 1. Call sites keep their current string, so a caller that sends no locale
 *    keeps getting the historical English message. Every existing test
 *    without a locale stays green (after asserting the English text).
 * 2. Messages with parameters are thrown as a `LocalizedSpec` (key + params +
 *    English fallback) and rendered by the boundary that knows the locale.
 */
import { staticTranslate, templateTranslate } from './messages.js';

export type Locale = 'vi' | 'en';

/** The languages the server can render; also the source of truth for checks. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['vi', 'en'];

export function normalizeLocale(value: unknown): Locale | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'object') return null;
  const raw =
    typeof value === 'string'
      ? value
      : typeof (value as { locale?: unknown }).locale === 'string'
        ? (value as { locale: string }).locale
        : null;
  if (!raw || typeof raw !== 'string') return null;
  const base = raw.toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.find((code) => code === base) ?? null;
}

/** `Accept-Language`-style header, reduced to the first supported locale. */
export function localeFromHeader(header: string | undefined | null): Locale | null {
  if (!header) return null;
  for (const part of String(header).split(',')) {
    const code = part.split(';')[0]?.trim().toLowerCase().split('-')[0];
    const match = SUPPORTED_LOCALES.find((supported) => supported === code);
    if (match) return match;
  }
  return null;
}

export interface TranslateParams {
  [key: string]: string | number;
}

/**
 * A parameterised message thrown by a layer that does not know the locale.
 *
 * `fallback` is the historical source string, so a boundary without a locale
 * renders it byte-identically and every existing test stays green. A boundary
 * that does know the locale renders the `TEMPLATES` entry for `key` instead.
 */
export interface LocalizedSpec {
  key: string;
  params?: TranslateParams;
  fallback: string;
}

/** Renders a spec in `locale`, or the untouched fallback when there is none. */
export function render(
  locale: Locale | null | undefined,
  spec: LocalizedSpec
): string {
  if (!locale) return spec.fallback;
  return templateTranslate(locale, spec.key, spec.params) ?? spec.fallback;
}

/**
 * Translates an unknown thrown value: a spec-bearing error (RaidError,
 * AuthError) renders through its key; a plain one falls back to the catalog
 * lookup of its message text.
 */
export function translateError(
  locale: Locale | null | undefined,
  err: unknown
): string {
  const spec = (err as { spec?: LocalizedSpec } | null | undefined)?.spec;
  if (spec) return render(locale, spec);
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string'
    ? translate(locale, message)
    : translate(locale, 'System error. Please try again.');
}

/**
 * Translates one known user-facing string into `locale`.
 *
 * Unknown messages are returned untouched, which is also what keeps historical
 * callers (and tests that never state a locale) byte-identical. The source
 * language of the codebase — and therefore the no-locale result — is English.
 */
export function translate(
  locale: Locale | null | undefined,
  message: string
): string {
  if (!locale || locale === 'en') return message;
  return staticTranslate(locale, message) ?? message;
}

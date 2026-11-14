/**
 * Client i18n bootstrap.
 *
 * The chosen language is persisted in `localStorage` and published on the
 * `<html lang>` attribute. The server is told the language separately: the
 * join options carry it, and `LanguageSwitcher` emits an event so a live room
 * can update its per-client locale without a reconnect.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.js';
import vi from './locales/vi.js';

export const LANGUAGE_STORAGE_KEY = 'cq_language';
export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Fired after the user changes language, so open rooms can send `SET_LOCALE`. */
export const LANGUAGE_CHANGED_EVENT = 'cq:language-changed';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Narrows an i18next language string to a supported locale. */
export function asLanguage(value: string): Language {
  return isLanguage(value) ? value : 'vi';
}

/**
 * Locale carried by the URL prefix (`/en/play` → `en`). Returns null for an
 * unprefixed path such as `/` or `/play`.
 */
export function localeFromPath(pathname: string): Language | null {
  const segment = pathname.split(/[?#]/)[0].split('/')[1]?.toLowerCase();
  return isLanguage(segment) ? segment : null;
}

/**
 * URL prefix first (so a shared `/en` link is honoured), then the stored
 * preference, then the browser's ordered languages. Vietnamese remains the
 * fallback for unsupported browsers, matching the game's default.
 */
export function detectLanguage(): Language {
  const fromPath =
    typeof window === 'undefined' ? null : localeFromPath(window.location.pathname);
  if (fromPath) return fromPath;

  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage can be unavailable in private mode; detection continues below.
  }

  const candidates =
    typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language]
      : [];
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'vi';
}

export function persistLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A failed write only means the choice will not survive a reload.
  }
}

function applyDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

const initialLanguage = detectLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi },
    en: { translation: en }
  },
  lng: initialLanguage,
  fallbackLng: 'vi',
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false
});

applyDocumentLanguage(i18n.language);

// Dev-only handle, like `__room` and `__worldScene`, so a browser check can
// inspect the live i18next instance without importing a second module copy.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __i18n?: typeof i18n }).__i18n = i18n;
}

i18n.on('languageChanged', (language) => {
  if (isLanguage(language)) persistLanguage(language);
  applyDocumentLanguage(language);
});

export default i18n;

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

/**
 * Stored preference first, then the browser's ordered preferences. Vietnamese
 * remains the fallback for unsupported browsers, matching the game's default.
 */
export function detectLanguage(): Language {
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

i18n.on('languageChanged', (language) => {
  if (isLanguage(language)) persistLanguage(language);
  applyDocumentLanguage(language);
});

export default i18n;

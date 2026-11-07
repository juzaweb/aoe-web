import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_CHANGED_EVENT,
  isLanguage,
  type Language
} from './index.js';

/**
 * Thin wrapper over `useTranslation` for components that only need the active
 * language and a setter. The change event lets `App` push the new locale to an
 * already-joined room without remounting the game.
 */
export function useLocale() {
  const { t, i18n } = useTranslation();

  const setLanguage = useCallback(
    (language: Language) => {
      if (i18n.language === language) return;
      void i18n.changeLanguage(language).then(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGED_EVENT, { detail: language }));
        }
      });
    },
    [i18n]
  );

  const language: Language = isLanguage(i18n.language) ? i18n.language : 'vi';

  return { t, i18n, language, setLanguage };
}

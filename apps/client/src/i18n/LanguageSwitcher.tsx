import React from 'react';
import { Languages } from 'lucide-react';
import { useLocale } from './useLocale.js';
import { SUPPORTED_LANGUAGES, type Language } from './index.js';

const LANGUAGE_LABELS: Record<Language, string> = {
  vi: 'Tiếng Việt',
  en: 'English'
};

interface LanguageSwitcherProps {
  /** A shorter control for the compact HUD. */
  compact?: boolean;
  className?: string;
}

/**
 * Two-state language picker. Kept outside every screen so the login page, the
 * session gate and the in-game HUD all use the same stored preference.
 */
export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  compact = false,
  className = ''
}) => {
  const { language, setLanguage, t } = useLocale();

  if (compact) {
    return (
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        aria-label={t('common.language')}
        title={LANGUAGE_LABELS[language]}
        className={`h-8 rounded border border-slate-700 bg-slate-900 px-1 text-[10px] font-semibold text-slate-200 ${className}`}
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div
      className={`flex items-center gap-1 rounded border border-slate-700 bg-slate-900/90 p-0.5 text-[11px] ${className}`}
      role="group"
      aria-label={t('common.language')}
    >
      <Languages size={13} className="ml-1 shrink-0 text-amber-400" aria-hidden />
      {SUPPORTED_LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          aria-pressed={language === code}
          className={`rounded px-1.5 py-0.5 font-semibold transition-colors ${
            language === code
              ? 'bg-amber-600 text-slate-950'
              : 'text-slate-300 hover:text-amber-200'
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

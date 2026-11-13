import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, LogIn, Swords, UserPlus } from 'lucide-react';
import { AuthUser, login, register } from '../auth/api.js';
import { useInputMode } from '../device/useInputMode.js';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.js';

type AuthMode = 'login' | 'register';

interface AuthScreenProps {
  /** Called once the server accepted the credentials. */
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** MOB-07: the shortcut cheat-sheet has to teach the gesture this device has. */
  const isTouch = useInputMode() === 'touch';

  const switchMode = (next: AuthMode) => {
    if (isSubmitting) return;
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result =
        mode === 'login'
          ? await login({ username, password })
          : await register({ username, displayName, password });
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.unknownError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="aoe-backdrop absolute inset-0 z-50 flex items-center justify-center overflow-y-auto p-3">
      <div className="absolute right-3 top-3 z-10">
        <LanguageSwitcher />
      </div>
      <div className="aoe-modal my-auto flex max-h-[94dvh] w-full max-w-md flex-col items-center overflow-y-auto p-4 text-center sm:p-6">
        <div className="p-3 rounded-full bg-amber-950/60 border border-amber-600/50 mb-3 text-amber-400">
          <Swords size={36} />
        </div>

        <h1 className="font-medieval text-2xl font-bold text-amber-300 tracking-wider mb-1">
          {t('auth.title')}
        </h1>
        <p className="text-xs text-slate-300 mb-5 max-w-xs">{t('auth.subtitle')}</p>

        {/* Mode tabs */}
        <div className="w-full grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => switchMode('login')}
            aria-pressed={mode === 'login'}
            className={`aoe-button min-h-[44px] py-2 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              mode === 'login' ? 'text-amber-100' : 'text-slate-300'
            }`}
          >
            {t('auth.loginTab')}
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            aria-pressed={mode === 'register'}
            className={`aoe-button min-h-[44px] py-2 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              mode === 'register' ? 'text-amber-100' : 'text-slate-300'
            }`}
          >
            {t('auth.registerTab')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-3 text-left">
          <div>
            <label htmlFor="auth-username" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('auth.username')}
            </label>
            <input
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.usernamePlaceholder')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={24}
              className="w-full min-h-[44px] rounded border border-amber-800 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-amber-400"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label htmlFor="auth-display" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('auth.displayName')}
              </label>
              <input
                id="auth-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('auth.displayNamePlaceholder')}
                pattern="[a-zA-Z0-9_]+"
                title={t('auth.displayNameHint')}
                maxLength={24}
                className="w-full min-h-[44px] rounded border border-amber-800 bg-slate-900 px-3 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-amber-400"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('auth.password')}
            </label>
            <div className="relative flex items-center">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? t('auth.passwordHint') : '••••••'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'register' ? 6 : undefined}
                maxLength={128}
                className="w-full min-h-[44px] rounded border border-amber-800 bg-slate-900 pl-3 pr-11 py-2 text-base text-slate-100 placeholder-slate-500 focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                className="absolute right-1 flex h-10 w-10 items-center justify-center rounded text-slate-400 transition-colors hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="aoe-frame-sm flex items-start gap-2 bg-red-950/70 px-3 py-2 text-[11px] text-red-200">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="aoe-button aoe-button-primary flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-950 transition-all disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('auth.connecting')}
              </>
            ) : mode === 'login' ? (
              <>
                <LogIn size={16} />
                {t('auth.enterWorld')}
              </>
            ) : (
              <>
                <UserPlus size={16} />
                {t('auth.createEmpire')}
              </>
            )}
          </button>
        </form>

        <div className="mt-5 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Lock size={12} />
          <span>{t('auth.passwordEncrypted')}</span>
        </div>

        {isTouch ? (
          <div className="mt-4 space-y-1 text-[11px] text-slate-400">
            <div>{t('auth.touchHelp1')}</div>
            <div>{t('auth.touchHelp2')}</div>
            <div>{t('auth.touchHelp3')}</div>
            <div>{t('auth.touchHelp4')}</div>
            <div>{t('auth.touchHelp5')}</div>
          </div>
        ) : (
        <div className="mt-4 text-[11px] text-slate-400 space-y-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((line) => (
            <div key={line}>{t(`auth.desktopHelp${line}`)}</div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
};

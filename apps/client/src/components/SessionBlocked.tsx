import React from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, ShieldAlert, UserPlus } from 'lucide-react';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.js';

interface SessionBlockedProps {
  /** Take the account over from the session that currently holds it. */
  onTakeover: () => void;
  /** Forget the stored token and go back to the login/register screen. */
  onUseAnotherAccount: () => void;
}

/**
 * SESS-06: shown when the server refuses this tab because the account is already
 * being played elsewhere, or when another device took the session over.
 *
 * Both escapes are explicit: nothing here retries on its own, so two tabs can
 * never end up fighting over the account.
 */
export const SessionBlocked: React.FC<SessionBlockedProps> = ({
  onTakeover,
  onUseAnotherAccount
}) => {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-md">
      <div className="absolute right-3 top-3 z-10">
        <LanguageSwitcher />
      </div>
      <div className="aoe-panel my-auto flex max-h-[94dvh] w-full max-w-md flex-col items-center overflow-y-auto rounded-xl border-2 border-amber-600 p-4 text-center shadow-2xl sm:p-6">
        <div className="p-3 rounded-full bg-amber-950/60 border border-amber-600/50 mb-3 text-amber-400">
          <ShieldAlert size={36} />
        </div>

        <h1 className="font-medieval text-2xl font-bold text-amber-300 tracking-wider mb-2">
          {t('session.title')}
        </h1>
        <p className="text-xs text-slate-300 mb-6 max-w-xs">{t('session.body')}</p>

        <div className="w-full space-y-2.5">
          <button
            type="button"
            onClick={onTakeover}
            className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded border border-amber-400 bg-gradient-to-r from-amber-600 to-amber-700 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-950 shadow-lg transition-all hover:from-amber-500 hover:to-amber-600"
          >
            <LogIn size={16} />
            {t('session.takeover')}
          </button>

          <button
            type="button"
            onClick={onUseAnotherAccount}
            className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded border border-slate-700 bg-slate-900 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-300 transition-all hover:border-amber-600 hover:bg-slate-800"
          >
            <UserPlus size={16} />
            {t('session.otherAccount')}
          </button>
        </div>

        <p className="mt-5 text-[11px] text-slate-500">{t('session.note')}</p>
      </div>
    </div>
  );
};

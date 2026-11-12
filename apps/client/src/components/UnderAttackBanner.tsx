import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

/**
 * ATK-05 / UIX-08: the red banner that says the kingdom is being hit.
 *
 * `role="alert"` with `aria-live="assertive"` because this is the one message in
 * the game where being late costs the player a building: it interrupts whatever
 * a screen reader is currently saying, unlike the polite command-rejection
 * toast. Keeping it out of `App` is what makes that claim testable — `App`
 * mounts a Phaser game and a Colyseus room, so anything inline there can only be
 * checked by scanning its source.
 *
 * Deliberately not interactive: it carries no control, so it must not swallow a
 * map click while it is up (the stack it sits in is `pointer-events-none`).
 */
export const UnderAttackBanner: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-under-attack-banner
      className="flex items-center gap-2 rounded border border-red-500/80 bg-red-950/90 px-4 py-2 text-sm text-red-200 shadow-2xl backdrop-blur-md animate-pulse"
    >
      {/* Decorative: the sentence already says what happened. */}
      <AlertCircle size={16} className="text-red-400" aria-hidden="true" />
      <span>{t('app.underAttack')}</span>
    </div>
  );
};

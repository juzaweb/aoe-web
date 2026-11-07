import React from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Smartphone } from 'lucide-react';

interface OrientationGateProps {
  /** Only a touch device with a portrait viewport should ever show this. */
  visible: boolean;
}

/**
 * Landscape gate for touch devices (MOB-02).
 *
 * The layout is designed for landscape only: a phone in portrait would either
 * clip the dock or need a second full HUD variant. Rather than locking the
 * orientation (the Screen Orientation API needs fullscreen and is refused on
 * iOS), the game keeps running underneath and this overlay asks the player to
 * rotate. It renders above everything and is deliberately dismissible only by
 * rotating, so a tap cannot slip through into a half-visible HUD.
 */
export const OrientationGate: React.FC<OrientationGateProps> = ({ visible }) => {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-[60] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center gap-4 px-8 text-center"
      data-orientation-gate
    >
      <div className="relative flex items-center justify-center text-amber-400">
        <Smartphone size={56} className="rotate-90" />
        <RotateCw size={22} className="absolute -right-6 -top-2 animate-spin text-amber-300" />
      </div>
      <h2 className="font-medieval text-lg font-bold tracking-wider text-amber-300">
        {t('orientation.title')}
      </h2>
      <p className="max-w-xs text-xs leading-relaxed text-slate-300">
        {t('orientation.body')}
      </p>
    </div>
  );
};

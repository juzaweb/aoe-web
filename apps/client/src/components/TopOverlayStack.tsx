import React from 'react';

interface TopOverlayStackProps {
  /** Phones anchor below the 44 px compact citadel row instead of the full HUD. */
  compact?: boolean;
  children?: React.ReactNode;
}

/**
 * One vertical column for every top-centre banner.
 *
 * CONTEXT: the placement reminder, the command-rejection toast and the
 * under-attack warning each hard-coded their own `top-16`/`top-20`/`top-24`
 * offset and their own `z-50`. Two of them at once therefore landed on the same
 * line, which hid the placement Cancel button exactly when a player needed it.
 * Anchoring one flex column makes the stacking automatic, and a fourth banner
 * added later joins the column instead of re-introducing the collision.
 *
 * The column itself ignores pointer events so the map stays draggable through
 * the empty space around the pills; each banner re-enables them on its own box
 * only if it carries a control (the placement Cancel button). The rejection
 * toast and the under-attack warning stay transparent to clicks: neither has
 * anything to press, so swallowing a map click under them would be a dead zone.
 *
 * `top-16` (64 px) is the anchor that clears the desktop HUD row (8 px inset
 * plus a 44 px control row); compact reuses the placement banner's existing
 * `safe-area + 4.75rem` offset, which already sits below the compact citadel row.
 */
export const TopOverlayStack: React.FC<TopOverlayStackProps> = ({ compact = false, children }) => (
  <div
    data-top-overlay-stack
    className={`pointer-events-none absolute inset-x-0 z-50 flex flex-col items-center gap-1.5 px-2 ${
      compact ? 'top-[calc(env(safe-area-inset-top)+4.75rem)]' : 'top-16'
    }`}
  >
    {children}
  </div>
);

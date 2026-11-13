import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DetailsPopoverProps {
  /** Whether the sheet is mounted; the dock owns the toggle. */
  open: boolean;
  /** Localized name of the selection, shared with the selection strip. */
  title: string;
  onClose: () => void;
  /** The full entity sheet; `EntityDetails` in its `popover` variant. */
  children: React.ReactNode;
}

/**
 * DOCK-04: the verbose entity card, lifted out of the dock and floated above it.
 *
 * The command dock is a fixed 156 px band, so the only way to keep every stat,
 * upgrade and research row on screen is to take the card out of the flow. The
 * parent (`DockBar`) is `position: relative` and this element is pinned with
 * `bottom-full`, which puts it directly above the band whatever the selection is
 * called and however wide the viewport is.
 *
 * `pointer-events-auto` republishes the module on top of a `pointer-events-none`
 * dock, exactly as the selection strip and the command card do; without it the
 * sheet would render but stay inert and unclickable.
 */
export const DetailsPopover: React.FC<DetailsPopoverProps> = ({
  open,
  title,
  onClose,
  children
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** What had focus before the sheet opened, so closing can hand it back. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // DOCK-04: focus moves to the close button when the sheet opens, so the
  // keyboard has an obvious way out and a screen reader announces the dialog.
  // The button, not the panel: focusing the container would leave a dialog with
  // no visible affordance.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      // DOCK-04: a keyboard player who closes the sheet lands back on the button
      // that opened it, not on `<body>` with the tab order reset. Guarded by
      // `isConnected`: a selection change can close the sheet after the strip
      // that owned the button has already unmounted.
      const trigger = returnFocusRef.current;
      if (trigger?.isConnected) trigger.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  // DOCK-05: Escape closes the sheet from the capture phase and the event is
  // consumed with `stopPropagation`. Phaser binds its own window-level Esc
  // handler — the one that cancels a building placement, a road brush or a wall
  // erase — so a bubble-phase listener would close the sheet *and* silently
  // disarm whatever the player had armed on the map. Capturing first and
  // stopping the event keeps the other ESC behaviour out of this gesture. The
  // listener is added only while open and removed by the cleanup, so once the
  // sheet is gone the game gets its normal Escape back.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  // DOCK-06: click-outside is a capture-phase `pointerdown`, not a click on a
  // full-screen backdrop. A backdrop would swallow the first press over the dock
  // (the minimap and the command grid must stay directly clickable), and capture
  // means the press on the map is seen by this listener before Phaser's canvas
  // handlers turn it into a selection or a move order. Only while open, so the
  // rest of the game never pays for an always-on window listener.
  //
  // The disclosure button that owns this sheet is excluded on purpose: `close`
  // and `toggle` are the same switch upstream, so closing here and then letting
  // the button's own click toggle again would reopen the sheet on every press.
  // `aria-controls="dock-details"` is the contract that identifies it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = event.target;
      if (!(target instanceof Element)) {
        onClose();
        return;
      }
      if (panel.contains(target)) return;
      if (target.closest('[aria-controls="dock-details"]')) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      id="dock-details"
      role="dialog"
      aria-label={title}
      data-details-popover
      className="absolute bottom-full right-0 z-30 mb-2 w-[360px] max-w-[calc(100vw-1rem)] max-h-[min(60vh,520px)] overflow-y-auto rounded aoe-panel p-2 pointer-events-auto"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-amber-800/40 pb-1.5">
        <span className="truncate font-medieval text-[11px] font-bold tracking-wider text-amber-300">
          {title}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('dock.closeDetails')}
          title={t('dock.closeDetails')}
          className="aoe-button flex h-8 w-8 shrink-0 items-center justify-center text-slate-300 hover:text-amber-200"
        >
          <X size={14} />
        </button>
      </div>
      {children}
    </div>
  );
};

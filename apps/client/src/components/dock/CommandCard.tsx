import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import type { DockCommand, DockPage } from './commandPages.js';
import { costText } from './commandPages.js';
import { dockCommandIcon } from './dockIcons.js';
import {
  DOCK_CARD_WIDTH_PX,
  DOCK_COLUMNS,
  DOCK_GAP_PX,
  DOCK_HEADER_PX,
  DOCK_PADDING_PX,
  DOCK_SLOT_CAPACITY,
  DOCK_SLOT_PX
} from './dockMetrics.js';

export interface CommandCardProps {
  /** Pages for the current selection; empty hides the card entirely. */
  pages: DockPage[];
}

/** Trimmed-down art size: 26 px leaves the slot's 6 px padding visible. */
const SLOT_ART_PX = 26;

/**
 * DOCK-03: the 5x3 command card, AoE style.
 *
 * The card is presentational on purpose: it renders whatever `buildDockPages`
 * handed it and never decides whether a command is legal. That keeps the "what
 * can I order" rules in one testable module and makes this component a pure
 * function of `pages`, which is also why the open page and the hovered slot are
 * the only state it owns.
 *
 * Geometry is exactly the documented budget: header (14) + gap (4) + three
 * 38 px rows with 4 px gaps (122) = 140, which is the card's inner height at
 * 156 px minus padding and border. Nothing here can grow the dock.
 */
export const CommandCard: React.FC<CommandCardProps> = ({ pages }) => {
  const { t } = useTranslation();

  /**
   * The page ids, not the page objects, are the identity: `DockBar` rebuilds
   * `pages` on every render (prices, queues, armed order), so depending on the
   * array would reset the card on every tick. Only a change of selection —
   * which always changes this list — sends the player back to the first page.
   */
  const pageIds = pages.map((page) => page.id).join('|');

  // The remembered index belongs to `pageState.ids`. A different id list means
  // a new selection, and the card is derived back to page one in the same
  // render — an effect would paint the previous selection's page for a frame.
  const [pageState, setPageState] = useState<{ ids: string; index: number }>({
    ids: pageIds,
    index: 0
  });
  // The id, not the command: `DockBar` rebuilds the command objects every
  // render, so a stored object would label the header with a stale price.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Empty selection: the dock collapses the card instead of keeping an empty
  // frame under the map.
  if (pages.length === 0) return null;

  // A page id that survived a list change stays selected; a disappeared one
  // falls back to the first page instead of rendering `undefined`.
  const pageIndex = pageState.ids === pageIds ? pageState.index : 0;
  const page = pages[Math.min(pageIndex, pages.length - 1)];

  const goToPage = (delta: number) => {
    const next = (pageIndex + delta + pages.length) % pages.length;
    setPageState({ ids: pageIds, index: next });
  };

  // Looked up in the current page every render: a hovered id from the previous
  // selection simply finds nothing and the header falls back to the page name.
  const hoveredCommand = hoveredId
    ? (page.commands.find((command) => command.id === hoveredId) ?? null)
    : null;

  // The header is the only readable name a slot has (AoE draws no label under
  // the art), so hovering or focusing a slot swaps the page label for the
  // command's name and, when it has one, its price.
  const headerLabel = hoveredCommand
    ? hoveredCommand.label
    : page.commands.length > 0
      ? page.label
      : t('dock.empty');
  const headerCost = hoveredCommand?.cost ? costText(hoveredCommand.cost) : null;
  const emptySlots = Math.max(0, DOCK_SLOT_CAPACITY - page.commands.length);

  return (
    <div
      data-command-card
      className="aoe-panel pointer-events-auto flex h-full shrink-0 flex-col overflow-hidden rounded"
      style={{ width: DOCK_CARD_WIDTH_PX, padding: DOCK_PADDING_PX, gap: DOCK_GAP_PX }}
    >
      <div className="flex shrink-0 items-center gap-1" style={{ height: DOCK_HEADER_PX }}>
        <span
          data-command-card-label
          className="min-w-0 truncate font-medieval text-[11px] font-bold leading-none text-amber-300"
        >
          {headerLabel}
        </span>
        {headerCost && (
          <span
            data-command-card-cost
            className="shrink-0 truncate font-mono text-[11px] leading-none text-amber-200/80"
          >
            {headerCost}
          </span>
        )}
        {pages.length > 1 && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => goToPage(-1)}
              aria-label={t('dock.prevPage')}
              title={t('dock.prevPage')}
              data-command-page-prev
              className="flex items-center justify-center rounded border border-amber-900/50 px-0.5 text-[11px] leading-none text-amber-400 transition-colors hover:border-amber-500 hover:text-amber-200"
            >
              <ChevronLeft size={11} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => goToPage(1)}
              aria-label={t('dock.nextPage')}
              title={t('dock.nextPage')}
              data-command-page-next
              className="flex items-center justify-center rounded border border-amber-900/50 px-0.5 text-[11px] leading-none text-amber-400 transition-colors hover:border-amber-500 hover:text-amber-200"
            >
              <ChevronRight size={11} aria-hidden />
            </button>
          </span>
        )}
      </div>

      <div
        className="grid"
        data-command-page={page.id}
        style={{
          gridTemplateColumns: `repeat(${DOCK_COLUMNS}, ${DOCK_SLOT_PX}px)`,
          gap: DOCK_GAP_PX
        }}
      >
        {page.commands.map((command) => (
          <CommandSlot
            key={command.id}
            command={command}
            onHover={setHoveredId}
          />
        ))}
        {Array.from({ length: emptySlots }, (_, index) => (
          <div
            key={`empty-${index}`}
            aria-hidden="true"
            data-command-slot-empty
            className="aoe-panel-inset rounded opacity-60"
            style={{ height: DOCK_SLOT_PX }}
          />
        ))}
      </div>
    </div>
  );
};

interface CommandSlotProps {
  command: DockCommand;
  /** Reports the hovered command's id, or `null` when the pointer leaves. */
  onHover: (commandId: string | null) => void;
}

/**
 * One command key. No visible label: the slot is 38 px, the tooltip and the
 * card header carry the name, which is how AoE keeps fifteen build options on
 * one card without a legend.
 */
const CommandSlot: React.FC<CommandSlotProps> = ({ command, onHover }) => {
  return (
    <button
      type="button"
      onClick={command.action}
      disabled={command.disabled}
      data-command-slot
      data-command-id={command.id}
      title={command.title}
      aria-label={command.title}
      aria-pressed={command.active}
      onMouseEnter={() => onHover(command.id)}
      onFocus={() => onHover(command.id)}
      onMouseLeave={() => onHover(null)}
      onBlur={() => onHover(null)}
      className={`relative flex items-center justify-center rounded border transition-colors ${
        command.active
          ? 'border-amber-400 bg-amber-600/35 ring-1 ring-amber-400'
          : command.disabled
            ? 'aoe-panel-inset cursor-not-allowed opacity-55'
            : 'aoe-button text-amber-100'
      }`}
      style={{ width: DOCK_SLOT_PX, height: DOCK_SLOT_PX }}
    >
      {command.thumbnail ? (
        <img
          src={command.thumbnail}
          alt=""
          className="object-contain"
          style={{ width: SLOT_ART_PX, height: SLOT_ART_PX }}
          onError={(event) => {
            // A missing sheet stays a blank (iconless) slot rather than showing
            // the browser's broken-image glyph over the art.
            (event.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        // Commands without art (brushes, order keys) share one warm tone, so a
        // row of pure glyphs reads as one group beside the painted buildings.
        <span aria-hidden="true" className="text-amber-200/90">
          {dockCommandIcon(command.art, SLOT_ART_PX)}
        </span>
      )}

      {command.hotkey && (
        <span
          aria-hidden="true"
          data-command-hotkey
          className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-black/70 px-0.5 font-mono text-[11px] font-bold leading-none text-amber-400"
        >
          {command.hotkey}
        </span>
      )}

      {command.lockedLevel !== undefined && (
        <span
          aria-hidden="true"
          data-command-locked
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-stone-950/75"
        >
          <Lock size={14} className="text-amber-400" />
        </span>
      )}
    </button>
  );
};

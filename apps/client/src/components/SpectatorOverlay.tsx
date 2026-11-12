import React, { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as Phaser from 'phaser';
import { Room } from '@colyseus/sdk';
import { Eye, X } from 'lucide-react';
import { PhaserGame } from '../game/PhaserGame.js';
import type { WorldScene } from '../game/scenes/WorldScene.js';
import { useModalFocus } from './useModalFocus.js';

interface SpectatorOverlayProps {
  /** The spectator room, or null while it is still being joined. */
  room: Room | null;
  /** Target empire, as shown on the world map. */
  target: { userId: string; name: string; color: string; townCenterLevel: number };
  /** A close request from the header; the app owns the room lifecycle. */
  onClose: () => void;
}

/**
 * Full-screen view of another empire.
 *
 * Mounted over the player's own game, which keeps running underneath: the
 * spectator runs its own Phaser instance against a separate room, so watching a
 * neighbour never pauses the viewer's own kingdom. Everything here is read-only;
 * the server refuses commands from the spectator session regardless.
 */
export const SpectatorOverlay: React.FC<SpectatorOverlayProps> = ({ room, target, onClose }) => {
  const { t } = useTranslation();
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // UIX-09: the second window covers the player's own kingdom, so it is a modal
  // dialog for as long as it is mounted: focus starts and stays inside, Esc
  // closes it, and the dock button that opened it gets the keyboard back.
  useModalFocus(containerRef, true, onClose);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="absolute inset-0 z-[55] flex flex-col bg-slate-950"
    >
      <header className="flex items-center gap-3 border-b border-amber-700/50 bg-slate-900/95 px-3 py-2">
        <Eye size={18} className="shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="truncate font-medieval text-sm font-bold tracking-wider text-amber-200"
          >
            {t('spectator.title', { name: target.name })}
          </h2>
          <p className="truncate text-[11px] text-slate-400">
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full border border-white/40 align-middle"
              style={{ backgroundColor: target.color }}
            />
            {t('spectator.level', { level: target.townCenterLevel })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('spectator.close')}
          className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-red-500 hover:text-red-300"
        >
          <X size={16} />
          {t('build.close')}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <PhaserGame
          room={room}
          playerName=""
          readOnly
          focusOwnerId={target.userId}
          ownerColor={target.color}
          onSelectionChange={() => undefined}
          onPlacementCancelled={() => undefined}
          onBuildingHotkey={() => undefined}
          onIdleVillagersChange={() => undefined}
          onCitadelStatusChange={() => undefined}
          onControlGroupsChange={() => undefined}
          onArmedOrderChange={() => undefined}
          onBoxSelectChange={() => undefined}
          onRoadModeChange={() => undefined}
          onWallModeChange={() => undefined}
          onUnderAttack={() => undefined}
          gameRef={gameRef}
          sceneRef={sceneRef}
        />
        {!room && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <span className="text-sm text-slate-300">{t('spectator.loading')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

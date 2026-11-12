import React from 'react';
import type { Room } from '@colyseus/sdk';
import type { BuildingType, Resources } from '@chien-quoc/shared';
import type { ArmedOrder, SelectedEntityData, WorldScene } from '../../game/scenes/WorldScene.js';
import type { RoadMode } from '../../game/input/RoadController.js';
import type { WallMode } from '../../game/input/WallController.js';
import { Minimap } from '../Minimap.js';
import { CommandCard } from './CommandCard.js';
import { SelectionStrip } from './SelectionStrip.js';
import { buildDockPages, type DockCommandHandlers } from './commandPages.js';
import { DOCK_HEIGHT_PX, DOCK_INSET_PX } from './dockMetrics.js';

export interface DockBarProps {
  /** Current selection; `null` collapses the dock to the radar alone. */
  entity: SelectedEntityData | null;
  /** Localized name of the selection. */
  displayName: string;
  resources: Resources;
  /** Own capital level, which is what unlocks the three drop-off camps. */
  townCenterLevel: number;
  inRaid: boolean;
  /** An attack-move or patrol order is armed, so its slot reads as pressed. */
  armedOrder: ArmedOrder | null;
  activeBuildingType: BuildingType | null;
  roadMode: RoadMode | null;
  wallMode: WallMode | null;
  room: Room | null;
  sceneRef: React.RefObject<WorldScene | null>;
  onPanToGrid: (gx: number, gy: number) => void;
  onCommandAtGrid: (gx: number, gy: number) => void;
  /** Every command routes to a handler `App` already owned. */
  handlers: DockCommandHandlers;
}

/**
 * DOCK-01: the desktop bottom band, AoE style.
 *
 * One fixed 156 px strip: radar, a thin selection summary and a 5x3 command
 * grid. The two floating panels this replaces (a 320 px entity card and a
 * 336 px build panel) sized themselves by their content, so selecting a villager
 * covered the bottom third of a 1080p screen. Here nothing inside can grow the
 * band: long content lives in the popover, and an empty selection collapses the
 * card instead of leaving a blank frame over the map.
 *
 * Touch keeps its own dock (`MobileCommandBar` + compact sheets) because 156 px
 * of chrome is exactly what MOB-06 rejected on a phone.
 */
export const DockBar: React.FC<DockBarProps> = ({
  entity,
  displayName,
  resources,
  townCenterLevel,
  inRaid,
  armedOrder,
  activeBuildingType,
  roadMode,
  wallMode,
  room,
  sceneRef,
  onPanToGrid,
  onCommandAtGrid,
  handlers
}) => {
  // Cheap to rebuild (15 commands) and always fresh: the card only keeps the
  // page index, never the commands, so a price or queue change is immediate.
  const pages = buildDockPages({
    entity,
    resources,
    townCenterLevel,
    inRaid,
    armedOrder,
    activeBuildingType,
    roadMode,
    wallMode,
    // The kingdom is the only map with player-painted roads; the battlefield's
    // road network is terrain, so its brush tools would be dead buttons.
    showRoadTools: sceneRef.current?.terrainLayout.kind !== 'battlefield',
    handlers
  });

  return (
    <div
      data-command-dock
      className="pointer-events-none absolute z-20 flex select-none items-stretch gap-2"
      style={{
        left: DOCK_INSET_PX,
        right: DOCK_INSET_PX,
        bottom: DOCK_INSET_PX,
        height: DOCK_HEIGHT_PX
      }}
    >
      <Minimap
        room={room}
        sceneRef={sceneRef}
        onPanToGrid={onPanToGrid}
        onCommandAtGrid={onCommandAtGrid}
      />

      {entity && (
        // `justify-between` plus a capped summary keeps the middle of the band
        // transparent: the map stays visible between the summary and the card
        // instead of a full-width panel covering everything below the horizon.
        <div className="relative flex min-w-0 flex-1 items-stretch justify-between gap-2">
          <div className="flex min-w-0 max-w-[340px] flex-1 items-stretch">
            <SelectionStrip
              entity={entity}
              displayName={displayName}
            />
          </div>
          <CommandCard pages={pages} />
        </div>
      )}
    </div>
  );
};

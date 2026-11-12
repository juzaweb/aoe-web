import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  Resources,
  getBuildingUnlockLevel,
  isBuildingUnlocked
} from '@chien-quoc/shared';
import { BrickWall, Eraser, Hammer, Lock, Route, X } from 'lucide-react';
import type { RoadMode } from '../game/input/RoadController.js';
import type { WallMode } from '../game/input/WallController.js';
import { BUILDING_HOTKEY_BY_TYPE } from '../game/input/buildingHotkeys';
import { buildingThumbnail } from './buildingThumbnails.js';
import { buildingIcon } from './buildingIcons.js';
import { buildingDescription, buildingName, resourceName } from '../i18n/labels.js';

interface BuildMenuProps {
  playerResources: Resources;
  activeBuildingType: BuildingType | null;
  onSelectBuilding: (type: BuildingType) => void;
  onCancelBuilding: () => void;
  /**
   * Kingdom-only road brush; the battlefield's roads are terrain, so its tools
   * would be dead buttons.
   */
  showRoadTools?: boolean;
  roadMode?: RoadMode | null;
  onSelectRoad?: (mode: RoadMode) => void;
  /** Kingdom-only wall erase brush; null when the tool is not open. */
  wallMode?: WallMode | null;
  onSelectWallErase?: () => void;
  /**
   * Phase 25: the player's Town Center level. The three drop-off camps are
   * locked until the capital reaches 1/2/3; every other building is open at 1.
   */
  townCenterLevel?: number;
}

/**
 * The order the sheet lists buildings in: structures first, economy after,
 * military last. The hotkeys printed on the buttons come from
 * `BUILDING_HOTKEY_BY_TYPE`, which is the table `CommandController` binds.
 */
const BUILDINGS: BuildingType[] = [
  'TOWN_CENTER',
  'BARRACKS',
  'STABLE',
  'ARCHERY_RANGE',
  'SIEGE_WORKSHOP',
  'HOUSE',
  'FARM',
  'TOWER',
  'WALL',
  'LUMBER_CAMP',
  'MILL',
  'MINING_CAMP'
];

/**
 * DOCK-01: the touch build sheet.
 *
 * This used to have a second, always-open desktop layout next to the entity
 * card. That dock is now `components/dock/DockBar`, whose 5x3 command card
 * fits the same 15 commands in 156 px, so what remains here is the collapsible
 * sheet a landscape phone uses: a 48 px button that opens a 4-column grid over
 * the map and closes again on every pick.
 *
 * Choosing a tile closes the sheet: the next tap is the placement, and leaving
 * the sheet open would hide the target tile.
 */
export const BuildMenu: React.FC<BuildMenuProps> = ({
  playerResources,
  activeBuildingType,
  onSelectBuilding,
  onCancelBuilding,
  showRoadTools = false,
  roadMode = null,
  onSelectRoad,
  wallMode = null,
  onSelectWallErase,
  townCenterLevel = 1
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const canAfford = (type: BuildingType) => {
    const bp = BUILDING_BLUEPRINTS[type];
    return (
      playerResources.wood >= bp.cost.wood &&
      playerResources.food >= bp.cost.food &&
      playerResources.gold >= bp.cost.gold &&
      playerResources.stone >= bp.cost.stone
    );
  };

  const pick = (type: BuildingType) => {
    const isSelected = activeBuildingType === type;
    if (isSelected) onCancelBuilding();
    else onSelectBuilding(type);
    setOpen(false);
  };

  const tiles = () =>
    BUILDINGS.map((type) => {
      const hotkey = BUILDING_HOTKEY_BY_TYPE[type];
      const bp = BUILDING_BLUEPRINTS[type];
      const thumbnail = buildingThumbnail(type);
      const affordable = canAfford(type);
      const isSelected = activeBuildingType === type;
      const unlocked = isBuildingUnlocked(type, townCenterLevel);
      const unlockLevel = getBuildingUnlockLevel(type);
      const disabled = !unlocked || !affordable;
      const title = unlocked
        ? `${buildingName(type)} — ${buildingDescription(type)}`
        : t('build.lockedAtLevel', { level: unlockLevel });

      return (
        <button
          key={type}
          onClick={() => pick(type)}
          disabled={disabled}
          title={title}
          className={`relative flex h-12 w-12 flex-col items-center justify-between rounded-md border p-0.5 transition-all ${
            isSelected
              ? 'border-amber-400 bg-amber-600/40 ring-2 ring-amber-400/60 shadow-lg'
              : disabled
                ? 'cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-600 opacity-50'
                : 'aoe-button text-slate-200'
          }`}
        >
          <div className="relative mt-0.5 flex h-7 w-7 items-center justify-center">
            {thumbnail && (
              <img
                src={thumbnail}
                alt={buildingName(type)}
                className="h-full w-full object-contain filter drop-shadow"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            )}
            {!unlocked && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-slate-950/80">
                <Lock
                  size={14}
                  className="text-amber-300"
                  aria-label={t('build.lockedAtLevel', { level: unlockLevel })}
                />
              </div>
            )}
            <div className="absolute inset-0 -z-10 flex items-center justify-center opacity-40">
              {buildingIcon(type, 20)}
            </div>
          </div>
          <span className="max-w-full truncate text-[11px] font-semibold leading-none text-slate-300">
            {buildingName(type)}
          </span>
        </button>
      );
    });

  /**
   * The brush tools. Roads are a 1x1 click-drag instead of a footprint, so they
   * are not building blueprints and cannot be listed in `BUILDINGS`. The wall
   * build brush lives in `BUILDINGS` (picking WALL enters it); only its erase
   * counterpart needs a separate button.
   */
  const brushTiles = () => {
    if (!showRoadTools) return null;
    const tools: Array<{
      key: string;
      label: string;
      hint: string;
      icon: React.ReactNode;
      active: boolean;
      onClick: () => void;
    }> = [
      {
        key: 'road-build',
        label: t('build.road'),
        hint: t('build.roadHint'),
        icon: <Route size={20} />,
        active: roadMode === 'build',
        onClick: () => onSelectRoad?.('build')
      },
      {
        key: 'road-erase',
        label: t('build.erase'),
        hint: t('build.eraseHint'),
        icon: <Eraser size={20} />,
        active: roadMode === 'erase',
        onClick: () => onSelectRoad?.('erase')
      }
    ];

    if (onSelectWallErase) {
      tools.push({
        key: 'wall-erase',
        label: t('build.eraseWall'),
        hint: t('build.eraseWallHint'),
        // Its own glyph: two identical erasers would make the road brush and the
        // wall brush indistinguishable in a 48 px sheet.
        icon: <BrickWall size={20} />,
        active: wallMode === 'erase',
        onClick: onSelectWallErase
      });
    }

    return tools.map(({ key, label, hint, icon, active, onClick }) => (
      <button
        key={key}
        type="button"
        onClick={onClick}
        title={hint}
        className={`relative flex h-12 w-12 flex-col items-center justify-between rounded-md border p-0.5 transition-all ${
          active
            ? 'border-amber-400 bg-amber-600/40 ring-2 ring-amber-400/60 shadow-lg'
            : 'aoe-button text-slate-200'
        }`}
      >
        <div className="mt-0.5 flex h-7 w-7 items-center justify-center text-amber-300">{icon}</div>
        <span className="max-w-full truncate text-[11px] font-semibold leading-none text-slate-300">
          {label}
        </span>
      </button>
    ));
  };

  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title={t('build.buildButton')}
        className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md border ${
          activeBuildingType
            ? 'border-amber-400 bg-amber-600/40 text-amber-100'
            : 'aoe-button border-amber-900/70 text-slate-200'
        }`}
      >
        <Hammer size={18} />
        <span className="text-[11px] font-semibold leading-none">{t('build.buildButton')}</span>
      </button>

      {open && (
        <div className="aoe-panel absolute bottom-full right-0 z-30 mb-2 w-[230px] rounded-lg p-2">
          <div className="mb-1.5 flex items-center justify-between border-b border-amber-800/40 pb-1">
            <span className="font-medieval text-[11px] font-bold tracking-wider text-amber-400">
              {t('build.title')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title={t('build.close')}
              aria-label={t('build.close')}
              className="flex h-11 w-11 items-center justify-center rounded border border-slate-700 text-slate-300"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {tiles()}
            {brushTiles()}
          </div>
          {activeBuildingType && (
            <button
              type="button"
              onClick={() => {
                onCancelBuilding();
                setOpen(false);
              }}
              className="mt-1.5 w-full rounded border border-red-800/60 bg-red-950/50 py-1.5 text-[11px] font-semibold uppercase text-red-300"
            >
              {t('build.cancelPlacement')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

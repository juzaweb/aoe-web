import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  Resources,
  getBuildingUnlockLevel,
  isBuildingUnlocked
} from '@chien-quoc/shared';
import {
  Landmark,
  ShieldAlert,
  House,
  Wheat,
  TowerControl,
  TreePine,
  Warehouse,
  Pickaxe,
  Target,
  Zap,
  Hammer,
  Lock,
  Route,
  Eraser,
  X
} from 'lucide-react';
import type { RoadMode } from '../game/input/RoadController.js';
import { BUILDING_HOTKEY_BY_TYPE } from '../game/input/buildingHotkeys';
import { buildingThumbnail } from './buildingThumbnails.js';
import { buildingDescription, buildingName, resourceName } from '../i18n/labels.js';

interface BuildMenuProps {
  playerResources: Resources;
  activeBuildingType: BuildingType | null;
  onSelectBuilding: (type: BuildingType) => void;
  onCancelBuilding: () => void;
  /** MOB-06: a collapsible 4-column sheet instead of the always-open desktop dock. */
  compact?: boolean;
  /**
   * Roads only exist in a kingdom: the battlefield's road network is terrain,
   * and a player-built tile there would have no price and no meaning.
   */
  showRoadTools?: boolean;
  roadMode?: RoadMode | null;
  onSelectRoad?: (mode: RoadMode) => void;
  /**
   * Phase 25: the player's Town Center level. The three drop-off camps are
   * locked until the capital reaches 1/2/3; every other building is open at 1.
   */
  townCenterLevel?: number;
}

const BUILDINGS: { type: BuildingType; icon: React.ReactNode }[] = [
  { type: 'TOWN_CENTER', icon: <Landmark size={20} /> },
  { type: 'BARRACKS', icon: <ShieldAlert size={20} /> },
  { type: 'STABLE', icon: <Zap size={20} /> },
  { type: 'ARCHERY_RANGE', icon: <Target size={20} /> },
  { type: 'HOUSE', icon: <House size={20} /> },
  { type: 'FARM', icon: <Wheat size={20} /> },
  { type: 'TOWER', icon: <TowerControl size={20} /> },
  { type: 'LUMBER_CAMP', icon: <TreePine size={20} /> },
  { type: 'MILL', icon: <Warehouse size={20} /> },
  { type: 'MINING_CAMP', icon: <Pickaxe size={20} /> }
];

/**
 * Optional thumbnails. MIL-01's `STABLE` and `ARCHERY_RANGE` sheets are generated
 * by `scripts/generate_buildings_assets.py`; an absent entry still renders the
 * lucide icon on its own instead of firing a request that can only 404. The
 * table itself lives in `buildingThumbnails.ts` so the selection panel and the
 * build menu cannot disagree about a path.
 */
export const BuildMenu: React.FC<BuildMenuProps> = ({
  playerResources,
  activeBuildingType,
  onSelectBuilding,
  onCancelBuilding,
  compact = false,
  showRoadTools = false,
  roadMode = null,
  onSelectRoad,
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

  /**
   * MOB-06: the sheet collapses after a pick — the next tap is the placement on the
   * map, so leaving the sheet over it would only hide the target tile.
   */
  const pick = (type: BuildingType) => {
    const isSelected = activeBuildingType === type;
    if (isSelected) onCancelBuilding();
    else onSelectBuilding(type);
    if (compact) setOpen(false);
  };

  const tiles = (compactTiles: boolean) =>
    BUILDINGS.map(({ type, icon }) => {
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

      const button = (
        <button
          key={type}
          onClick={() => pick(type)}
          disabled={disabled}
          title={title}
          className={`relative flex flex-col items-center justify-between rounded-md border transition-all ${
            compactTiles ? 'h-12 w-12 p-0.5' : 'h-16 w-16 p-1'
          } ${
            isSelected
              ? 'border-amber-400 bg-amber-600/40 ring-2 ring-amber-400/60 shadow-lg'
              : disabled
                ? 'cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-600 opacity-50'
                : 'aoe-button text-slate-200'
          }`}
        >
          <div
            className={`relative flex items-center justify-center ${
              compactTiles ? 'mt-0.5 h-7 w-7' : 'mt-0.5 h-10 w-10'
            }`}
          >
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
                  size={compactTiles ? 14 : 18}
                  className="text-amber-300"
                  aria-label={`Cần Nhà chính Lv ${unlockLevel}`}
                />
              </div>
            )}
            <div className="absolute inset-0 -z-10 flex items-center justify-center opacity-40">
              {icon}
            </div>
          </div>
          <span
            className={`max-w-full truncate font-semibold leading-none text-slate-300 ${
              compactTiles ? 'text-[8px]' : 'mb-0.5 max-w-[56px] text-[10px]'
            }`}
          >
            {buildingName(type)}
          </span>
          {/* MOB-06: no keyboard on a phone, so the hotkey badge is desktop only. */}
          {!compactTiles && (
            <span className="absolute right-1 top-0.5 rounded bg-black/60 px-1 font-mono text-[9px] font-bold text-amber-400">
              {hotkey}
            </span>
          )}
        </button>
      );

      if (compactTiles) return button;

      return (
        <div key={type} className="group relative">
          {button}
          {/* Tooltip */}
          <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-48 -translate-x-1/2 rounded border border-amber-600/70 bg-slate-950/95 p-2 text-left opacity-0 shadow-2xl transition-opacity group-hover:opacity-100">
            <div className="font-medieval mb-1 text-xs font-bold text-amber-300">{buildingName(type)}</div>
            <div className="mb-2 text-[11px] leading-tight text-slate-300">{buildingDescription(type)}</div>
            {!unlocked && (
              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-300">
                <Lock size={10} /> {t('build.lockedAtLevel', { level: unlockLevel })}
              </div>
            )}
            <div className="space-y-0.5 border-t border-slate-800 pt-1 font-mono text-[10px]">
              {bp.cost.wood > 0 && <div className="text-amber-400">{resourceName('wood')}: {bp.cost.wood}</div>}
              {bp.cost.food > 0 && <div className="text-red-400">{resourceName('food')}: {bp.cost.food}</div>}
              {bp.cost.gold > 0 && <div className="text-yellow-400">{resourceName('gold')}: {bp.cost.gold}</div>}
              {bp.cost.stone > 0 && <div className="text-slate-300">{resourceName('stone')}: {bp.cost.stone}</div>}
              {bp.populationProvided > 0 && (
                <div className="text-sky-400">{t('build.population')}: +{bp.populationProvided}</div>
              )}
            </div>
          </div>
        </div>
      );
    });

  /**
   * The road tool pair. Roads are a 1x1 click-drag instead of a footprint, so
   * they are not building blueprints and cannot be listed in `BUILDINGS`.
   */
  const roadTiles = (compactTiles: boolean) => {
    if (!showRoadTools) return null;
    const tools: Array<{
      mode: RoadMode;
      label: string;
      hint: string;
      icon: React.ReactNode;
    }> = [
      {
        mode: 'build',
        label: t('build.road'),
        hint: t('build.roadHint'),
        icon: <Route size={20} />
      },
      {
        mode: 'erase',
        label: t('build.erase'),
        hint: t('build.eraseHint'),
        icon: <Eraser size={20} />
      }
    ];

    return tools.map(({ mode, label, hint, icon }) => {
      const active = roadMode === mode;
      return (
        <button
          key={mode}
          type="button"
          onClick={() => onSelectRoad?.(mode)}
          title={hint}
          className={`relative flex flex-col items-center justify-between rounded-md border transition-all ${
            compactTiles ? 'h-12 w-12 p-0.5' : 'h-16 w-16 p-1'
          } ${
            active
              ? 'border-amber-400 bg-amber-600/40 ring-2 ring-amber-400/60 shadow-lg'
              : 'aoe-button text-slate-200'
          }`}
        >
          <div
            className={`relative flex items-center justify-center text-amber-300 ${
              compactTiles ? 'mt-0.5 h-7 w-7' : 'mt-0.5 h-10 w-10'
            }`}
          >
            {icon}
          </div>
          <span
            className={`max-w-full truncate font-semibold leading-none text-slate-300 ${
              compactTiles ? 'text-[8px]' : 'mb-0.5 max-w-[56px] text-[10px]'
            }`}
          >
            {label}
          </span>
        </button>
      );
    });
  };

  if (compact) {
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
          <span className="text-[9px] font-semibold leading-none">{t('build.buildButton')}</span>
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
                className="flex h-9 w-9 items-center justify-center rounded border border-slate-700 text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {tiles(true)}
              {roadTiles(true)}
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
  }

  return (
    <div className="aoe-panel pointer-events-auto flex flex-col gap-1.5 rounded-lg p-3">
      <div className="flex items-center justify-between border-b border-amber-800/40 pb-1.5">
        <span className="font-medieval text-xs font-bold tracking-wider text-amber-400">
          {t('build.title')}
        </span>
        {activeBuildingType && (
          <button
            onClick={onCancelBuilding}
            className="rounded border border-red-800/50 bg-red-950/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400 hover:text-red-300"
          >
            {t('build.cancel')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {tiles(false)}
        {roadTiles(false)}
      </div>
    </div>
  );
};

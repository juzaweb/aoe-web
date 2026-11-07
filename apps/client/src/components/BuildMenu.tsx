import React, { useState } from 'react';
import { BUILDING_BLUEPRINTS, BuildingType, Resources } from '@chien-quoc/shared';
import {
  Landmark,
  ShieldAlert,
  House,
  Wheat,
  TowerControl,
  TreePine,
  Warehouse,
  Pickaxe,
  Hammer,
  Route,
  Eraser,
  X
} from 'lucide-react';
import type { RoadMode } from '../game/input/RoadController.js';
import { BUILDING_HOTKEY_BY_TYPE } from '../game/input/buildingHotkeys';

interface BuildMenuProps {
  playerResources: Resources;
  activeBuildingType: BuildingType | null;
  onSelectBuilding: (type: BuildingType) => void;
  onCancelBuilding: () => void;
  /** MOB-06: a collapsible 4x2 sheet instead of the always-open desktop dock. */
  compact?: boolean;
  /**
   * Roads only exist in a kingdom: the battlefield's road network is terrain,
   * and a player-built tile there would have no price and no meaning.
   */
  showRoadTools?: boolean;
  roadMode?: RoadMode | null;
  onSelectRoad?: (mode: RoadMode) => void;
}

const BUILDINGS: { type: BuildingType; icon: React.ReactNode }[] = [
  { type: 'TOWN_CENTER', icon: <Landmark size={20} /> },
  { type: 'BARRACKS', icon: <ShieldAlert size={20} /> },
  { type: 'HOUSE', icon: <House size={20} /> },
  { type: 'FARM', icon: <Wheat size={20} /> },
  { type: 'TOWER', icon: <TowerControl size={20} /> },
  { type: 'LUMBER_CAMP', icon: <TreePine size={20} /> },
  { type: 'MILL', icon: <Warehouse size={20} /> },
  { type: 'MINING_CAMP', icon: <Pickaxe size={20} /> }
];

const BUILDING_THUMBNAILS: Record<BuildingType, string> = {
  TOWN_CENTER: '/assets/buildings/town_center.png?v=3',
  BARRACKS: '/assets/buildings/barracks.png?v=3',
  HOUSE: '/assets/buildings/house.png?v=3',
  FARM: '/assets/buildings/farm.png?v=3',
  TOWER: '/assets/buildings/tower.png?v=3',
  LUMBER_CAMP: '/assets/buildings/lumber_camp.png?v=1',
  MILL: '/assets/buildings/mill.png?v=1',
  MINING_CAMP: '/assets/buildings/mining_camp.png?v=1',
  // Not listed in BUILDINGS: portals are server-created. The entry only keeps
  // the exhaustive Record type-checking.
  PORTAL: '/assets/buildings/portal.png?v=3'
};

export const BuildMenu: React.FC<BuildMenuProps> = ({
  playerResources,
  activeBuildingType,
  onSelectBuilding,
  onCancelBuilding,
  compact = false,
  showRoadTools = false,
  roadMode = null,
  onSelectRoad
}) => {
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
      const affordable = canAfford(type);
      const isSelected = activeBuildingType === type;

      const button = (
        <button
          key={type}
          onClick={() => pick(type)}
          disabled={!affordable}
          title={`${bp.name} — ${bp.description}`}
          className={`relative flex flex-col items-center justify-between rounded-md border transition-all ${
            compactTiles ? 'h-12 w-12 p-0.5' : 'h-16 w-16 p-1'
          } ${
            isSelected
              ? 'border-amber-400 bg-amber-600/40 ring-2 ring-amber-400/60 shadow-lg'
              : affordable
                ? 'aoe-button text-slate-200'
                : 'cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-600 opacity-50'
          }`}
        >
          <div
            className={`relative flex items-center justify-center ${
              compactTiles ? 'mt-0.5 h-7 w-7' : 'mt-0.5 h-10 w-10'
            }`}
          >
            <img
              src={BUILDING_THUMBNAILS[type]}
              alt={bp.name}
              className="h-full w-full object-contain filter drop-shadow"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div className="absolute inset-0 -z-10 flex items-center justify-center opacity-40">
              {icon}
            </div>
          </div>
          <span
            className={`max-w-full truncate font-semibold leading-none text-slate-300 ${
              compactTiles ? 'text-[8px]' : 'mb-0.5 max-w-[56px] text-[10px]'
            }`}
          >
            {bp.name}
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
            <div className="font-medieval mb-1 text-xs font-bold text-amber-300">{bp.name}</div>
            <div className="mb-2 text-[11px] leading-tight text-slate-300">{bp.description}</div>
            <div className="space-y-0.5 border-t border-slate-800 pt-1 font-mono text-[10px]">
              {bp.cost.wood > 0 && <div className="text-amber-400">Gỗ: {bp.cost.wood}</div>}
              {bp.cost.food > 0 && <div className="text-red-400">Thịt: {bp.cost.food}</div>}
              {bp.cost.gold > 0 && <div className="text-yellow-400">Vàng: {bp.cost.gold}</div>}
              {bp.cost.stone > 0 && <div className="text-slate-300">Đá: {bp.cost.stone}</div>}
              {bp.populationProvided > 0 && (
                <div className="text-sky-400">Dân số: +{bp.populationProvided}</div>
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
        label: 'Đường',
        hint: 'Kéo để vẽ đường. 2 gỗ mỗi ô. Lính đi nhanh hơn 30% trên đường.',
        icon: <Route size={20} />
      },
      {
        mode: 'erase',
        label: 'Xoá',
        hint: 'Kéo để xoá đường của bạn. Không hoàn lại gỗ.',
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
          title="Xây công trình"
          className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md border ${
            activeBuildingType
              ? 'border-amber-400 bg-amber-600/40 text-amber-100'
              : 'aoe-button border-amber-900/70 text-slate-200'
          }`}
        >
          <Hammer size={18} />
          <span className="text-[9px] font-semibold leading-none">Xây</span>
        </button>

        {open && (
          <div className="aoe-panel absolute bottom-full right-0 z-30 mb-2 w-[230px] rounded-lg p-2">
            <div className="mb-1.5 flex items-center justify-between border-b border-amber-800/40 pb-1">
              <span className="font-medieval text-[11px] font-bold tracking-wider text-amber-400">
                XÂY CÔNG TRÌNH
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Đóng"
                aria-label="Đóng"
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
                Huỷ đặt
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
          XÂY CÔNG TRÌNH
        </span>
        {activeBuildingType && (
          <button
            onClick={onCancelBuilding}
            className="rounded border border-red-800/50 bg-red-950/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400 hover:text-red-300"
          >
            Hủy (Esc)
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

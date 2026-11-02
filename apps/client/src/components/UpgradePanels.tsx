import React from 'react';
import {
  BuildingType,
  Resources,
  UNIT_BLUEPRINTS,
  UNIT_UPGRADE_ORDER,
  UnitType,
  getBuildingMaxLevel,
  getBuildingUpgradeCost,
  getBuildingUpgradeTimeMs,
  getPlayerUnitLevel,
  getUnitMaxLevel,
  getUnitUpgradeCost,
  getUnitUpgradeTimeMs
} from '@chien-quoc/shared';
import { ArrowUp, Clock, Swords, X } from 'lucide-react';

const RESOURCE_SHORT: Record<keyof Resources, string> = {
  wood: 'Gỗ',
  food: 'Thịt',
  gold: 'Vàng',
  stone: 'Đá'
};

const RESOURCE_TEXT: Record<keyof Resources, string> = {
  wood: 'text-amber-400',
  food: 'text-red-400',
  gold: 'text-yellow-400',
  stone: 'text-slate-300'
};

const RESOURCE_ORDER: Array<keyof Resources> = ['wood', 'food', 'gold', 'stone'];

const CostChips: React.FC<{ cost: Resources }> = ({ cost }) => (
  <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-[9px] leading-tight font-mono">
    {RESOURCE_ORDER.filter((resource) => cost[resource] > 0).map((resource) => (
      <span key={resource} className={RESOURCE_TEXT[resource]}>
        {RESOURCE_SHORT[resource]}: {cost[resource]}
      </span>
    ))}
  </div>
);

const ProgressBar: React.FC<{ percent: number; tone: 'amber' | 'sky' }> = ({ percent, tone }) => (
  <div className="w-full h-2 rounded bg-slate-900 border border-slate-700 overflow-hidden">
    <div
      className={`h-full transition-all duration-200 ${
        tone === 'amber' ? 'bg-amber-500' : 'bg-sky-500'
      }`}
      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
    />
  </div>
);

function canAfford(resources: Resources, cost: Resources): boolean {
  return (
    resources.wood >= cost.wood &&
    resources.food >= cost.food &&
    resources.gold >= cost.gold &&
    resources.stone >= cost.stone
  );
}

interface BuildingUpgradePanelProps {
  buildingId: string;
  type: BuildingType;
  level: number;
  maxLevel?: number;
  upgradeProgressMs?: number;
  upgradeTimeMs?: number;
  playerResources: Resources;
  onUpgrade: (buildingId: string) => void;
  onCancel: (buildingId: string) => void;
}

/** Owned, finished building: start the next level or watch/cancel the timer. */
export const BuildingUpgradePanel: React.FC<BuildingUpgradePanelProps> = ({
  buildingId,
  type,
  level,
  maxLevel,
  upgradeProgressMs = 0,
  upgradeTimeMs = 0,
  playerResources,
  onUpgrade,
  onCancel
}) => {
  const cap = maxLevel ?? getBuildingMaxLevel(type);
  const isUpgrading = upgradeTimeMs > 0;
  const isMaxed = level >= cap;
  const cost = getBuildingUpgradeCost(type, level);
  const duration = getBuildingUpgradeTimeMs(type, level);
  const affordable = canAfford(playerResources, cost);
  const progressPercent =
    (upgradeProgressMs / Math.max(1, upgradeTimeMs)) * 100;

  return (
    <div className="border-t border-slate-800 pt-2 space-y-1.5" data-upgrade>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-amber-400 tracking-wider flex items-center gap-1">
          <ArrowUp size={12} /> NÂNG CẤP CÔNG TRÌNH
        </span>
        <span className="text-[10px] text-amber-300 font-mono">
          Lv {level}/{cap}
        </span>
      </div>

      {isUpgrading ? (
        <>
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-amber-400" /> Đang nâng cấp
            </span>
            <span className="font-mono text-amber-300">
              {Math.floor(upgradeProgressMs / 1000)}s / {Math.ceil(upgradeTimeMs / 1000)}s
            </span>
          </div>
          <ProgressBar percent={progressPercent} tone="amber" />
          <button
            onClick={() => onCancel(buildingId)}
            className="w-full px-2 py-1 rounded border border-red-800/70 bg-red-950/40 text-[10px] font-semibold text-red-300 hover:border-red-500 transition-all flex items-center justify-center gap-1"
            title="Huỷ nâng cấp, hoàn lại toàn bộ tài nguyên"
          >
            <X size={12} /> Huỷ nâng cấp (hoàn tiền)
          </button>
        </>
      ) : isMaxed ? (
        <p className="text-[10px] text-emerald-300/90 italic">Đã đạt cấp tối đa.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <CostChips cost={cost} />
            <span className="text-[9px] text-slate-400 font-mono shrink-0">
              {(duration / 1000).toFixed(1)}s
            </span>
          </div>
          <button
            onClick={() => onUpgrade(buildingId)}
            disabled={!affordable}
            className={`w-full px-2 py-1 rounded border text-[10px] font-semibold transition-all flex items-center justify-center gap-1 ${
              affordable
                ? 'aoe-button text-amber-200 hover:border-amber-400'
                : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
            }`}
          >
            <ArrowUp size={12} /> Nâng lên Lv {level + 1}
          </button>
        </>
      )}
    </div>
  );
};

interface BarracksResearchPanelProps {
  unitLevels: number[];
  researchUnitType?: string;
  researchProgressMs?: number;
  researchTimeMs?: number;
  playerResources: Resources;
  onUpgradeUnitType: (unitType: UnitType) => void;
  onCancelResearch: (unitType: UnitType) => void;
}

/**
 * Barracks-only research board. One player-wide timer at a time; every card is
 * disabled while it runs, and the active type shows its progress instead.
 */
export const BarracksResearchPanel: React.FC<BarracksResearchPanelProps> = ({
  unitLevels,
  researchUnitType = '',
  researchProgressMs = 0,
  researchTimeMs = 0,
  playerResources,
  onUpgradeUnitType,
  onCancelResearch
}) => {
  const busy = Boolean(researchUnitType);
  const progressPercent = (researchProgressMs / Math.max(1, researchTimeMs)) * 100;

  return (
    <div className="border-t border-slate-800 pt-2 space-y-1.5" data-research>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-amber-400 tracking-wider flex items-center gap-1">
          <Swords size={12} /> NGHIÊN CỨU QUÂN ĐỘI
        </span>
        <span className="text-[9px] text-slate-500 font-mono">Toàn cục</span>
      </div>

      {researchUnitType && (
        <>
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span className="flex items-center gap-1">
              <Clock size={12} className="text-sky-400" />
              {UNIT_BLUEPRINTS[researchUnitType as UnitType]?.name ?? researchUnitType}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-sky-300">
                {Math.floor(researchProgressMs / 1000)}s / {Math.ceil(researchTimeMs / 1000)}s
              </span>
              <button
                onClick={() => onCancelResearch(researchUnitType as UnitType)}
                className="w-4 h-4 rounded border border-red-800/70 bg-red-950/60 text-red-300 hover:border-red-500 hover:text-red-200 flex items-center justify-center transition-all"
                title="Huỷ nghiên cứu, hoàn lại toàn bộ tài nguyên"
              >
                <X size={10} />
              </button>
            </span>
          </div>
          <ProgressBar percent={progressPercent} tone="sky" />
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        {UNIT_UPGRADE_ORDER.map((unitType) => {
          const level = getPlayerUnitLevel(unitLevels, unitType);
          const maxLevel = getUnitMaxLevel();
          const atMax = level >= maxLevel;
          const cost = getUnitUpgradeCost(unitType, level);
          const duration = getUnitUpgradeTimeMs(unitType, level);
          const affordable = canAfford(playerResources, cost);
          const researchingThis = researchUnitType === unitType;

          return (
            <div
              key={unitType}
              className="rounded border border-slate-800 bg-slate-950/40 p-1.5 space-y-1"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold text-slate-200 truncate">
                  {UNIT_BLUEPRINTS[unitType].name}
                </span>
                <span
                  className={`text-[9px] font-mono shrink-0 ${
                    atMax ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  Lv {level}/{maxLevel}
                </span>
              </div>

              {atMax ? (
                <div className="text-[9px] text-emerald-300/80 text-center py-1">Tối đa</div>
              ) : (
                <>
                  <CostChips cost={cost} />
                  <button
                    onClick={() => onUpgradeUnitType(unitType)}
                    disabled={busy || !affordable}
                    title={`Nâng lên Lv ${level + 1} • ${(duration / 1000).toFixed(1)}s`}
                    className={`w-full px-1 py-0.5 rounded border text-[9px] font-semibold transition-all ${
                      busy || !affordable
                        ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                        : 'aoe-button text-amber-200 hover:border-amber-400'
                    }`}
                  >
                    {researchingThis ? 'Đang nghiên cứu' : `Nâng Lv ${level + 1}`}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

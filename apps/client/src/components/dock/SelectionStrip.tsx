import React from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Gauge, Pickaxe, Shield, Swords, Timer } from 'lucide-react';
import {
  BUILDING_BLUEPRINTS,
  isTrainerBuilding,
  type BuildingType,
  type UnitType,
  dropOffGatherMultiplier,
  townCenterAuraMultiplier,
  townCenterUnitAttackMultiplier,
  trainerSpeedMultiplier,
  trainerUnitBuffMultiplier
} from '@chien-quoc/shared';
import type { SelectedEntityData } from '../../game/scenes/WorldScene.js';
import { buildingThumbnail } from '../buildingThumbnails.js';
import { resourceThumbnail } from '../resourceThumbnails.js';
import { resourceName, stanceName, unitName } from '../../i18n/labels.js';
import { unitThumbnail } from '../unitThumbnails.js';

export interface SelectionStripProps {
  entity: SelectedEntityData;
  /** Localized name of the selected entity. */
  displayName: string;
}

/** CMB-01: same stance colours as `EntityDetails`, same order as the `D` key. */
const STANCE_CLASSES: Record<string, string> = {
  AGGRESSIVE: 'text-emerald-300',
  DEFENSIVE: 'text-sky-300',
  STAND_GROUND: 'text-amber-300',
  NO_ATTACK: 'text-slate-400'
};

/** 36 px portrait source for the selection, or `null` for the placeholder box. */
function portraitUrl(entity: SelectedEntityData): string | null {
  if (entity.type === 'unit' && entity.subType) return unitThumbnail(entity.subType);
  if (entity.type === 'building' && entity.subType) return buildingThumbnail(entity.subType);
  if (entity.type === 'resource' && entity.subType) return resourceThumbnail(entity.subType);
  return null;
}

interface StatusChip {
  /** Stable key, also the `data-status-chip` value. */
  key: string;
  label: string;
  tone: string;
}

/** Compact one-line summary of a building's level bonus or visual tier. */
function summarizeBuildingStats(
  entity: SelectedEntityData,
  t: (key: string) => string
): { icon: 'shield' | 'pickaxe'; text: string } | null {
  if (entity.type !== 'building' || !entity.subType) return null;
  const bType = entity.subType as BuildingType;
  const bp = BUILDING_BLUEPRINTS[bType];
  const level = entity.level ?? 1;

  if (bType === 'TOWN_CENTER' && entity.isOwner) {
    const ownerTc = entity.ownerTownCenterLevel ?? level;
    const hpBuff = Math.round((townCenterAuraMultiplier(ownerTc) - 1) * 100);
    const atkBuff = Math.round((townCenterUnitAttackMultiplier(ownerTc) - 1) * 100);
    if (hpBuff > 0 || atkBuff > 0) {
      return {
        icon: 'shield',
        text: `+${hpBuff}% HP · +${atkBuff}% ${t('details.attackPower')}`
      };
    }
  } else if (isTrainerBuilding(bType)) {
    const speedPct = Math.round((1 - trainerSpeedMultiplier(level)) * 100);
    const buffPct = Math.round((trainerUnitBuffMultiplier(level) - 1) * 100);
    if (speedPct > 0 || buffPct > 0) {
      return {
        icon: 'shield',
        text: `-${speedPct}% ${t('stats.trainingTime')} · +${buffPct}%`
      };
    }
  } else if ((bp?.dropOffs.length ?? 0) > 0) {
    const gatherPct = Math.round((dropOffGatherMultiplier(level) - 1) * 100);
    if (gatherPct > 0) {
      return {
        icon: 'pickaxe',
        text: `+${gatherPct}% ${t('stats.gatherSpeed')}`
      };
    }
  }

  return entity.visualTierName ? { icon: 'shield', text: entity.visualTierName } : null;
}

/**
 * DOCK-05: identity, health, core stats and status chips inside the fixed
 * 156 px dock height with no scrolling.
 */
export const SelectionStrip: React.FC<SelectionStripProps> = ({
  entity,
  displayName
}) => {
  const { t } = useTranslation();
  const portrait = portraitUrl(entity);
  const hpShown = entity.hp !== undefined && entity.maxHp !== undefined;
  const hpRatio = hpShown && entity.maxHp! > 0 ? entity.hp! / entity.maxHp! : 0;
  const hpClass =
    hpRatio > 0.5 ? 'bg-emerald-500' : hpRatio > 0.25 ? 'bg-amber-500' : 'bg-red-500';

  /** DOCK-05: at most five chips, so two wrapped lines is the worst case. */
  const chips: StatusChip[] = [];
  if (entity.stance) {
    chips.push({
      key: 'stance',
      label: stanceName(entity.stance),
      tone: STANCE_CLASSES[entity.stance] ?? 'text-slate-300'
    });
  }
  if ((entity.carryingAmount ?? 0) > 0) {
    const carried = entity.carryingResourceType
      ? resourceName(entity.carryingResourceType)
      : '';
    chips.push({
      key: 'carrying',
      label: `${entity.carryingAmount} ${carried}`.trim(),
      tone: 'text-amber-300'
    });
  }
  if ((entity.trainingQueue?.length ?? 0) > 0) {
    chips.push({
      key: 'training',
      label: t('details.queue', { count: entity.trainingQueue?.length ?? 0 }),
      tone: 'text-amber-300'
    });
  }
  if (entity.isConstructed === false) {
    chips.push({
      key: 'construction',
      label: `${t('details.underConstruction')} ${Math.floor(entity.constructionProgress ?? 0)}%`,
      tone: 'text-amber-300'
    });
  }
  if ((entity.upgradeTimeMs ?? 0) > 0) {
    const percent = Math.floor(
      ((entity.upgradeProgressMs ?? 0) / Math.max(1, entity.upgradeTimeMs ?? 0)) * 100
    );
    chips.push({ key: 'upgrade', label: `${t('dock.upgrade')} ${percent}%`, tone: 'text-sky-300' });
  }
  if (entity.researchUnitType) {
    const percent =
      (entity.researchTimeMs ?? 0) > 0
        ? ` ${Math.floor(
            ((entity.researchProgressMs ?? 0) / Math.max(1, entity.researchTimeMs ?? 0)) * 100
          )}%`
        : '';
    chips.push({
      key: 'research',
      label: `${unitName(entity.researchUnitType as UnitType)}${percent}`,
      tone: 'text-sky-300'
    });
  }

  const showUnitStats = entity.type === 'unit' && entity.attackPower !== undefined;
  const showResourceStats = entity.remainingAmount !== undefined;
  const buildingStatSummary =
    !showUnitStats && !showResourceStats ? summarizeBuildingStats(entity, t) : null;

  return (
    <div
      data-selection-strip
      className="aoe-panel pointer-events-auto flex h-full min-w-0 flex-1 flex-col gap-1.5 overflow-hidden rounded p-2"
    >
      {/* Row 1: portrait and name/type. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {portrait ? (
          <img
            src={portrait}
            alt=""
            className="aoe-panel-inset h-9 w-9 shrink-0 rounded border border-amber-600/70 object-contain p-0.5"
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="aoe-panel-inset flex h-9 w-9 shrink-0 items-center justify-center rounded border border-amber-600/70 text-[11px] font-bold text-amber-500">
            ?
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <span
            data-selection-name
            title={displayName}
            className="truncate font-medieval text-xs font-bold text-amber-300"
          >
            {displayName}
          </span>
          <span className="truncate font-mono text-[11px] uppercase tracking-wider text-slate-400">
            {t(`entityType.${entity.type}`, { defaultValue: entity.type })}
            {entity.level !== undefined && (
              <span className="ml-1.5 normal-case text-amber-400">
                Lv {entity.level}
                {entity.maxLevel !== undefined ? `/${entity.maxLevel}` : ''}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Row 2: only entities that can take damage get a bar. */}
      {hpShown && (
        <div className="flex min-w-0 shrink-0 items-center gap-2" data-selection-hp>
          <div className="aoe-bar h-2 min-w-0 flex-1 overflow-hidden rounded-sm">
            <div
              className={`h-full transition-all duration-200 ${hpClass}`}
              style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber-100/90">
            {entity.hp} / {entity.maxHp}
          </span>
        </div>
      )}

      {/* Row 3: core stats bar so the middle AoE card stays informative without scrolling. */}
      {showUnitStats && (
        <div
          data-selection-stats
          className="aoe-panel-inset grid shrink-0 grid-cols-4 gap-1 rounded px-2 py-1 text-[11px] font-mono tabular-nums text-slate-200"
        >
          <span
            className="flex items-center gap-1 truncate"
            title={t('details.attackPower')}
          >
            <Swords size={12} className="shrink-0 text-red-400" aria-hidden />
            <span className="text-emerald-300">{entity.attackPower}</span>
          </span>
          <span
            className="flex items-center gap-1 truncate"
            title={t('details.attackRange')}
          >
            <Crosshair size={12} className="shrink-0 text-sky-400" aria-hidden />
            <span>{(entity.attackRange ?? 0).toFixed(1)}</span>
          </span>
          <span
            className="flex items-center gap-1 truncate"
            title={t('details.cooldown')}
          >
            <Timer size={12} className="shrink-0 text-amber-400" aria-hidden />
            <span>{`${((entity.attackCooldownMs ?? 0) / 1000).toFixed(1)}s`}</span>
          </span>
          <span
            className="flex items-center gap-1 truncate"
            title={t('details.speed')}
          >
            <Gauge size={12} className="shrink-0 text-emerald-400" aria-hidden />
            <span>{(entity.speed ?? 0).toFixed(1)}</span>
          </span>
        </div>
      )}

      {showResourceStats && (
        <div
          data-selection-stats
          className="aoe-panel-inset flex shrink-0 items-center justify-between gap-2 rounded px-2 py-1 text-[11px]"
        >
          <span className="flex items-center gap-1 text-slate-300">
            <Pickaxe size={12} className="shrink-0 text-amber-400" aria-hidden />
            {t('details.remaining')}
          </span>
          <span className="font-mono font-semibold tabular-nums text-amber-200">
            {`${entity.remainingAmount}${entity.maxAmount !== undefined ? ` / ${entity.maxAmount}` : ''}`}
          </span>
        </div>
      )}

      {buildingStatSummary && (
        <div
          data-selection-stats
          className="aoe-panel-inset flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11px] text-amber-200"
        >
          {buildingStatSummary.icon === 'pickaxe' ? (
            <Pickaxe size={12} className="shrink-0 text-amber-400" aria-hidden />
          ) : (
            <Shield size={12} className="shrink-0 text-amber-400" aria-hidden />
          )}
          <span className="truncate">{buildingStatSummary.text}</span>
        </div>
      )}

      {/* Row 4: what the selection is doing right now. */}
      {chips.length > 0 && (
        <div
          data-selection-status
          className="flex max-h-[34px] min-w-0 flex-wrap gap-1 overflow-hidden"
        >
          {chips.map((chip) => (
            <span
              key={chip.key}
              data-status-chip={chip.key}
              title={chip.label}
              className={`aoe-chip truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${chip.tone}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

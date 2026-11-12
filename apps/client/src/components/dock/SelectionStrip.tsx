import React from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { UnitType } from '@chien-quoc/shared';
import type { SelectedEntityData } from '../../game/scenes/WorldScene.js';
import { buildingThumbnail } from '../buildingThumbnails.js';
import { resourceThumbnail } from '../resourceThumbnails.js';
import { resourceName, stanceName, unitName } from '../../i18n/labels.js';
import { unitThumbnail } from './commandPages.js';

export interface SelectionStripProps {
  entity: SelectedEntityData;
  /** Localized name, shared with the popover title so both always agree. */
  displayName: string;
  /** The detail popover is open, which the Details button reflects. */
  detailsOpen: boolean;
  onToggleDetails: () => void;
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

/**
 * DOCK-05: one line of identity, one line of health and one wrapped row of
 * statuses.
 *
 * The strip is a summary, not a second `EntityDetails`: at 156 px of dock the
 * only job is "what is selected, how hurt is it, what is it doing". Everything
 * that needs a paragraph (stats, upgrades, queues) lives in the popover this
 * button opens, so the strip can be pure read-only text with no scrolling —
 * the dock is height-locked and must never grow with a selection.
 */
export const SelectionStrip: React.FC<SelectionStripProps> = ({
  entity,
  displayName,
  detailsOpen,
  onToggleDetails
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

  return (
    <div
      data-selection-strip
      className="aoe-panel pointer-events-auto flex h-full min-w-0 flex-1 flex-col gap-1 overflow-hidden rounded-lg p-2"
    >
      {/* Row 1: portrait, name/type, and the one button that leaves the strip. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {portrait ? (
          <img
            src={portrait}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md border border-amber-500/60 bg-slate-900/90 object-contain p-0.5"
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-amber-500/60 bg-slate-900/90 text-[11px] font-bold text-amber-500">
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

        <button
          type="button"
          onClick={onToggleDetails}
          aria-expanded={detailsOpen}
          aria-controls="dock-details"
          title={t('dock.detailsTitle')}
          aria-label={t('dock.detailsTitle')}
          data-selection-details
          className={`flex min-h-[28px] shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
            detailsOpen
              ? 'border-amber-400 bg-amber-600/30 text-amber-100'
              : 'aoe-button border-amber-900/70 text-slate-200'
          }`}
        >
          <Info size={12} aria-hidden />
          {t('dock.details')}
        </button>
      </div>

      {/* Row 2: only entities that can take damage get a bar. */}
      {hpShown && (
        <div className="flex min-w-0 shrink-0 items-center gap-2" data-selection-hp>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded border border-slate-700 bg-slate-900">
            <div
              className={`h-full transition-all duration-200 ${hpClass}`}
              style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-slate-300">
            {entity.hp} / {entity.maxHp}
          </span>
        </div>
      )}

      {/* Row 3: what the selection is doing right now, capped at two lines. */}
      {chips.length > 0 && (
        <div
          data-selection-status
          className="flex max-h-[38px] min-w-0 flex-wrap gap-1 overflow-hidden"
        >
          {chips.map((chip) => (
            <span
              key={chip.key}
              data-status-chip={chip.key}
              title={chip.label}
              className={`truncate rounded border border-slate-700/70 bg-slate-900/70 px-1 py-0.5 text-[11px] leading-none ${chip.tone}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

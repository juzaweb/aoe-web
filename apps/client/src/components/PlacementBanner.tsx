import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BrickWall, Eraser, Hammer, Route, X } from 'lucide-react';
import { BUILDING_BLUEPRINTS, type BuildingType, type Resources } from '@chien-quoc/shared';
import type { RoadMode } from '../game/input/RoadController.js';
import type { WallMode } from '../game/input/WallController.js';
import { buildingName, resourceName } from '../i18n/labels.js';

interface PlacementBannerProps {
  /** A building footprint is being placed (`WALL` enters the wall brush). */
  buildingType: BuildingType | null;
  roadMode: RoadMode | null;
  wallMode: WallMode | null;
  /** Live stockpile, so the banner can warn before the server rejects a drop. */
  resources: Resources;
  /** MOB-06: phones keep the banner out of the compact HUD row. */
  compact?: boolean;
  /** Leaves whichever mode is active; wired to the scene's own cancel paths. */
  onCancel: () => void;
}

const RESOURCE_ORDER: Array<keyof Resources> = ['wood', 'food', 'gold', 'stone'];

/**
 * UIX-02: the persistent reminder that the next map tap places something.
 *
 * Selecting a building from the mobile sheet closes the sheet, which used to
 * leave only a translucent ghost with no explanation and no visible way out.
 * The banner names what is being placed, repeats the price so a player can back
 * out before spending it, and carries its own Cancel button so leaving the mode
 * never depends on finding the closed sheet again.
 */
export const PlacementBanner: React.FC<PlacementBannerProps> = ({
  buildingType,
  roadMode,
  wallMode,
  resources,
  compact = false,
  onCancel
}) => {
  const { t } = useTranslation();

  // Road / wall brushes are not buildings: they paint tiles and are cancelled
  // with the same button, but their label does not come from a blueprint.
  if (roadMode) {
    return (
      <PlacementShell
        compact={compact}
        icon={<Route size={16} className="text-amber-300" />}
        title={t('placement.road')}
        hint={t('placement.roadHint')}
        onCancel={onCancel}
      />
    );
  }
  if (wallMode === 'erase') {
    return (
      <PlacementShell
        compact={compact}
        icon={<Eraser size={16} className="text-amber-300" />}
        title={t('placement.wallErase')}
        hint={t('placement.wallEraseHint')}
        onCancel={onCancel}
      />
    );
  }
  if (wallMode === 'build') {
    return (
      <PlacementShell
        compact={compact}
        icon={<BrickWall size={16} className="text-amber-300" />}
        title={t('placement.wall')}
        hint={t('placement.wallHint')}
        onCancel={onCancel}
      />
    );
  }
  if (!buildingType) return null;

  const blueprint = BUILDING_BLUEPRINTS[buildingType];
  const costs = RESOURCE_ORDER.filter((key) => blueprint.cost[key] > 0);
  const unaffordable = costs.filter((key) => resources[key] < blueprint.cost[key]);

  return (
    <PlacementShell
      compact={compact}
      icon={<Hammer size={16} className="text-amber-300" />}
      title={t('placement.placing', { name: buildingName(buildingType) })}
      hint={t('placement.hint')}
      onCancel={onCancel}
      footer={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" data-placement-cost>
          {costs.map((key) => {
            const short = resources[key] < blueprint.cost[key];
            return (
              <span
                key={key}
                className={short ? 'font-bold text-red-400' : 'text-slate-300'}
                title={t('placement.stock', { amount: Math.floor(resources[key]) })}
              >
                {resourceName(key)} {blueprint.cost[key]}
              </span>
            );
          })}
          {unaffordable.length > 0 && (
            <span className="flex items-center gap-1 font-semibold text-red-300">
              <AlertTriangle size={12} /> {t('placement.insufficient')}
            </span>
          )}
        </div>
      }
    />
  );
};

interface PlacementShellProps {
  compact: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  footer?: React.ReactNode;
  onCancel: () => void;
}

/** One pill for every placement flavour; only the words and icon change. */
const PlacementShell: React.FC<PlacementShellProps> = ({
  compact,
  icon,
  title,
  hint,
  footer,
  onCancel
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="aoe-frame-sm pointer-events-auto flex max-w-full items-center gap-2 bg-slate-950/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-md"
      data-placement-banner
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      {/* `role="status"` announces the mode when it opens, so a screen-reader
          player learns that the next map tap places a building. It deliberately
          wraps the words only: a live region that also contains the Cancel
          button re-announces a control label as if it were status text, and
          makes the button harder to reach in a screen reader's form list. */}
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <div className="truncate text-[11px] font-bold uppercase tracking-wide text-amber-200">{title}</div>
        <div className="truncate text-[11px] text-slate-300">{hint}</div>
        {footer}
      </div>
      <button
        type="button"
        onClick={onCancel}
        title={t('placement.cancelTitle')}
        aria-label={t('placement.cancelTitle')}
        style={compact ? { minHeight: 44, minWidth: 44 } : undefined}
        className="aoe-button aoe-button-danger flex shrink-0 items-center justify-center gap-1 px-2 py-1 text-[11px] font-bold uppercase text-red-200 transition-colors hover:text-red-100"
      >
        <X size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{t('placement.cancel')}</span>
      </button>
    </div>
  );
};

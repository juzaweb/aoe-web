import React, { useId, useRef, useState } from 'react';
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
import { buildingThumbnail } from './buildingThumbnails.js';
import { buildingIcon } from './buildingIcons.js';
import { buildingDescription, buildingName, resourceName } from '../i18n/labels.js';
import { useModalFocus } from './useModalFocus.js';

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
 * military last. The sheet prints no hotkey badges — a touch sheet has no
 * keyboard — but the order is kept aligned with the binding table
 * `CommandController` builds from `BUILDING_HOTKEY_BY_TYPE`, so the two never
 * disagree about which building sits where.
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

/** Same order the stockpile chips and the placement banner use. */
const RESOURCE_ORDER: Array<keyof Resources> = ['wood', 'food', 'gold', 'stone'];

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
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /** `aria-controls` target: the sheet element itself, not its heading. */
  const sheetId = `${titleId}-sheet`;

  // UIX-09: the sheet covers part of the map and floats above the dock, so while
  // it is open it behaves as a modal dialog — focus enters it, Tab circles
  // inside it, and Esc returns focus to the build button that opened it.
  useModalFocus(sheetRef, open, () => setOpen(false));

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

  /** Price line of the tooltip; short stock turns red instead of being hidden. */
  const costChips = (type: BuildingType) => {
    const bp = BUILDING_BLUEPRINTS[type];
    return RESOURCE_ORDER.filter((key) => bp.cost[key] > 0).map((key) => (
      <span
        key={key}
        className={`mr-2 ${playerResources[key] < bp.cost[key] ? 'text-red-400' : 'text-slate-300'}`}
      >
        {resourceName(key)}: {bp.cost[key]}
      </span>
    ));
  };

  const tiles = () =>
    BUILDINGS.map((type, index) => {
      const bp = BUILDING_BLUEPRINTS[type];
      const thumbnail = buildingThumbnail(type);
      const affordable = canAfford(type);
      const isSelected = activeBuildingType === type;
      const unlocked = isBuildingUnlocked(type, townCenterLevel);
      const unlockLevel = getBuildingUnlockLevel(type);
      const disabled = !unlocked || !affordable;
      const tooltipId = `${titleId}-${type.toLowerCase()}`;
      // The sheet hangs off the right edge of the dock, so the last column has
      // to open its tooltip inwards or it would spill off the screen.
      const hangsRight = index % 4 === 3;

      return (
        <div key={type} className="group relative h-12 w-12">
          <button
            onClick={() => pick(type)}
            disabled={disabled}
            // UIX-15: the price and the unlock requirement live in the tooltip,
            // so the button has to point at it — `title` alone never reached a
            // screen reader as a description and never opened on focus.
            aria-describedby={tooltipId}
            aria-pressed={isSelected}
            className={`aoe-button relative flex h-full w-full flex-col items-center justify-between p-0.5 transition-all ${
              isSelected
                ? 'text-amber-100'
                : disabled
                  ? 'cursor-not-allowed text-slate-600'
                  : 'text-slate-200'
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

          {/* UIX-15: hover for the mouse, `focus-within` for the keyboard and
              `active` for a finger — the sheet is the only way to reach a
              building on a phone, which has neither hover nor Tab. */}
          <div
            id={tooltipId}
            role="tooltip"
            className={`aoe-tooltip pointer-events-none absolute bottom-full z-40 mb-1.5 w-44 p-2 text-left opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-active:opacity-100 ${
              hangsRight ? 'right-0' : 'left-1/2 -translate-x-1/2'
            }`}
          >
            {/* Hidden from assistive tech: the button already announces its own
                name, and a description that repeats it reads as a duplicate. */}
            <span
              aria-hidden="true"
              className="font-medieval mb-0.5 block text-xs font-bold text-amber-300"
            >
              {buildingName(type)}
            </span>
            <span className="mb-1 block text-[11px] text-slate-300">
              {buildingDescription(type)}
            </span>
            {!unlocked && (
              <span className="mb-1 block text-[11px] font-semibold text-amber-300">
                {t('build.lockedAtLevel', { level: unlockLevel })}
              </span>
            )}
            <span className="block border-t border-slate-800 pt-1 font-mono text-[11px]">
              {costChips(type)}
            </span>
          </div>
        </div>
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
        aria-pressed={active}
        className={`aoe-button relative flex h-12 w-12 flex-col items-center justify-between p-0.5 transition-all ${
          active ? 'text-amber-100' : 'text-slate-200'
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
        aria-controls={sheetId}
        title={t('build.buildButton')}
        className={`aoe-button flex h-12 w-12 flex-col items-center justify-center gap-0.5 ${
          activeBuildingType ? 'text-amber-100' : 'text-slate-200'
        }`}
      >
        <Hammer size={18} />
        <span className="text-[11px] font-semibold leading-none">{t('build.buildButton')}</span>
      </button>

      {open && (
        <div
          ref={sheetRef}
          id={sheetId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="aoe-panel absolute bottom-full right-0 z-30 mb-2 w-[230px] rounded-lg p-2"
        >
          <div className="mb-1.5 flex items-center justify-between border-b border-amber-800/40 pb-1">
            <h2
              id={titleId}
              className="font-medieval text-[11px] font-bold tracking-wider text-amber-400"
            >
              {t('build.title')}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title={t('build.close')}
              aria-label={t('build.close')}
              // UIX-14: 36 px is the desktop box; the sheet only exists on a
              // phone, so the 44 px floor always applies here.
              style={{ minHeight: 44, minWidth: 44 }}
              className="aoe-button flex h-9 w-9 items-center justify-center text-slate-300"
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
              className="aoe-button aoe-button-danger mt-1.5 w-full py-1.5 text-[11px] font-semibold uppercase text-red-300"
            >
              {t('build.cancelPlacement')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

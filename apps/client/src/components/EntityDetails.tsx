import React from 'react';
import { SelectedEntityData } from '../game/scenes/WorldScene.js';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  Resources,
  UNIT_BLUEPRINTS,
  UnitType,
  getEffectiveTrainTimeMs,
  getEffectiveUnitAttackPower,
  getEffectiveUnitMaxHp,
  getPlayerUnitLevel,
  getUnitMaxLevel,
  dropOffGatherMultiplier,
  dropOffRange,
  trainerSpeedMultiplier,
  trainerUnitBuffMultiplier,
  townCenterAuraMultiplier,
  townCenterUnitAttackMultiplier
} from '@chien-quoc/shared';
import { Shield, UserPlus, Heart, Hammer, X, Trash2, Boxes, Swords, Crosshair, Timer, Gauge } from 'lucide-react';
import { BuildingUpgradePanel, UnitResearchPanel } from './UpgradePanels.js';
import { UNIT_TRAINING_HOTKEY_BY_TYPE } from '../game/input/unitHotkeys.js';
import { buildingThumbnail } from './buildingThumbnails.js';
import { resourceThumbnail } from './resourceThumbnails.js';
import { useTranslation } from 'react-i18next';
import {
  buildingName,
  resourceName,
  resourceNodeName,
  stanceName,
  unitDescription,
  unitName
} from '../i18n/labels.js';

/**
 * CMB-01: stance colours, in the same order the `D` key cycles them. The names
 * themselves come from the i18n catalog via `stanceName`.
 */
const STANCE_CLASSES: Record<string, string> = {
  AGGRESSIVE: 'text-emerald-300',
  DEFENSIVE: 'text-sky-300',
  STAND_GROUND: 'text-amber-300',
  NO_ATTACK: 'text-slate-400'
};

interface EntityDetailsProps {
  /**
   * UIX-07: callers mount this panel only while something is selected, so the
   * empty-state placeholder no longer exists even as a branch.
   */
  entity: SelectedEntityData;
  playerResources: Resources;
  /** Phase 23: true while the player is attacking somebody else's kingdom. */
  inRaid?: boolean;
  /** Phase 23: leaves the raid through the retreat gate. */
  onRetreat?: () => void;
  onTrainUnit: (buildingId: string, unitType: UnitType) => void;
  /** CMD-04a: drops the first unit in the training queue and refunds it. */
  onCancelTrain: (buildingId: string) => void;
  /** Removes a foundation or demolishes a completed building. */
  onCancelBuilding: (buildingId: string) => void;
  /** LVL: starts upgrading one owned, finished building. */
  onUpgradeBuilding: (buildingId: string) => void;
  /** LVL: cancels an in-flight upgrade and refunds its cost. */
  onCancelBuildingUpgrade: (buildingId: string) => void;
  /** MIL-01: starts a player-wide research for one unit type (its trainer only). */
  onUpgradeUnitType: (unitType: UnitType) => void;
  /** LVL: cancels the in-flight unit research. */
  onCancelUnitUpgrade: (unitType: UnitType) => void;
  /** MOB-06: fit the landscape phone dock instead of the desktop centre column. */
  compact?: boolean;
  /**
   * DOCK-07: `panel` is the historical self-sizing card; `popover` is the same
   * content inside `DetailsPopover`, which owns the width and the scrolling, so
   * the card must not impose its own 320 px width or its viewport height caps.
   */
  variant?: 'panel' | 'popover';
  /**
   * MOB-06: how this player orders units. Touch players hold the target, mouse
   * players right-click it, and the help text must not teach the wrong gesture.
   */
  interactionHint?: 'right-click' | 'long-press';
}

export const EntityDetails: React.FC<EntityDetailsProps> = ({
  entity,
  playerResources,
  inRaid = false,
  onRetreat,
  onTrainUnit,
  onCancelTrain,
  onCancelBuilding,
  onUpgradeBuilding,
  onCancelBuildingUpgrade,
  onUpgradeUnitType,
  onCancelUnitUpgrade,
  compact = false,
  interactionHint = 'right-click',
  variant = 'panel'
}) => {
  const { t } = useTranslation();
  const buildingBp = entity.type === 'building' ? BUILDING_BLUEPRINTS[entity.subType as BuildingType] : null;
  const trainableUnits = buildingBp ? buildingBp.trainableUnits : [];
  // MIL-01: `null` only for a building type that ships no sheet, so the panel
  // draws its placeholder instead of requesting a file that cannot exist.
  const buildingThumb = entity.type === 'building' ? buildingThumbnail(entity.subType ?? '') : null;

  // Phase 25: aura of the entity's owner. Missing data (a battlefield snapshot
  // before the level loads) reads as level 1, the same fallback the server uses.
  const ownerTownCenterLevel = entity.ownerTownCenterLevel ?? 1;
  const auraPercent = Math.round((townCenterAuraMultiplier(ownerTownCenterLevel) - 1) * 100);
  const attackPercent = Math.round(
    (townCenterUnitAttackMultiplier(ownerTownCenterLevel) - 1) * 100
  );

  const buildingIsOwnedAndFinished =
    entity.type === 'building' && entity.isOwner === true && entity.isConstructed === true;

  // Phase 26: level effects belong to the selected building itself. Trainers
  // speed up and strengthen their own line; camps speed gathering and widen
  // their unload ring. The Town Center keeps its phase-25 aura panel.
  const selectedType = entity.type === 'building' ? (entity.subType as BuildingType) : null;
  const selectedBlueprint = selectedType ? BUILDING_BLUEPRINTS[selectedType] : null;
  const isTrainerBuilding =
    selectedType === 'BARRACKS' ||
    selectedType === 'STABLE' ||
    selectedType === 'ARCHERY_RANGE';
  const isDropOffCamp =
    selectedType !== null &&
    selectedType !== 'TOWN_CENTER' &&
    (selectedBlueprint?.dropOffs.length ?? 0) > 0;
  const buildingLevel = entity.level ?? 1;
  const trainerSpeedPercent = Math.round((1 - trainerSpeedMultiplier(buildingLevel)) * 100);
  const trainerBuffPercent = Math.round((trainerUnitBuffMultiplier(buildingLevel) - 1) * 100);
  const gatherPercent = Math.round((dropOffGatherMultiplier(buildingLevel) - 1) * 100);
  const unloadRadius = dropOffRange(buildingLevel);

  /**
   * I18N: the scene publishes English/protocol names, so the card re-labels it
   * here from the entity type instead of trusting the published string.
   */
  let displayName = entity.name;
  if (entity.type === 'building') {
    if (entity.subType === 'ROAD') displayName = t('details.roadUnderConstruction');
    else if (entity.subType) displayName = buildingName(entity.subType as BuildingType);
  } else if (entity.type === 'unit' && entity.subType) {
    const base = unitName(entity.subType as UnitType);
    displayName =
      entity.selectionCount && entity.selectionCount > 1 ? `${base} (${entity.selectionCount})` : base;
  } else if (entity.type === 'resource') {
    displayName = resourceNodeName(entity.subType) ?? entity.name;
  }

  /**
   * DOCK-07: the variant only changes sizing — sections, handlers and props stay
   * identical, so the phone sheet and the desktop popover cannot drift apart.
   * `panel` reproduces the original classes exactly. `popover` fills the popover
   * box (`w-full`) and drops both the min-height and the viewport cap, because
   * in that variant `DetailsPopover` is the element that sizes and scrolls.
   */
  const sizeClasses =
    variant === 'popover'
      ? 'w-full min-h-0 max-h-none p-3'
      : compact
        ? // MOB-06: full width of the dock's centre column, capped by the shorter
          // landscape viewport, with every inner button lifted to a thumb target.
          'w-full max-w-[420px] max-h-[28dvh] p-2 [&_button]:min-h-[44px]'
        : 'w-80 min-h-[144px] max-h-[72vh] p-3';

  return (
    <div
      className={`aoe-panel pointer-events-auto flex flex-col gap-2 overflow-y-auto rounded-lg ${sizeClasses}`}
    >
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-amber-800/40 pb-2">
        <div className="flex items-center gap-2.5">
          {entity.type === 'unit' && entity.subType ? (
            <img
              src={`/assets/units/${entity.subType.toLowerCase()}_idle.png?v=4`}
              alt={entity.name}
              className="w-10 h-10 object-contain rounded-md bg-slate-900/90 border border-amber-500/60 p-0.5 shadow-md"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : entity.type === 'building' && entity.subType ? (
            buildingThumb ? (
              <img
                src={buildingThumb}
                alt={entity.name}
                className="w-10 h-10 object-contain rounded-md bg-slate-900/90 border border-amber-500/60 p-0.5 shadow-md"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-slate-900/90 border border-amber-500/60 flex items-center justify-center text-amber-500 font-bold">
                ?
              </div>
            )
          ) : entity.type === 'resource' && entity.subType ? (
            <img
              src={resourceThumbnail(entity.subType)}
              alt={entity.name}
              className="w-10 h-10 object-contain rounded-md bg-slate-900/90 border border-amber-500/60 p-0.5 shadow-md"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-slate-900/90 border border-amber-500/60 flex items-center justify-center text-amber-500 font-bold">
              ?
            </div>
          )}
          <div className="flex flex-col">
            <span className="font-medieval text-xs font-bold text-amber-300 truncate max-w-[170px]">
              {displayName}
            </span>
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider">
              {t(`entityType.${entity.type}`, { defaultValue: entity.type })}
              {entity.level !== undefined && (
                <span className="ml-1.5 text-amber-400 normal-case">
                  Lv {entity.level}
                  {entity.maxLevel !== undefined ? `/${entity.maxLevel}` : ''}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Health Bar (if applicable) */}
      {entity.hp !== undefined && entity.maxHp !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span className="flex items-center gap-1">
              <Heart size={12} className="text-red-400" /> {t('details.hp')}
            </span>
            <span className="font-mono text-slate-200">
              {entity.hp} / {entity.maxHp}
            </span>
          </div>
          <div className="aoe-bar w-full h-2 rounded overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                entity.hp / entity.maxHp > 0.5
                  ? 'bg-emerald-500'
                  : entity.hp / entity.maxHp > 0.25
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, (entity.hp / entity.maxHp) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* CMB-01: combat stats of the selected unit. Attack is the effective
          value (research + Town Center aura + trainer), so it matches the
          damage the simulation deals instead of the raw blueprint number. */}
      {entity.type === 'unit' && entity.attackPower !== undefined && (
        <div className="border-t border-slate-800 pt-2 space-y-1" data-unit-power>
          <span className="text-[11px] font-bold tracking-wider text-amber-300">
            {t('details.unitPower')}
          </span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                <Swords size={12} className="text-red-400" /> {t('details.attackPower')}
              </span>
              <span className="font-mono text-emerald-300" data-unit-attack>
                {entity.attackPower}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                <Crosshair size={12} className="text-sky-400" /> {t('details.attackRange')}
              </span>
              <span className="font-mono text-slate-200" data-unit-range>
                {(entity.attackRange ?? 0).toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                <Timer size={12} className="text-amber-400" /> {t('details.cooldown')}
              </span>
              <span className="font-mono text-slate-200" data-unit-cooldown>
                {((entity.attackCooldownMs ?? 0) / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                <Gauge size={12} className="text-emerald-400" /> {t('details.speed')}
              </span>
              <span className="font-mono text-slate-200" data-unit-speed>
                {(entity.speed ?? 0).toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Phase 25: the capital is an empire-wide aura, so its own panel is where
          the player reads the exact numbers instead of guessing from stats. */}
      {entity.type === 'building' && entity.subType === 'TOWN_CENTER' && entity.isOwner && (
        <div className="border-t border-amber-800/40 pt-2 space-y-1" data-town-center-aura>
          <span className="text-[11px] font-bold tracking-wider text-amber-300">
            {t('details.empireBuff', { level: ownerTownCenterLevel })}
          </span>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.buildingUnitHp')}</span>
            <span className="font-mono text-emerald-300">+{auraPercent}%</span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.unitAttack')}</span>
            <span className="font-mono text-emerald-300">+{attackPercent}%</span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.trainingTime')}</span>
            <span className="font-mono text-sky-300">-{auraPercent}%</span>
          </div>
        </div>
      )}

      {buildingIsOwnedAndFinished && isTrainerBuilding && (
        <div className="border-t border-slate-800 pt-2 space-y-1" data-trainer-effects>
          <span className="text-[11px] font-bold tracking-wider text-amber-300">
            {t('details.trainerEffectHeader', { level: buildingLevel })}
          </span>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.trainingTime')}</span>
            <span className="font-mono text-sky-300" data-trainer-speed>
              -{trainerSpeedPercent}%
            </span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.unitHpAttack')}</span>
            <span className="font-mono text-emerald-300" data-trainer-buff>
              +{trainerBuffPercent}%
            </span>
          </div>
        </div>
      )}

      {buildingIsOwnedAndFinished && isDropOffCamp && (
        <div className="border-t border-slate-800 pt-2 space-y-1" data-camp-effects>
          <span className="text-[11px] font-bold tracking-wider text-amber-300">
            {t('details.campEffectHeader', { level: buildingLevel })}
          </span>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.gatherSpeed')}</span>
            <span className="font-mono text-emerald-300" data-gather-bonus>
              +{gatherPercent}%
            </span>
          </div>
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>{t('stats.unloadRadius')}</span>
            <span className="font-mono text-sky-300" data-unload-radius>
              {unloadRadius.toFixed(2)} tile
            </span>
          </div>
        </div>
      )}

      {/* Phase 23: a portal is now only a retreat gate, and only a raider has
          one. Right-clicking it is the second way to retreat. */}
      {entity.type === 'building' && entity.isPortal && entity.isOwner && inRaid && (
        <div className="border-t border-red-800/60 pt-2 space-y-1.5">
          <span className="text-[11px] font-bold text-red-300 tracking-wider">
            {t('details.retreatGate')}
          </span>
          <button
            type="button"
            onClick={onRetreat}
            className="w-full px-2 py-1.5 rounded border border-red-600/80 bg-red-950/60 text-[11px] font-semibold text-red-200 hover:border-red-400 transition-all"
          >
            {t('details.retreatAll')}
          </button>
          <p className="text-[11px] text-slate-400 italic">
            {interactionHint === 'long-press'
              ? t('details.retreatHintTouch')
              : t('details.retreatHintMouse')}
          </p>
        </div>
      )}

      {/* CMB-01: combat stance + the key that cycles it */}
      {entity.type === 'unit' && entity.stance && (
        <div className="flex items-center justify-between text-[11px]" data-stance>
          <span className="flex items-center gap-1 text-slate-300">
            <Shield size={12} className="text-sky-400" /> {t('details.stance')}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`font-mono font-bold ${
                STANCE_CLASSES[entity.stance] ?? 'text-slate-300'
              }`}
            >
              {stanceName(entity.stance)}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">(D)</span>
          </span>
        </div>
      )}

      {/* SIM-02: what this villager is hauling right now */}
      {entity.type === 'unit' && (entity.carryingAmount ?? 0) > 0 && (
        <div className="flex items-center justify-between text-[11px] text-slate-300" data-carrying>
          <span className="flex items-center gap-1">
            <Boxes size={12} className="text-amber-400" /> {t('details.carrying')}
          </span>
          <span className="font-mono text-amber-300 font-bold">
            {entity.carryingAmount} {resourceName(entity.carryingResourceType ?? '')}
          </span>
        </div>
      )}

      {/* Resource Node Info */}
      {entity.remainingAmount !== undefined && (
        <div className="text-xs text-slate-300 space-y-1">
          <div className="flex justify-between">
            <span>{t('details.remaining')}</span>
            <span className="font-mono text-amber-400 font-bold">
              {entity.remainingAmount} / {entity.maxAmount}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 italic">
            {interactionHint === 'long-press'
              ? entity.type === 'building'
                ? t('details.harvestFarmTouch')
                : t('details.harvestMineTouch')
              : entity.type === 'building'
                ? t('details.harvestFarmMouse')
                : t('details.harvestMineMouse')}
          </p>
        </div>
      )}

      {/* CMD-04b — Foundation still under construction */}
      {entity.type === 'building' && entity.isOwner && entity.isConstructed === false && (
        <div className="border-t border-slate-800 pt-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span className="flex items-center gap-1">
              <Hammer size={12} className="text-amber-400" /> {t('details.underConstruction')}
            </span>
            <span className="font-mono text-amber-300">
              {Math.floor(entity.constructionProgress ?? 0)}%
            </span>
          </div>
          <div className="aoe-bar w-full h-2 rounded overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-200"
              style={{
                width: `${Math.max(0, Math.min(100, entity.constructionProgress ?? 0))}%`
              }}
            />
          </div>
          <button
            onClick={() => onCancelBuilding(entity.id)}
            className="w-full px-2 py-1 rounded border border-red-800/70 bg-red-950/50 text-[11px] font-semibold text-red-300 hover:border-red-500 transition-all flex items-center justify-center gap-1"
            title={t('details.cancelBuildingTitle')}
          >
            <X size={12} /> {t('details.cancelBuilding')}
          </button>
        </div>
      )}

      {/* Unit Production Section (for owned buildings) */}
      {entity.isOwner && trainableUnits.length > 0 && (
        <div className="border-t border-slate-800 pt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-400 tracking-wider flex items-center gap-1">
              <UserPlus size={12} /> {t('details.trainingTitle')}
            </span>
            {entity.trainingQueue && entity.trainingQueue.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-[11px] text-amber-300 font-mono">
                  {t('details.queue', { count: entity.trainingQueue.length })}
                </span>
                {/* CMD-04a — cancel the unit currently at the head of the queue */}
                <button
                  onClick={() => onCancelTrain(entity.id)}
                  className="w-4 h-4 rounded border border-red-800/70 bg-red-950/60 text-red-300 hover:border-red-500 hover:text-red-200 flex items-center justify-center transition-all"
                  title={t('details.cancelTrainTitle')}
                >
                  <X size={10} />
                </button>
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {trainableUnits.map((uType, index) => {
              const uBp = UNIT_BLUEPRINTS[uType];
              const canAffordUnit =
                playerResources.wood >= uBp.cost.wood &&
                playerResources.food >= uBp.cost.food &&
                playerResources.gold >= uBp.cost.gold &&
                playerResources.stone >= uBp.cost.stone;
              const unitLevel = entity.unitLevels
                ? getPlayerUnitLevel(entity.unitLevels, uType)
                : 1;
              const unitAttack = getEffectiveUnitAttackPower(
                uType,
                unitLevel,
                ownerTownCenterLevel,
                buildingLevel
              );
              const unitMaxHp = getEffectiveUnitMaxHp(
                uType,
                unitLevel,
                ownerTownCenterLevel,
                buildingLevel
              );
              const effectiveTrainSeconds =
                getEffectiveTrainTimeMs(uType, ownerTownCenterLevel, buildingLevel) / 1000;
              const trainHotkey = UNIT_TRAINING_HOTKEY_BY_TYPE[uType];
              // UIX-15: the button names this box with `aria-describedby`, so one
              // id per trainable unit per entity keeps the pair unique.
              const tooltipId = `train-tooltip-${entity.id}-${uType}`;
              // UIX-15: a centred 176 px box hangs ~60 px past the panel edge on
              // the first button, and the panel's `overflow-y-auto` clips it, so
              // the edge buttons pin their box to the row instead of centring.
              const tooltipAlign =
                index === 0
                  ? 'left-0'
                  : index === trainableUnits.length - 1
                    ? 'right-0'
                    : 'left-1/2 -translate-x-1/2';

              return (
                <div key={uType} className="relative group">
                  <button
                    onClick={() => onTrainUnit(entity.id, uType)}
                    disabled={!canAffordUnit}
                    aria-describedby={tooltipId}
                    data-train-hotkey={trainHotkey}
                    className={`scroll-mt-36 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all flex flex-col items-center gap-1 ${
                      canAffordUnit
                        ? 'aoe-button text-slate-200'
                        : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                    }`}
                  >
                    <img
                      src={`/assets/units/${uType.toLowerCase()}_idle.png?v=4`}
                      alt={unitName(uType)}
                      className="w-7 h-7 object-contain rounded bg-slate-900/60 p-0.5 border border-amber-600/40"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <span>{unitName(uType)}</span>
                  </button>

                  {/* UIX-04: the hotkey the panel advertises is the one
                      `CommandController` actually binds, both read from
                      `unitHotkeys.ts`. Desktop only: a phone has no keyboard. */}
                  {!compact && (
                    <span
                      className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-black/70 px-1 font-mono text-[11px] font-bold text-amber-400"
                      title={t('details.hotkey', { key: trainHotkey })}
                    >
                      {trainHotkey}
                    </span>
                  )}

                  {/* UIX-15: hover alone used to reveal this box, which left
                      keyboard and touch players unable to read a unit's price
                      and stats. Focus and a touch press reveal the same box,
                      and the button's `aria-describedby` lets a screen reader
                      announce it without any pointer at all. `scroll-mt` keeps
                      the row clear of the panel's top edge when focus scrolls
                      it into view, so the box above it is not cut off. */}
                  <div
                    id={tooltipId}
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full mb-2 w-44 rounded border border-amber-600/70 bg-slate-950 p-2 text-left opacity-0 shadow-2xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-active:opacity-100 z-50 ${tooltipAlign}`}
                  >
                    <div className="font-medieval text-xs font-bold text-amber-300 mb-0.5">{unitName(uType)}</div>
                    <div className="text-[11px] text-slate-300 mb-1">{unitDescription(uType)}</div>
                    <div className="text-[11px] space-y-0.5 border-t border-slate-800 pt-1 font-mono">
                      {uBp.cost.food > 0 && <span className="text-red-400 mr-2">{resourceName('food')}: {uBp.cost.food}</span>}
                      {uBp.cost.wood > 0 && <span className="text-amber-400 mr-2">{resourceName('wood')}: {uBp.cost.wood}</span>}
                      {uBp.cost.gold > 0 && <span className="text-yellow-400 mr-2">{resourceName('gold')}: {uBp.cost.gold}</span>}
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        {t('details.attack', { value: unitAttack })} | {t('details.hpStat', { value: unitMaxHp })}
                      </div>
                      <div className="text-slate-400 text-[11px]">
                        {t('details.currentLevel', { level: unitLevel, max: getUnitMaxLevel() })}
                      </div>
                      {/* UIX-02: AoE2 tooltips advertise the training time, which is
                          the only way to compare two units' cost-per-second. */}
                      <div className="text-slate-400 text-[11px]">
                        {t('details.trainTime', { seconds: effectiveTrainSeconds.toFixed(1) })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LVL: every owned, finished building can upgrade itself, except the
          portal (server-created travel infrastructure). LVL2: the gate rows and
          the slot counter are empire-wide, so they ride along in the same data. */}
      {buildingIsOwnedAndFinished &&
        entity.subType !== 'PORTAL' &&
        entity.subType !== 'WALL' &&
        entity.level !== undefined && (
        <BuildingUpgradePanel
          buildingId={entity.id}
          type={entity.subType as BuildingType}
          level={entity.level}
          maxLevel={entity.maxLevel}
          upgradeProgressMs={entity.upgradeProgressMs}
          upgradeTimeMs={entity.upgradeTimeMs}
          playerResources={playerResources}
          coreLevels={entity.coreLevels}
          activeUpgrades={entity.activeUpgrades}
          visualTier={entity.visualTier}
          visualTierCount={entity.visualTierCount}
          visualTierName={entity.visualTierName}
          nextVisualTierLevel={entity.nextVisualTierLevel}
          onUpgrade={onUpgradeBuilding}
          onCancel={onCancelBuildingUpgrade}
        />
      )}

      {/* MIL-01: every trainer researches its own unit line — the barracks
          spearmen, the stable cavalry, the range archers, the town center
          villagers. Which types appear is the blueprint's `trainableUnits`. */}
      {buildingIsOwnedAndFinished &&
        trainableUnits.length > 0 &&
        (entity.unitLevels?.length ?? 0) > 0 && (
          <UnitResearchPanel
            unitTypes={trainableUnits}
            unitLevels={entity.unitLevels ?? []}
            researchUnitType={entity.researchUnitType}
            researchProgressMs={entity.researchProgressMs}
            researchTimeMs={entity.researchTimeMs}
            playerResources={playerResources}
            onUpgradeUnitType={onUpgradeUnitType}
            onCancelResearch={onCancelUnitUpgrade}
          />
        )}

      {/* Delete completed building (except default Town Center and Portal) */}
      {buildingIsOwnedAndFinished &&
        !entity.isPortal &&
        !entity.isDefaultTownCenter && (
          <div className="border-t border-slate-800 pt-2">
            <button
              onClick={() => onCancelBuilding(entity.id)}
              className="w-full px-2 py-1.5 rounded border border-red-800/70 bg-red-950/50 text-[11px] font-semibold text-red-300 hover:border-red-500 hover:bg-red-900/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              title={t('details.deleteBuildingTitle')}
            >
              <Trash2 size={12} /> {t('details.deleteBuilding')}
            </button>
          </div>
        )}
    </div>
  );
};


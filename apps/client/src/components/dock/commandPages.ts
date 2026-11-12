import {
  BUILDING_BLUEPRINTS,
  MAX_CONCURRENT_BUILDING_UPGRADES,
  UNIT_BLUEPRINTS,
  canTrainUnitsAt,
  getBuildingMaxLevel,
  getBuildingUnlockLevel,
  getBuildingUpgradeCost,
  getCoreLevelGaps,
  getPlayerUnitLevel,
  getUnitMaxLevel,
  getUnitUpgradeCost,
  isBuildingUnlocked
} from '@chien-quoc/shared';
import type { BuildingType, Resources, UnitType } from '@chien-quoc/shared';
import type { ArmedOrder, SelectedEntityData } from '../../game/scenes/WorldScene.js';
import type { RoadMode } from '../../game/input/RoadController.js';
import type { WallMode } from '../../game/input/WallController.js';
import { BUILDING_HOTKEYS } from '../../game/input/buildingHotkeys.js';
import { UNIT_TRAINING_HOTKEY_BY_TYPE } from '../../game/input/unitHotkeys.js';
import { buildingThumbnail } from '../buildingThumbnails.js';
import i18n from '../../i18n/index.js';
import {
  buildingDescription,
  buildingName,
  resourceName,
  resourceNodeName,
  stanceName,
  unitName
} from '../../i18n/labels.js';
import { DOCK_SLOT_CAPACITY } from './dockMetrics.js';

/**
 * DOCK-02: the commands a dock page can hold, built as plain data.
 *
 * The card renders whatever this module returns, so the "what can the player
 * order right now" rules live in one testable place instead of being spread
 * through JSX. Every rule here mirrors an existing surface (`BuildMenu`,
 * `EntityDetails`, `UpgradePanels`) rather than inventing a new one: the dock is
 * a second view of the same commands, never a second set of rules.
 */

export type DockPageId = 'BUILD' | 'ORDERS' | 'TRAIN' | 'UPGRADE';

export interface DockCommand {
  /** Stable key, also the DOM id of the slot (`build:HOUSE`). */
  id: string;
  label: string;
  /** Tooltip / accessible name: name, price and why it is blocked. */
  title: string;
  hotkey?: string;
  /** PNG art for the slot; `null` falls back to `art`'s vector glyph. */
  thumbnail: string | null;
  /** Artwork key: a building/unit type, or a command glyph name. */
  art: string;
  disabled: boolean;
  /** Armed order, open placement or active brush. */
  active: boolean;
  /** Set when the command is hidden behind a Town Center level. */
  lockedLevel?: number;
  cost?: Resources;
  action: () => void;
}

export interface DockPage {
  id: DockPageId;
  label: string;
  commands: DockCommand[];
}

/**
 * The command handlers the dock calls. Every one of them already exists in
 * `App.tsx`; the dock adds no scene API of its own.
 */
export interface DockCommandHandlers {
  onSelectBuilding: (type: BuildingType) => void;
  onSelectRoad: (mode: RoadMode) => void;
  onSelectWallErase: () => void;
  onTrainUnit: (buildingId: string, unitType: UnitType) => void;
  onCancelTrain: (buildingId: string) => void;
  onUpgradeBuilding: (buildingId: string) => void;
  onCancelBuildingUpgrade: (buildingId: string) => void;
  onUpgradeUnitType: (unitType: UnitType) => void;
  onCancelUnitUpgrade: (unitType: UnitType) => void;
  onArmAttackMove: () => void;
  onArmPatrol: () => void;
  onStopUnits: () => void;
  onCycleStance: () => void;
  onClearSelection: () => void;
  onCenterBase: () => void;
}

export interface DockPageInput {
  entity: SelectedEntityData | null;
  resources: Resources;
  /** Own capital level: unlocks the three drop-off camps. */
  townCenterLevel: number;
  /** Building orders are refused while raiding, so the page says so up front. */
  inRaid: boolean;
  armedOrder: ArmedOrder | null;
  activeBuildingType: BuildingType | null;
  roadMode: RoadMode | null;
  wallMode: WallMode | null;
  /** Roads only exist in a kingdom; the battlefield hides the brush tools. */
  showRoadTools: boolean;
  handlers: DockCommandHandlers;
}

const RESOURCE_ORDER: Array<keyof Resources> = ['wood', 'food', 'gold', 'stone'];

/** Unit art the scene preloads for a type, e.g. `/assets/units/villager_idle.png?v=3`. */
export function unitThumbnail(type: string): string {
  return `/assets/units/${type.toLowerCase()}_idle.png?v=3`;
}

function canAfford(resources: Resources, cost: Resources): boolean {
  return (
    resources.wood >= cost.wood &&
    resources.food >= cost.food &&
    resources.gold >= cost.gold &&
    resources.stone >= cost.stone
  );
}

/** `Gỗ 30 · Thịt 10`, the price line the tooltip and the header show. */
export function costText(cost: Resources): string {
  return RESOURCE_ORDER.filter((resource) => cost[resource] > 0)
    .map((resource) => `${resourceName(resource)} ${cost[resource]}`)
    .join(' · ');
}

/**
 * Name the selection strip and the popover title show.
 *
 * Extracted from `EntityDetails` so the strip, the card and the detail panel
 * cannot disagree about what the player has selected. `SelectedEntityData`
 * publishes protocol names, so this re-labels them in the active language.
 */
export function selectionDisplayName(entity: SelectedEntityData): string {
  if (entity.type === 'building') {
    if (entity.subType === 'ROAD') return i18n.t('details.roadUnderConstruction');
    if (entity.subType) return buildingName(entity.subType as BuildingType);
  } else if (entity.type === 'unit' && entity.subType) {
    const base = unitName(entity.subType as UnitType);
    return entity.selectionCount && entity.selectionCount > 1
      ? `${base} (${entity.selectionCount})`
      : base;
  } else if (entity.type === 'resource') {
    return resourceNodeName(entity.subType) ?? entity.name;
  }
  return entity.name;
}

/** A block of text for a command that is blocked by a rule, not by a price. */
function blockedTitle(base: string | undefined, reason: string): string {
  return base ? `${base} — ${reason}` : reason;
}

/** The 12 building tiles plus the three brush tools: AoE's 5x3 build card. */
function buildCommands(input: DockPageInput): DockCommand[] {
  const {
    resources,
    townCenterLevel,
    inRaid,
    activeBuildingType,
    roadMode,
    wallMode,
    handlers
  } = input;

  const commands: DockCommand[] = BUILDING_HOTKEYS.map(({ key, type }) => {
    const blueprint = BUILDING_BLUEPRINTS[type];
    const name = buildingName(type);
    const unlocked = isBuildingUnlocked(type, townCenterLevel);
    const unlockLevel = getBuildingUnlockLevel(type);
    const affordable = canAfford(resources, blueprint.cost);

    const command: DockCommand = {
      id: `build:${type}`,
      label: name,
      title: inRaid
        ? blockedTitle(name, i18n.t('dock.raidBlocked'))
        : unlocked
          ? `${name} — ${costText(blueprint.cost)}`
          : i18n.t('build.lockedAtLevel', { level: unlockLevel }),
      hotkey: key,
      thumbnail: buildingThumbnail(type),
      art: type,
      disabled: inRaid || !unlocked || !affordable,
      active: activeBuildingType === type || (type === 'WALL' && wallMode === 'build'),
      cost: blueprint.cost,
      action: () => handlers.onSelectBuilding(type)
    };
    if (!unlocked) command.lockedLevel = unlockLevel;
    return command;
  });

  // The brushes paint tiles and are not blueprints, so they cannot come from
  // BUILDING_HOTKEYS. Three of them complete the fifteen slots exactly. They are
  // data plus one shared projection: the same raid wording and the same art
  // fallback for all three, stated once instead of three times.
  if (input.showRoadTools) {
    // Inferred, not annotated: the projection below is the only reader, so a
    // shape change shows up as a type error there instead of here.
    const brushes = [
      {
        id: 'tool:ROAD',
        art: 'ROAD',
        label: i18n.t('build.road'),
        hint: i18n.t('build.roadHint'),
        active: roadMode === 'build',
        action: () => handlers.onSelectRoad('build')
      },
      {
        id: 'tool:ROAD_ERASE',
        art: 'ROAD_ERASE',
        label: i18n.t('build.erase'),
        hint: i18n.t('build.eraseHint'),
        active: roadMode === 'erase',
        action: () => handlers.onSelectRoad('erase')
      },
      {
        id: 'tool:WALL_ERASE',
        art: 'WALL_ERASE',
        label: i18n.t('build.eraseWall'),
        hint: i18n.t('build.eraseWallHint'),
        active: wallMode === 'erase',
        action: () => handlers.onSelectWallErase()
      }
    ];

    for (const brush of brushes) {
      commands.push({
        id: brush.id,
        label: brush.label,
        title: inRaid ? blockedTitle(brush.label, i18n.t('dock.raidBlocked')) : brush.hint,
        thumbnail: null,
        art: brush.art,
        disabled: inRaid,
        active: brush.active,
        action: brush.action
      });
    }
  }

  return commands.slice(0, DOCK_SLOT_CAPACITY);
}


/** Stance, stop, attack-move, patrol and the camera shortcuts (CMD-01/CMB-01). */
function orderCommands(input: DockPageInput): DockCommand[] {
  const { entity, armedOrder, handlers } = input;
  // No `disabled` flag below: `buildDockPages` only asks for this page for an
  // owned unit, so every order here is executable by construction. A selection
  // the player cannot command gets no page at all, which is what removes the
  // buttons instead of graying them out.
  const stance = entity?.stance ? stanceName(entity.stance) : '';

  return [
    {
      id: 'order:STOP',
      label: i18n.t('dock.stop'),
      title: i18n.t('dock.stopTitle'),
      hotkey: 'S',
      thumbnail: null,
      art: 'STOP',
      disabled: false,
      active: false,
      action: () => handlers.onStopUnits()
    },
    {
      id: 'order:STANCE',
      label: i18n.t('dock.stance'),
      title: i18n.t('dock.stanceTitle', { stance }),
      hotkey: 'D',
      thumbnail: null,
      art: 'STANCE',
      disabled: false,
      active: false,
      action: () => handlers.onCycleStance()
    },
    {
      id: 'order:ATTACK_MOVE',
      label: i18n.t('dock.attackMove'),
      title: i18n.t('dock.attackMoveTitle'),
      hotkey: 'A',
      thumbnail: null,
      art: 'ATTACK',
      disabled: false,
      active: armedOrder === 'ATTACK_MOVE',
      action: () => handlers.onArmAttackMove()
    },
    {
      id: 'order:PATROL',
      label: i18n.t('dock.patrol'),
      title: i18n.t('dock.patrolTitle'),
      hotkey: 'P',
      thumbnail: null,
      art: 'PATROL',
      disabled: false,
      active: armedOrder === 'PATROL',
      action: () => handlers.onArmPatrol()
    },
    {
      id: 'order:CLEAR',
      label: i18n.t('dock.clear'),
      title: i18n.t('dock.clearTitle'),
      thumbnail: null,
      art: 'CLEAR',
      disabled: false,
      active: false,
      action: () => handlers.onClearSelection()
    },
    {
      id: 'order:HOME',
      label: i18n.t('dock.home'),
      title: i18n.t('dock.homeTitle'),
      hotkey: 'H',
      thumbnail: null,
      art: 'HOME',
      disabled: false,
      active: false,
      action: () => handlers.onCenterBase()
    }
  ];
}

/**
 * Training card. The roster and the affordability rule are the ones
 * `EntityDetails` already uses (`trainableUnits` of the selected building), so
 * the card cannot offer a unit the panel would grey out.
 */
function trainCommands(entity: SelectedEntityData, input: DockPageInput): DockCommand[] {
  const blueprint = BUILDING_BLUEPRINTS[entity.subType as BuildingType];
  // Ownership is the dispatcher's gate (`buildDockPages`); re-checking it here
  // would be a second copy of the same rule.
  if (!blueprint) return [];

  const { resources, handlers } = input;
  const commands: DockCommand[] = blueprint.trainableUnits.map((unitType) => {
    const unitBlueprint = UNIT_BLUEPRINTS[unitType];
    const name = unitName(unitType);
    return {
      id: `train:${unitType}`,
      label: name,
      title: `${name} — ${costText(unitBlueprint.cost)}`,
      hotkey: UNIT_TRAINING_HOTKEY_BY_TYPE[unitType],
      thumbnail: unitThumbnail(unitType),
      art: unitType,
      disabled: !canAfford(resources, unitBlueprint.cost),
      active: false,
      cost: unitBlueprint.cost,
      action: () => handlers.onTrainUnit(entity.id, unitType)
    };
  });

  if ((entity.trainingQueue?.length ?? 0) > 0) {
    commands.push({
      id: 'train:CANCEL',
      label: i18n.t('dock.cancelTrain'),
      title: i18n.t('dock.cancelTrainTitle'),
      thumbnail: null,
      art: 'CANCEL_TRAIN',
      disabled: false,
      active: true,
      action: () => handlers.onCancelTrain(entity.id)
    });
  }

  return commands.slice(0, DOCK_SLOT_CAPACITY);
}

/**
 * Upgrade + research card for an owned, finished building.
 *
 * The gates mirror `BuildingUpgradePanel` and `UnitResearchPanel` exactly: the
 * capital's pillar gate, the two upgrade slots, the one research slot and the
 * per-type max level. A shortcut that ignored them would just be rejected by
 * the server after the player clicked it.
 */
function upgradeCommands(entity: SelectedEntityData, input: DockPageInput): DockCommand[] {
  const type = entity.subType as BuildingType;
  const blueprint = BUILDING_BLUEPRINTS[type];
  // A foundation has no upgrade or research yet; ownership is the dispatcher's
  // gate, so only construction state is decided here.
  if (!blueprint || entity.isConstructed !== true) return [];

  const { resources, handlers } = input;
  const commands: DockCommand[] = [];
  const level = entity.level ?? 1;
  const cap = entity.maxLevel ?? getBuildingMaxLevel(type);
  const upgrading = (entity.upgradeTimeMs ?? 0) > 0;

  if (type !== 'PORTAL' && type !== 'WALL' && entity.level !== undefined) {
    if (upgrading) {
      commands.push({
        id: 'upgrade:CANCEL',
        label: i18n.t('dock.cancelUpgrade'),
        title: i18n.t('dock.cancelUpgradeTitle'),
        thumbnail: null,
        art: 'CANCEL_UPGRADE',
        disabled: false,
        active: true,
        action: () => handlers.onCancelBuildingUpgrade(entity.id)
      });
    } else if (level < cap) {
      const cost = getBuildingUpgradeCost(type, level);
      const slotsFull = (entity.activeUpgrades ?? 0) >= MAX_CONCURRENT_BUILDING_UPGRADES;
      const unmetGate =
        type === 'TOWN_CENTER' && getCoreLevelGaps(entity.coreLevels, level).some((gap) => !gap.met);
      const command: DockCommand = {
        id: 'upgrade:START',
        label: i18n.t('dock.upgrade'),
        title: `${i18n.t('dock.upgradeTo', { level: level + 1 })} — ${costText(cost)}`,
        thumbnail: null,
        art: 'UPGRADE',
        disabled: slotsFull || unmetGate || !canAfford(resources, cost),
        active: false,
        cost,
        action: () => handlers.onUpgradeBuilding(entity.id)
      };
      if (slotsFull) command.title = blockedTitle(command.title, i18n.t('dock.slotsFull'));
      else if (unmetGate) command.title = blockedTitle(command.title, i18n.t('dock.gateBlocked'));
      commands.push(command);
    }
  }

  const researching = entity.researchUnitType ? (entity.researchUnitType as UnitType) : null;
  if (researching) {
    commands.push({
      id: 'research:CANCEL',
      label: i18n.t('dock.cancelResearch'),
      title: i18n.t('dock.cancelResearchTitle'),
      thumbnail: null,
      art: 'CANCEL_RESEARCH',
      disabled: false,
      active: true,
      action: () => handlers.onCancelUnitUpgrade(researching)
    });
  } else if (canTrainUnitsAt(type) && (entity.unitLevels?.length ?? 0) > 0) {
    for (const unitType of blueprint.trainableUnits) {
      const unitLevel = getPlayerUnitLevel(entity.unitLevels, unitType);
      const unitCap = getUnitMaxLevel();
      if (unitLevel >= unitCap) continue;
      const cost = getUnitUpgradeCost(unitType, unitLevel);
      const command: DockCommand = {
        id: `research:${unitType}`,
        label: i18n.t('dock.research'),
        title: `${i18n.t('dock.researchTo', {
          unit: unitName(unitType),
          level: unitLevel + 1
        })} — ${costText(cost)}`,
        thumbnail: unitThumbnail(unitType),
        art: unitType,
        disabled: !canAfford(resources, cost),
        active: false,
        cost,
        action: () => handlers.onUpgradeUnitType(unitType)
      };
      commands.push(command);
    }
  }

  return commands.slice(0, DOCK_SLOT_CAPACITY);
}

/**
 * The pages the card shows for the current selection, in reading order.
 *
 * A villager leads with the build card because that is the whole reason the
 * villager was selected; a building leads with its production card. Nothing
 * selected means no pages, which is how the dock hides the card entirely.
 */
export function buildDockPages(input: DockPageInput): DockPage[] {
  const { entity } = input;
  if (!entity) return [];

  const pages: DockPage[] = [];

  // `villagerSelected` already implies ownership in the scene, but the card is
  // the thing the player clicks, so it re-checks: an enemy villager must never
  // open a build grid that the server would refuse.
  if (entity.type === 'unit' && entity.isOwner === true && entity.villagerSelected === true) {
    const commands = buildCommands(input);
    if (commands.length > 0) {
      pages.push({ id: 'BUILD', label: i18n.t('dock.pageBuild'), commands });
    }
  }

  if (entity.type === 'unit' && entity.isOwner === true) {
    pages.push({ id: 'ORDERS', label: i18n.t('dock.pageOrders'), commands: orderCommands(input) });
  }

  if (entity.type === 'building' && entity.isOwner === true) {
    const training = trainCommands(entity, input);
    if (training.length > 0) {
      pages.push({ id: 'TRAIN', label: i18n.t('dock.pageTrain'), commands: training });
    }
    const upgrades = upgradeCommands(entity, input);
    if (upgrades.length > 0) {
      pages.push({ id: 'UPGRADE', label: i18n.t('dock.pageUpgrade'), commands: upgrades });
    }
  }

  return pages;
}

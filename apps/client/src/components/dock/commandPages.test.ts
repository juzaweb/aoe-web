import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/index.js';
import type { BuildingType, Resources } from '@chien-quoc/shared';
import type { SelectedEntityData } from '../../game/scenes/WorldScene.js';
import { BUILDING_HOTKEYS } from '../../game/input/buildingHotkeys.js';
import { UNIT_TRAINING_HOTKEY_BY_TYPE } from '../../game/input/unitHotkeys.js';
import { buildingName } from '../../i18n/labels.js';
import {
  buildDockPages,
  costText,
  selectionDisplayName,
  type DockCommand,
  type DockCommandHandlers,
  type DockPageInput
} from './commandPages.js';
import { DOCK_SLOT_CAPACITY } from './dockMetrics.js';

const RICH: Resources = { wood: 5000, food: 5000, gold: 5000, stone: 5000 };
const BROKE: Resources = { wood: 0, food: 0, gold: 0, stone: 0 };

/** Every handler is a spy, so an action can be proven wired without a scene. */
function makeHandlers(): DockCommandHandlers {
  return {
    onSelectBuilding: vi.fn(),
    onSelectRoad: vi.fn(),
    onSelectWallErase: vi.fn(),
    onTrainUnit: vi.fn(),
    onCancelTrain: vi.fn(),
    onUpgradeBuilding: vi.fn(),
    onCancelBuildingUpgrade: vi.fn(),
    onUpgradeUnitType: vi.fn(),
    onCancelUnitUpgrade: vi.fn(),
    onArmAttackMove: vi.fn(),
    onArmPatrol: vi.fn(),
    onStopUnits: vi.fn(),
    onCycleStance: vi.fn(),
    onClearSelection: vi.fn(),
    onCenterBase: vi.fn(),
    onCancelBuilding: vi.fn(),
    onRetreat: vi.fn()
  };
}

function makeInput(overrides: Partial<DockPageInput> = {}): DockPageInput {
  return {
    entity: null,
    resources: RICH,
    townCenterLevel: 1,
    inRaid: false,
    armedOrder: null,
    activeBuildingType: null,
    roadMode: null,
    wallMode: null,
    showRoadTools: true,
    handlers: makeHandlers(),
    ...overrides
  };
}

function villager(overrides: Partial<SelectedEntityData> = {}): SelectedEntityData {
  return {
    id: 'unit-1',
    type: 'unit',
    name: 'VILLAGER (1)',
    subType: 'VILLAGER',
    quantity: undefined,
    isOwner: true,
    villagerSelected: true,
    selectionCount: 1,
    hp: 25,
    maxHp: 25,
    ...overrides
  } as SelectedEntityData;
}

function building(
  type: BuildingType,
  overrides: Partial<SelectedEntityData> = {}
): SelectedEntityData {
  return {
    id: `building-${type}`,
    type: 'building',
    name: type,
    subType: type,
    isOwner: true,
    isConstructed: true,
    level: 1,
    maxLevel: 10,
    hp: 600,
    maxHp: 600,
    // The player-wide research ladder, published with any owned building.
    unitLevels: [1, 1, 1, 1, 1],
    coreLevels: { HOUSE: 1, BARRACKS: 1, FARM: 1, TOWER: 1 },
    ...overrides
  } as SelectedEntityData;
}

function ids(commands: DockCommand[]): string[] {
  return commands.map((command) => command.id);
}

beforeEach(async () => {
  await i18n.changeLanguage('vi');
});

describe('buildDockPages — no selection', () => {
  it('returns no pages, which is how the dock hides the card', () => {
    expect(buildDockPages(makeInput())).toEqual([]);
  });

  it('returns no pages for a resource node', () => {
    const entity = {
      id: 'node-1',
      type: 'resource',
      name: 'TREE',
      subType: 'TREE',
      remainingAmount: 100,
      maxAmount: 100
    } as SelectedEntityData;
    expect(buildDockPages(makeInput({ entity }))).toEqual([]);
  });
});

describe('buildDockPages — villager build card', () => {
  it('leads with the build page and keeps the orders page behind it', () => {
    const pages = buildDockPages(makeInput({ entity: villager() }));
    expect(pages.map((page) => page.id)).toEqual(['BUILD', 'ORDERS']);
    expect(pages[0].label).toBe(i18n.t('dock.pageBuild'));
  });

  it('fills exactly the 15 slots: 12 buildings in hotkey order plus 3 brushes', () => {
    const [build] = buildDockPages(makeInput({ entity: villager() }));
    expect(build.commands).toHaveLength(DOCK_SLOT_CAPACITY);
    expect(ids(build.commands)).toEqual([
      ...BUILDING_HOTKEYS.map(({ type }) => `build:${type}`),
      'tool:ROAD',
      'tool:ROAD_ERASE',
      'tool:WALL_ERASE'
    ]);
  });

  it('prints the same hotkey the keyboard path binds', () => {
    const [build] = buildDockPages(makeInput({ entity: villager() }));
    const byId = new Map(build.commands.map((command) => [command.id, command]));
    for (const { key, type } of BUILDING_HOTKEYS) {
      expect(byId.get(`build:${type}`)?.hotkey).toBe(key);
    }
  });

  it('disables a building the Town Center has not unlocked, and names the level', () => {
    const [build] = buildDockPages(makeInput({ entity: villager(), townCenterLevel: 1 }));
    const mining = build.commands.find((command) => command.id === 'build:MINING_CAMP');
    expect(mining?.disabled).toBe(true);
    expect(mining?.lockedLevel).toBe(3);
    expect(mining?.title).toBe(i18n.t('build.lockedAtLevel', { level: 3 }));
    const lumber = build.commands.find((command) => command.id === 'build:LUMBER_CAMP');
    expect(lumber?.lockedLevel).toBeUndefined();
  });

  it('unlocks the camps once the capital reaches their level', () => {
    const [build] = buildDockPages(makeInput({ entity: villager(), townCenterLevel: 3 }));
    const mining = build.commands.find((command) => command.id === 'build:MINING_CAMP');
    expect(mining?.lockedLevel).toBeUndefined();
    expect(mining?.disabled).toBe(false);
  });

  it('disables a building the player cannot afford, but keeps the brush tools open', () => {
    const [build] = buildDockPages(makeInput({ entity: villager(), resources: BROKE }));
    const buildingSlots = build.commands.filter((command) => command.id.startsWith('build:'));
    expect(buildingSlots.every((command) => command.disabled)).toBe(true);
    const road = build.commands.find((command) => command.id === 'tool:ROAD');
    expect(road?.disabled).toBe(false);
  });

  it('marks the open placement and the active brushes', () => {
    const [build] = buildDockPages(
      makeInput({
        entity: villager(),
        activeBuildingType: 'HOUSE',
        roadMode: 'erase',
        wallMode: 'erase'
      })
    );
    const active = build.commands.filter((command) => command.active).map((command) => command.id);
    expect(active).toEqual(['build:HOUSE', 'tool:ROAD_ERASE', 'tool:WALL_ERASE']);
  });

  it('drops the three brushes when the map has no roads to paint', () => {
    const [build] = buildDockPages(
      makeInput({ entity: villager(), showRoadTools: false })
    );
    expect(build.commands).toHaveLength(BUILDING_HOTKEYS.length);
  });

  it('turns every build command off during a raid and says why', () => {
    const pages = buildDockPages(makeInput({ entity: villager(), inRaid: true }));
    const [build] = pages;
    expect(build.commands).toHaveLength(DOCK_SLOT_CAPACITY);
    expect(build.commands.every((command) => command.disabled)).toBe(true);
    expect(build.commands.every((command) => command.title.includes(i18n.t('dock.raidBlocked')))).toBe(
      true
    );
  });

  it('sends the clicked building to the existing placement handler', () => {
    const handlers = makeHandlers();
    const [build] = buildDockPages(makeInput({ entity: villager(), handlers }));
    build.commands.find((command) => command.id === 'build:HOUSE')?.action();
    expect(handlers.onSelectBuilding).toHaveBeenCalledWith('HOUSE');
    build.commands.find((command) => command.id === 'tool:ROAD')?.action();
    expect(handlers.onSelectRoad).toHaveBeenCalledWith('build');
    build.commands.find((command) => command.id === 'tool:WALL_ERASE')?.action();
    expect(handlers.onSelectWallErase).toHaveBeenCalled();
  });
});

describe('buildDockPages — orders card', () => {
  it('offers the desktop order keys for an owned unit', () => {
    const pages = buildDockPages(makeInput({ entity: villager() }));
    const orders = pages.find((page) => page.id === 'ORDERS');
    expect(ids(orders?.commands ?? [])).toEqual([
      'order:STOP',
      'order:STANCE',
      'order:ATTACK_MOVE',
      'order:PATROL',
      'order:CLEAR',
      'order:HOME'
    ]);
    expect(orders?.commands.find((command) => command.id === 'order:STOP')?.hotkey).toBe('S');
    expect(orders?.commands.find((command) => command.id === 'order:STANCE')?.hotkey).toBe('D');
  });

  it('shows the armed order as pressed', () => {
    const pages = buildDockPages(makeInput({ entity: villager(), armedOrder: 'PATROL' }));
    const orders = pages.find((page) => page.id === 'ORDERS');
    const patrol = orders?.commands.find((command) => command.id === 'order:PATROL');
    expect(patrol?.active).toBe(true);
    const attack = orders?.commands.find((command) => command.id === 'order:ATTACK_MOVE');
    expect(attack?.active).toBe(false);
  });

  it('disables the unit orders for a unit this player does not own', () => {
    const enemy = villager({ isOwner: false });
    const pages = buildDockPages(makeInput({ entity: enemy }));
    expect(pages.map((page) => page.id)).toEqual([]);
  });
});

describe('buildDockPages — building cards', () => {
  it('offers training, upgrades, research and delete on a single page for an owned barracks', () => {
    const pages = buildDockPages(makeInput({ entity: building('BARRACKS') }));
    expect(pages.map((page) => page.id)).toEqual(['TRAIN']);
    const cmds = pages[0].commands;
    expect(ids(cmds)).toEqual([
      'train:SPEARMAN',
      'upgrade:START',
      'research:SPEARMAN',
      'building:DELETE'
    ]);
    expect(cmds[0].hotkey).toBe(UNIT_TRAINING_HOTKEY_BY_TYPE.SPEARMAN);
  });

  it('offers catapult training and research on an owned siege workshop', () => {
    const pages = buildDockPages(makeInput({ entity: building('SIEGE_WORKSHOP') }));
    expect(pages.map((page) => page.id)).toEqual(['TRAIN']);
    const cmds = pages[0].commands;
    expect(ids(cmds)).toEqual([
      'train:CATAPULT',
      'upgrade:START',
      'research:CATAPULT',
      'building:DELETE'
    ]);
    expect(cmds[0].hotkey).toBe(UNIT_TRAINING_HOTKEY_BY_TYPE.CATAPULT);
    expect(cmds.find((command) => command.id === 'research:CATAPULT')?.title).toContain(
      i18n.t('units.CATAPULT.name')
    );
  });

  it('greys out training the player cannot pay for', () => {
    const pages = buildDockPages(makeInput({ entity: building('BARRACKS'), resources: BROKE }));
    const train = pages[0];
    expect(train?.commands.find((command) => command.id === 'train:SPEARMAN')?.disabled).toBe(true);
  });

  it('offers a cancel slot while a unit is in the training queue', () => {
    const handlers = makeHandlers();
    const pages = buildDockPages(
      makeInput({ entity: building('BARRACKS', { trainingQueue: ['SPEARMAN'] }), handlers })
    );
    const cmds = pages[0]?.commands ?? [];
    expect(ids(cmds)).toEqual([
      'train:SPEARMAN',
      'train:CANCEL',
      'upgrade:START',
      'research:SPEARMAN',
      'building:DELETE'
    ]);
    cmds.find((command) => command.id === 'train:CANCEL')?.action();
    expect(handlers.onCancelTrain).toHaveBeenCalledWith('building-BARRACKS');
  });

  it('swaps research for a cancel while a research runs', () => {
    const handlers = makeHandlers();
    const pages = buildDockPages(
      makeInput({ entity: building('BARRACKS', { researchUnitType: 'SPEARMAN' }), handlers })
    );
    const cmds = pages[0]?.commands ?? [];
    expect(ids(cmds)).toEqual([
      'train:SPEARMAN',
      'upgrade:START',
      'research:CANCEL',
      'building:DELETE'
    ]);
    cmds.find((command) => command.id === 'research:CANCEL')?.action();
    expect(handlers.onCancelUnitUpgrade).toHaveBeenCalledWith('SPEARMAN');
  });

  it('swaps the upgrade slot for a cancel while a timer runs', () => {
    const pages = buildDockPages(
      makeInput({ entity: building('BARRACKS', { upgradeTimeMs: 5000, upgradeProgressMs: 1000 }) })
    );
    const cmds = pages[0]?.commands ?? [];
    expect(ids(cmds)).toEqual([
      'train:SPEARMAN',
      'upgrade:CANCEL',
      'research:SPEARMAN',
      'building:DELETE'
    ]);
  });

  it('refuses the upgrade when both slots are taken, and explains it', () => {
    const pages = buildDockPages(makeInput({ entity: building('BARRACKS', { activeUpgrades: 2 }) }));
    const start = pages[0]?.commands.find((command) => command.id === 'upgrade:START');
    expect(start?.disabled).toBe(true);
    expect(start?.title).toContain(i18n.t('dock.slotsFull'));
  });

  it('holds the Town Center upgrade behind its four pillars', () => {
    const blocked = buildDockPages(
      makeInput({ entity: building('TOWN_CENTER', { coreLevels: {} }) })
    );
    const start = blocked[0]?.commands.find((command) => command.id === 'upgrade:START');
    expect(start?.disabled).toBe(true);
    expect(start?.title).toContain(i18n.t('dock.gateBlocked'));

    const open = buildDockPages(
      makeInput({
        entity: building('TOWN_CENTER', {
          level: 2,
          // MIL-01 expanded the gate to all six pillars; every one must match.
          coreLevels: {
            HOUSE: 2,
            BARRACKS: 2,
            STABLE: 2,
            ARCHERY_RANGE: 2,
            FARM: 2,
            TOWER: 2
          }
        })
      })
    );
    const ready = open[0]?.commands.find((command) => command.id === 'upgrade:START');
    expect(ready?.disabled).toBe(false);
  });

  it('offers no card at all for an enemy building', () => {
    const pages = buildDockPages(
      makeInput({ entity: building('BARRACKS', { isOwner: false }) })
    );
    expect(pages).toEqual([]);
  });

  it('offers training and cancel on a single page for a foundation', () => {
    const handlers = makeHandlers();
    const pages = buildDockPages(
      makeInput({
        entity: building('BARRACKS', { isConstructed: false, level: undefined }),
        handlers
      })
    );
    expect(pages.map((page) => page.id)).toEqual(['TRAIN']);
    expect(ids(pages[0].commands)).toEqual(['train:SPEARMAN', 'building:CANCEL']);
    pages[0].commands[1].action();
    expect(handlers.onCancelBuilding).toHaveBeenCalledWith('building-BARRACKS');
  });

  it('routes building delete and portal retreat to the existing handlers', () => {
    const handlers = makeHandlers();
    const housePages = buildDockPages(makeInput({ entity: building('HOUSE'), handlers }));
    const deleteCmd = housePages[0].commands.find((command) => command.id === 'building:DELETE');
    expect(deleteCmd).toBeDefined();
    deleteCmd?.action();
    expect(handlers.onCancelBuilding).toHaveBeenCalledWith('building-HOUSE');

    const tcPages = buildDockPages(
      makeInput({ entity: building('TOWN_CENTER', { isDefaultTownCenter: true }), handlers })
    );
    expect(
      tcPages.flatMap((page) => page.commands).some((command) => command.id === 'building:DELETE')
    ).toBe(false);

    const portalPages = buildDockPages(
      makeInput({
        entity: building('PORTAL', { isPortal: true }),
        inRaid: true,
        handlers
      })
    );
    expect(portalPages.map((page) => page.id)).toEqual(['ORDERS']);
    expect(ids(portalPages[0].commands)).toEqual(['building:RETREAT']);
    portalPages[0].commands[0].action();
    expect(handlers.onRetreat).toHaveBeenCalledTimes(1);

    const idlePortalPages = buildDockPages(
      makeInput({
        entity: building('PORTAL', { isPortal: true }),
        inRaid: false,
        handlers
      })
    );
    expect(idlePortalPages).toEqual([]);

    const wallPages = buildDockPages(makeInput({ entity: building('WALL'), handlers }));
    expect(wallPages.map((page) => page.id)).toEqual(['ORDERS']);
    expect(ids(wallPages[0].commands)).toEqual(['building:DELETE']);
  });

  it('routes the train and upgrade clicks to the existing handlers', () => {
    const handlers = makeHandlers();
    const pages = buildDockPages(makeInput({ entity: building('BARRACKS'), handlers }));
    pages[0].commands.find((command) => command.id === 'train:SPEARMAN')?.action();
    expect(handlers.onTrainUnit).toHaveBeenCalledWith('building-BARRACKS', 'SPEARMAN');
    pages[0].commands.find((command) => command.id === 'upgrade:START')?.action();
    expect(handlers.onUpgradeBuilding).toHaveBeenCalledWith('building-BARRACKS');
  });
});

describe('dock pages stay inside the card', () => {
  it('never asks the grid for more slots than it has', () => {
    const selections: SelectedEntityData[] = [
      villager(),
      building('BARRACKS'),
      building('TOWN_CENTER'),
      building('HOUSE'),
      building('STABLE')
    ];
    for (const entity of selections) {
      for (const page of buildDockPages(makeInput({ entity }))) {
        expect(page.commands.length).toBeLessThanOrEqual(DOCK_SLOT_CAPACITY);
      }
    }
  });
});

describe('selectionDisplayName', () => {
  it('labels a multi-unit selection with its size', () => {
    expect(selectionDisplayName(villager({ selectionCount: 3 }))).toBe(
      `${i18n.t('units.VILLAGER.name')} (3)`
    );
  });

  it('re-labels a building from its type instead of the published name', () => {
    expect(selectionDisplayName(building('BARRACKS'))).toBe(buildingName('BARRACKS'));
  });

  it('uses the resource node label for a resource selection', () => {
    const node = {
      id: 'n1',
      type: 'resource',
      name: 'TREE',
      subType: 'TREE'
    } as SelectedEntityData;
    expect(selectionDisplayName(node)).toBe(i18n.t('resourceNodes.TREE'));
  });
});

describe('costText', () => {
  it('lists only the resources the command actually costs', () => {
    expect(costText({ wood: 100, food: 0, gold: 20, stone: 0 })).toBe(
      `${i18n.t('resources.wood')} 100 · ${i18n.t('resources.gold')} 20`
    );
  });
});

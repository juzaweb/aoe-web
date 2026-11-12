import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import i18n from '../../i18n/index.js';
import type { Resources } from '@chien-quoc/shared';
import type { SelectedEntityData } from '../../game/scenes/WorldScene.js';
import type { DockCommandHandlers } from './commandPages.js';
import { DockBar } from './DockBar.js';
import { DOCK_HEIGHT_PX, DOCK_SLOT_CAPACITY } from './dockMetrics.js';

const RICH: Resources = { wood: 5000, food: 5000, gold: 5000, stone: 5000 };

function handlers(): DockCommandHandlers {
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

function villager(): SelectedEntityData {
  return {
    id: 'unit-1',
    type: 'unit',
    name: 'VILLAGER (1)',
    subType: 'VILLAGER',
    isOwner: true,
    villagerSelected: true,
    selectionCount: 1,
    hp: 25,
    maxHp: 25
  } as SelectedEntityData;
}

function renderDock(options: {
  entity?: SelectedEntityData | null;
  displayName?: string;
} = {}): string {
  const entity = options.entity === undefined ? villager() : options.entity;
  return renderToString(
    <DockBar
      entity={entity}
      displayName={options.displayName ?? (entity ? i18n.t('units.VILLAGER.name') : '')}
      resources={RICH}
      townCenterLevel={1}
      inRaid={false}
      armedOrder={null}
      activeBuildingType={null}
      roadMode={null}
      wallMode={null}
      room={null}
      sceneRef={React.createRef()}
      onPanToGrid={() => undefined}
      onCommandAtGrid={() => undefined}
      handlers={handlers()}
    />
  );
}

function countSlots(html: string): number {
  return html.split('data-command-slot').length - 1;
}

describe('DockBar server render', () => {
  it('renders one fixed dock with the fifteen build slots and no floating panel', async () => {
    await i18n.changeLanguage('vi');
    const html = renderDock();

    expect(html).toContain('data-command-dock');
    expect(html).toContain(`height:${DOCK_HEIGHT_PX}px`);
    expect(countSlots(html)).toBe(DOCK_SLOT_CAPACITY);
    expect(html).toContain('data-selection-strip');
    expect(html).not.toContain('data-selection-details');
    expect(html).not.toContain('data-details-popover');
  });

  it('collapses to the radar alone when nothing is selected', async () => {
    await i18n.changeLanguage('vi');
    const html = renderDock({ entity: null });

    expect(html).toContain('data-command-dock');
    expect(html).toContain('data-minimap-desktop');
    expect(html).not.toContain('data-command-card');
    expect(html).not.toContain('data-selection-strip');
  });

  it('shrinks the command set on a map with no paintable roads', async () => {
    await i18n.changeLanguage('vi');
    // `sceneRef` is null in this render, so the dock cannot know the zone and
    // keeps the brush tools: the build page is the full fifteen.
    expect(countSlots(renderDock())).toBe(DOCK_SLOT_CAPACITY);
  });

  it('only shows page arrows when the selection owns more than one page', async () => {
    await i18n.changeLanguage('vi');
    // A villager has BUILD + ORDERS, so the header carries page arrows.
    const villagerHtml = renderDock();
    expect(villagerHtml).toContain('data-command-page-prev');
    expect(villagerHtml).toContain('data-command-page-next');

    // A house has only the upgrade page, so there is nothing to page through.
    const houseHtml = renderDock({
      entity: {
        id: 'house-1',
        type: 'building',
        name: 'HOUSE',
        subType: 'HOUSE',
        isOwner: true,
        isConstructed: true,
        level: 1,
        maxLevel: 10
      } as SelectedEntityData
    });
    expect(houseHtml).toContain('data-command-card');
    expect(houseHtml).not.toContain('data-command-page-prev');
  });

  it('follows the active language', async () => {
    await i18n.changeLanguage('en');
    const english = renderDock();
    expect(english).toContain(i18n.t('dock.pageBuild'));

    await i18n.changeLanguage('vi');
    const vietnamese = renderDock();
    expect(vietnamese).toContain(i18n.t('dock.pageBuild'));
    expect(english).not.toBe(vietnamese);
  });

  it('renders compact combat stats for units and remaining stockpile for resources', async () => {
    await i18n.changeLanguage('en');
    const unitHtml = renderDock({
      entity: {
        ...villager(),
        attackPower: 5,
        attackRange: 1.2,
        attackCooldownMs: 1500,
        speed: 3.5
      }
    });
    expect(unitHtml).toContain('data-selection-stats');
    expect(unitHtml).toContain('5');
    expect(unitHtml).toContain('1.2');
    expect(unitHtml).toContain('1.5s');
    expect(unitHtml).toContain('3.5');

    const resourceHtml = renderDock({
      entity: {
        id: 'tree-1',
        type: 'resource',
        name: 'TREE',
        subType: 'TREE',
        remainingAmount: 85,
        maxAmount: 100
      } as SelectedEntityData
    });
    expect(resourceHtml).toContain('data-selection-stats');
    expect(resourceHtml).toContain('85 / 100');

    const farmHtml = renderDock({
      entity: {
        id: 'farm-1',
        type: 'building',
        name: 'FARM',
        subType: 'FARM',
        isOwner: true,
        isConstructed: true,
        hp: 400,
        maxHp: 400,
        level: 1,
        maxLevel: 10,
        remainingAmount: 220,
        maxAmount: 250
      } as SelectedEntityData
    });
    expect(farmHtml).toContain('data-selection-stats');
    expect(farmHtml).toContain('220 / 250');
  });
});

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
    onCenterBase: vi.fn()
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
  detailsOpen?: boolean;
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
      detailsOpen={options.detailsOpen ?? false}
      onToggleDetails={() => undefined}
      onPanToGrid={() => undefined}
      onCommandAtGrid={() => undefined}
      handlers={handlers()}
      details={null}
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
    // UIX-07: the full entity sheet only exists once the player asks for it.
    expect(html).not.toContain('data-details-popover');
    expect(html).toContain('aria-expanded="false"');
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

  it('mounts the detail sheet inside the popover when it is open', async () => {
    await i18n.changeLanguage('vi');
    const html = renderDock({ detailsOpen: true, displayName: 'Nông dân' });

    expect(html).toContain('data-details-popover');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-expanded="true"');
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
});

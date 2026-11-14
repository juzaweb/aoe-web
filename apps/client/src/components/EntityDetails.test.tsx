import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { SelectedEntityData } from '../game/scenes/WorldScene.js';
import i18n from '../i18n/index.js';
import { EntityDetails } from './EntityDetails.js';

/**
 * UIX-15 regression guard: the training tooltip is the only place the panel
 * writes down a unit's price, attack, HP and training time, and it used to open
 * on hover alone. Keyboard and touch players therefore could not read it.
 *
 * The component is rendered through `react-dom/server` — the same markup-level
 * pattern `AuthScreen.test.tsx` uses — because the contract under test is the
 * rendered attributes: which utility classes reveal the box and which element
 * names it for a screen reader.
 */
const RICH_RESOURCES = { wood: 900, food: 900, gold: 900, stone: 900 };

const BARRACKS: SelectedEntityData = {
  id: 'b1',
  type: 'building',
  name: 'Barracks',
  subType: 'BARRACKS',
  hp: 1200,
  maxHp: 1200,
  isOwner: true,
  isConstructed: true,
  level: 1,
  maxLevel: 5,
  unitLevels: [1, 1, 1, 1, 1]
};

function renderPanel(entity: SelectedEntityData, resources = RICH_RESOURCES): string {
  return renderToString(
    <EntityDetails
      entity={entity}
      playerResources={resources}
      onTrainUnit={() => {}}
      onCancelTrain={() => {}}
      onCancelBuilding={() => {}}
      onUpgradeBuilding={() => {}}
      onCancelBuildingUpgrade={() => {}}
      onUpgradeUnitType={() => {}}
      onCancelUnitUpgrade={() => {}}
    />
  );
}

/** Class list of every tooltip box the panel rendered. */
function tooltipClasses(html: string): string[] {
  return [...html.matchAll(/role="tooltip"[^>]*class="([^"]*)"/g)].map((match) => match[1]);
}

function describedBy(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]*)"/g)].map((match) => match[1]);
}

function tooltipIds(html: string): string[] {
  return [...html.matchAll(/<div id="([^"]*)" role="tooltip"/g)].map((match) => match[1]);
}

describe('unit training tooltip (UIX-15)', () => {
  it('keeps the desktop hover reveal and adds focus and touch reveals', () => {
    const classes = tooltipClasses(renderPanel(BARRACKS));

    expect(classes.length).toBe(1);
    expect(classes[0]).toContain('group-hover:opacity-100');
    // Keyboard: `Tab` onto the train button opens its box.
    expect(classes[0]).toContain('group-focus-within:opacity-100');
    // Touch: a press has no hover, so holding the button opens the same box.
    expect(classes[0]).toContain('group-active:opacity-100');
  });

  it('is announced from the button through aria-describedby', async () => {
    await i18n.changeLanguage('en');
    const html = renderPanel(BARRACKS);

    expect(describedBy(html)).toEqual(tooltipIds(html));
    expect(describedBy(html).length).toBe(1);
    expect(html).toContain(`aria-describedby="train-tooltip-b1-SPEARMAN"`);
  });

  it('describes the price and the stats a hover used to reveal', async () => {
    await i18n.changeLanguage('en');
    const html = renderPanel(BARRACKS);

    // The description must be the real content, not a placeholder: a screen
    // reader announces name, cost and combat stats from it.
    expect(html).toMatch(/role="tooltip"[\s\S]*?Spearman/);
    expect(html).toMatch(/role="tooltip"[\s\S]*?Attack: \d+/);
    expect(html).toMatch(/role="tooltip"[\s\S]*?HP: \d+/);
    expect(html).toMatch(/role="tooltip"[\s\S]*?Training: [\d.]+s/);
  });

  it('pins the revealed box to the row edge so the scroll panel cannot clip it', () => {
    // The card is `overflow-y-auto`, so a 176 px box centred on a button at the
    // row's left edge hangs outside the panel and is cut off. Edge buttons
    // anchor to the row instead of centring, which keeps the box inside.
    const classes = tooltipClasses(renderPanel(BARRACKS));

    expect(classes[0]).toMatch(/\bleft-0\b/);
    expect(classes[0]).not.toContain('-translate-x-1/2');
  });

  it('keeps the dim shade only on the disabled train button', () => {
    // UIX-12: the greyed-out state is the affordance, so it keeps the dimmer
    // `text-slate-600`, and it is always paired with the not-allowed cursor.
    const html = renderPanel(BARRACKS, { wood: 0, food: 0, gold: 0, stone: 0 });

    expect(html).toContain('text-slate-600 cursor-not-allowed');
    expect(html).not.toContain('text-slate-500');
  });
});

describe('raid retreat gate (phase 23)', () => {
  it('offers retreat from the shared portal even though the defender owns it', async () => {
    await i18n.changeLanguage('en');
    const portal: SelectedEntityData = {
      ...BARRACKS,
      id: 'b-portal',
      name: 'Portal',
      subType: 'PORTAL',
      isPortal: true,
      isOwner: false
    };

    const html = renderToString(
      <EntityDetails
        entity={portal}
        playerResources={RICH_RESOURCES}
        inRaid
        onRetreat={() => {}}
        onTrainUnit={() => {}}
        onCancelTrain={() => {}}
        onCancelBuilding={() => {}}
        onUpgradeBuilding={() => {}}
        onCancelBuildingUpgrade={() => {}}
        onUpgradeUnitType={() => {}}
        onCancelUnitUpgrade={() => {}}
      />
    );

    expect(html).toContain('RETREAT GATE');
    expect(html).toContain('Withdraw the whole army to the kingdom');
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { BuildingUpgradePanel } from './UpgradePanels.js';

/**
 * UIX-12 regression guard for the two panels this slice owns.
 *
 * `text-slate-500` (#64748b) measures 4.24:1 on the page background,
 * 3.75:1 on `#0f172a` and 3.07:1 on the `aoe-panel` gradient — under the 4.5:1
 * AA floor that applies to the 11 px auxiliary labels these panels use.
 * `text-slate-400` (#94a3b8) measures 7.87:1 and 5.9:1 on the same surfaces.
 *
 * The rule enforced here: every informational shade is `slate-400`, and any
 * remaining `slate-500`/`slate-600` sits on a control that is genuinely
 * disabled, where the muted colour is the affordance rather than body text.
 */
const COMPONENT_DIR = dirname(fileURLToPath(import.meta.url));
const SCANNED_FILES = ['UpgradePanels.tsx', 'EntityDetails.tsx'];

/** A dim shade is allowed only where the disabled affordance is also present. */
const DISABLED_CUE = /cursor-not-allowed|aria-disabled|disabled=/;
const DIM_SHADE = /text-slate-(500|600)/;

const TOWN_CENTER_PROPS = {
  buildingId: 'b1',
  type: 'TOWN_CENTER' as const,
  level: 2,
  playerResources: { wood: 900, food: 900, gold: 900, stone: 900 },
  onUpgrade: () => {},
  onCancel: () => {}
};

describe('auxiliary text contrast (UIX-12)', () => {
  it('dims text only on disabled controls', () => {
    const offenders = SCANNED_FILES.flatMap((name) =>
      readFileSync(join(COMPONENT_DIR, name), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          DIM_SHADE.test(line) && !DISABLED_CUE.test(line) ? [`${name}:${index + 1}`] : []
        )
    );

    expect(offenders).toEqual([]);
  });

  it('prints the next-level preview in the readable shade', () => {
    const html = renderToString(<BuildingUpgradePanel {...TOWN_CENTER_PROPS} />);

    // The "→ +n%" previews are informational: they only appear while an
    // upgrade is still possible, which is exactly when the player compares
    // levels, so they must clear AA.
    expect(html).toMatch(/text-slate-400">\s*→/);
    expect(html).not.toContain('text-slate-500');
  });

  it('keeps the dim shade on the blocked upgrade button', () => {
    const html = renderToString(
      <BuildingUpgradePanel
        {...TOWN_CENTER_PROPS}
        playerResources={{ wood: 0, food: 0, gold: 0, stone: 0 }}
      />
    );

    expect(html).toContain('text-slate-600 cursor-not-allowed');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The completion cue is the only audio in `SelectionController`; mocking the
 * module keeps this test about the selection contract, not Web Audio.
 */
vi.mock('../audio/commandSound.js', () => ({ playCommandSound: vi.fn() }));

import { playCommandSound } from '../audio/commandSound.js';
import { SelectionController } from './SelectionController.js';

interface FakeUnit {
  x: number;
  y: number;
  type?: string;
}

/**
 * The slice of `WorldScene` a box selection reads. Bodies use `getUnitBodyBox`
 * defaults, so a unit placed near the origin overlaps a drag box drawn from the
 * origin.
 */
function fakeScene(units: Record<string, FakeUnit>) {
  const unitSprites = new Map<string, never>();
  const stateUnits = new Map<string, { ownerId: string; type: string }>();
  Object.entries(units).forEach(([id, unit]) => {
    unitSprites.set(id, {
      x: unit.x,
      y: unit.y,
      getData: () => undefined
    } as never);
    stateUnits.set(id, { ownerId: 'me', type: unit.type ?? 'SPEARMAN' });
  });

  const scene = {
    room: { state: { units: stateUnits } },
    myOwnerId: 'me',
    unitSprites,
    buildingSprites: new Map<string, never>(),
    selectedUnitIds: new Set<string>(),
    selectedBuildingId: null as string | null,
    selectedResourceId: null as string | null,
    selectedRoadId: null as string | null,
    commands: { cancelPendingOrder: vi.fn() },
    cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
    notifySelectionChange: vi.fn()
  };
  return scene;
}

function drag(scene: ReturnType<typeof fakeScene>) {
  const controller = new SelectionController(scene as never);
  controller.handleBoxSelect({ x: 0, y: 0 }, { x: 50, y: 50 }, false, 'all');
  return controller;
}

describe('box-selection completion cue (UIX-05)', () => {
  beforeEach(() => {
    vi.mocked(playCommandSound).mockClear();
  });

  it('plays the select cue when a drag takes more than one unit', () => {
    const scene = fakeScene({
      a: { x: 10, y: 10 },
      b: { x: 20, y: 20 }
    });
    drag(scene);
    expect(scene.selectedUnitIds.size).toBe(2);
    expect(playCommandSound).toHaveBeenCalledWith('select');
  });

  it('stays silent for a drag that lands a single unit', () => {
    const scene = fakeScene({ a: { x: 10, y: 10 } });
    drag(scene);
    expect(scene.selectedUnitIds.size).toBe(1);
    expect(playCommandSound).not.toHaveBeenCalled();
  });

  it('stays silent for a drag that lands nothing', () => {
    const scene = fakeScene({});
    drag(scene);
    expect(scene.selectedUnitIds.size).toBe(0);
    expect(playCommandSound).not.toHaveBeenCalled();
  });
});

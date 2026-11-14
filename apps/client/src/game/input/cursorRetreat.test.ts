import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hitTest.js', () => ({
  findBuildingAt: vi.fn(),
  findOwnFoundationAt: vi.fn(() => null),
  findOwnGatherableAt: vi.fn(() => null),
  findResourceAt: vi.fn(() => null),
  findUnitAt: vi.fn(() => null)
}));

import { findBuildingAt, findUnitAt } from './hitTest.js';
import { CursorController } from './CursorController.js';

function fakeScene() {
  return {
    buildingToPlace: null,
    wallMode: null,
    commands: { pendingOrder: null, contextualArmed: false },
    selectedUnitIds: new Set<string>(['u1']),
    selection: { isAllVillagers: () => false },
    room: {
      state: {
        buildings: new Map([
          ['portal-1', { id: 'portal-1', type: 'PORTAL', ownerId: 'defender' }],
          ['tower-1', { id: 'tower-1', type: 'TOWER', ownerId: 'defender' }]
        ])
      }
    }
  };
}

describe('CursorController shared retreat gate', () => {
  beforeEach(() => {
    vi.mocked(findUnitAt).mockReset();
    vi.mocked(findBuildingAt).mockReset();
  });

  it('does not show the attack cursor over the portal a raid shares', () => {
    // The defender owns the gateway a raider retreats through. It is not an
    // attack target, so the cursor must not promise an attack on it.
    const scene = fakeScene();
    const cursor = new CursorController(scene as never);
    vi.mocked(findBuildingAt).mockReturnValue('portal-1');

    expect(cursor.resolve({ x: 0, y: 0 })).toBe('default');
  });

  it('shows the attack cursor over an enemy building that is not a portal', () => {
    const scene = fakeScene();
    const cursor = new CursorController(scene as never);
    vi.mocked(findBuildingAt).mockImplementation((_scene, _grid, owner) =>
      owner === 'enemy' ? 'tower-1' : null
    );

    expect(cursor.resolve({ x: 0, y: 0 })).toBe('attack');
  });

  it('still shows the attack cursor for an enemy unit standing on the portal', () => {
    const scene = fakeScene();
    const cursor = new CursorController(scene as never);
    vi.mocked(findUnitAt).mockReturnValue('enemy-unit');
    vi.mocked(findBuildingAt).mockReturnValue('portal-1');

    expect(cursor.resolve({ x: 0, y: 0 })).toBe('attack');
  });
});

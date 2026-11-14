import { describe, expect, it, vi } from 'vitest';

// The scene only ever runs inside Phaser; this suite calls one lifecycle method
// on a fabricated instance, so the base class does not need to do anything.
vi.mock('phaser', () => ({ Scene: class {} }));

import { WorldScene } from './WorldScene.js';

/**
 * Builds just enough of a scene for `resetForNewWorld` to run.
 *
 * The method is private, and reaching it through a real `WorldScene` would mean
 * booting Phaser and a room for a map-teardown guard; calling it on a stub keeps
 * the behaviour under test (which fields it touches before `create()` has run)
 * without any of that.
 */
function stubScene(overrides: Record<string, unknown> = {}) {
  return {
    buildingSprites: new Map(),
    unitSprites: new Map(),
    corpseSprites: new Map(),
    resourceSprites: new Map(),
    pendingResources: [],
    pendingResourceKeys: new Set(),
    unitMotion: new Map(),
    selectedUnitIds: new Set(),
    cancelledFoundations: new Set(),
    rangedFire: { reset: vi.fn() },
    ownerColorRegistry: { invalidateAll: vi.fn() },
    underAttackTracker: { clear: vi.fn() },
    ...overrides
  };
}

function resetForNewWorld(scene: unknown) {
  const method = (WorldScene.prototype as unknown as Record<string, (this: unknown) => void>)[
    'resetForNewWorld'
  ];
  return method.call(scene);
}

describe('WorldScene.resetForNewWorld', () => {
  it('runs before create() built the renderer', () => {
    // React detaches the old room as soon as it is released, which can happen
    // while Phaser is still booting: `entityRenderer` is assigned in create(),
    // so every call from here has to tolerate it being absent. This crashed
    // with "Cannot read properties of undefined (reading 'clearTeamColors')".
    expect(() => resetForNewWorld(stubScene())).not.toThrow();
  });

  it('clears the remembered team colours of the previous map', () => {
    const clearTeamColors = vi.fn();
    resetForNewWorld(stubScene({ entityRenderer: { clearTeamColors } }));
    expect(clearTeamColors).toHaveBeenCalledOnce();
  });

  it('drops every sprite of the previous map', () => {
    const destroy = vi.fn();
    const sprite = { destroy };
    const scene = stubScene({
      entityRenderer: { clearTeamColors: vi.fn() },
      unitSprites: new Map([['a', sprite]]),
      corpseSprites: new Map([['b', sprite]])
    });
    resetForNewWorld(scene);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect((scene.unitSprites as Map<string, unknown>).size).toBe(0);
    expect((scene.corpseSprites as Map<string, unknown>).size).toBe(0);
  });
});

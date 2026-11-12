import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIsoDepth, screenToGrid } from '@chien-quoc/shared';

/**
 * `orderFeedback.ts` imports Phaser for the `Scene` type and the tween call.
 * These tests only exercise the pure spec, the depth key and the drawing
 * contract, so Phaser is stubbed and the scene/graphics are fakes.
 */
vi.mock('phaser', () => ({}));

import {
  ORDER_FEEDBACK_DURATION_MS,
  ORDER_FEEDBACK_DEPTH_OFFSET,
  ORDER_FEEDBACK_STATIC_DURATION_MS,
  drawOrderFeedback,
  orderFeedbackDepth,
  orderFeedbackSpec,
  type OrderFeedbackKind
} from './orderFeedback.js';

const KINDS: OrderFeedbackKind[] = ['move', 'attack', 'gather', 'build', 'rally', 'stop', 'focus', 'reject'];

function fakeScene() {
  const graphics = {
    setDepth: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    strokeEllipse: vi.fn().mockReturnThis(),
    lineBetween: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillCircle: vi.fn().mockReturnThis(),
    setScale: vi.fn().mockReturnThis(),
    setAlpha: vi.fn().mockReturnThis(),
    destroy: vi.fn()
  };
  const addGraphics = vi.fn(() => graphics);
  const addTween = vi.fn((_config: Record<string, unknown>) => ({}));
  const delayedCall = vi.fn((_delayMs: number, _callback: () => void) => ({}));
  const scene = {
    add: { graphics: addGraphics },
    tweens: { add: addTween },
    time: { delayedCall }
  };
  return { scene, graphics, addGraphics, addTween, delayedCall };
}

/** Makes `prefersReducedMotion()` answer the given value for one test. */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('window', {
    matchMedia: vi.fn((query: string) => ({ matches: reduce, media: query }))
  });
}

describe('order feedback decals (UIX-01)', () => {
  it('gives every order kind its own spec', () => {
    const specs = KINDS.map((kind) => orderFeedbackSpec(kind));
    specs.forEach((spec) => {
      expect(spec.rings).toBeGreaterThanOrEqual(1);
      expect(spec.color).toBeTypeOf('number');
      expect(spec.accent).toBeTypeOf('number');
    });
    // No two orders may share both shape and colour, or the decal says nothing.
    const signatures = new Set(specs.map((spec) => `${spec.color}:${spec.rings}:${spec.crosshair}:${spec.ticks}`));
    expect(signatures.size).toBe(specs.length);
  });

  it('marks only attack with a reticle', () => {
    expect(orderFeedbackSpec('attack').crosshair).toBe(true);
    KINDS.filter((kind) => kind !== 'attack').forEach((kind) => {
      expect(orderFeedbackSpec(kind).crosshair).toBe(false);
    });
  });

  it('closes the whole decal inside the 300 ms budget', () => {
    expect(ORDER_FEEDBACK_DURATION_MS).toBe(300);
  });

  it('keys the depth to the tapped tile, below every entity band', () => {
    const x = 128;
    const y = 96;
    const grid = screenToGrid(x, y);
    expect(orderFeedbackDepth(x, y)).toBe(getIsoDepth(grid.gridX, grid.gridY, ORDER_FEEDBACK_DEPTH_OFFSET));
    // EntityRenderer starts at +10 in the same isometric row.
    expect(ORDER_FEEDBACK_DEPTH_OFFSET).toBeLessThan(10);
    expect(ORDER_FEEDBACK_DEPTH_OFFSET).toBeGreaterThan(0);
  });

  it('draws around the local origin so the shrink cannot slide off the cursor', () => {
    const { scene, addGraphics, graphics, addTween } = fakeScene();
    drawOrderFeedback(scene as never, 640, 320, 'move');

    // Positioned at the click point, shapes drawn at (0, 0).
    expect(addGraphics).toHaveBeenCalledWith({ x: 640, y: 320 });
    expect(graphics.strokeEllipse).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number));
    expect(graphics.setScale).toHaveBeenCalledWith(1.45);

    const tween = addTween.mock.calls[0][0] as unknown as {
      duration: number;
      scaleX: number;
      scaleY: number;
      alpha: number;
      onComplete: () => void;
    };
    expect(tween.duration).toBe(ORDER_FEEDBACK_DURATION_MS);
    expect(tween.scaleX).toBe(1);
    expect(tween.scaleY).toBe(1);
    expect(tween.alpha).toBe(0);

    expect(graphics.destroy).not.toHaveBeenCalled();
    tween.onComplete();
    expect(graphics.destroy).toHaveBeenCalledTimes(1);
  });

  it('draws the attack reticle as four arms with a centre gap', () => {
    const { scene, graphics } = fakeScene();
    drawOrderFeedback(scene as never, 0, 0, 'attack');
    // Four lineBetween calls for the crosshair; no ticks on an attack.
    expect(graphics.lineBetween).toHaveBeenCalledTimes(4);
  });
});

/**
 * UIX-13: reduced motion drops the scale/alpha tween, not the marker. The decal
 * still has to appear where the order was issued and then leave — it is the only
 * acknowledgement a right click gets before the server round-trip lands.
 */
describe('order feedback under reduced motion (UIX-13)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the decal at rest and removes it on a short timer instead of tweening', () => {
    stubReducedMotion(true);
    const { scene, graphics, addTween, delayedCall } = fakeScene();

    const decal = drawOrderFeedback(scene as never, 640, 320, 'move');

    expect(decal).toBe(graphics);
    expect(addTween).not.toHaveBeenCalled();
    // No shrink either: the ring is already at the size it stays at.
    expect(graphics.setScale).not.toHaveBeenCalled();
    expect(delayedCall).toHaveBeenCalledWith(ORDER_FEEDBACK_STATIC_DURATION_MS, expect.any(Function));

    const [, onElapsed] = delayedCall.mock.calls[0];
    expect(graphics.destroy).not.toHaveBeenCalled();
    onElapsed();
    expect(graphics.destroy).toHaveBeenCalledTimes(1);
  });

  it('still draws every shape of the order, so the feedback survives', () => {
    stubReducedMotion(true);
    const { scene, graphics } = fakeScene();

    drawOrderFeedback(scene as never, 0, 0, 'attack');

    expect(graphics.strokeEllipse).toHaveBeenCalledTimes(1);
    expect(graphics.lineBetween).toHaveBeenCalledTimes(4);
    expect(graphics.fillCircle).toHaveBeenCalledWith(0, 0, 3);
  });

  it('keeps the existing tween when the player has no motion preference', () => {
    stubReducedMotion(false);
    const { scene, addTween, delayedCall } = fakeScene();

    drawOrderFeedback(scene as never, 640, 320, 'move');

    expect(addTween).toHaveBeenCalledTimes(1);
    expect(delayedCall).not.toHaveBeenCalled();
  });
});

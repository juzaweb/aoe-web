import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as Phaser from 'phaser';
import { applyEdgeScroll, installCanvasPresence } from './cameraInput.js';
import type { EdgeScrollOptions } from './cameraInput.js';

const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 800;
const BASE_SPEED = 12;

/** Mirrors `EDGE_SCROLL_SIZE_PX`; a few pixels inside the band must still pan. */
const INSIDE_BAND = 4;

/**
 * Regression guard for the reported bug: with the mouse dragged out of the
 * browser over the right edge, the camera kept panning to the end of the map.
 * Phaser keeps reporting the last coordinates it saw, so `applyEdgeScroll` alone
 * cannot tell "parked on the edge" from "left the window" — the presence flag is
 * the only thing that stops it.
 */
describe('applyEdgeScroll', () => {
  function scroll(x: number, y: number, pointerInsideCanvas: boolean) {
    const camera = { scrollX: 0, scrollY: 0 };
    const options = {
      camera,
      pointer: { x, y },
      viewWidth: VIEW_WIDTH,
      viewHeight: VIEW_HEIGHT,
      pointerInsideCanvas,
      cameraSpeed: BASE_SPEED
    } as unknown as EdgeScrollOptions;
    applyEdgeScroll(options);
    return camera;
  }

  it('does not pan while the pointer is outside the canvas', () => {
    // Exactly the bug: coordinates still pinned to the right edge, pointer gone.
    expect(scroll(VIEW_WIDTH - 1, VIEW_HEIGHT / 2, false)).toEqual({ scrollX: 0, scrollY: 0 });
    expect(scroll(1, 1, false)).toEqual({ scrollX: 0, scrollY: 0 });
  });

  it('pans toward each screen edge while the pointer is inside', () => {
    expect(scroll(VIEW_WIDTH - INSIDE_BAND, VIEW_HEIGHT / 2, true).scrollX).toBe(BASE_SPEED);
    expect(scroll(INSIDE_BAND, VIEW_HEIGHT / 2, true).scrollX).toBe(-BASE_SPEED);
    expect(scroll(VIEW_WIDTH / 2, VIEW_HEIGHT - INSIDE_BAND, true).scrollY).toBe(BASE_SPEED);
    expect(scroll(VIEW_WIDTH / 2, INSIDE_BAND, true).scrollY).toBe(-BASE_SPEED);
  });

  it('does not pan while the pointer is away from every edge', () => {
    expect(scroll(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, true)).toEqual({ scrollX: 0, scrollY: 0 });
  });
});

/** Minimal DOM stand-in: the installer only needs add/removeEventListener. */
function fakeEventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, handler: () => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: () => void) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type: string) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    }
  };
}

describe('installCanvasPresence', () => {
  let canvas: ReturnType<typeof fakeEventTarget>;
  let windowTarget: ReturnType<typeof fakeEventTarget>;
  let documentTarget: ReturnType<typeof fakeEventTarget> & { hidden: boolean };
  let shutdown: (() => void) | null = null;

  beforeEach(() => {
    // Fresh targets per test so a listener leaked by one case cannot inflate the
    // counts the shutdown case asserts on.
    canvas = fakeEventTarget();
    windowTarget = fakeEventTarget();
    documentTarget = Object.assign(fakeEventTarget(), { hidden: false });
    (globalThis as Record<string, unknown>).window = windowTarget;
    (globalThis as Record<string, unknown>).document = documentTarget;
    shutdown = null;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  function install() {
    const changes: boolean[] = [];
    const game = { canvas } as unknown as Phaser.Game;
    const sceneEvents = {
      once(event: string, handler: () => void) {
        if (event === 'shutdown') shutdown = handler;
      }
    } as unknown as Phaser.Events.EventEmitter;
    const dispose = installCanvasPresence(game, sceneEvents, (inside) => changes.push(inside));
    return { changes, dispose };
  }

  it('reports entering and leaving the canvas, and only on a real flip', () => {
    const { changes } = install();

    canvas.dispatch('pointerenter');
    canvas.dispatch('pointerenter');
    canvas.dispatch('pointerleave');

    expect(changes).toEqual([true, false]);
  });

  it('reports the exits that fire no pointer event on the canvas', () => {
    const { changes } = install();

    canvas.dispatch('pointerenter');
    windowTarget.dispatch('blur');
    canvas.dispatch('pointerenter');
    documentTarget.hidden = true;
    documentTarget.dispatch('visibilitychange');
    canvas.dispatch('pointerenter');
    canvas.dispatch('pointercancel');

    expect(changes).toEqual([true, false, true, false, true, false]);
  });

  it('ignores a visibilitychange that only returns to the tab', () => {
    const { changes } = install();

    canvas.dispatch('pointerenter');
    documentTarget.hidden = false;
    documentTarget.dispatch('visibilitychange');

    expect(changes).toEqual([true]);
  });

  it('removes every listener on scene shutdown', () => {
    install();
    expect(canvas.listenerCount('pointerenter')).toBe(1);

    shutdown?.();

    expect(canvas.listenerCount('pointerenter')).toBe(0);
    expect(canvas.listenerCount('pointerleave')).toBe(0);
    expect(canvas.listenerCount('pointercancel')).toBe(0);
    expect(windowTarget.listenerCount('blur')).toBe(0);
    expect(documentTarget.listenerCount('visibilitychange')).toBe(0);
  });
});

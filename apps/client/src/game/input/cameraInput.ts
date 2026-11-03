import type * as Phaser from 'phaser';

/**
 * Width of the screen-border band that pans the camera while the pointer rests
 * there, in CSS pixels.
 */
const EDGE_SCROLL_SIZE_PX = 24;

export interface EdgeScrollOptions {
  camera: Phaser.Cameras.Scene2D.Camera;
  pointer: Phaser.Input.Pointer;
  viewWidth: number;
  viewHeight: number;
  /**
   * Whether the pointer is really over the game canvas (see
   * `installCanvasPresence`).
   */
  pointerInsideCanvas: boolean;
  /** World units to pan this frame. */
  cameraSpeed: number;
  /**
   * Whether this input source edge-scrolls at all.
   *
   * Touch is the reason this exists: a lifted finger leaves `activePointer` at the
   * last coordinates forever, so a phone released near the screen edge would keep
   * the camera crawling to the map bound. Touch pans by dragging instead.
   *
   * @default true
   */
  enabled?: boolean;
}

/**
 * Pans the camera while the pointer sits inside a screen-border band.
 * Uses `activePointer` screen coordinates, which are immune to camera scroll.
 */
export function applyEdgeScroll(options: EdgeScrollOptions) {
  const { camera, pointer, viewWidth, viewHeight, pointerInsideCanvas, cameraSpeed, enabled } =
    options;

  if (enabled === false) return;

  // Phaser keeps reporting the last coordinates it saw after the pointer leaves
  // the canvas or the window, so a mouse dragged out over the right edge would
  // otherwise keep the camera panning until the map bound. The same flag covers
  // startup: Phaser reports (0,0) until the first real move, which sits inside
  // the top-left band and would pan up-left on its own from the first frame.
  if (!pointerInsideCanvas) return;

  if (pointer.x <= EDGE_SCROLL_SIZE_PX) camera.scrollX -= cameraSpeed;
  else if (pointer.x >= viewWidth - EDGE_SCROLL_SIZE_PX) camera.scrollX += cameraSpeed;

  if (pointer.y <= EDGE_SCROLL_SIZE_PX) camera.scrollY -= cameraSpeed;
  else if (pointer.y >= viewHeight - EDGE_SCROLL_SIZE_PX) camera.scrollY += cameraSpeed;
}

/**
 * Tracks whether the pointer is really over the game canvas.
 *
 * Phaser only updates `activePointer` from events that reach the canvas, and
 * keeps the last coordinates forever after the pointer leaves. So there is no
 * way to tell "mouse parked on the right edge" from "mouse left the browser
 * through the right edge" from the pointer state alone — the second case used to
 * keep edge-scrolling until the camera hit the map bound.
 *
 * DOM `pointerenter` / `pointerleave` on the canvas answer it directly, and also
 * fire when the pointer moves onto a React HUD panel (the panel is layered over
 * the canvas, so the canvas stops receiving moves there) and when the pointer
 * leaves the window without crossing any other element.
 *
 * `blur`, `visibilitychange` and `pointercancel` cover the exits that produce no
 * leave event at all: alt-tab, a tab switch, or a gesture the browser aborted.
 *
 * Deliberately one-way on return: regaining focus with the pointer still parked
 * in a band does not resume scrolling until the pointer moves. Restarting on
 * focus-restore would pan the camera as a side effect of switching tabs back.
 *
 * @param onChange Called only when the state actually flips.
 * @returns a disposer that removes every listener.
 */
export function installCanvasPresence(
  game: Phaser.Game,
  sceneEvents: Phaser.Events.EventEmitter,
  onChange: (inside: boolean) => void
): () => void {
  const canvas = game.canvas;
  let inside = false;

  const set = (next: boolean) => {
    if (next === inside) return;
    inside = next;
    onChange(inside);
  };

  const onEnter = () => set(true);
  const onLeave = () => set(false);
  const onBlur = () => set(false);
  const onVisibilityChange = () => {
    if (document.hidden) set(false);
  };

  const dispose = () => {
    canvas.removeEventListener('pointerenter', onEnter);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointercancel', onLeave);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointercancel', onLeave);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);
  sceneEvents.once('shutdown', dispose);
  return dispose;
}

/**
 * Middle-button drag panning (AoE2 convention: hold the middle mouse button and
 * drag the map).
 *
 * The camera moves by the pointer delta converted from screen pixels to world
 * units, so the ground under the cursor keeps up with the mouse at every zoom
 * level. Panning writes `scrollX/scrollY` directly instead of calling
 * `camera.pan()`, whose tween would fight the drag.
 */
export class MiddleDragPan {
  private last: { x: number; y: number } | null = null;

  /** Starts a drag at the current pointer position. */
  begin(pointer: Phaser.Input.Pointer) {
    this.last = { x: pointer.x, y: pointer.y };
  }

  get active(): boolean {
    return this.last !== null;
  }

  /**
   * Applies one frame of the drag.
   *
   * @returns false when no drag is in progress, so the caller can skip the rest
   *   of the pointer work.
   */
  update(camera: Phaser.Cameras.Scene2D.Camera, pointer: Phaser.Input.Pointer): boolean {
    if (!this.last) return false;

    // A release that lands on a HUD panel never reaches the canvas, so no
    // `pointerup` (not even `pointerupoutside`) ends the drag. The button state on
    // the next move is the only reliable end condition: without it the camera
    // would keep following the mouse after the button was let go.
    if (!pointer.middleButtonDown()) {
      this.last = null;
      return false;
    }

    const zoom = camera.zoom || 1;
    camera.scrollX -= (pointer.x - this.last.x) / zoom;
    camera.scrollY -= (pointer.y - this.last.y) / zoom;
    this.last = { x: pointer.x, y: pointer.y };
    return true;
  }

  end() {
    this.last = null;
  }
}

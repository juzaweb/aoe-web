import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import { ZOOM_MAX, ZOOM_MIN } from './CameraController.js';
import { TouchGesture, zoomFromPinch, type TouchGestureEvent } from './touchGesture.js';

/**
 * MOB-02/MOB-03: turns Phaser touch pointers into camera and scene intents.
 *
 * Phaser reports a touch as *the left mouse button*, so without this layer a tap
 * would start a box selection and there would be no way to pan. The policy lives
 * in `TouchGesture` (pure, unit tested); this class only owns the Phaser-specific
 * parts: which `Input.Pointer` is being tracked, camera clamping, and handing the
 * resulting intent to `WorldScene`.
 *
 * Applied here rather than in the scene's handlers so `WorldScene` keeps one
 * `if (pointer.wasTouch)` branch per event and the desktop path stays untouched.
 */
export class TouchController {
  private readonly gesture = new TouchGesture();
  /** The pointer the current gesture started with; used for world lookups. */
  private pointer: Phaser.Input.Pointer | null = null;
  /** A one-finger drag has crossed the tap threshold. */
  private dragging = false;
  /** The drag is painting the box-selection rectangle instead of panning. */
  private boxDragging = false;

  constructor(private readonly scene: WorldScene) {}

  /** True while a two-finger pinch owns the input. */
  get isPinching(): boolean {
    return this.gesture.isPinching;
  }

  begin(pointer: Phaser.Input.Pointer) {
    const time = (pointer.event as TouchEvent | undefined)?.timeStamp ?? this.now();
    this.pointer = pointer;
    this.gesture.begin(pointer.id, pointer.x, pointer.y, time);

    // Placement has no hover on touch: showing the ghost where the finger landed
    // is the only feedback before the tap that commits it.
    this.scene.touchPressPointer(pointer);
  }

  move(pointer: Phaser.Input.Pointer) {
    if (!this.gesture.isDown) return;
    const time = (pointer.event as TouchEvent | undefined)?.timeStamp ?? this.now();
    this.handle(this.gesture.move(pointer.id, pointer.x, pointer.y, time), pointer);
  }

  /**
   * @param outside true when the release landed off-canvas (a HUD panel, or a
   *   cancelled gesture). A tap is then skipped: the pointer coordinates describe
   *   the panel, not the world, so an order fired from them would land anywhere.
   */
  end(pointer: Phaser.Input.Pointer, outside = false) {
    const time = (pointer.event as TouchEvent | undefined)?.timeStamp ?? this.now();
    const event = this.gesture.end(pointer.id, pointer.x, pointer.y, time);
    this.handle(outside && event.kind === 'tap' ? { kind: 'none' } : event, pointer);
    if (!this.gesture.isDown) {
      // The box rectangle belongs to the gesture that painted it: committing it
      // here (not on the pan event) is what makes a slow drag select, not nothing.
      if (this.boxDragging) this.scene.endTouchDrag(pointer);
      this.resetDrag();
    }
  }

  /** Long-press timer pump, called once per frame from `WorldScene.update`. */
  tick(now: number) {
    if (!this.gesture.isDown) return;
    this.handle(this.gesture.tick(now), this.pointer);
  }

  /**
   * Drops the gesture without acting on it: the browser cancelled it (a system
   * gesture took over, the app was backgrounded, the map switched).
   */
  cancel() {
    this.gesture.reset();
    this.resetDrag();
    this.pointer = null;
  }

  private handle(event: TouchGestureEvent, pointer: Phaser.Input.Pointer | null) {
    const camera = this.scene.cameras.main;

    switch (event.kind) {
      case 'pan': {
        if (!pointer) return;
        if (!this.dragging) {
          // First sample past the tap threshold: decide once whether this drag is
          // a box selection (armed from the bar) or a camera pan.
          this.dragging = true;
          this.boxDragging = this.scene.beginTouchDrag(pointer);
        }

        if (this.boxDragging) {
          this.scene.updateTouchDrag(pointer);
          return;
        }

        const zoom = camera.zoom || 1;
        camera.scrollX -= event.dx / zoom;
        camera.scrollY -= event.dy / zoom;
        return;
      }

      case 'pinch': {
        // A pinch is a camera gesture, never a selection: drop any rectangle that
        // was being painted before the second finger landed.
        if (this.boxDragging) {
          this.scene.cancelTouchDrag();
          this.boxDragging = false;
        }

        // Anchor the zoom on the fingers: remember the world point under the
        // midpoint, apply the zoom, then shift the camera by however far that
        // point moved. Zooming about the screen centre instead would slide the
        // ground out from under the gesture.
        const before = camera.getWorldPoint(event.x, event.y);
        this.scene.setCameraZoom(
          zoomFromPinch(camera.zoom, event.factor, ZOOM_MIN, ZOOM_MAX)
        );
        const after = camera.getWorldPoint(event.x, event.y);
        camera.scrollX += before.x - after.x;
        camera.scrollY += before.y - after.y;

        // Follow the midpoint too, so a two-finger drag pans while it pinches.
        const zoom = camera.zoom || 1;
        camera.scrollX -= event.dx / zoom;
        camera.scrollY -= event.dy / zoom;
        return;
      }

      case 'tap': {
        if (!pointer) return;
        this.scene.touchTapPointer(pointer);
        return;
      }

      case 'long-press': {
        if (!pointer) return;
        this.scene.touchLongPressPointer(pointer);
        // Best-effort haptic confirmation; iOS Safari has no Vibration API, and a
        // refused call must not break the order that already went out.
        try {
          navigator.vibrate?.(10);
        } catch {
          /* ignore */
        }
        return;
      }

      default:
        return;
    }
  }

  private resetDrag() {
    this.dragging = false;
    this.boxDragging = false;
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}

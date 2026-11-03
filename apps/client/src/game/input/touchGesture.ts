/**
 * Gesture recogniser for the touch input path.
 *
 * Phaser gives every finger its own `Input.Pointer`, but it maps a touch to the
 * *left mouse button* (`Pointer#touchstart` sets `buttons = 1`), so the scene
 * cannot tell a tap from a drag from a second finger. This class is the missing
 * layer: it consumes raw pointer events and emits one of four intents.
 *
 * It is deliberately free of Phaser and DOM imports so the whole policy can be
 * unit tested in Node, the same way `cameraInput.ts` is. Camera math and scene
 * side effects stay with the caller (`TouchController`).
 *
 * Time is injected rather than read from `performance.now()`: a test can drive a
 * long-press by advancing the clock, and the scene can pump `tick()` from its own
 * frame loop with Phaser's clock, so both agree on the same timeline.
 */

/** Maximum travel from the press point that still counts as a tap, CSS px. */
export const TAP_MAX_MOVE_PX = 12;

/** A press held longer than this is a tap only if it also moved almost nothing. */
export const TAP_MAX_MS = 400;

/** Hold duration that turns a stationary press into a contextual order. */
export const LONG_PRESS_MS = 350;

/**
 * Below this span the pinch factor is not trusted: two fingers that close
 * together make span division numerically unstable, and the resulting zoom would
 * jump by whole steps.
 */
export const PINCH_MIN_SPAN_PX = 24;

export type TouchGestureEvent =
  | { kind: 'none' }
  /** Release without travel: select, confirm a placement or commit an order. */
  | { kind: 'tap'; x: number; y: number }
  /** Stationary hold: the right-click equivalent. */
  | { kind: 'long-press'; x: number; y: number }
  /** One-finger drag: camera pan, or box selection when the bar armed it. */
  | { kind: 'pan'; dx: number; dy: number }
  /**
   * Two-finger gesture. `factor` is relative to the previous pinch sample, so a
   * caller multiplies its current zoom by it and clamps; `dx/dy` is how far the
   * midpoint travelled, which pans the map under the fingers, and `x/y` is where
   * that midpoint is now, so the zoom can be anchored on it instead of the centre
   * of the screen.
   */
  | { kind: 'pinch'; factor: number; dx: number; dy: number; x: number; y: number };

const NONE: TouchGestureEvent = { kind: 'none' };

interface DownState {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  time: number;
  /** Largest distance from the press point seen so far. */
  moved: number;
}

interface SecondState {
  id: number;
  x: number;
  y: number;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Zoom a pinch sample would produce, clamped to the camera's range.
 *
 * Bounds are parameters instead of imports because `ZOOM_MIN`/`ZOOM_MAX` live in
 * `CameraController.ts`, which imports Phaser; pulling that in would make this
 * module untestable in the Node test environment.
 */
export function zoomFromPinch(currentZoom: number, factor: number, min: number, max: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return currentZoom;
  return Math.min(max, Math.max(min, currentZoom * factor));
}

export class TouchGesture {
  private down: DownState | null = null;
  private second: SecondState | null = null;
  /** How the current one-finger press is being interpreted. */
  private phase: 'idle' | 'tap' | 'pan' | 'pinch' = 'idle';
  /** The long-press already fired, so this gesture may never become a tap. */
  private longPressFired = false;
  private lastX = 0;
  private lastY = 0;
  private pinchLastSpan = 0;
  private pinchLastMid = { x: 0, y: 0 };

  /** Whether a finger is currently down. */
  get isDown(): boolean {
    return this.down !== null;
  }

  /** A new finger touched down. */
  begin(id: number, x: number, y: number, time: number): TouchGestureEvent {
    if (!this.down) {
      this.down = { id, startX: x, startY: y, x, y, time, moved: 0 };
      this.phase = 'tap';
      this.longPressFired = false;
      this.lastX = x;
      this.lastY = y;
      return NONE;
    }

    if (this.down.id === id) return NONE;

    // A third finger is ignored: the pinch is defined by the first two, and
    // letting a third pointer replace the second would make the span jump.
    if (this.second) return NONE;

    // A second finger always wins: the waiting tap/long-press is abandoned and the
    // gesture becomes a pinch.
    this.second = { id, x, y };
    this.phase = 'pinch';
    this.longPressFired = true;
    this.pinchLastSpan = distance(this.down, this.second);
    this.pinchLastMid = midpoint(this.down, this.second);
    return NONE;
  }

  /** A finger moved. */
  move(id: number, x: number, y: number): TouchGestureEvent {
    if (!this.down) return NONE;

    if (this.second && id === this.second.id) {
      this.second.x = x;
      this.second.y = y;
    } else if (id === this.down.id) {
      this.down.x = x;
      this.down.y = y;
    } else {
      return NONE;
    }

    if (this.phase === 'pinch' && this.second) {
      const span = distance(this.down, this.second);
      const mid = midpoint(this.down, this.second);
      const dx = mid.x - this.pinchLastMid.x;
      const dy = mid.y - this.pinchLastMid.y;
      this.pinchLastMid = mid;

      // A degenerate span (fingers stacked) yields factor 1 rather than a jump.
      const trustSpan = span >= PINCH_MIN_SPAN_PX && this.pinchLastSpan >= PINCH_MIN_SPAN_PX;
      const factor = trustSpan ? span / this.pinchLastSpan : 1;
      this.pinchLastSpan = span;
      return { kind: 'pinch', factor, dx, dy, x: mid.x, y: mid.y };
    }

    if (this.phase !== 'tap' && this.phase !== 'pan') return NONE;

    this.down.moved = Math.max(
      this.down.moved,
      distance({ x, y }, { x: this.down.startX, y: this.down.startY })
    );

    if (this.phase === 'tap') {
      if (this.down.moved <= TAP_MAX_MOVE_PX) return NONE;

      // Crossing the threshold: hand the camera the movement accumulated since
      // the press, not just this sample, so the map does not lag behind the finger.
      this.phase = 'pan';
      this.longPressFired = true;
      const dx = x - this.down.startX;
      const dy = y - this.down.startY;
      this.lastX = x;
      this.lastY = y;
      return { kind: 'pan', dx, dy };
    }

    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    return { kind: 'pan', dx, dy };
  }

  /** A finger lifted. */
  end(id: number, x: number, y: number, time: number): TouchGestureEvent {
    if (!this.down) return NONE;

    // Lifting the second finger ends the pinch but keeps the first one panning:
    // that is how every map app behaves, and no tap may come out of this gesture.
    if (this.second && id === this.second.id) {
      this.second = null;
      this.phase = 'pan';
      this.longPressFired = true;
      this.lastX = this.down.x;
      this.lastY = this.down.y;
      return NONE;
    }

    if (id !== this.down.id) return NONE;

    // Lifting the first finger while the second is still down hands the gesture
    // over to the remaining finger, again without a tap.
    if (this.second) {
      const remaining = this.second;
      this.down = {
        id: remaining.id,
        startX: remaining.x,
        startY: remaining.y,
        x: remaining.x,
        y: remaining.y,
        time,
        moved: 0
      };
      this.second = null;
      this.phase = 'pan';
      this.longPressFired = true;
      this.lastX = remaining.x;
      this.lastY = remaining.y;
      return NONE;
    }

    const wasTap =
      this.phase === 'tap' &&
      !this.longPressFired &&
      time - this.down.time <= TAP_MAX_MS &&
      this.down.moved <= TAP_MAX_MOVE_PX;

    this.reset();

    return wasTap ? { kind: 'tap', x, y } : NONE;
  }

  /**
   * Advances the long-press timer. Called every frame while a finger is down; the
   * caller gets at most one `long-press` per press.
   */
  tick(now: number): TouchGestureEvent {
    if (this.phase !== 'tap' || !this.down || this.longPressFired) return NONE;
    if (now - this.down.time < LONG_PRESS_MS) return NONE;
    if (this.down.moved > TAP_MAX_MOVE_PX) return NONE;

    this.longPressFired = true;
    return { kind: 'long-press', x: this.down.x, y: this.down.y };
  }

  /** Forgets the gesture entirely (pointer cancelled, app backgrounded, resize). */
  reset() {
    this.down = null;
    this.second = null;
    this.phase = 'idle';
    this.longPressFired = false;
    this.pinchLastSpan = 0;
    this.pinchLastMid = { x: 0, y: 0 };
    this.lastX = 0;
    this.lastY = 0;
  }
}

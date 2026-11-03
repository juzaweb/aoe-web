import { describe, expect, it } from 'vitest';
import {
  LONG_PRESS_MS,
  PINCH_MIN_SPAN_PX,
  TAP_MAX_MS,
  TAP_MAX_MOVE_PX,
  TouchGesture,
  zoomFromPinch
} from './touchGesture.js';

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.2;

/**
 * Drives the state machine through a plausible gesture. Every case starts from a
 * fresh instance so a leaked long-press or pinch can never make the next one pass.
 */
describe('TouchGesture', () => {
  it('emits a tap for a quick press that barely moves', () => {
    const gesture = new TouchGesture();
    expect(gesture.begin(1, 100, 100, 1000)).toEqual({ kind: 'none' });
    expect(gesture.move(1, 103, 102)).toEqual({ kind: 'none' });
    expect(gesture.end(1, 103, 102, 1080)).toEqual({ kind: 'tap', x: 103, y: 102 });
  });

  it('does not tap when the press lasted longer than TAP_MAX_MS', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    expect(gesture.end(1, 100, 100, 1000 + TAP_MAX_MS + 1)).toEqual({ kind: 'none' });
  });

  it('turns a moving press into a pan and never into a tap', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);

    // Just under the threshold: still a tap candidate.
    expect(gesture.move(1, 100 + TAP_MAX_MOVE_PX, 100)).toEqual({ kind: 'none' });

    // Crossing it hands the camera every pixel travelled since the press.
    const first = gesture.move(1, 140, 130);
    expect(first).toEqual({ kind: 'pan', dx: 40, dy: 30 });

    // Later samples are incremental, or the camera would double-apply the start.
    expect(gesture.move(1, 150, 140)).toEqual({ kind: 'pan', dx: 10, dy: 10 });
    expect(gesture.end(1, 150, 140, 1040)).toEqual({ kind: 'none' });
  });

  it('fires one long-press and suppresses the tap that follows it', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 200, 200, 1000);

    expect(gesture.tick(1000 + LONG_PRESS_MS - 1)).toEqual({ kind: 'none' });
    expect(gesture.tick(1000 + LONG_PRESS_MS)).toEqual({ kind: 'long-press', x: 200, y: 200 });
    // Not repeated on later frames, however long the finger stays down.
    expect(gesture.tick(1000 + LONG_PRESS_MS + 500)).toEqual({ kind: 'none' });
    expect(gesture.end(1, 200, 200, 1000 + LONG_PRESS_MS + 600)).toEqual({ kind: 'none' });
  });

  it('never long-presses once the press has already become a pan', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.move(1, 200, 200);
    expect(gesture.tick(1000 + LONG_PRESS_MS * 2)).toEqual({ kind: 'none' });
  });

  it('pinches with the span ratio and reports the midpoint travel', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.begin(2, 200, 100, 1000);

    // Span 100 -> 200 doubles the zoom; midpoint 150 -> 300 travels 150 px.
    const pinch = gesture.move(1, 400, 100);
    expect(pinch).toEqual({ kind: 'pinch', factor: 2, dx: 150, dy: 0, x: 300, y: 100 });

    // Span 200 -> 100 is 0.5 of the previous sample, not of the first one.
    const second = gesture.move(1, 300, 100);
    expect(second).toEqual({ kind: 'pinch', factor: 0.5, dx: -50, dy: 0, x: 250, y: 100 });
  });

  it('abandons a pending tap and long-press when a second finger lands', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.begin(2, 200, 100, 1010);
    expect(gesture.tick(1000 + LONG_PRESS_MS * 2)).toEqual({ kind: 'none' });
    expect(gesture.end(2, 200, 100, 1200)).toEqual({ kind: 'none' });
    expect(gesture.end(1, 100, 100, 1210)).toEqual({ kind: 'none' });
  });

  it('keeps the remaining finger panning after a pinch, with no tap', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.begin(2, 200, 100, 1000);
    gesture.move(1, 120, 100);

    expect(gesture.end(2, 200, 100, 1020)).toEqual({ kind: 'none' });
    expect(gesture.move(1, 180, 130)).toEqual({ kind: 'pan', dx: 60, dy: 30 });
    expect(gesture.end(1, 180, 130, 1040)).toEqual({ kind: 'none' });
  });

  it('hands the gesture to the second finger when the first one lifts', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.begin(2, 200, 100, 1000);
    expect(gesture.end(1, 100, 100, 1010)).toEqual({ kind: 'none' });
    expect(gesture.isDown).toBe(true);
    expect(gesture.move(2, 240, 120)).toEqual({ kind: 'pan', dx: 40, dy: 20 });
  });

  it('ignores a pinch below the minimum span instead of dividing by it', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.begin(2, 100 + PINCH_MIN_SPAN_PX / 2, 100, 1000);
    const first = gesture.move(1, 101, 100);
    expect(first).toMatchObject({ kind: 'pinch', factor: 1 });
  });

  it('drops the gesture on reset, so a cancelled pointer cannot select anything', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.reset();
    expect(gesture.isDown).toBe(false);
    expect(gesture.end(1, 100, 100, 1010)).toEqual({ kind: 'none' });
    expect(gesture.tick(1000 + LONG_PRESS_MS)).toEqual({ kind: 'none' });
  });

  it('tracks three pointers without corrupting the pinch', () => {
    const gesture = new TouchGesture();
    gesture.begin(1, 100, 100, 1000);
    gesture.begin(2, 200, 100, 1000);
    // A third finger is not part of the pinch; it must not detach the second.
    expect(gesture.begin(3, 300, 300, 1000)).toEqual({ kind: 'none' });
    expect(gesture.move(3, 340, 340)).toEqual({ kind: 'none' });
    const pinch = gesture.move(1, 300, 100);
    expect(pinch).toMatchObject({ kind: 'pinch' });
  });
});

describe('zoomFromPinch', () => {
  it('multiplies the current zoom by the factor', () => {
    expect(zoomFromPinch(1, 2, ZOOM_MIN, ZOOM_MAX)).toBe(2);
    expect(zoomFromPinch(1, 0.5, ZOOM_MIN, ZOOM_MAX)).toBe(0.5);
  });

  it('clamps at both ends of the camera range', () => {
    expect(zoomFromPinch(2, 4, ZOOM_MIN, ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomFromPinch(0.5, 0.1, ZOOM_MIN, ZOOM_MAX)).toBe(ZOOM_MIN);
  });

  it('ignores a degenerate factor instead of collapsing the camera', () => {
    expect(zoomFromPinch(1.2, 0, ZOOM_MIN, ZOOM_MAX)).toBe(1.2);
    expect(zoomFromPinch(1.2, Number.NaN, ZOOM_MIN, ZOOM_MAX)).toBe(1.2);
  });
});

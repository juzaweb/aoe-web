import { describe, expect, it } from 'vitest';
import type * as Phaser from 'phaser';
import { findUnitAt, getUnitBodyBox, hitTestUnit } from './hitTest.js';

/**
 * A container stand-in with just the two fields the hit tests read: a world
 * position and the `getData` keys written at sprite-creation time. Using real
 * Phaser objects here would drag a WebGL context into the Node test run.
 */
function fakeContainer(x: number, y: number, extra: Record<string, number> = {}, depth = 0) {
  return {
    x,
    y,
    depth,
    getData: (key: string) => extra[key]
  } as unknown as Phaser.GameObjects.Container;
}

/** `findUnitAt` only needs Colyseus-`forEach`-shaped maps. */
function fakeScene(units: Array<{ id: string; ownerId: string }>, sprites: Map<string, unknown>) {
  const stateUnits = {
    forEach(callback: (unit: unknown, id: string) => void) {
      for (const unit of units) callback(unit, unit.id);
    }
  };
  return {
    room: { state: { units: stateUnits } },
    myOwnerId: 'me',
    unitSprites: sprites
  } as unknown as Parameters<typeof findUnitAt>[0];
}

describe('getUnitBodyBox', () => {
  it('defaults to the authored body radii, unchanged for the mouse path', () => {
    const box = getUnitBodyBox(fakeContainer(100, 200));
    expect(box).toEqual({ centerX: 100, centerY: 163, radiusX: 36, radiusY: 40 });
  });

  it('scales both radii by the slack without moving the centre', () => {
    const box = getUnitBodyBox(fakeContainer(100, 200), 1.5);
    expect(box).toEqual({ centerX: 100, centerY: 163, radiusX: 54, radiusY: 60 });
  });
});

describe('hitTestUnit', () => {
  const container = fakeContainer(0, 0, { bodyOffsetY: 0, bodyRadiusX: 20, bodyRadiusY: 20 });

  it('accepts the centre and rejects a point outside the ellipse', () => {
    expect(hitTestUnit(0, 0, container)).toBe(true);
    expect(hitTestUnit(30, 0, container)).toBe(false);
  });

  it('lets a fingertip catch a unit the mouse would have missed', () => {
    // 25 px away: outside the authored 20 px radius, inside the 1.5x one (30 px).
    expect(hitTestUnit(25, 0, container)).toBe(false);
    expect(hitTestUnit(25, 0, container, 1.5)).toBe(true);
  });
});

describe('findUnitAt', () => {
  it('picks the topmost unit under the point, not the first inserted', () => {
    const low = fakeContainer(0, 0, { bodyOffsetY: 0 }, 10);
    const high = fakeContainer(4, 0, { bodyOffsetY: 0 }, 20);
    const scene = fakeScene(
      [
        { id: 'low', ownerId: 'me' },
        { id: 'high', ownerId: 'me' }
      ],
      new Map([
        ['low', low],
        ['high', high]
      ])
    );

    expect(findUnitAt(scene, { x: 2, y: 0 })).toBe('high');
  });

  it('honours the owner filter and the touch slack', () => {
    const enemy = fakeContainer(0, 0, { bodyOffsetY: 0 }, 5);
    const scene = fakeScene([{ id: 'enemy', ownerId: 'them' }], new Map([['enemy', enemy]]));

    expect(findUnitAt(scene, { x: 0, y: 0 }, 'me')).toBeNull();
    expect(findUnitAt(scene, { x: 0, y: 0 }, 'enemy')).toBe('enemy');

    // 45 px away is outside the authored box but inside the 1.5x tap box.
    expect(findUnitAt(scene, { x: 45, y: 0 }, 'enemy')).toBeNull();
    expect(findUnitAt(scene, { x: 45, y: 0 }, 'enemy', 1.5)).toBe('enemy');
  });
});

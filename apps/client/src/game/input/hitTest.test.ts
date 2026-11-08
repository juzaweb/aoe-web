import { describe, expect, it } from 'vitest';
import type * as Phaser from 'phaser';
import { citadelLayoutFor } from '@chien-quoc/shared';
import {
  findBuildingAt,
  findBuildingAtPoint,
  findOwnFoundationAt,
  findUnitAt,
  getUnitBodyBox,
  hitTestUnit
} from './hitTest.js';

/**
 * A container stand-in with just the two fields the hit tests read: a world
 * position and the `getData` keys written at sprite-creation time. Using real
 * Phaser objects here would drag a WebGL context into the Node test run.
 */
function fakeContainer(
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
  depth = 0
) {
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

describe('findBuildingAt with Citadel rules', () => {
  it('protects enemy interior citadel buildings from attack while allowing attack on citadel walls/gate', () => {
    const layout = citadelLayoutFor(48, 53);
    const tc = { id: 'b-tc', ownerId: 'enemy', type: 'TOWN_CENTER', gridX: 48, gridY: 53, sizeX: 4, sizeY: 6, hp: 2400, maxHp: 2400 };
    const citadel = { id: 'b-citadel', ownerId: 'enemy', type: 'CITADEL', gridX: layout.originX, gridY: layout.originY, sizeX: 26, sizeY: 26, hp: 7050, maxHp: 7050 };

    const buildings = new Map([
      ['b-tc', tc],
      ['b-citadel', citadel]
    ]);

    const scene = {
      myOwnerId: 'me',
      room: {
        state: { buildings }
      }
    } as any;

    // Direct click on enemy Town Center inside citadel returns null when filtering for enemy attack target
    expect(findBuildingAt(scene, { gridX: 49, gridY: 54 }, 'enemy')).toBeNull();

    // Click on citadel wall returns b-citadel
    const wallTile = layout.walls[0];
    expect(findBuildingAt(scene, { gridX: wallTile.gridX, gridY: wallTile.gridY }, 'enemy')).toBe('b-citadel');

    // Click on citadel gate returns b-citadel
    const gateTile = layout.gates[0];
    expect(findBuildingAt(scene, { gridX: gateTile.gridX, gridY: gateTile.gridY }, 'enemy')).toBe('b-citadel');
  });
});

describe('findBuildingAtPoint with the citadel compound', () => {
  const layout = citadelLayoutFor(48, 53);
  const citadel = {
    id: 'b-citadel',
    ownerId: 'me',
    type: 'CITADEL',
    gridX: layout.originX,
    gridY: layout.originY,
    sizeX: 26,
    sizeY: 26
  };
  const house = {
    id: 'b-house',
    ownerId: 'me',
    type: 'HOUSE',
    gridX: layout.originX + 1,
    gridY: layout.originY + 15,
    sizeX: 2,
    sizeY: 2
  };

  function sceneWithCitadelSprite() {
    const buildings = new Map([
      [house.id, house],
      [citadel.id, citadel]
    ]);
    return {
      myOwnerId: 'me',
      room: { state: { buildings } },
      unitSprites: new Map(),
      buildingSprites: new Map([
        [
          house.id,
          fakeContainer(0, 0, {
            visualCenterY: -88,
            buildingImage: { displayWidth: 256, displayHeight: 220 }
          })
        ],
        // The compound's own sprite would cover the whole walled area, exactly
        // the hit box that used to swallow clicks meant for the buildings inside.
        [
          citadel.id,
          fakeContainer(0, 0, {
            visualCenterY: -130,
            buildingImage: { displayWidth: 26 * 128, displayHeight: 26 * 64 + 260 }
          })
        ]
      ]),
      resourceSprites: new Map()
    } as unknown as Parameters<typeof findBuildingAtPoint>[0];
  }

  it('picks the structure inside the walls instead of the compound', () => {
    const scene = sceneWithCitadelSprite();
    const grid = { gridX: house.gridX, gridY: house.gridY };

    expect(findBuildingAtPoint(scene, { x: 0, y: 0 }, grid)).toBe(house.id);
  });

  it('still selects the compound when the click lands on a wall or gate tile', () => {
    const scene = sceneWithCitadelSprite();
    const wall = layout.walls[0];
    // Far away from every sprite, so the footprint pass decides.
    const far = { x: 10_000, y: 10_000 };

    expect(
      findBuildingAtPoint(scene, far, { gridX: wall.gridX, gridY: wall.gridY })
    ).toBe(citadel.id);
  });

  it('does not return the compound for the empty stone floor inside it', () => {
    const scene = sceneWithCitadelSprite();
    const far = { x: 10_000, y: 10_000 };

    expect(
      findBuildingAtPoint(scene, far, {
        gridX: layout.originX + 3,
        gridY: layout.originY + 3
      })
    ).toBeNull();
  });
});

describe('findOwnFoundationAt', () => {
  it('recognizes an unconstructed or damaged building of the local player', () => {
    const buildings = new Map([
      ['b-uncon', { id: 'b-uncon', ownerId: 'me', gridX: 10, gridY: 10, sizeX: 2, sizeY: 2, isConstructed: false, hp: 100, maxHp: 100 }],
      ['b-full', { id: 'b-full', ownerId: 'me', gridX: 15, gridY: 10, sizeX: 2, sizeY: 2, isConstructed: true, hp: 100, maxHp: 100 }],
      ['b-damaged', { id: 'b-damaged', ownerId: 'me', gridX: 20, gridY: 10, sizeX: 2, sizeY: 2, isConstructed: true, hp: 50, maxHp: 100 }],
      ['b-enemy-damaged', { id: 'b-enemy-damaged', ownerId: 'enemy', gridX: 25, gridY: 10, sizeX: 2, sizeY: 2, isConstructed: true, hp: 50, maxHp: 100 }]
    ]);

    const scene = {
      myOwnerId: 'me',
      room: {
        state: {
          buildings,
          roads: new Map()
        }
      }
    } as any;

    expect(findOwnFoundationAt(scene, { gridX: 10, gridY: 10 })).toBe('b-uncon');
    expect(findOwnFoundationAt(scene, { gridX: 15, gridY: 10 })).toBeNull();
    expect(findOwnFoundationAt(scene, { gridX: 20, gridY: 10 })).toBe('b-damaged');
    expect(findOwnFoundationAt(scene, { gridX: 25, gridY: 10 })).toBeNull();
  });

  it('recognizes an unconstructed road of the local player', () => {
    const roads = new Map([
      ['20,20', { id: '20,20', ownerId: 'me', isConstructed: false }],
      ['21,20', { id: '21,20', ownerId: 'me', isConstructed: true }],
      ['22,20', { id: '22,20', ownerId: 'other', isConstructed: false }]
    ]);

    const scene = {
      myOwnerId: 'me',
      room: {
        state: {
          buildings: new Map(),
          roads
        }
      }
    } as any;

    expect(findOwnFoundationAt(scene, { gridX: 20, gridY: 20 })).toBe('20,20');
    expect(findOwnFoundationAt(scene, { gridX: 21, gridY: 20 })).toBeNull();
    expect(findOwnFoundationAt(scene, { gridX: 22, gridY: 20 })).toBeNull();
    expect(findOwnFoundationAt(scene, { gridX: 25, gridY: 25 })).toBeNull();
  });
});

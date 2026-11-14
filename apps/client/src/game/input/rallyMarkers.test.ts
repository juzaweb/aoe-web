import { describe, expect, it, vi } from 'vitest';

/**
 * `CommandController` reads Phaser only for `KeyCodes.SHIFT`, inside `bindKeys`,
 * which these tests never call. The module-level import still has to resolve, and
 * the real package needs a DOM, so it is stubbed rather than loaded.
 */
vi.mock('phaser', () => ({ Input: { Keyboard: { KeyCodes: { SHIFT: 16 } } } }));

import { gridToScreen } from '@chien-quoc/shared';
import { CommandController } from './CommandController.js';

interface FakeBuilding {
  id: string;
  ownerId: string;
  rallyX: number;
  rallyY: number;
}

/**
 * The slice of `WorldScene` the rally overlay touches. Buildings own the rally
 * point, `buildingSprites` says which of them have art on screen, and the fake
 * `add` records every banner so a test can see what was drawn and destroyed.
 */
function fakeScene(buildings: FakeBuilding[]) {
  const images: Array<{
    x: number;
    y: number;
    key: string;
    destroyed: boolean;
    setOrigin: ReturnType<typeof vi.fn>;
    setScale: ReturnType<typeof vi.fn>;
    setDepth: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];

  const graphics = {
    clear: vi.fn(),
    lineStyle: vi.fn(),
    lineBetween: vi.fn(),
    fillStyle: vi.fn(),
    fillEllipse: vi.fn(),
    setDepth: vi.fn()
  };

  const scene = {
    myOwnerId: 'me',
    selectedBuildingId: null as string | null,
    room: { state: { buildings: new Map(buildings.map((b) => [b.id, b])) } },
    buildingSprites: new Map(buildings.map((b) => [b.id, { x: 120, y: 240 }])),
    isOwnBuilding: (ownerId: string) => ownerId === 'me',
    add: {
      graphics: () => graphics,
      image: (x: number, y: number, key: string) => {
        const image = {
          x,
          y,
          key,
          destroyed: false,
          setOrigin: vi.fn(),
          setScale: vi.fn(),
          setDepth: vi.fn(),
          destroy: vi.fn(() => {
            image.destroyed = true;
          })
        };
        images.push(image);
        return image;
      }
    }
  };

  return { scene, images, graphics };
}

function controllerFor(buildings: FakeBuilding[]) {
  const harness = fakeScene(buildings);
  const controller = new CommandController(harness.scene as never);
  controller.createOverlays();
  return { ...harness, controller };
}

const HOUSE: FakeBuilding = { id: 'house-1', ownerId: 'me', rallyX: 8, rallyY: 9 };
const BARRACKS: FakeBuilding = { id: 'barracks-1', ownerId: 'me', rallyX: 3, rallyY: 4 };

describe('CommandController rally markers (CTL-06)', () => {
  it('draws nothing while no building is selected', () => {
    const { controller, images, graphics } = controllerFor([HOUSE, BARRACKS]);

    controller.updateRallyMarkers();

    expect(images).toHaveLength(0);
    expect(graphics.lineBetween).not.toHaveBeenCalled();
  });

  it('draws only the selected building, not every rally point on the map', () => {
    const { scene, controller, images, graphics } = controllerFor([HOUSE, BARRACKS]);
    scene.selectedBuildingId = HOUSE.id;

    controller.updateRallyMarkers();

    expect(images).toHaveLength(1);
    const expected = gridToScreen(HOUSE.rallyX, HOUSE.rallyY);
    expect(images[0]).toMatchObject({ x: expected.x, y: expected.y, key: 'rally_flag' });
    // The line runs from the house itself, not from another building or the flag.
    expect(graphics.lineBetween).toHaveBeenCalledWith(120, 240, expected.x, expected.y);
  });

  it('moves the flag when a different building is clicked', () => {
    const { scene, controller, images } = controllerFor([HOUSE, BARRACKS]);
    scene.selectedBuildingId = HOUSE.id;
    controller.updateRallyMarkers();

    scene.selectedBuildingId = BARRACKS.id;
    controller.updateRallyMarkers();

    expect(images).toHaveLength(2);
    expect(images[0].destroyed).toBe(true);
    const expected = gridToScreen(BARRACKS.rallyX, BARRACKS.rallyY);
    expect(images[1]).toMatchObject({ x: expected.x, y: expected.y, destroyed: false });
  });

  it('moves the flag between two buildings that share a rally point', () => {
    const secondHouse: FakeBuilding = { ...HOUSE, id: 'house-1b' };
    const { scene, controller, images } = controllerFor([HOUSE, secondHouse]);
    scene.selectedBuildingId = HOUSE.id;
    controller.updateRallyMarkers();

    scene.selectedBuildingId = secondHouse.id;
    controller.updateRallyMarkers();

    // The coordinates are identical, so only the building id can tell the two
    // markers apart: a coordinate-only signature would leave the first flag on
    // screen while the panel shows the second house.
    expect(images).toHaveLength(2);
    expect(images[0].destroyed).toBe(true);
    expect(images[1].destroyed).toBe(false);
  });

  it('clears the flag when the selection is dropped', () => {
    const { scene, controller, images } = controllerFor([HOUSE]);
    scene.selectedBuildingId = HOUSE.id;
    controller.updateRallyMarkers();

    scene.selectedBuildingId = null;
    controller.updateRallyMarkers();

    expect(images).toHaveLength(1);
    expect(images[0].destroyed).toBe(true);
  });

  it('ignores a selected building with no rally point', () => {
    const idleHouse: FakeBuilding = { id: 'house-2', ownerId: 'me', rallyX: -1, rallyY: -1 };
    const { scene, controller, images } = controllerFor([idleHouse]);
    scene.selectedBuildingId = idleHouse.id;

    controller.updateRallyMarkers();

    expect(images).toHaveLength(0);
  });

  it('ignores a selected building that has no sprite on screen yet', () => {
    const { scene, controller, images } = controllerFor([HOUSE]);
    scene.selectedBuildingId = HOUSE.id;
    scene.buildingSprites.delete(HOUSE.id);

    controller.updateRallyMarkers();

    expect(images).toHaveLength(0);
  });

  it('ignores an enemy building even if it is the selection', () => {
    const enemyHouse: FakeBuilding = { id: 'house-3', ownerId: 'enemy', rallyX: 1, rallyY: 2 };
    const { scene, controller, images } = controllerFor([enemyHouse]);
    scene.selectedBuildingId = enemyHouse.id;

    controller.updateRallyMarkers();

    expect(images).toHaveLength(0);
  });

  it('skips the redraw while the selection and rally point are unchanged', () => {
    const { scene, controller, images } = controllerFor([HOUSE]);
    scene.selectedBuildingId = HOUSE.id;
    controller.updateRallyMarkers();

    controller.updateRallyMarkers();

    expect(images).toHaveLength(1);
  });
});

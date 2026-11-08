import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessage, ROAD_COST_PER_TILE } from '@chien-quoc/shared';

/**
 * The brush resolves the pointed tile through `pointerWorldGrid`, which needs a
 * live Phaser camera. These tests pin the tile instead and care about the
 * stroke contract: which message is sent, with which tiles and crew.
 */
const pointerGrid = vi.hoisted(() => ({ gridX: 10, gridY: 10 }));
vi.mock('./pointer.js', () => ({ pointerWorldGrid: () => pointerGrid }));

import { WallController } from './WallController.js';

function fakeScene(wood = 100, stone = 100) {
  const overlay = {
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    clear: vi.fn(),
    fillStyle: vi.fn(),
    lineStyle: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fillPath: vi.fn(),
    strokePath: vi.fn()
  };
  const buildings = new Map<string, any>();
  const roads = new Map<string, any>();
  const resources = new Map<string, any>();
  const player = { wood, stone };

  const scene = {
    room: {
      state: {
        buildings,
        roads,
        resourceNodes: resources,
        players: new Map([['owner', player]])
      },
      send: vi.fn()
    },
    selectedUnitIds: new Set<string>(['u1']),
    myOwnerId: 'owner',
    mapWidth: 100,
    mapHeight: 100,
    cursor: { refresh: vi.fn() },
    cameras: { main: {} },
    add: { graphics: () => overlay }
  };

  return { scene, buildings, roads, resources, player };
}

const pointer = {} as never;

describe('WallController', () => {
  let harness: ReturnType<typeof fakeScene>;
  let controller: WallController;

  beforeEach(() => {
    pointerGrid.gridX = 10;
    pointerGrid.gridY = 10;
    harness = fakeScene();
    controller = new WallController(harness.scene as never);
    controller.enter('build');
  });

  it('sends PLACE_WALL for the painted tile with the selected crew', () => {
    controller.begin(pointer);
    controller.end();

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_WALL, {
      tiles: [{ x: 10, y: 10 }],
      unitIds: ['u1']
    });
  });

  it('fills the gap between two pointer samples', () => {
    controller.begin(pointer);
    pointerGrid.gridX = 13;
    controller.drag(pointer);
    controller.end();

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_WALL, {
      tiles: [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
        { x: 12, y: 10 },
        { x: 13, y: 10 }
      ],
      unitIds: ['u1']
    });
  });

  it('skips a tile that already holds a building', () => {
    harness.buildings.set('house', {
      type: 'HOUSE',
      ownerId: 'owner',
      gridX: 10,
      gridY: 10,
      sizeX: 1,
      sizeY: 1
    });

    controller.begin(pointer);
    controller.end();

    expect(harness.scene.room.send).not.toHaveBeenCalled();
  });

  it('trims the stroke to what wood and stone can pay for', () => {
    harness = fakeScene(8, 12);
    controller = new WallController(harness.scene as never);
    controller.enter('build');

    controller.begin(pointer);
    pointerGrid.gridX = 12;
    controller.drag(pointer);
    controller.end();

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_WALL, {
      tiles: [
        { x: 10, y: 10 },
        { x: 11, y: 10 }
      ],
      unitIds: ['u1']
    });
  });

  it('erases only the player’s own wall tiles', () => {
    harness.buildings.set('my-wall', {
      type: 'WALL',
      ownerId: 'owner',
      gridX: 10,
      gridY: 10,
      sizeX: 1,
      sizeY: 1
    });
    harness.buildings.set('enemy-wall', {
      type: 'WALL',
      ownerId: 'enemy',
      gridX: 11,
      gridY: 10,
      sizeX: 1,
      sizeY: 1
    });
    controller.enter('erase');

    controller.begin(pointer);
    pointerGrid.gridX = 11;
    controller.drag(pointer);
    controller.end();

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.REMOVE_WALL, {
      tiles: [{ x: 10, y: 10 }]
    });
  });

  it('does not spend road wood on a wall stroke', () => {
    // Guard against a future refactor copying the road cost helper: a wall
    // stroke must price itself from the WALL blueprint instead.
    controller.begin(pointer);
    controller.end();

    expect(ROAD_COST_PER_TILE).toBeGreaterThan(0);
    expect(harness.player.wood).toBe(100);
    expect(harness.player.stone).toBe(100);
  });
});

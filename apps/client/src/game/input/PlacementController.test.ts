import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessage, citadelLayoutFor, type BuildingType } from '@chien-quoc/shared';

/**
 * The controller resolves the clicked tile through `pointerWorldGrid`, which
 * needs a live Phaser camera. These tests care about the placement contract
 * (send, close or stay, who gets the crew), so the tile is pinned instead.
 */
const pointerGrid = vi.hoisted(() => ({ gridX: 10, gridY: 10 }));
vi.mock('./pointer.js', () => ({ pointerWorldGrid: () => pointerGrid }));

import { PlacementController } from './PlacementController.js';

/** The slice of `WorldScene` the placement code touches. */
function fakeScene() {
  const ghost = {
    setPosition: vi.fn(),
    setVisible: vi.fn(),
    setDepth: vi.fn(),
    add: vi.fn()
  };
  const ghostImage = {
    setAlpha: vi.fn(),
    setTexture: vi.fn(),
    setY: vi.fn(),
    setScale: vi.fn(),
    setTint: vi.fn()
  };
  const buildings = new Map<string, any>();

  const scene = {
    room: {
      state: { buildings, resourceNodes: new Map(), roads: new Map() },
      send: vi.fn()
    },
    selectedUnitIds: new Set<string>(['u1', 'u2']),
    buildingToPlace: null as BuildingType | null,
    mapWidth: 100,
    mapHeight: 100,
    terrainLayout: undefined as { kind: string; width: number; height: number } | undefined,
    commands: { showFeedback: vi.fn() },
    cursor: { refresh: vi.fn() },
    notifySelectionChange: vi.fn(),
    onPlacementCancelled: vi.fn(),
    textures: { exists: () => false },
    cameras: { main: {} },
    add: {
      container: () => ghost,
      image: () => ghostImage
    }
  };

  return { scene, buildings };
}

const pointer = {} as never;

describe('PlacementController', () => {
  let harness: ReturnType<typeof fakeScene>;
  let controller: PlacementController;

  beforeEach(() => {
    pointerGrid.gridX = 10;
    pointerGrid.gridY = 10;
    harness = fakeScene();
    controller = new PlacementController(harness.scene as never);
    controller.create();
    controller.enter('HOUSE');
  });

  it('sends the placement and closes the mode on a plain click', () => {
    controller.commit(pointer);

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_BUILDING, {
      type: 'HOUSE',
      gridX: 10,
      gridY: 10,
      unitIds: ['u1', 'u2']
    });
    expect(harness.scene.buildingToPlace).toBeNull();
    expect(harness.scene.onPlacementCancelled).toHaveBeenCalledTimes(1);
  });

  it('stays in placement mode when the click asks to keep placing', () => {
    controller.commit(pointer, true);

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_BUILDING, {
      type: 'HOUSE',
      gridX: 10,
      gridY: 10,
      unitIds: ['u1', 'u2'],
      queue: true
    });
    expect(harness.scene.buildingToPlace).toBe('HOUSE');
    expect(harness.scene.onPlacementCancelled).not.toHaveBeenCalled();
  });

  it('queues every drop of a shift-chain for the same crew', () => {
    controller.commit(pointer, true);
    pointerGrid.gridX = 12;
    controller.commit(pointer, true);

    const payloads = harness.scene.room.send.mock.calls.map((call) => call[1]);
    // The server appends the second foundation behind the first instead of
    // pulling the crew off the site it is already building.
    expect(payloads[0]).toMatchObject({ unitIds: ['u1', 'u2'], queue: true });
    expect(payloads[1]).toMatchObject({ unitIds: ['u1', 'u2'], queue: true });
  });

  it('does not queue a plain drop, so it replaces the crew current order', () => {
    controller.commit(pointer, true);
    pointerGrid.gridX = 12;
    controller.commit(pointer);

    const payloads = harness.scene.room.send.mock.calls.map((call) => call[1]);
    expect(payloads[1].queue).toBeUndefined();
    expect(harness.scene.buildingToPlace).toBeNull();
  });

  it('refuses a second drop on the same tile until the snapshot catches up', () => {
    controller.commit(pointer, true);
    controller.commit(pointer, true);

    // Only the first click reached the server; the ghost knows the footprint is
    // already spoken for, so a fast double click cannot fire a rejected order.
    expect(harness.scene.room.send).toHaveBeenCalledTimes(1);
    expect(harness.scene.commands.showFeedback).toHaveBeenCalledTimes(1);
    expect(harness.scene.buildingToPlace).toBe('HOUSE');
  });

  it('still allows a neighbouring footprint that does not overlap the reservation', () => {
    controller.commit(pointer, true);
    pointerGrid.gridX = 12;
    controller.commit(pointer, true);

    expect(harness.scene.room.send).toHaveBeenCalledTimes(2);
    expect(harness.scene.room.send.mock.calls[1][1]).toMatchObject({ gridX: 12, gridY: 10 });
  });

  it('forgets local reservations when the placement session ends', () => {
    controller.commit(pointer, true);
    controller.commit(pointer); // plain click on the reserved tile is refused...
    expect(harness.scene.room.send).toHaveBeenCalledTimes(1);

    controller.enter('HOUSE');
    controller.commit(pointer, true);

    expect(harness.scene.room.send).toHaveBeenCalledTimes(2);
  });

  it('keeps the mode open and sends nothing when the footprint is blocked', () => {
    harness.buildings.set('existing', { gridX: 10, gridY: 10, sizeX: 2, sizeY: 2 });

    controller.commit(pointer, true);

    expect(harness.scene.room.send).not.toHaveBeenCalled();
    expect(harness.scene.buildingToPlace).toBe('HOUSE');
    expect(harness.scene.commands.showFeedback).toHaveBeenCalledTimes(1);
  });

  it('refuses a footprint that covers a citadel wall tile', () => {
    harness.scene.terrainLayout = { kind: 'kingdom', width: 110, height: 110 };
    harness.buildings.set('tc', {
      type: 'TOWN_CENTER',
      ownerId: 'p1',
      gridX: 48,
      gridY: 53,
      sizeX: 4,
      sizeY: 6
    });
    // A wall tile clear of the Town Center footprint so only the wall blocks
    // the click, whatever the compound layout becomes.
    const wall = citadelLayoutFor(48, 53).walls[0];
    pointerGrid.gridX = wall.gridX;
    pointerGrid.gridY = wall.gridY;

    controller.commit(pointer, true);

    expect(harness.scene.room.send).not.toHaveBeenCalled();
    expect(harness.scene.buildingToPlace).toBe('HOUSE');
    expect(harness.scene.commands.showFeedback).toHaveBeenCalledTimes(1);
  });

  it('ignores the citadel compound entity inside the courtyard', () => {
    harness.scene.terrainLayout = { kind: 'kingdom', width: 110, height: 110 };
    harness.buildings.set('tc', {
      type: 'TOWN_CENTER',
      ownerId: 'p1',
      gridX: 48,
      gridY: 53,
      sizeX: 4,
      sizeY: 6
    });
    // Retrofitted saves carry the scoring entity, which spans the whole compound.
    harness.buildings.set('citadel', {
      type: 'CITADEL',
      ownerId: 'p1',
      gridX: 43,
      gridY: 43,
      sizeX: 26,
      sizeY: 26
    });
    // Clear stone floor between the Town Center and the south wall.
    pointerGrid.gridX = 58;
    pointerGrid.gridY = 62;

    controller.commit(pointer, true);

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_BUILDING, {
      type: 'HOUSE',
      gridX: 58,
      gridY: 62,
      unitIds: ['u1', 'u2'],
      queue: true
    });
  });

  it('allows a footprint through the single east gate', () => {    harness.scene.terrainLayout = { kind: 'kingdom', width: 110, height: 110 };
    harness.buildings.set('tc', {
      type: 'TOWN_CENTER',
      ownerId: 'p1',
      gridX: 48,
      gridY: 53,
      sizeX: 4,
      sizeY: 4
    });
    // Gate tiles sit in the middle third of the east wall (x = 63).
    pointerGrid.gridX = 63;
    pointerGrid.gridY = 54;

    controller.commit(pointer, true);

    expect(harness.scene.room.send).toHaveBeenCalledWith(NetworkMessage.PLACE_BUILDING, {
      type: 'HOUSE',
      gridX: 63,
      gridY: 54,
      unitIds: ['u1', 'u2'],
      queue: true
    });
  });
});

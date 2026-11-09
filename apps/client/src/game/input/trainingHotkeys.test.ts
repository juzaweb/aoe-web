import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessage } from '@chien-quoc/shared';

/** `CommandController` needs Phaser only for `KeyCodes.SHIFT` in `bindKeys`. */
vi.mock('phaser', () => ({ Input: { Keyboard: { KeyCodes: { SHIFT: 16 } } } }));

import { CommandController } from './CommandController.js';

function fakeGraphics() {
  const chain = {
    setDepth: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    strokeEllipse: vi.fn().mockReturnThis(),
    lineBetween: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillCircle: vi.fn().mockReturnThis(),
    setScale: vi.fn().mockReturnThis(),
    setAlpha: vi.fn().mockReturnThis(),
    destroy: vi.fn()
  };
  return chain;
}

interface FakeSceneOptions {
  buildingId?: string | null;
  buildingType?: string;
  ownerId?: string;
  myOwnerId?: string;
  units?: string[];
  /** Stockpile of the local player; undefined means "rich enough for anything". */
  stockpile?: { wood: number; food: number; gold: number; stone: number };
}

function fakeScene(options: FakeSceneOptions = {}) {
  const {
    buildingId = 'b1',
    buildingType = 'TOWN_CENTER',
    ownerId = 'me',
    myOwnerId = 'me',
    units = [],
    stockpile = { wood: 10_000, food: 10_000, gold: 10_000, stone: 10_000 }
  } = options;

  const buildings = new Map<string, { id: string; type: string; ownerId: string }>();
  if (buildingId) buildings.set(buildingId, { id: buildingId, type: buildingType, ownerId });

  const scene = {
    readOnly: false,
    buildingToPlace: null as string | null,
    roadMode: null,
    wallMode: null,
    selectedUnitIds: new Set<string>(units),
    selectedBuildingId: buildingId,
    myOwnerId,
    mapWidth: 100,
    mapHeight: 100,
    room: {
      send: vi.fn(),
      state: {
        buildings,
        units: new Map(),
        roads: new Map(),
        players: new Map([[myOwnerId, { id: myOwnerId, ...stockpile }]])
      }
    },
    buildingSprites: new Map([[buildingId ?? '', { x: 10, y: 20 }]]),
    add: { graphics: vi.fn(() => fakeGraphics()) },
    tweens: { add: vi.fn(() => ({})) },
    cursor: { refresh: vi.fn() },
    publishArmedOrder: vi.fn(),
    isOwnBuilding: (id: string) => id === myOwnerId
  };
  return scene;
}

function fakeKeyboard() {
  const handlers = new Map<string, (event: KeyboardEvent) => void>();
  return {
    handlers,
    addKey: () => ({}),
    on(event: string, handler: (event: KeyboardEvent) => void) {
      handlers.set(event, handler);
    },
    press(event: string, extra: Partial<KeyboardEvent> = {}) {
      const preventDefault = vi.fn();
      handlers.get(event)?.({
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault,
        ...extra
      } as unknown as KeyboardEvent);
      return preventDefault;
    }
  };
}

function bindTraining(scene: ReturnType<typeof fakeScene>) {
  const controller = new CommandController(scene as never);
  const keyboard = fakeKeyboard();
  // The private binder is the unit under test; the public entry point also
  // registers dozens of unrelated keys.
  (controller as unknown as { bindTrainingKeys: (kb: typeof keyboard) => void }).bindTrainingKeys(keyboard);
  return { controller, keyboard };
}

describe('training hotkeys (UIX-04)', () => {
  let scene: ReturnType<typeof fakeScene>;

  beforeEach(() => {
    scene = fakeScene();
  });

  it('trains a villager from a selected Town Center on V', () => {
    const { keyboard } = bindTraining(scene);
    const preventDefault = keyboard.press('keydown-V');
    expect(scene.room.send).toHaveBeenCalledWith(NetworkMessage.TRAIN_UNIT, {
      buildingId: 'b1',
      unitType: 'VILLAGER'
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it('trains a spearman from a Barracks on S', () => {
    scene = fakeScene({ buildingType: 'BARRACKS' });
    const { keyboard } = bindTraining(scene);
    keyboard.press('keydown-S');
    expect(scene.room.send).toHaveBeenCalledWith(NetworkMessage.TRAIN_UNIT, {
      buildingId: 'b1',
      unitType: 'SPEARMAN'
    });
  });

  it('refuses a unit the building cannot train', () => {
    scene = fakeScene({ buildingType: 'BARRACKS' });
    const { keyboard } = bindTraining(scene);
    const preventDefault = keyboard.press('keydown-A');
    expect(scene.room.send).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('leaves the letter to the unit command card when units are selected', () => {
    scene = fakeScene({ units: ['u1'] });
    const { keyboard } = bindTraining(scene);
    const preventDefault = keyboard.press('keydown-V');
    expect(scene.room.send).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('refuses an enemy building', () => {
    scene = fakeScene({ ownerId: 'them' });
    const { keyboard } = bindTraining(scene);
    keyboard.press('keydown-V');
    expect(scene.room.send).not.toHaveBeenCalled();
  });

  it('stays dead when the unit is unaffordable, exactly like the disabled button', () => {
    scene = fakeScene({ stockpile: { wood: 0, food: 0, gold: 0, stone: 0 } });
    const { keyboard } = bindTraining(scene);
    const preventDefault = keyboard.press('keydown-V');
    expect(scene.room.send).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing while a placement mode owns the keyboard', () => {
    scene = fakeScene();
    scene.buildingToPlace = 'HOUSE';
    const { keyboard } = bindTraining(scene);
    keyboard.press('keydown-V');
    expect(scene.room.send).not.toHaveBeenCalled();
  });

  it('ignores a repeated key event', () => {
    scene = fakeScene();
    const { keyboard } = bindTraining(scene);
    keyboard.press('keydown-V', { repeat: true });
    expect(scene.room.send).not.toHaveBeenCalled();
  });
});

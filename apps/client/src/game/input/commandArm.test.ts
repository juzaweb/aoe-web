import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `CommandController` reads Phaser only for `KeyCodes.SHIFT`, inside `bindKeys`,
 * which these tests never call. The module-level import still has to resolve, and
 * the real package needs a DOM, so it is stubbed rather than loaded.
 */
vi.mock('phaser', () => ({ Input: { Keyboard: { KeyCodes: { SHIFT: 16 } } } }));

import { CommandController } from './CommandController.js';

/** The slice of `WorldScene` the arming code touches. */
function fakeScene() {
  return {
    buildingToPlace: null,
    readOnly: false,
    selectedUnitIds: new Set<string>(['u1']),
    selectedBuildingId: null as string | null,
    cursor: { refresh: vi.fn() },
    publishArmedOrder: vi.fn()
  };
}

const pointer = {} as never;

/**
 * Enough of Phaser's keyboard plugin to register and then fire one hotkey.
 *
 * Phaser's EventEmitter keeps *every* listener for a key, and real commands do
 * share keys across contexts (training `A` vs attack-move `A`), so the fake
 * keeps a list per event instead of the last registration overwriting the rest.
 */
function fakeKeyboard() {
  const handlers = new Map<string, Array<(event: KeyboardEvent) => void>>();
  const events: string[] = [];
  return {
    events,
    addKey: () => ({}),
    on(event: string, handler: (event: KeyboardEvent) => void) {
      events.push(event);
      const list = handlers.get(event);
      if (list) list.push(handler);
      else handlers.set(event, [handler]);
    },
    press(event: string) {
      handlers.get(event)?.forEach((handler) =>
        handler({
          repeat: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          preventDefault: () => {}
        } as unknown as KeyboardEvent)
      );
    }
  };
}

describe('CommandController armed orders', () => {
  let scene: ReturnType<typeof fakeScene>;
  let commands: CommandController;

  beforeEach(() => {
    scene = fakeScene();
    commands = new CommandController(scene as never);
  });

  it('arms an explicit mode from the bar', () => {
    commands.armOrder('ATTACK_MOVE');
    expect(commands.pendingOrder).toBe('ATTACK_MOVE');
    expect(commands.contextualArmed).toBe(false);
  });

  it('drops the mode when the same button is pressed again', () => {
    commands.armOrder('PATROL');
    commands.armOrder('PATROL');
    expect(commands.pendingOrder).toBeNull();
    expect(commands.contextualArmed).toBe(false);
  });

  it('replaces a contextual arm with an explicit mode instead of keeping both', () => {
    // Regression: with both flags left set, `commitPendingOrder` took the
    // contextual branch and silently dropped the attack-move the player chose.
    commands.armContextualOrder();
    expect(commands.contextualArmed).toBe(true);

    commands.armOrder('ATTACK_MOVE');
    expect(commands.pendingOrder).toBe('ATTACK_MOVE');
    expect(commands.contextualArmed).toBe(false);
  });

  it('lets the keyboard A key replace a contextual arm', () => {
    // Regression: the `A`/`P` handler used to set `pendingOrder` without clearing
    // `contextualArmed`, so the next click fired a right-click and dropped the
    // attack-move the player had just chosen.
    const keyboard = fakeKeyboard();
    commands.bindKeys(keyboard as never);

    commands.armContextualOrder();
    keyboard.press('keydown-A');

    expect(commands.pendingOrder).toBe('ATTACK_MOVE');
    expect(commands.contextualArmed).toBe(false);
  });

  it('binds only camera keys in read-only mode', () => {
    scene.readOnly = true;
    const keyboard = fakeKeyboard();
    commands.bindKeys(keyboard as never);

    // Camera controls stay live: the spectator may look anywhere.
    expect(keyboard.events).toContain('keydown-PLUS');
    expect(keyboard.events).toContain('keydown-MINUS');
    expect(keyboard.events).toContain('keydown-F2');
    expect(keyboard.events).toContain('keydown-ESC');
    // Every command hotkey is dead: the room would refuse it anyway.
    expect(keyboard.events).not.toContain('keydown-A');
    expect(keyboard.events).not.toContain('keydown-P');
    expect(keyboard.events).not.toContain('keydown-S');
    expect(keyboard.events).not.toContain('keydown-ONE');
    expect(keyboard.events).not.toContain('keydown-H');
    expect(keyboard.events).not.toContain('keydown-X');
  });

  it('replaces an explicit mode when the contextual button is armed', () => {
    commands.armOrder('ATTACK_MOVE');
    commands.armContextualOrder();
    expect(commands.pendingOrder).toBeNull();
    expect(commands.contextualArmed).toBe(true);
  });

  it('toggles the contextual arm off on a second press', () => {
    commands.armContextualOrder();
    commands.armContextualOrder();
    expect(commands.contextualArmed).toBe(false);
  });

  it('does nothing without a selection to command', () => {
    scene.selectedUnitIds = new Set<string>();
    commands.armOrder('ATTACK_MOVE');
    expect(commands.pendingOrder).toBeNull();
    expect(scene.publishArmedOrder).not.toHaveBeenCalled();
  });

  it('publishes every arm change so the bar can highlight it', () => {
    commands.armOrder('ATTACK_MOVE');
    commands.cancelPendingOrder();
    expect(scene.publishArmedOrder).toHaveBeenCalledTimes(2);
  });

  it('commits a contextual arm through the right-click dispatch', () => {
    const contextual = vi.spyOn(commands, 'handleRightClick').mockImplementation(() => {});
    const attackMove = vi.spyOn(commands, 'issueAttackMove').mockImplementation(() => {});

    commands.armContextualOrder();
    commands.commitPendingOrder(pointer);

    expect(contextual).toHaveBeenCalledTimes(1);
    expect(attackMove).not.toHaveBeenCalled();
    // The arm is consumed by the tap that fired it.
    expect(commands.contextualArmed).toBe(false);
  });

  it('commits an explicit arm as an attack-move, not as a right-click', () => {
    const contextual = vi.spyOn(commands, 'handleRightClick').mockImplementation(() => {});
    const attackMove = vi.spyOn(commands, 'issueAttackMove').mockImplementation(() => {});

    commands.armOrder('PATROL');
    commands.commitPendingOrder(pointer);

    expect(attackMove).toHaveBeenCalledWith(pointer, 'PATROL');
    expect(contextual).not.toHaveBeenCalled();
    expect(commands.pendingOrder).toBeNull();
  });
});

describe('cancelSelectedFoundation', () => {
  let scene: ReturnType<typeof fakeScene> & {
    selectedRoadId?: string | null;
    myOwnerId?: string;
    room?: any;
    markFoundationCancelled?: ReturnType<typeof vi.fn>;
    townCenterCountFor?: (ownerId: string) => number;
    notifySelectionChange?: ReturnType<typeof vi.fn>;
  };
  let commands: CommandController;

  beforeEach(() => {
    const baseScene = fakeScene();
    scene = {
      ...baseScene,
      selectedRoadId: null,
      myOwnerId: 'player-a',
      room: {
        send: vi.fn(),
        state: {
          buildings: new Map<string, any>(),
          roads: new Map<string, any>(),
          mapWidth: 110,
          mapHeight: 110,
          zoneId: 'kingdom'
        }
      },
      markFoundationCancelled: vi.fn(),
      townCenterCountFor: (ownerId: string) => {
        let count = 0;
        scene.room.state.buildings.forEach((b: any) => {
          if (b.ownerId === ownerId && b.type === 'TOWN_CENTER') count++;
        });
        return count;
      },
      notifySelectionChange: vi.fn()
    };
    commands = new CommandController(scene as never);
  });

  it('rejects deleting the default Town Center', () => {
    scene.selectedBuildingId = 'tc-1';
    scene.room.state.buildings.set('tc-1', {
      id: 'tc-1',
      ownerId: 'player-a',
      type: 'TOWN_CENTER',
      gridX: 48,
      gridY: 53,
      isConstructed: true
    });

    const result = commands.cancelSelectedFoundation();
    expect(result).toBe(false);
    expect(scene.room.send).not.toHaveBeenCalled();
  });

  it('rejects deleting a Portal', () => {
    scene.selectedBuildingId = 'portal-1';
    scene.room.state.buildings.set('portal-1', {
      id: 'portal-1',
      ownerId: 'player-a',
      type: 'PORTAL',
      gridX: 10,
      gridY: 10,
      isConstructed: true
    });

    const result = commands.cancelSelectedFoundation();
    expect(result).toBe(false);
    expect(scene.room.send).not.toHaveBeenCalled();
  });

  it('deletes a completed house and sends CANCEL_BUILDING', () => {
    scene.selectedBuildingId = 'house-1';
    scene.room.state.buildings.set('house-1', {
      id: 'house-1',
      ownerId: 'player-a',
      type: 'HOUSE',
      gridX: 20,
      gridY: 20,
      isConstructed: true
    });

    const result = commands.cancelSelectedFoundation();
    expect(result).toBe(true);
    expect(scene.markFoundationCancelled).toHaveBeenCalledWith('house-1');
    expect(scene.room.send).toHaveBeenCalledWith('CANCEL_BUILDING', { buildingId: 'house-1' });
  });

  it('allows deleting a secondary Town Center', () => {
    scene.room.state.buildings.set('tc-1', {
      id: 'tc-1',
      ownerId: 'player-a',
      type: 'TOWN_CENTER',
      gridX: 48,
      gridY: 53,
      isConstructed: true
    });
    scene.room.state.buildings.set('tc-2', {
      id: 'tc-2',
      ownerId: 'player-a',
      type: 'TOWN_CENTER',
      gridX: 10,
      gridY: 10,
      isConstructed: true
    });
    scene.selectedBuildingId = 'tc-2';

    const result = commands.cancelSelectedFoundation();
    expect(result).toBe(true);
    expect(scene.markFoundationCancelled).toHaveBeenCalledWith('tc-2');
    expect(scene.room.send).toHaveBeenCalledWith('CANCEL_BUILDING', { buildingId: 'tc-2' });
  });
});

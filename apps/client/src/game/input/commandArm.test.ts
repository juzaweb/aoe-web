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
    selectedUnitIds: new Set<string>(['u1']),
    selectedBuildingId: null as string | null,
    cursor: { refresh: vi.fn() },
    publishArmedOrder: vi.fn()
  };
}

const pointer = {} as never;

/** Enough of Phaser's keyboard plugin to register and then fire one hotkey. */
function fakeKeyboard() {
  const handlers = new Map<string, (event: KeyboardEvent) => void>();
  return {
    addKey: () => ({}),
    on(event: string, handler: (event: KeyboardEvent) => void) {
      handlers.set(event, handler);
    },
    press(event: string) {
      handlers.get(event)?.(
        {
          repeat: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          preventDefault: () => {}
        } as unknown as KeyboardEvent
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

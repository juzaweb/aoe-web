import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `CommandController` reads Phaser only for `KeyCodes.SHIFT`, inside `bindKeys`,
 * which these tests never call. The module-level import still has to resolve,
 * and the real package needs a DOM, so it is stubbed rather than loaded.
 */
vi.mock('phaser', () => ({ Input: { Keyboard: { KeyCodes: { SHIFT: 16 } } } }));

vi.mock('./pointer.js', () => ({
  pointerWorldPoint: () => ({ x: 100, y: 100 }),
  pointerWorldGrid: () => ({ gridX: 5, gridY: 5 })
}));

vi.mock('./hitTest.js', () => ({
  findBuildingAt: vi.fn(),
  findOwnFoundationAt: vi.fn(() => null),
  findOwnGatherableAt: vi.fn(() => null),
  findResourceAt: vi.fn(() => null),
  findUnitAt: vi.fn(() => null)
}));

vi.mock('../audio/commandSound.js', () => ({ playCommandSound: vi.fn() }));

import { NetworkMessage } from '@chien-quoc/shared';
import { findBuildingAt } from './hitTest.js';
import { CommandController } from './CommandController.js';

const send = vi.fn();

function fakeScene(portalOwnerId: string) {
  return {
    readOnly: false,
    myOwnerId: 'attacker',
    selectedUnitIds: new Set<string>(['u1']),
    cameras: { main: {} },
    room: {
      state: {
        buildings: new Map([
          [
            'portal-1',
            {
              id: 'portal-1',
              type: 'PORTAL',
              ownerId: portalOwnerId,
              gridX: 5,
              gridY: 5
            }
          ]
        ])
      },
      send
    }
  };
}

describe('CommandController shared retreat gate', () => {
  beforeEach(() => {
    send.mockReset();
    vi.mocked(findBuildingAt).mockReset();
  });

  it('retreats when right-clicking the defender portal during a raid', () => {
    // A raid reuses the kingdom's single gateway, so the portal under the
    // cursor belongs to the defender, not the raider.
    const scene = fakeScene('defender');
    const commands = new CommandController(scene as never);
    commands.showFeedback = vi.fn();
    vi.mocked(findBuildingAt).mockReturnValue('portal-1');

    commands.handleRightClick({} as never);

    expect(send).toHaveBeenCalledWith(NetworkMessage.RAID_RETREAT, {});
  });

  it('still attacks a non-portal enemy building', () => {
    const scene = fakeScene('defender');
    scene.room.state.buildings.set('tower-1', {
      id: 'tower-1',
      type: 'TOWER',
      ownerId: 'defender',
      gridX: 5,
      gridY: 5
    } as never);
    const commands = new CommandController(scene as never);
    commands.showFeedback = vi.fn();
    vi.mocked(findBuildingAt).mockReturnValueOnce(null).mockReturnValueOnce('tower-1');

    commands.handleRightClick({} as never);

    expect(send).toHaveBeenCalledWith(NetworkMessage.ATTACK_TARGET, {
      unitIds: ['u1'],
      targetEntityId: 'tower-1',
      targetType: 'building'
    });
  });
});

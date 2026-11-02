import { ErrorCode, ServerError } from '@colyseus/core';
import { zoneForOwner } from '@chien-quoc/shared';
import { WorldRoom } from './WorldRoom.js';
import type { RoomAuth } from './identity.js';

/**
 * One private map per account.
 *
 * The room is registered with `filterBy(['ownerId'])`, so the matchmaker hands
 * a player back the same live room on a refresh. `onAuth` independently proves
 * the option names the authenticated account: filtering is matchmaking, not
 * authorization, and a room created for somebody else's id would otherwise load
 * their empire before `onJoin` could refuse it.
 */
export class KingdomRoom extends WorldRoom {
  static async onAuth(
    token: string | undefined,
    options?: { ownerId?: unknown }
  ): Promise<RoomAuth> {
    const auth = await super.onAuth(token);
    const ownerId = options?.ownerId;

    if (typeof ownerId !== 'string' || ownerId.length === 0 || ownerId !== auth.userId) {
      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        'Vương quốc này không thuộc tài khoản đang đăng nhập.'
      );
    }

    return auth;
  }

  protected resolveOwnerScope(options: any): string | null {
    const ownerId = options?.ownerId;
    return typeof ownerId === 'string' && ownerId.length > 0 ? ownerId : null;
  }

  protected resolveZoneId(options: any): string {
    const ownerId = this.resolveOwnerScope(options);
    return ownerId ? zoneForOwner(ownerId) : 'world';
  }

  protected canJoinOwner(ownerId: string): boolean {
    return this.ownerScope === ownerId;
  }
}

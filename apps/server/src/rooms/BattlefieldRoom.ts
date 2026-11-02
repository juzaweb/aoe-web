import { BATTLEFIELD_ZONE } from '@chien-quoc/shared';
import { WorldRoom } from './WorldRoom.js';

/**
 * The single shared PvP map every kingdom's portal leads to.
 *
 * There is no starter base here: players bring the units they selected through
 * the portal and build their own forward camp with the villagers among them.
 * The room restores every participant's buildings and units, including those of
 * offline accounts, so a camp stays attackable while its owner is home.
 */
export class BattlefieldRoom extends WorldRoom {
  protected resolveOwnerScope(): string | null {
    return null;
  }

  protected resolveZoneId(): string {
    return BATTLEFIELD_ZONE;
  }

  protected async spawnZoneContent(): Promise<void> {
    // Nothing is granted on arrival; the portal is created on demand and the
    // rest is built by the player.
  }
}

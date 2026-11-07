import { WorldScene } from './WorldScene.js';

/**
 * Read-only view of somebody else's kingdom.
 *
 * Runs as a second Phaser game next to the player's own one, so their empire
 * keeps simulating while they watch. The scene is the normal world renderer with
 * the command layer switched off: the flag is set before `create()`, which is
 * what makes `CommandController` bind only the camera keys.
 */
export class SpectatorScene extends WorldScene {
  /** Mirrors the server rule: a watcher never issues a command. */
  public readOnly: boolean = true;
}

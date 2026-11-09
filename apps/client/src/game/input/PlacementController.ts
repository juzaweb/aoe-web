import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  NetworkMessage,
  citadelLayoutFor,
  footprintTouchesWalls,
  gridToScreen
} from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import { buildingArt, type BuildingArt } from '../render/buildingArt.js';
import { pointerWorldGrid } from './pointer.js';

/**
 * CMD-04: building placement mode. Owns the ghost preview, the placement
 * validation that the ghost, the cursor and the click must all agree on, and the
 * PLACE_BUILDING message.
 */
export class PlacementController {
  private ghost!: Phaser.GameObjects.Container;
  private ghostImage!: Phaser.GameObjects.Image;

  /**
   * Footprints dropped during this placement session that the server has not
   * echoed back in a snapshot yet. Without them a fast shift-chain validates
   * every click against the pre-placement state: a second click on the same tile
   * (or one that overlaps the foundation just sent) would look placeable and be
   * rejected by the server instead of turning the ghost red here.
   */
  private pendingFootprints: Array<{
    gridX: number;
    gridY: number;
    sizeX: number;
    sizeY: number;
  }> = [];

  constructor(private readonly scene: WorldScene) {}

  create() {
    const scene = this.scene;
    this.ghost = scene.add.container(0, 0);
    this.ghostImage = scene.add.image(0, 0, 'b_house');
    this.ghostImage.setAlpha(0.65);
    this.ghost.add(this.ghostImage);
    this.ghost.setDepth(999999);
    this.ghost.setVisible(false);
  }

  /** Whether a footprint anchored at `gx, gy` may be placed right now. */
  isValid(gx: number, gy: number, blueprint: any): boolean {
    const scene = this.scene;
    if (!scene.room) return false;
    if (
      gx < 0 ||
      gx + blueprint.sizeX > scene.mapWidth ||
      gy < 0 ||
      gy + blueprint.sizeY > scene.mapHeight
    ) {
      return false;
    }

    let blocked = false;

    // A foundation sent a few milliseconds ago is not in the snapshot yet, so a
    // fast second click can land on a tile the server already considers taken.
    this.pendingFootprints.forEach((p) => {
      const overlapX = gx < p.gridX + p.sizeX && gx + blueprint.sizeX > p.gridX;
      const overlapY = gy < p.gridY + p.sizeY && gy + blueprint.sizeY > p.gridY;
      if (overlapX && overlapY) blocked = true;
    });

    scene.room.state.buildings.forEach((b: any) => {
      // The citadel compound is a scoring entity, not an obstacle: its wall ring
      // is checked separately below, and its 26x26 footprint must not swallow
      // every build order inside the courtyard.
      if (b.type === 'CITADEL') return;
      const overlapX = gx < b.gridX + b.sizeX && gx + blueprint.sizeX > b.gridX;
      const overlapY = gy < b.gridY + b.sizeY && gy + blueprint.sizeY > b.gridY;
      if (overlapX && overlapY) blocked = true;
    });

    // The server rejects a footprint that covers a player-painted road, so the
    // ghost has to refuse the same tiles instead of promising a placement that
    // will come back as a rejection.
    const roads = (scene.room.state as any).roads as
      | { get: (key: string) => any }
      | undefined;
    for (let x = gx; x < gx + blueprint.sizeX && !blocked; x++) {
      for (let y = gy; y < gy + blueprint.sizeY && !blocked; y++) {
        if (roads?.get(`${x},${y}`)) blocked = true;
      }
    }

    scene.room.state.resourceNodes.forEach((res: any) => {
      if (
        res.gridX >= gx &&
        res.gridX < gx + blueprint.sizeX &&
        res.gridY >= gy &&
        res.gridY < gy + blueprint.sizeY
      ) {
        blocked = true;
      }
    });

    // Citadel walls are indestructible terrain derived from the Town Center, not
    // buildings, so the server rejects them separately. The ghost must too.
    if (scene.terrainLayout?.kind === 'kingdom') {
      let townCenter: any = null;
      scene.room.state.buildings?.forEach((b: any) => {
        if (!townCenter && b.type === 'TOWN_CENTER') townCenter = b;
      });
      if (townCenter) {
        const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
        const reserved = [...layout.walls];
        blocked =
          blocked ||
          footprintTouchesWalls(reserved, gx, gy, blueprint.sizeX, blueprint.sizeY);
      }
    }

    return !blocked;
  }

  /** Follows the pointer every frame while placement mode is active. */
  updateGhost(gridX: number, gridY: number) {
    const scene = this.scene;

    if (!scene.buildingToPlace) {
      this.ghost.setVisible(false);
      return;
    }

    const blueprint = BUILDING_BLUEPRINTS[scene.buildingToPlace];
    const ghostPos = gridToScreen(
      gridX + blueprint.sizeX / 2 - 0.5,
      gridY + blueprint.sizeY / 2 - 0.5
    );
    this.ghost.setPosition(ghostPos.x, ghostPos.y);
    this.ghost.setVisible(true);
    this.ghostImage.setTint(this.isValid(gridX, gridY, blueprint) ? 0x86efac : 0xfca5a5);
  }

  /** Enters placement mode for `type` and dresses the ghost in its artwork. */
  enter(type: BuildingType) {
    const scene = this.scene;
    // UIX-06: the selection stays put. AoE keeps the villagers (and their build
    // card) on screen while placing, and clearing them here would blank the card
    // the moment a building is picked, then leave nothing selected once the
    // building is dropped.
    scene.buildingToPlace = type;
    scene.notifySelectionChange();
    this.pendingFootprints = [];

    const art = this.ghostArt(type);
    this.ghostImage.setTexture(art.textureKey);
    this.ghostImage.setY(art.offsetY);
    this.ghostImage.setScale(art.scale);
  }

  cancel() {
    const scene = this.scene;
    scene.buildingToPlace = null;
    this.pendingFootprints = [];
    this.ghost.setVisible(false);
    // Placement owns the cursor while active, so leaving the mode has to restore
    // it even though the pointer has not moved.
    scene.cursor.refresh();
    scene.onPlacementCancelled?.();
  }

  /**
   * Sends PLACE_BUILDING for the tile under the click, or blinks a refusal.
   *
   * `keepActive` is the shift-click convention: the mode survives a successful
   * drop so the next click can place the same building again, and the drop is
   * queued behind the crew's current site. Without it the mode closes as soon as
   * one foundation is sent and the order replaces whatever the crew was doing.
   */
  commit(pointer: Phaser.Input.Pointer, keepActive = false) {
    const scene = this.scene;
    if (!scene.buildingToPlace || !scene.room) return;
    const type = scene.buildingToPlace;
    const blueprint = BUILDING_BLUEPRINTS[type];

    // Recompute from the pointer that actually clicked. The ghost position is
    // only refreshed on pointermove, so a click right after a camera pan (or any
    // input source that skips pointermove) would otherwise place the building at
    // a stale coordinate.
    const { gridX, gridY } = pointerWorldGrid(scene.cameras.main, pointer);

    if (this.isValid(gridX, gridY, blueprint)) {
      const unitIds = Array.from(scene.selectedUnitIds);
      // CMD-07: the crew travels with the placement. The foundation's id is
      // minted by the server, so a client-side follow-up BUILD_TARGET would have
      // to wait for the new building to appear in the snapshot and guess which
      // entry it just placed — that race is exactly the second click this removes.
      //
      // A shift-chain sends the same crew again with `queue`: the server appends
      // the new foundation behind their current site instead of abandoning it.
      scene.room.send(NetworkMessage.PLACE_BUILDING, {
        type,
        gridX,
        gridY,
        ...(unitIds.length > 0 ? { unitIds } : {}),
        ...(keepActive ? { queue: true } : {})
      });
      this.pendingFootprints.push({
        gridX,
        gridY,
        sizeX: blueprint.sizeX,
        sizeY: blueprint.sizeY
      });
      if (keepActive) return;
      this.cancel();
      return;
    }

    // Stay in placement mode (AoE lets you retry another tile) but tell the player
    // why nothing happened, at the spot they clicked.
    const ghostPos = gridToScreen(
      gridX + blueprint.sizeX / 2 - 0.5,
      gridY + blueprint.sizeY / 2 - 0.5
    );
    scene.commands.showFeedback(ghostPos.x, ghostPos.y, 0xef4444);
  }

  private ghostArt(type: BuildingType): BuildingArt {
    return buildingArt(type, (key) => this.scene.textures.exists(key));
  }
}

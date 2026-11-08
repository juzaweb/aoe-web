import {
  MAP_BUILD_MARGIN_TILES,
  MAX_ROAD_TILES_PER_MESSAGE,
  NetworkMessage,
  ROAD_COST_PER_TILE,
  citadelLayoutFor
} from '@chien-quoc/shared';
import type { WorldScene } from '../scenes/WorldScene.js';
import { batchTiles } from './roadPaint.js';
import type { RoadTile } from './roadPaint.js';
import { StrokeBrushController } from './StrokeBrushController.js';

/** Which way the road tool works. */
export type RoadMode = 'build' | 'erase';

/**
 * The road paint tool.
 *
 * Validation, pricing and the message that carries a stroke are road-specific;
 * the pointer-drag engine and ghost overlay come from `StrokeBrushController`,
 * which the wall brush shares.
 */
export class RoadController extends StrokeBrushController<RoadMode> {
  constructor(scene: WorldScene) {
    super(scene, MAX_ROAD_TILES_PER_MESSAGE);
  }

  /** Tiles of the stroke that the tool may actually act on. */
  protected validTiles(): RoadTile[] {
    const room = this.scene.room;
    if (!room) return [];

    const margin = MAP_BUILD_MARGIN_TILES;
    const state = room.state as any;
    const roads: { get: (key: string) => any } | undefined = state?.roads;
    const buildings: { forEach: (cb: (b: any) => void) => void } | undefined = state?.buildings;
    const resources: { forEach: (cb: (n: any) => void) => void } | undefined = state?.resourceNodes;

    const occupied = new Set<string>();
    buildings?.forEach((b: any) => {
      for (let y = 0; y < b.sizeY; y++) {
        for (let x = 0; x < b.sizeX; x++) occupied.add(`${b.gridX + x},${b.gridY + y}`);
      }
    });
    resources?.forEach((n: any) => occupied.add(`${n.gridX},${n.gridY}`));

    // Stair flights are citadel structures, not pavement; the server rejects
    // roads on them, so the ghost overlay must too.
    buildings?.forEach((b: any) => {
      if (b.type !== 'TOWN_CENTER') return;
      for (const stair of citadelLayoutFor(b.gridX, b.gridY).stairs) {
        occupied.add(`${stair.bottom.gridX},${stair.bottom.gridY}`);
        occupied.add(`${stair.top.gridX},${stair.top.gridY}`);
      }
    });

    const pending = this.pending;
    const valid: RoadTile[] = [];
    for (const tile of pending) {
      if (tile.x < margin || tile.y < margin) continue;
      if (tile.x >= this.scene.mapWidth - margin || tile.y >= this.scene.mapHeight - margin) continue;

      const key = `${tile.x},${tile.y}`;
      const existing = roads?.get(key);
      if (this.mode === 'build') {
        if (existing || occupied.has(key)) continue;
      } else {
        // Only the player's own tiles may be erased; the server enforces it too.
        if (!existing || existing.ownerId !== this.scene.myOwnerId) continue;
      }
      valid.push(tile);
    }
    return valid;
  }

  /**
   * The stroke cut down to what this player can pay for.
   *
   * The server charges per tile and rejects a batch it cannot afford, so the
   * client must not promise more road than the wood covers. Erasing is free.
   */
  protected affordableStroke(): RoadTile[] {
    const valid = this.validTiles();
    if (this.mode === 'erase') return valid;

    const affordableTiles = Math.floor(this.playerWood() / ROAD_COST_PER_TILE);
    return affordableTiles >= valid.length ? valid : valid.slice(0, affordableTiles);
  }

  protected canAffordStroke(validCount: number): boolean {
    if (this.mode === 'erase') return true;
    return this.playerWood() >= validCount * ROAD_COST_PER_TILE;
  }

  protected sendStroke(tiles: RoadTile[]): void {
    const unitIds = Array.from(this.scene.selectedUnitIds);
    for (const batch of batchTiles(tiles, MAX_ROAD_TILES_PER_MESSAGE)) {
      this.scene.room?.send(
        this.mode === 'erase' ? NetworkMessage.REMOVE_ROAD : NetworkMessage.PLACE_ROAD,
        {
          tiles: batch,
          ...(this.mode === 'build' && unitIds.length > 0 ? { unitIds } : {})
        }
      );
    }
  }

  private playerWood(): number {
    const room = this.scene.room as any;
    return Number(room?.state?.players?.get?.(this.scene.myOwnerId)?.wood ?? 0);
  }
}

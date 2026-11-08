import {
  BUILDING_BLUEPRINTS,
  MAX_WALL_TILES_PER_MESSAGE,
  NetworkMessage,
  citadelLayoutFor
} from '@chien-quoc/shared';
import type { WorldScene } from '../scenes/WorldScene.js';
import type { RoadTile } from './roadPaint.js';
import { batchTiles } from './roadPaint.js';
import { StrokeBrushController } from './StrokeBrushController.js';

/** Which way the wall brush works. */
export type WallMode = 'build' | 'erase';

/**
 * The stone-wall paint tool.
 *
 * Each painted tile becomes a 1x1 building foundation on the server, priced from
 * the WALL blueprint. The pointer-drag engine and ghost overlay are shared with
 * the road brush; this class only answers what a wall may occupy, what it costs
 * and which message carries the stroke.
 */
export class WallController extends StrokeBrushController<WallMode> {
  constructor(scene: WorldScene) {
    super(scene, MAX_WALL_TILES_PER_MESSAGE);
  }

  /**
   * Tiles of the stroke that the brush may actually act on.
   *
   * A build stroke skips anything already occupied: buildings, resource nodes,
   * player roads and the indestructible citadel wall ring. An erase stroke keeps
   * only the caller's own wall segments, so a drag never touches an enemy's wall.
   */
  protected validTiles(): RoadTile[] {
    const room = this.scene.room;
    if (!room) return [];

    const state = room.state as any;
    const buildings: { forEach: (cb: (b: any) => void) => void } | undefined = state?.buildings;
    const roads: { has: (key: string) => boolean } | undefined = state?.roads;
    const resources: { forEach: (cb: (n: any) => void) => void } | undefined = state?.resourceNodes;

    const buildingAt = new Map<string, any>();
    const occupied = new Set<string>();
    buildings?.forEach((b: any) => {
      if (b.type === 'CITADEL') return;
      for (let y = 0; y < b.sizeY; y++) {
        for (let x = 0; x < b.sizeX; x++) {
          const key = `${b.gridX + x},${b.gridY + y}`;
          occupied.add(key);
          buildingAt.set(key, b);
        }
      }
    });
    resources?.forEach((n: any) => occupied.add(`${n.gridX},${n.gridY}`));

    // The citadel wall ring is terrain, not a building row; stamp its tiles in
    // so a wall stroke cannot be drawn on top of the capital's own masonry.
    buildings?.forEach((b: any) => {
      if (b.type !== 'TOWN_CENTER') return;
      const layout = citadelLayoutFor(b.gridX, b.gridY);
      for (const wall of layout.walls) {
        occupied.add(`${wall.gridX},${wall.gridY}`);
      }
      for (const stair of layout.stairs) {
        occupied.add(`${stair.bottom.gridX},${stair.bottom.gridY}`);
        occupied.add(`${stair.top.gridX},${stair.top.gridY}`);
      }
    });

    const valid: RoadTile[] = [];
    for (const tile of this.pending) {
      if (tile.x < 0 || tile.y < 0) continue;
      if (tile.x >= this.scene.mapWidth || tile.y >= this.scene.mapHeight) continue;

      const key = `${tile.x},${tile.y}`;
      if (this.mode === 'build') {
        if (roads?.has(key) || occupied.has(key)) continue;
      } else {
        const building = buildingAt.get(key);
        if (!building || building.type !== 'WALL' || building.ownerId !== this.scene.myOwnerId) {
          continue;
        }
      }
      valid.push(tile);
    }
    return valid;
  }

  /**
   * The stroke cut down to what this player can pay for.
   *
   * A wall tile costs both wood and stone, so the number of affordable tiles is
   * the smaller of the two budgets. Erasing is free.
   */
  protected affordableStroke(): RoadTile[] {
    const valid = this.validTiles();
    if (this.mode === 'erase') return valid;

    const blueprint = BUILDING_BLUEPRINTS.WALL;
    const { wood, stone } = this.playerResources();
    const affordableTiles = Math.min(
      blueprint.cost.wood > 0 ? Math.floor(wood / blueprint.cost.wood) : valid.length,
      blueprint.cost.stone > 0 ? Math.floor(stone / blueprint.cost.stone) : valid.length
    );
    return affordableTiles >= valid.length ? valid : valid.slice(0, Math.max(0, affordableTiles));
  }

  protected canAffordStroke(validCount: number): boolean {
    if (this.mode === 'erase') return true;

    const blueprint = BUILDING_BLUEPRINTS.WALL;
    const { wood, stone } = this.playerResources();
    return (
      wood >= validCount * blueprint.cost.wood &&
      stone >= validCount * blueprint.cost.stone
    );
  }

  protected sendStroke(tiles: RoadTile[]): void {
    const unitIds = Array.from(this.scene.selectedUnitIds);
    for (const batch of batchTiles(tiles, MAX_WALL_TILES_PER_MESSAGE)) {
      this.scene.room?.send(
        this.mode === 'erase' ? NetworkMessage.REMOVE_WALL : NetworkMessage.PLACE_WALL,
        {
          tiles: batch,
          ...(this.mode === 'build' && unitIds.length > 0 ? { unitIds } : {})
        }
      );
    }
  }

  private playerResources(): { wood: number; stone: number } {
    const room = this.scene.room as any;
    const player = room?.state?.players?.get?.(this.scene.myOwnerId);
    return {
      wood: Number(player?.wood ?? 0),
      stone: Number(player?.stone ?? 0)
    };
  }
}

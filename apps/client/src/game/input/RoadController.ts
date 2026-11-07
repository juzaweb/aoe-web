import {
  MAP_BUILD_MARGIN_TILES,
  MAX_ROAD_TILES_PER_MESSAGE,
  NetworkMessage,
  ROAD_COST_PER_TILE,
  TILE_HEIGHT,
  TILE_WIDTH,
  gridToScreen
} from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import { pointerWorldGrid } from './pointer.js';
import { batchTiles, lineTiles, type RoadTile } from './roadPaint.js';

/** Which way the road tool works. */
export type RoadMode = 'build' | 'erase';

/**
 * The road paint tool.
 *
 * A stroke is a set of tiles accumulated while the pointer is down; pointer
 * samples are joined with Bresenham so a fast drag still paints a continuous
 * road. Nothing is sent until the button comes up, so a stroke is one command
 * instead of one message per tile.
 *
 * The ghost overlay is drawn from the same `pending` set the commit reads, so
 * what the player sees during the drag is exactly what the server will be
 * asked to paint.
 */
export class RoadController {
  private mode: RoadMode | null = null;
  /** Tiles painted by the stroke in progress. */
  private pending: RoadTile[] = [];
  private pendingKeys = new Set<string>();
  private drawing = false;
  private lastTile: RoadTile | null = null;
  /** Green when the stroke is affordable and clear, red otherwise. */
  private readonly overlay: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: WorldScene) {
    this.overlay = scene.add.graphics();
    this.overlay.setDepth(999998);
    this.overlay.setVisible(false);
  }

  get active(): RoadMode | null {
    return this.mode;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  enter(mode: RoadMode) {
    this.mode = mode;
    this.pending = [];
    this.pendingKeys.clear();
    this.drawing = false;
    this.lastTile = null;
    this.overlay.setVisible(true);
  }

  cancel() {
    this.mode = null;
    this.pending = [];
    this.pendingKeys.clear();
    this.drawing = false;
    this.lastTile = null;
    this.overlay.clear();
    this.overlay.setVisible(false);
    this.scene.cursor.refresh();
  }

  /** Starts a stroke at a screen pointer. */
  begin(pointer: Phaser.Input.Pointer) {
    if (!this.mode) return;
    this.drawing = true;
    this.lastTile = null;
    this.extend(pointer);
  }

  /** Extends the stroke to the pointer, filling the gap since the last sample. */
  drag(pointer: Phaser.Input.Pointer) {
    if (!this.drawing) return;
    this.extend(pointer);
  }

  /** Finishes the stroke and sends it to the server. */
  end() {
    if (!this.drawing) return;
    this.drawing = false;
    this.lastTile = null;

    // Trim to what the player can actually pay for: a stroke longer than the
    // wood on hand would otherwise be rejected tile-by-tile by the server, and
    // the player would get one toast per batch instead of a partial road.
    const tiles = this.affordableStroke();
    this.pending = [];
    this.pendingKeys.clear();
    this.redraw();
    if (tiles.length === 0) return;

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

  /** Dropped when the pointer is lost (HUD press, gesture cancel, map switch). */
  abort() {
    this.drawing = false;
    this.pending = [];
    this.pendingKeys.clear();
    this.lastTile = null;
    this.redraw();
  }

  /** Redraws the ghost for the current stroke. Called every frame while active. */
  render() {
    if (!this.mode) {
      this.overlay.setVisible(false);
      return;
    }
    this.overlay.setVisible(true);
    this.redraw();
  }

  private extend(pointer: Phaser.Input.Pointer) {
    const grid = pointerWorldGrid(this.scene.cameras.main, pointer);
    const tile: RoadTile = { x: grid.gridX, y: grid.gridY };
    const segment = this.lastTile ? lineTiles(this.lastTile, tile) : [tile];
    this.lastTile = tile;

    for (const next of segment) {
      // The stroke is bounded by one message's worth of tiles. A drag across the
      // whole map would otherwise hold thousands of queued tiles and redraw one
      // diamond each per frame, while the server accepts 200 at a time anyway.
      if (this.pending.length >= MAX_ROAD_TILES_PER_MESSAGE) break;
      const key = `${next.x},${next.y}`;
      if (this.pendingKeys.has(key)) continue;
      this.pendingKeys.add(key);
      this.pending.push(next);
    }
    this.redraw();
  }

  /** Tiles of the stroke that the tool may actually act on. */
  private validTiles(): RoadTile[] {
    const room = this.scene.room;
    if (!room) return [];

    const margin = MAP_BUILD_MARGIN_TILES;
    const state = room.state as any;
    const roads: { has: (key: string) => boolean; get: (key: string) => any } | undefined = state?.roads;
    const buildings: { forEach: (cb: (b: any) => void) => void } | undefined = state?.buildings;
    const resources: { forEach: (cb: (n: any) => void) => void } | undefined = state?.resourceNodes;

    const occupied = new Set<string>();
    buildings?.forEach((b: any) => {
      for (let y = 0; y < b.sizeY; y++) {
        for (let x = 0; x < b.sizeX; x++) occupied.add(`${b.gridX + x},${b.gridY + y}`);
      }
    });
    resources?.forEach((n: any) => occupied.add(`${n.gridX},${n.gridY}`));

    const valid: RoadTile[] = [];
    for (const tile of this.pending) {
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
  private affordableStroke(): RoadTile[] {
    const valid = this.validTiles();
    if (this.mode === 'erase') return valid;

    const room = this.scene.room as any;
    const wood = Number(room?.state?.players?.get?.(this.scene.myOwnerId)?.wood ?? 0);
    const affordableTiles = Math.floor(wood / ROAD_COST_PER_TILE);
    return affordableTiles >= valid.length ? valid : valid.slice(0, affordableTiles);
  }

  /** Wood the player would have left after painting the current stroke. */
  private remainingWoodAfterStroke(validCount: number): number {
    const room = this.scene.room as any;
    const myId = this.scene.myOwnerId;
    const wood = Number(room?.state?.players?.get?.(myId)?.wood ?? 0);
    if (this.mode === 'erase') return Number.POSITIVE_INFINITY;
    return wood - validCount * ROAD_COST_PER_TILE;
  }

  private redraw() {
    const graphics = this.overlay;
    graphics.clear();
    if (!this.mode) return;

    // One pass per frame: the valid set is read twice (colour of each tile, then
    // the total cost), and re-deriving it doubled the per-move work.
    const validTiles = this.validTiles();
    const validKeys = new Set(validTiles.map((tile) => `${tile.x},${tile.y}`));
    const affordable = this.remainingWoodAfterStroke(validTiles.length) >= 0;

    for (const tile of this.pending) {
      const key = `${tile.x},${tile.y}`;
      const ok = validKeys.has(key) && (this.mode === 'erase' || affordable);
      this.drawDiamond(tile.x, tile.y, ok ? 0x86efac : 0xfca5a5, ok ? 0.45 : 0.35);
    }
  }

  private drawDiamond(gx: number, gy: number, color: number, alpha: number) {
    const center = gridToScreen(gx, gy);
    const halfW = TILE_WIDTH / 2;
    const halfH = TILE_HEIGHT / 2;
    this.overlay.fillStyle(color, alpha);
    this.overlay.lineStyle(1, color, 0.9);
    this.overlay.beginPath();
    this.overlay.moveTo(center.x, center.y - halfH);
    this.overlay.lineTo(center.x + halfW, center.y);
    this.overlay.lineTo(center.x, center.y + halfH);
    this.overlay.lineTo(center.x - halfW, center.y);
    this.overlay.closePath();
    this.overlay.fillPath();
    this.overlay.strokePath();
  }
}

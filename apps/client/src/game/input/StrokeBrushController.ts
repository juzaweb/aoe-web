import { TILE_HEIGHT, TILE_WIDTH, gridToScreen } from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import { pointerWorldGrid } from './pointer.js';
import { lineTiles, type RoadTile } from './roadPaint.js';

/**
 * Shared engine for the two 1x1 paint brushes (roads and stone walls).
 *
 * Both tools turn a pointer drag into a set of tiles, draw the same diamond
 * ghost and commit the stroke on release. They differ only in what counts as a
 * valid tile, what the stroke costs and which network message carries it, so
 * those four questions are the abstract surface here.
 *
 * A stroke is accumulated while the pointer is down; pointer samples are joined
 * with Bresenham so a fast drag still paints a continuous line. Nothing is sent
 * until the button comes up, so a stroke is one command instead of one message
 * per tile.
 */
export abstract class StrokeBrushController<Mode extends string> {
  protected mode: Mode | null = null;
  /** Tiles painted by the stroke in progress. */
  protected pending: RoadTile[] = [];
  private pendingKeys = new Set<string>();
  private drawing = false;
  private lastTile: RoadTile | null = null;
  /** Green when the stroke is affordable and clear, red otherwise. */
  private readonly overlay: Phaser.GameObjects.Graphics;

  constructor(
    protected readonly scene: WorldScene,
    private readonly maxTilesPerStroke: number
  ) {
    this.overlay = scene.add.graphics();
    this.overlay.setDepth(999998);
    this.overlay.setVisible(false);
  }

  get active(): Mode | null {
    return this.mode;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  enter(mode: Mode) {
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

  /** Finishes the stroke and hands it to the subclass to send. */
  end() {
    if (!this.drawing) return;
    this.drawing = false;
    this.lastTile = null;

    const tiles = this.affordableStroke();
    this.pending = [];
    this.pendingKeys.clear();
    this.redraw();
    if (tiles.length > 0) this.sendStroke(tiles);
  }

  /** Drops a half-drawn stroke (pointer lost, pinch, map switch). */
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

  /** Tiles of the stroke the brush may actually act on. */
  protected abstract validTiles(): RoadTile[];

  /** The valid part of the stroke cut down to what the player can pay for. */
  protected abstract affordableStroke(): RoadTile[];

  /** Whether every valid tile of the stroke is affordable, for the ghost colour. */
  protected abstract canAffordStroke(validCount: number): boolean;

  /** Sends the committed stroke to the server. */
  protected abstract sendStroke(tiles: RoadTile[]): void;

  private extend(pointer: Phaser.Input.Pointer) {
    const grid = pointerWorldGrid(this.scene.cameras.main, pointer);
    const tile: RoadTile = { x: grid.gridX, y: grid.gridY };
    const segment = this.lastTile ? lineTiles(this.lastTile, tile) : [tile];
    this.lastTile = tile;

    for (const next of segment) {
      // One stroke is one message, so there is no point accumulating more tiles
      // than the server will accept in that message.
      if (this.pending.length >= this.maxTilesPerStroke) break;
      const key = `${next.x},${next.y}`;
      if (this.pendingKeys.has(key)) continue;
      this.pendingKeys.add(key);
      this.pending.push(next);
    }
    this.redraw();
  }

  private redraw() {
    this.overlay.clear();
    if (!this.mode) return;

    const validTiles = this.validTiles();
    const validKeys = new Set(validTiles.map((tile) => `${tile.x},${tile.y}`));
    const affordable = this.canAffordStroke(validTiles.length);

    for (const tile of this.pending) {
      const key = `${tile.x},${tile.y}`;
      const ok = validKeys.has(key) && affordable;
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

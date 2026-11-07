import {
  TILE_HEIGHT,
  TILE_WIDTH,
  citadelLayoutFor,
  getIsoDepth,
  gridToScreen
} from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';

/**
 * Wall block art sizes, in texture pixels.
 *
 * The base diamond (64 px tall) sits at `WALL_BASE_CENTER_Y` and the cap is
 * lifted by `WALL_RISE`, so adjacent 1x1 wall tiles read as one continuous wall
 * rather than as a row of curbs.
 */
const WALL_RISE = 90;
const WALL_BASE_CENTER_Y = 32 + WALL_RISE;
const WALL_TEXTURE_HEIGHT = WALL_BASE_CENTER_Y + 32;

/**
 * Stone floor and indestructible walls of every kingdom citadel on the map.
 *
 * The compound is not replicated as entities: it is a pure function of the Town
 * Center's position (see `citadelLayoutFor`), so the client redraws exactly what
 * the server uses for collision. Only a kingdom gets one; the battlefield has no
 * citadel and this layer stays empty.
 */
export class CitadelLayer {
  private floorTiles: Phaser.GameObjects.Image[] = [];
  private wallTiles: Phaser.GameObjects.Image[] = [];
  /** Town Center positions the current graphics were built from. */
  private signature = '';

  constructor(private readonly scene: WorldScene) {}

  /** Builds the two procedural textures once. Call from the scene's create(). */
  create() {
    this.ensureTextures();
  }

  /** Removes every drawn tile. */
  clear() {
    for (const tile of this.floorTiles) tile.destroy();
    for (const tile of this.wallTiles) tile.destroy();
    this.floorTiles = [];
    this.wallTiles = [];
    this.signature = '';
  }

  /**
   * Redraws the citadel when its anchor moves (a new Town Center, a new map).
   *
   * Cheap enough to call on every building add/remove: the signature makes a
   * non-Town-Center change a no-op.
   */
  rebuild(room: { state?: any } | null) {
    if (!room?.state || this.scene.terrainLayout.kind !== 'kingdom') {
      this.clear();
      return;
    }

    const townCenters: any[] = [];
    room.state.buildings?.forEach((building: any) => {
      if (building.type === 'TOWN_CENTER') townCenters.push(building);
    });

    const signature = townCenters
      .map((tc) => `${tc.ownerId}:${tc.gridX},${tc.gridY}`)
      .sort()
      .join('|');

    if (signature === this.signature && this.floorTiles.length + this.wallTiles.length > 0) {
      return;
    }

    this.clear();
    this.signature = signature;

    for (const tc of townCenters) {
      this.drawCitadel(tc.gridX, tc.gridY);
    }
  }

  private drawCitadel(townCenterGridX: number, townCenterGridY: number) {
    const layout = citadelLayoutFor(townCenterGridX, townCenterGridY);

    // Stone apron inside the walls, just above the grass and below roads.
    for (let y = layout.innerMinY; y <= layout.innerMaxY; y++) {
      for (let x = layout.innerMinX; x <= layout.innerMaxX; x++) {
        const pos = gridToScreen(x, y);
        const tile = this.scene.add.image(pos.x, pos.y, 'citadel_floor');
        tile.setDepth(-99996);
        this.floorTiles.push(tile);
      }
    }

    // Wall blocks sort by their own tile, like a resource, so a unit walking
    // below a wall is drawn in front of it and one behind is hidden by it.
    for (const wall of layout.walls) {
      const pos = gridToScreen(wall.gridX, wall.gridY);
      const tile = this.scene.add.image(pos.x, pos.y, 'citadel_wall');
      tile.setOrigin(0.5, WALL_BASE_CENTER_Y / WALL_TEXTURE_HEIGHT);
      tile.setDepth(getIsoDepth(wall.gridX, wall.gridY, 12));
      this.wallTiles.push(tile);
    }
  }

  /** Draws the two textures used by every tile of every citadel. */
  private ensureTextures() {
    const scene = this.scene;

    if (!scene.textures.exists('citadel_floor')) {
      const g = scene.add.graphics();
      g.fillStyle(0x7b7f88, 1);
      g.beginPath();
      g.moveTo(64, 0);
      g.lineTo(128, 32);
      g.lineTo(64, 64);
      g.lineTo(0, 32);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0x4f535b, 1);
      g.strokePath();

      // A pair of seams reads as flagstones without needing a tileset.
      g.lineStyle(1, 0x969aa3, 0.55);
      g.beginPath();
      g.moveTo(32, 16);
      g.lineTo(96, 48);
      g.strokePath();
      g.beginPath();
      g.moveTo(96, 16);
      g.lineTo(32, 48);
      g.strokePath();

      g.generateTexture('citadel_floor', TILE_WIDTH, TILE_HEIGHT);
      g.destroy();
    }

    if (!scene.textures.exists('citadel_wall')) {
      const g = scene.add.graphics();
      const baseCenterY = WALL_BASE_CENTER_Y;
      const topCenterY = baseCenterY - WALL_RISE;
      const capInset = 12;

      // Front-left and front-right faces of the wall, drawn from the full-width
      // base up to the narrower cap. The inset cap leaves a small gutter between
      // neighbouring tiles, which reads as crenellation rather than a runway.
      g.fillStyle(0x5b606a, 1);
      g.beginPath();
      g.moveTo(0, baseCenterY);
      g.lineTo(64, baseCenterY + 32);
      g.lineTo(64, topCenterY + 32 - capInset);
      g.lineTo(capInset, topCenterY);
      g.closePath();
      g.fillPath();

      g.fillStyle(0x43474f, 1);
      g.beginPath();
      g.moveTo(64, baseCenterY + 32);
      g.lineTo(128, baseCenterY);
      g.lineTo(128 - capInset, topCenterY);
      g.lineTo(64, topCenterY + 32 - capInset);
      g.closePath();
      g.fillPath();

      // Cap.
      g.fillStyle(0xa4aab4, 1);
      g.beginPath();
      g.moveTo(64, topCenterY - 32 + capInset);
      g.lineTo(128 - capInset, topCenterY);
      g.lineTo(64, topCenterY + 32 - capInset);
      g.lineTo(capInset, topCenterY);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0x33373e, 1);
      g.strokePath();

      // Masonry course halfway up the front faces.
      g.lineStyle(1, 0x767c86, 0.85);
      g.beginPath();
      g.moveTo(0, baseCenterY - WALL_RISE / 2);
      g.lineTo(64, baseCenterY + 32 - WALL_RISE / 2);
      g.lineTo(128, baseCenterY - WALL_RISE / 2);
      g.strokePath();

      // A few vertical joints, so a long wall does not read as one smooth slab.
      g.lineStyle(1, 0x353940, 0.7);
      for (const fraction of [0.3, 0.7]) {
        const x = 64 * fraction;
        g.beginPath();
        g.moveTo(x, baseCenterY - x / 2);
        g.lineTo(x, topCenterY - x / 2 + 32 - capInset);
        g.strokePath();
      }

      g.generateTexture('citadel_wall', TILE_WIDTH, WALL_TEXTURE_HEIGHT);
      g.destroy();
    }
  }
}

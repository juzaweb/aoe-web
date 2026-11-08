import { MapTerrain, TERRAIN_BATTLEFIELD, TILE_HEIGHT, TILE_WIDTH, gridToScreen, screenToGrid } from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import { grassTextureIndex, grassTint, hash2 } from './visualVariation.js';

/**
 * Grass tiles and player-painted road tiles, drawn from pools.
 *
 * A map is up to 220x220 tiles and Phaser has no batching that makes hundreds of
 * thousands of images cheap, so the visible window is rendered from a fixed pool
 * that is repositioned (not recreated) whenever the camera moves far enough.
 * Roads are never baked into the terrain: every road tile comes from the room
 * state, so {@link setPlayerRoads} is the only source.
 */
export class TerrainLayer {
  private tilePool: Phaser.GameObjects.Image[] = [];
  /**
   * Player-painted road tiles of the current room, as `gx,gy` keys, drawn as one
   * dirt quad per tile.
   */
  private playerRoads = new Set<string>();
  private playerRoadTiles: Array<{ gridX: number; gridY: number }> = [];
  private playerRoadPool: Phaser.GameObjects.Image[] = [];
  private unconstructedRoadTiles: Array<{ gridX: number; gridY: number; progress: number }> = [];
  private unconstructedRoadPool: Phaser.GameObjects.Image[] = [];
  private foundationGraphics: Phaser.GameObjects.Graphics | null = null;
  private terrain: MapTerrain = TERRAIN_BATTLEFIELD;
  private lastViewportX = -999999;
  private lastViewportY = -999999;
  private lastViewportZoom = -1;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Pre-allocates the pools. Call once, from create(). */
  create() {
    this.tilePool = [];
    for (let i = 0; i < 6000; i++) {
      const tile = this.scene.add.image(0, 0, 'tile_grass');
      tile.setDepth(-100000);
      tile.setVisible(false);
      this.tilePool.push(tile);
    }

    // One quad per painted tile. The pool grows on demand and is repositioned
    // with the rest of the terrain, so a long road costs only the tiles on
    // screen instead of one object per tile in the map.
    this.playerRoadPool = [];
    this.foundationGraphics = this.scene.add.graphics();
    this.foundationGraphics.setDepth(-99994);
  }

  /**
   * Switches to another map's terrain layout.
   *
   * Safe to call before `create()` (the pools do not exist yet) and after it;
   * either way the next frame repositions every tile for the new map.
   */
  setTerrain(terrain: MapTerrain) {
    this.terrain = terrain;
    this.invalidateViewport();
  }

  /**
   * Replaces the player-painted road set.
   *
   * The scene calls this whenever the room's `roads` map changes. Only the
   * keys are kept: the renderer derives the texture variant from the tile
   * coordinates, so nothing else has to be replicated.
   */
  setPlayerRoads(
    tiles: Iterable<{ gridX: number; gridY: number }>,
    unconstructedTiles: Iterable<{ gridX: number; gridY: number; progress: number }> = []
  ) {
    this.playerRoads.clear();
    this.playerRoadTiles = [];
    for (const tile of tiles) {
      const key = `${tile.gridX},${tile.gridY}`;
      if (this.playerRoads.has(key)) continue;
      this.playerRoads.add(key);
      this.playerRoadTiles.push(tile);
    }
    this.unconstructedRoadTiles = [];
    for (const tile of unconstructedTiles) {
      this.unconstructedRoadTiles.push(tile);
    }
    this.invalidateViewport();
  }

  /** Forces the next frame to reposition the pool (new map, reset camera). */
  invalidateViewport() {
    this.lastViewportX = -999999;
    this.lastViewportY = -999999;
    this.lastViewportZoom = -1;
  }

  /** Repositions the pool for the current viewport. Cheap no-op when idle. */
  render() {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    // Only recalculate when camera has moved more than 16px or zoom changed
    if (
      Math.abs(view.x - this.lastViewportX) < 16 &&
      Math.abs(view.y - this.lastViewportY) < 16 &&
      Math.abs(cam.zoom - this.lastViewportZoom) < 0.01
    ) {
      return;
    }

    this.lastViewportX = view.x;
    this.lastViewportY = view.y;
    this.lastViewportZoom = cam.zoom;

    // Expand margin to prevent edge pop-in during fast scrolling
    const margin = 160;
    const left = view.left - margin;
    const right = view.right + margin;
    const top = view.top - margin;
    const bottom = view.bottom + margin;

    const cTopLeft = screenToGrid(left, top);
    const cTopRight = screenToGrid(right, top);
    const cBottomLeft = screenToGrid(left, bottom);
    const cBottomRight = screenToGrid(right, bottom);

    // Grass covers the whole visible window, not just an apron around the
    // playable tiles. The camera is clamped to the map's bounding box, and an
    // isometric bounding box is far larger than the map diamond itself; filling
    // only a few rings left the corners of the box showing the flat camera
    // clear colour, which reads as endless empty ground when panned to the edge.
    // Roads stay inside the map: the spline generator already clamps to it.
    const minGx = Math.min(cTopLeft.gridX, cTopRight.gridX, cBottomLeft.gridX, cBottomRight.gridX) - 3;
    const maxGx = Math.max(cTopLeft.gridX, cTopRight.gridX, cBottomLeft.gridX, cBottomRight.gridX) + 3;
    const minGy = Math.min(cTopLeft.gridY, cTopRight.gridY, cBottomLeft.gridY, cBottomRight.gridY) - 3;
    const maxGy = Math.max(cTopLeft.gridY, cTopRight.gridY, cBottomLeft.gridY, cBottomRight.gridY) + 3;

    let poolIdx = 0;

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const screenPos = gridToScreen(gx, gy);

        if (
          screenPos.x >= left &&
          screenPos.x <= right &&
          screenPos.y >= top &&
          screenPos.y <= bottom
        ) {
          // Dynamically allocate from pool, expanding on demand if screen is large or zoomed out
          let tile = this.tilePool[poolIdx];
          if (!tile) {
            tile = this.scene.add.image(0, 0, 'tile_grass');
            tile.setDepth(-100000);
            this.tilePool.push(tile);
          }
          poolIdx++;

          // Hashed per tile. The old picker was `(gx * 7 + gy * 13) % 3`, which
          // is `(gx + gy) % 3` and painted diagonal stripes across the map.
          const variant = grassTextureIndex(gx, gy);
          const texKey = this.scene.textures.exists(`tile_grass_${variant}`)
            ? `tile_grass_${variant}`
            : 'tile_grass';
          if (tile.texture.key !== texKey) {
            tile.setTexture(texKey);
          }

          tile.setPosition(screenPos.x, screenPos.y);
          tile.setTint(grassTint(gx, gy));
          tile.setVisible(true);
        }
      }
    }

    // Hide remaining unused tiles
    const totalPooled = this.tilePool.length;
    while (poolIdx < totalPooled) {
      this.tilePool[poolIdx++].setVisible(false);
    }

    // Player-painted road tiles sit on the ground layer, one dirt quad each.
    let playerRoadIdx = 0;
    for (const tile of this.playerRoadTiles) {
      if (tile.gridX < minGx || tile.gridX > maxGx || tile.gridY < minGy || tile.gridY > maxGy) continue;

      let image = this.playerRoadPool[playerRoadIdx];
      if (!image) {
        image = this.scene.add.image(0, 0, 'tile_dirt');
        image.setDepth(-99995);
        image.setVisible(false);
        this.playerRoadPool.push(image);
      }
      playerRoadIdx++;

      const variant = (Math.floor(hash2(tile.gridX, tile.gridY, 0x7a11) * 3) % 3) + 1;
      const texKey = this.scene.textures.exists(`tile_dirt_${variant}`)
        ? `tile_dirt_${variant}`
        : 'tile_dirt';
      if (image.texture.key !== texKey) image.setTexture(texKey);

      const pos = gridToScreen(tile.gridX, tile.gridY);
      image.setPosition(pos.x, pos.y);
      // A slight per-tile tint variation keeps a long straight road from
      // reading as one repeated stamp.
      const shade = 232 + Math.floor(hash2(tile.gridX, tile.gridY, 0x5b3c) * 23);
      image.setTint((shade << 16) | (shade << 8) | shade);
      image.setAlpha(1.0);
      image.setVisible(true);
    }
    for (let i = playerRoadIdx; i < this.playerRoadPool.length; i++) {
      this.playerRoadPool[i].setVisible(false);
    }

    // Unconstructed road tiles (foundations)
    let unbuiltIdx = 0;
    const halfW = TILE_WIDTH / 2;
    const halfH = TILE_HEIGHT / 2;

    if (this.foundationGraphics) {
      this.foundationGraphics.clear();
      this.foundationGraphics.lineStyle(1.5, 0xf59e0b, 0.85);
      this.foundationGraphics.beginPath();
    }

    for (const tile of this.unconstructedRoadTiles) {
      if (tile.gridX < minGx || tile.gridX > maxGx || tile.gridY < minGy || tile.gridY > maxGy) continue;

      let image = this.unconstructedRoadPool[unbuiltIdx];
      if (!image) {
        image = this.scene.add.image(0, 0, 'tile_dirt');
        image.setDepth(-99995);
        image.setVisible(false);
        this.unconstructedRoadPool.push(image);
      }
      unbuiltIdx++;

      const variant = (Math.floor(hash2(tile.gridX, tile.gridY, 0x7a11) * 3) % 3) + 1;
      const texKey = this.scene.textures.exists(`tile_dirt_${variant}`)
        ? `tile_dirt_${variant}`
        : 'tile_dirt';
      if (image.texture.key !== texKey) image.setTexture(texKey);

      const pos = gridToScreen(tile.gridX, tile.gridY);
      image.setPosition(pos.x, pos.y);
      const shade = 210 + Math.floor(hash2(tile.gridX, tile.gridY, 0x5b3c) * 23);
      image.setTint((shade << 16) | (shade << 8) | shade);
      image.setAlpha(0.45);
      image.setVisible(true);

      if (this.foundationGraphics) {
        this.foundationGraphics.moveTo(pos.x, pos.y - halfH);
        this.foundationGraphics.lineTo(pos.x + halfW, pos.y);
        this.foundationGraphics.lineTo(pos.x, pos.y + halfH);
        this.foundationGraphics.lineTo(pos.x - halfW, pos.y);
        this.foundationGraphics.closePath();
      }
    }

    this.foundationGraphics?.strokePath();

    for (let i = unbuiltIdx; i < this.unconstructedRoadPool.length; i++) {
      this.unconstructedRoadPool[i].setVisible(false);
    }
  }
}

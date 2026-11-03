import {
  MapTerrain,
  RoadSplinePoint,
  TERRAIN_BATTLEFIELD,
  getRoadSplinePoints,
  gridToScreen,
  screenToGrid
} from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import { MAP_APRON_TILES } from './decorScatter.js';
import { grassTextureIndex, grassTint, roadStampLook } from './visualVariation.js';

/**
 * Grass tiles and dirt-road stamps, drawn from pools.
 *
 * A map is up to 220x220 tiles and Phaser has no batching that makes hundreds of
 * thousands of images cheap, so the visible window is rendered from a fixed pool
 * that is repositioned (not recreated) whenever the camera moves far enough.
 * The road spline depends on the map's layout (kingdom vs battlefield) and is
 * swapped by {@link setTerrain} when the scene joins a different room.
 */
export class TerrainLayer {
  private tilePool: Phaser.GameObjects.Image[] = [];
  private roadStampPool: Phaser.GameObjects.Image[] = [];
  /** Smaller, fainter stamps that widen the worn edge of a road. */
  private roadShoulderPool: Phaser.GameObjects.Image[] = [];
  private allRoadPoints: RoadSplinePoint[] = [];
  private terrain: MapTerrain = TERRAIN_BATTLEFIELD;
  private lastViewportX = -999999;
  private lastViewportY = -999999;
  private lastViewportZoom = -1;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Pre-allocates the pools and caches the road spline. Call once, from create(). */
  create() {
    this.tilePool = [];
    for (let i = 0; i < 6000; i++) {
      const tile = this.scene.add.image(0, 0, 'tile_grass');
      tile.setDepth(-100000);
      tile.setVisible(false);
      this.tilePool.push(tile);
    }

    this.allRoadPoints = getRoadSplinePoints(this.terrain);

    this.roadStampPool = [];
    for (let i = 0; i < 700; i++) {
      const stamp = this.scene.add.image(0, 0, 'road_stamp_1');
      stamp.setDepth(-99990);
      stamp.setVisible(false);
      this.roadStampPool.push(stamp);
    }

    // About a quarter of the road points get a shoulder, so this pool only has
    // to cover that fraction of the main one.
    this.roadShoulderPool = [];
    for (let i = 0; i < 260; i++) {
      const shoulder = this.scene.add.image(0, 0, 'road_stamp_2');
      shoulder.setDepth(-99991);
      shoulder.setAlpha(0.55);
      shoulder.setVisible(false);
      this.roadShoulderPool.push(shoulder);
    }
  }

  /**
   * Switches to another map's terrain layout.
   *
   * Safe to call before `create()` (the pools do not exist yet) and after it;
   * either way the next frame repositions every stamp from the new spline.
   */
  setTerrain(terrain: MapTerrain) {
    this.terrain = terrain;
    this.allRoadPoints = getRoadSplinePoints(terrain);
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

    // Grass extends past the playable edge so the border forest has ground to
    // stand on instead of the flat camera clear colour. Roads stay inside the
    // map: the spline generator already clamps to it.
    const minGx = Math.max(-MAP_APRON_TILES, Math.min(cTopLeft.gridX, cTopRight.gridX, cBottomLeft.gridX, cBottomRight.gridX) - 3);
    const maxGx = Math.min(this.terrain.width - 1 + MAP_APRON_TILES, Math.max(cTopLeft.gridX, cTopRight.gridX, cBottomLeft.gridX, cBottomRight.gridX) + 3);
    const minGy = Math.max(-MAP_APRON_TILES, Math.min(cTopLeft.gridY, cTopRight.gridY, cBottomLeft.gridY, cBottomRight.gridY) - 3);
    const maxGy = Math.min(this.terrain.height - 1 + MAP_APRON_TILES, Math.max(cTopLeft.gridY, cTopRight.gridY, cBottomLeft.gridY, cBottomRight.gridY) + 3);

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

    // Render continuous organic AoE dirt roads over seamless grass (zero diamond stair-steps)
    let roadPoolIdx = 0;
    let shoulderPoolIdx = 0;
    const roadMargin = 140;
    const rLeft = left - roadMargin;
    const rRight = right + roadMargin;
    const rTop = top - roadMargin;
    const rBottom = bottom + roadMargin;

    const roadPointsLen = this.allRoadPoints.length;
    for (let i = 0; i < roadPointsLen; i++) {
      const rp = this.allRoadPoints[i];
      if (rp.x >= rLeft && rp.x <= rRight && rp.y >= rTop && rp.y <= rBottom) {
        let stamp = this.roadStampPool[roadPoolIdx];
        if (!stamp) {
          stamp = this.scene.add.image(0, 0, 'road_stamp');
          stamp.setDepth(-99990);
          this.roadStampPool.push(stamp);
        }
        roadPoolIdx++;

        const stampKey = `road_stamp_${rp.variant}`;
        if (stamp.texture.key !== stampKey && this.scene.textures.exists(stampKey)) {
          stamp.setTexture(stampKey);
        }

        // The tangent comes from the previous dense spline point. A jump larger
        // than a few tiles means a different route (or the hub ring), so the
        // stamp falls back to axis-aligned instead of pointing at the gap.
        const prev = this.allRoadPoints[i - 1];
        let angle = 0;
        if (prev) {
          const dx = rp.x - prev.x;
          const dy = rp.y - prev.y;
          if (Math.hypot(dx, dy) < 40) angle = Math.atan2(dy, dx);
        }
        const look = roadStampLook(rp.x, rp.y, angle, i);
        stamp.setPosition(rp.x + look.offsetX, rp.y + look.offsetY);
        stamp.setRotation(look.angle);
        stamp.setScale(look.scale);
        stamp.setTint(look.tint);
        stamp.setVisible(true);

        if (look.shoulderScale !== null) {
          let shoulder = this.roadShoulderPool[shoulderPoolIdx];
          if (!shoulder) {
            shoulder = this.scene.add.image(0, 0, 'road_stamp_2');
            shoulder.setDepth(-99991);
            shoulder.setAlpha(0.55);
            this.roadShoulderPool.push(shoulder);
          }
          shoulderPoolIdx++;
          const shoulderKey = `road_stamp_${((rp.variant + 1) % 3) + 1}`;
          if (shoulder.texture.key !== shoulderKey && this.scene.textures.exists(shoulderKey)) {
            shoulder.setTexture(shoulderKey);
          }
          // Pushed further out along the same perpendicular as the main offset,
          // which is what turns one clean band into a worn edge.
          shoulder.setPosition(rp.x + look.offsetX * 6, rp.y + look.offsetY * 6);
          shoulder.setRotation(look.angle);
          shoulder.setScale(look.shoulderScale);
          shoulder.setTint(look.tint);
          shoulder.setVisible(true);
        }
      }
    }

    // Hide remaining unused road stamps
    const totalRoadPooled = this.roadStampPool.length;
    while (roadPoolIdx < totalRoadPooled) {
      this.roadStampPool[roadPoolIdx++].setVisible(false);
    }
    const totalShoulderPooled = this.roadShoulderPool.length;
    while (shoulderPoolIdx < totalShoulderPooled) {
      this.roadShoulderPool[shoulderPoolIdx++].setVisible(false);
    }
  }
}

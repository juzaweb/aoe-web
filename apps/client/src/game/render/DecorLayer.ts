import { MapTerrain, citadelLayoutFor, getIsoDepth, gridToScreen, screenToGrid } from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import { decorTextureKey } from './decorArt.js';
import {
  MAP_APRON_TILES,
  borderDecorAt,
  canopyDecor,
  decorAt,
  tileKey
} from './decorScatter.js';
import type { DecorChoice, DecorCategory } from './decorScatter.js';
import { hash2 } from './visualVariation.js';

/** Zoom below which the small ground cover is dropped (it would be sub-pixel). */
const FORB_LOD_ZOOM = 0.55;

/**
 * Renders the decorative ground cover and the border forest.
 *
 * Same pooling strategy as {@link TerrainLayer}: the visible window is laid out
 * once per camera move into pre-allocated images, never recreated. Decor is not
 * interactive and never enters the room state, so it cannot affect selection,
 * pathfinding or hit-testing.
 */
export class DecorLayer {
  private forbPool: Phaser.GameObjects.Image[] = [];
  private rockPool: Phaser.GameObjects.Image[] = [];
  private borderPool: Phaser.GameObjects.Image[] = [];
  private lastViewportX = -999999;
  private lastViewportY = -999999;
  private lastViewportZoom = -1;

  constructor(private readonly scene: WorldScene) {}

  /** Pools grow on demand: a 4K window at min zoom needs far fewer than a map. */
  create() {
    this.forbPool = [];
    this.rockPool = [];
    this.borderPool = [];
  }

  invalidateViewport() {
    this.lastViewportX = -999999;
    this.lastViewportY = -999999;
    this.lastViewportZoom = -1;
  }

  /** Lays out the visible decor. Cheap no-op while the camera is still. */
  render() {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
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

    const terrain = this.scene.terrainLayout;
    const margin = 220;
    const bounds = this.tileBounds(view.left - margin, view.top - margin, view.right + margin, view.bottom + margin, terrain);
    const blocked = this.collectBlocked(bounds);
    const showForbs = cam.zoom >= FORB_LOD_ZOOM;

    let forbIdx = 0;
    let rockIdx = 0;
    let borderIdx = 0;

    for (let gy = bounds.minGy; gy <= bounds.maxGy; gy++) {
      for (let gx = bounds.minGx; gx <= bounds.maxGx; gx++) {
        const inside = gx >= 0 && gy >= 0 && gx < terrain.width && gy < terrain.height;
        const choice = inside ? decorAt(gx, gy, terrain, blocked) : borderDecorAt(gx, gy, terrain);
        if (!choice) continue;
        if (choice.category === 'border-tree') {
          const image = this.poolImage('border-tree', borderIdx++);
          this.place(image, choice, gx, gy);
        } else if (choice.category === 'rock') {
          const image = this.poolImage('rock', rockIdx++);
          this.place(image, choice, gx, gy);
        } else if (showForbs) {
          const image = this.poolImage('forb', forbIdx++);
          this.place(image, choice, gx, gy);
        }
      }
    }

    // Tufts around resource trees tie the trunks to the ground. The trees are
    // already placed by `EntityRenderer`, so this only reads their tile.
    if (showForbs) {
      for (const [id, container] of this.scene.resourceSprites) {
        if (!container.visible) continue;
        if (container.getData('resourceType') !== 'TREE') continue;
        const gx = container.getData('gridX') as number | undefined;
        const gy = container.getData('gridY') as number | undefined;
        if (gx === undefined || gy === undefined) continue;
        if (gx < bounds.minGx || gx > bounds.maxGx || gy < bounds.minGy || gy > bounds.maxGy) continue;
        for (const choice of canopyDecor(id, gx, gy)) {
          const image = this.poolImage('forb', forbIdx++);
          this.place(image, choice, gx, gy);
        }
      }
    }

    this.hideUnused(this.forbPool, forbIdx);
    this.hideUnused(this.rockPool, rockIdx);
    this.hideUnused(this.borderPool, borderIdx);
  }

  /** Sway. Called every frame; rotation pivots on the bottom origin. */
  update(time: number) {
    const seconds = time * 0.001;
    for (const image of this.forbPool) {
      if (!image.visible) continue;
      const phase = (image.getData('phase') as number | undefined) ?? 0;
      image.setRotation(Math.sin(seconds * 1.1 + phase) * 0.026);
    }
    for (const image of this.borderPool) {
      if (!image.visible) continue;
      const phase = (image.getData('phase') as number | undefined) ?? 0;
      image.setRotation(Math.sin(seconds * 0.45 + phase) * 0.007);
    }
  }

  private poolImage(category: DecorCategory, index: number): Phaser.GameObjects.Image {
    const pool = category === 'rock' ? this.rockPool : category === 'border-tree' ? this.borderPool : this.forbPool;
    let image = pool[index];
    if (!image) {
      image = this.scene.add.image(0, 0, decorTextureKey(category, 1));
      image.setOrigin(0.5, 1);
      image.setVisible(false);
      pool.push(image);
    }
    return image;
  }

  private place(
    image: Phaser.GameObjects.Image,
    choice: DecorChoice,
    gx: number,
    gy: number
  ) {
    const key = decorTextureKey(choice.category, choice.variant);
    // A missing file (bad manifest sync) must drop the decoration, not render
    // Phaser's green "missing texture" box over the map.
    if (!this.scene.textures.exists(key)) {
      image.setVisible(false);
      return;
    }
    image.setTexture(key);
    const screen = gridToScreen(gx, gy);
    const jitterX = (hash2(gx, gy, 0xdead) - 0.5) * 34;
    const jitterY = (hash2(gx, gy, 0xbeef) - 0.5) * 14;
    image.setPosition(screen.x + jitterX, screen.y + jitterY);
    image.setScale(choice.scale);
    image.setFlipX(choice.flipX);
    image.setDepth(getIsoDepth(gx, gy, 5));
    image.setData('phase', choice.phase);
    image.setVisible(true);
  }

  private hideUnused(pool: Phaser.GameObjects.Image[], used: number) {
    for (let i = used; i < pool.length; i++) pool[i].setVisible(false);
  }

  /**
   * Every tile a resource node, a painted road or a building footprint occupies.
   *
   * Read from the room state when it is available: resource sprites spawn over
   * several frames (`flushResourceSpawns`), so a sprite-based set would let
   * flowers grow under a tree that appears one frame later.
   *
   * Roads are state, so a kingdom can hold thousands of them; only the tiles the
   * current viewport can show are collected, which keeps a pan cheap.
   */
  private collectBlocked(bounds: { minGx: number; maxGx: number; minGy: number; maxGy: number }): Set<string> {
    const blocked = new Set<string>();
    const state = this.scene.room?.state as
      | {
          resourceNodes?: { forEach: (cb: (node: any) => void) => void };
          buildings?: { forEach: (cb: (node: any) => void) => void };
          roads?: { forEach: (cb: (road: any) => void) => void };
        }
      | null
      | undefined;
    if (state?.resourceNodes) {
      state.resourceNodes.forEach((node: any) => {
        blocked.add(tileKey(node.gridX, node.gridY));
      });
    } else {
      for (const container of this.scene.resourceSprites.values()) {
        const gx = container.getData('gridX') as number | undefined;
        const gy = container.getData('gridY') as number | undefined;
        if (gx !== undefined && gy !== undefined) blocked.add(tileKey(gx, gy));
      }
    }
    const townCenters: Array<{ gridX: number; gridY: number }> = [];
    if (state?.roads) {
      state.roads.forEach((road: any) => {
        if (
          road.gridX < bounds.minGx ||
          road.gridX > bounds.maxGx ||
          road.gridY < bounds.minGy ||
          road.gridY > bounds.maxGy
        ) {
          return;
        }
        blocked.add(tileKey(road.gridX, road.gridY));
      });
    }
    if (state?.buildings) {
      state.buildings.forEach((building: any) => {
        for (let y = 0; y < building.sizeY; y++) {
          for (let x = 0; x < building.sizeX; x++) {
            blocked.add(tileKey(building.gridX + x, building.gridY + y));
          }
        }
        if (building.type === 'TOWN_CENTER') townCenters.push(building);
      });
    } else {
      for (const container of this.scene.buildingSprites.values()) {
        const gx = container.getData('gridX') as number | undefined;
        const gy = container.getData('gridY') as number | undefined;
        const sx = (container.getData('sizeX') as number | undefined) ?? 1;
        const sy = (container.getData('sizeY') as number | undefined) ?? 1;
        if (gx === undefined || gy === undefined) continue;
        for (let y = 0; y < sy; y++) {
          for (let x = 0; x < sx; x++) blocked.add(tileKey(gx + x, gy + y));
        }
      }
    }
    // Every tile of a citadel compound is stone, not ground: without this the
    // grass scatter grows tufts and flowers through the wall and the floor.
    for (const townCenter of townCenters) {
      const layout = citadelLayoutFor(townCenter.gridX, townCenter.gridY);
      for (let y = 0; y < layout.sizeY; y++) {
        for (let x = 0; x < layout.sizeX; x++) {
          blocked.add(tileKey(layout.originX + x, layout.originY + y));
        }
      }
    }
    return blocked;
  }

  private tileBounds(left: number, top: number, right: number, bottom: number, terrain: MapTerrain) {
    const corners = [
      screenToGrid(left, top),
      screenToGrid(right, top),
      screenToGrid(left, bottom),
      screenToGrid(right, bottom)
    ];
    const minX = Math.min(...corners.map((c) => c.gridX));
    const maxX = Math.max(...corners.map((c) => c.gridX));
    const minY = Math.min(...corners.map((c) => c.gridY));
    const maxY = Math.max(...corners.map((c) => c.gridY));
    return {
      minGx: Math.max(-MAP_APRON_TILES, minX - 2),
      maxGx: Math.min(terrain.width - 1 + MAP_APRON_TILES, maxX + 2),
      minGy: Math.max(-MAP_APRON_TILES, minY - 2),
      maxGy: Math.min(terrain.height - 1 + MAP_APRON_TILES, maxY + 2)
    };
  }
}

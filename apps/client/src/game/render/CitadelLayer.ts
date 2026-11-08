import {
  CITADEL_GATE_WIDTH,
  TILE_HEIGHT,
  TILE_WIDTH,
  citadelLayoutFor,
  getIsoDepth,
  gridToScreen
} from '@chien-quoc/shared';
import type * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import { CITADEL_WALL_RISE } from './citadelSurface.js';
import {
  TC_PLATFORM_ORIGIN_Y,
  TC_PLATFORM_RISE,
  TC_PLATFORM_TEXTURE
} from './townCenterPlatform.js';

/**
 * Wall block art sizes, in texture pixels.
 *
 * The base diamond (64 px tall) sits at `WALL_BASE_CENTER_Y` and the cap is
 * lifted by `WALL_RISE`, so adjacent 1x1 wall tiles read as one continuous wall
 * rather than as a row of curbs. The numbers must match
 * `scripts/process_citadel_assets.py`, which draws the shipped `citadel/wall.png`.
 */
const WALL_RISE = CITADEL_WALL_RISE;
const WALL_BASE_CENTER_Y = 32 + WALL_RISE;
const WALL_TEXTURE_HEIGHT = WALL_BASE_CENTER_Y + 32;

/**
 * Stair sprite geometry.
 *
 * `citadel/stairs.png` is a two-tile flight anchored on the bottom tile centre,
 * so the top of the art lands on the wall lip at `WALL_RISE`. The numbers match
 * `scripts/process_citadel_assets.py`.
 */
const STAIRS_TEXTURE_WIDTH = 256;
const STAIRS_TEXTURE_HEIGHT = 260;
const STAIRS_ORIGIN_Y = 220 / STAIRS_TEXTURE_HEIGHT;

/**
 * Gate sprite geometry.
 *
 * `citadel/gate.png` is a 512x500 canvas whose 384 px of wall front cover the
 * three gate tiles plus the wall on either side. The origin sits on the middle
 * gate tile's front corner, so the passage lands where the server lets units
 * walk and the wall run continues at the same base line.
 */
const GATE_TEXTURE_WIDTH = 512;
const GATE_TEXTURE_HEIGHT = 500;
const GATE_ORIGIN_Y = 308 / GATE_TEXTURE_HEIGHT;
/**
 * Wall tiles covered by the gate sprite along the east wall.
 *
 * `citadel/gate.png` covers six tiles in total: 1 tile north of the gateway
 * (the north flanking tower), the 3 gateway tiles, and 2 tiles south (the south
 * tower plus the wall front extending to b_b). Symmetrical +-3 from middle
 * skipped seven tiles instead of six, leaving a 1-tile gap north of the gate.
 */
export const GATE_COVER_NORTH_TILES = 1;
export const GATE_COVER_SOUTH_TILES = 2;

export function citadelGateCoveredYRange(gates: readonly { gridY: number }[]): {
  coveredFrom: number;
  coveredTo: number;
} {
  if (gates.length === 0) {
    return { coveredFrom: 0, coveredTo: -1 };
  }
  const minY = Math.min(...gates.map((g) => g.gridY));
  const maxY = Math.max(...gates.map((g) => g.gridY));
  return {
    coveredFrom: minY - GATE_COVER_NORTH_TILES,
    coveredTo: maxY + GATE_COVER_SOUTH_TILES
  };
}

/** Portcullis drawn inside the arch, in gate-texture pixels. */
const GATE_DOOR = { x: 160, y: 219, width: 192, height: 169 };

/** How close a unit has to be to the gate centre before it lifts, in tiles. */
const GATE_OPEN_RADIUS = 3.2;
/** Milliseconds for the portcullis to travel from shut to open. */
const GATE_TRAVEL_MS = 260;

interface GateSprite {
  image: Phaser.GameObjects.Image;
  door: Phaser.GameObjects.Image;
  /** Only the citadel owner's units may make the portcullis lift. */
  ownerId: string;
  gridX: number;
  gridY: number;
  /** 0 = shut, 1 = raised. */
  open: number;
}

/**
 * Stone floor, indestructible walls, the gatehouse and the Town Center terrace
 * of every kingdom citadel.
 *
 * The compound is not replicated as entities: it is a pure function of the Town
 * Center's position (see `citadelLayoutFor`), so the client redraws exactly what
 * the server uses for collision. Only a kingdom gets one; the battlefield has no
 * citadel and this layer stays empty.
 *
 * Art is shipped (`assets/citadel/{floor,wall,gate,tc_platform}.png`), built by
 * `scripts/process_citadel_assets.py`. The procedural textures below are only a
 * fallback for a failed load, so a missing file degrades to the old blocky look
 * instead of a green box.
 */
export class CitadelLayer {
  private floorTiles: Phaser.GameObjects.Image[] = [];
  private wallTiles: Phaser.GameObjects.Image[] = [];
  private stairTiles: Phaser.GameObjects.Image[] = [];
  private platforms: Phaser.GameObjects.Image[] = [];
  private gates: GateSprite[] = [];
  /** Town Center positions the current graphics were built from. */
  private signature = '';

  constructor(private readonly scene: WorldScene) {}

  /** Builds the fallback textures once. Call from the scene's create(). */
  create() {
    this.ensureFallbackTextures();
  }

  /** Removes every drawn tile. */
  clear() {
    for (const tile of this.floorTiles) tile.destroy();
    for (const tile of this.wallTiles) tile.destroy();
    for (const tile of this.stairTiles) tile.destroy();
    for (const platform of this.platforms) platform.destroy();
    for (const gate of this.gates) {
      gate.image.destroy();
      gate.door.destroy();
    }
    this.floorTiles = [];
    this.wallTiles = [];
    this.stairTiles = [];
    this.platforms = [];
    this.gates = [];
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
      this.drawCitadel(tc.gridX, tc.gridY, tc.ownerId);
    }
  }

  /**
   * Lifts each portcullis while a unit stands in its gateway.
   *
   * Purely visual: the server already treats the three gate tiles as walkable, so
   * this only stops the gate from looking shut while an army walks through it.
   */
  update(delta: number) {
    if (this.gates.length === 0) return;
    const units = this.scene.room?.state?.units;
    const step = Math.min(1, delta / GATE_TRAVEL_MS);

    for (const gate of this.gates) {
      let wanted = 0;
      units?.forEach((unit: any) => {
        if (wanted === 1) return;
        // The gate is sealed to everyone else, so it must not visibly open for
        // a raider standing on the far side of it.
        if (unit.ownerId !== gate.ownerId) return;
        if (Math.hypot(unit.x - gate.gridX, unit.y - gate.gridY) <= GATE_OPEN_RADIUS) {
          wanted = 1;
        }
      });
      if (gate.open === wanted) continue;

      gate.open = gate.open < wanted ? Math.min(wanted, gate.open + step) : Math.max(wanted, gate.open - step);
      // Smoothstep so the shutter eases out of the arch instead of snapping.
      const eased = gate.open * gate.open * (3 - 2 * gate.open);
      gate.door.setScale(1, Math.max(0.02, 1 - 0.94 * eased));
      gate.door.setAlpha(1 - eased);
    }
  }

  private drawCitadel(
    townCenterGridX: number,
    townCenterGridY: number,
    ownerId: string
  ) {
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

    // Raised terrace under the Town Center. It is drawn here rather than on the
    // building container so the citadel layer can keep it below the walls and
    // units with a plain depth key; `EntityRenderer` lifts the building art by
    // the same `TC_PLATFORM_RISE`.
    const townCenter = layout.slots.find((slot) => slot.type === 'TOWN_CENTER');
    if (townCenter && this.scene.textures.exists(TC_PLATFORM_TEXTURE)) {
      const platformPos = gridToScreen(
        townCenter.gridX + townCenter.sizeX / 2 - 0.5,
        townCenter.gridY + townCenter.sizeY / 2 - 0.5
      );
      const platform = this.scene.add.image(
        platformPos.x,
        platformPos.y - TC_PLATFORM_RISE,
        TC_PLATFORM_TEXTURE
      );
      platform.setOrigin(0.5, TC_PLATFORM_ORIGIN_Y);
      platform.setDepth(
        getIsoDepth(
          townCenter.gridX + townCenter.sizeX,
          townCenter.gridY + townCenter.sizeY,
          14
        )
      );
      this.platforms.push(platform);
    }

    // Wall blocks sort by their own tile, like a resource, so a unit walking
    // below a wall is drawn in front of it and one behind is hidden by it.
    // The gate sprite already draws the six tiles of wall it covers, so those
    // blocks are skipped: otherwise a nearer wall block would cut the gate in
    // half, because one sprite can only carry one depth key.
    // Stairs sit on the courtyard side of the wall, under the wall blocks so a
    // unit climbing is drawn in front of the flight.
    for (const stair of layout.stairs) {
      const pos = gridToScreen(stair.bottom.gridX, stair.bottom.gridY);
      const tile = this.scene.add.image(pos.x, pos.y, 'citadel_stairs');
      tile.setOrigin(0.5, STAIRS_ORIGIN_Y);
      // Key the flight on its bottom tile so a unit climbing it (depth offset
      // 25) is drawn above the treads rather than behind them.
      tile.setDepth(getIsoDepth(stair.bottom.gridX, stair.bottom.gridY, 11));
      this.stairTiles.push(tile);
    }

    const { coveredFrom, coveredTo } = citadelGateCoveredYRange(layout.gates);
    const coveredX = layout.originX + layout.sizeX - 1;
    const hasGate = this.scene.textures.exists('citadel_gate');
    for (const wall of layout.walls) {
      if (
        hasGate &&
        wall.gridX === coveredX &&
        wall.gridY >= coveredFrom &&
        wall.gridY <= coveredTo
      ) {
        continue;
      }
      const pos = gridToScreen(wall.gridX, wall.gridY);
      const tile = this.scene.add.image(pos.x, pos.y, 'citadel_wall');
      tile.setOrigin(0.5, WALL_BASE_CENTER_Y / WALL_TEXTURE_HEIGHT);
      tile.setDepth(getIsoDepth(wall.gridX, wall.gridY, 12));
      this.wallTiles.push(tile);
    }

    this.drawGate(layout.gates, ownerId, coveredFrom);
  }

  /**
   * Places the gatehouse over the open tiles in the middle of the east wall.
   *
   * The sprite covers six tiles of wall front (1 tile north of the doorway, 3 doorway
   * tiles, and 2 tiles south), centred on the middle gate tile. Only one gate
   * exists per citadel today, but the loop keeps the contract explicit.
   */
  private drawGate(
    gates: { gridX: number; gridY: number }[],
    ownerId: string,
    coveredFrom: number
  ) {
    if (gates.length === 0) return;
    // No gate art means no gate: an untextured 512x500 rectangle would be worse
    // than the plain wall run, so the citadel degrades to the old look.
    if (!this.scene.textures.exists('citadel_gate')) return;
    const middle = gates[Math.floor(CITADEL_GATE_WIDTH / 2)] ?? gates[0];
    const pos = gridToScreen(middle.gridX, middle.gridY);

    const image = this.scene.add.image(pos.x, pos.y, 'citadel_gate');
    image.setOrigin(0.5, GATE_ORIGIN_Y);
    // Key the sprite on the northernmost covered tile so a unit walking the
    // gate roof (depth offset 30) sorts above it at every covered tile.
    image.setDepth(getIsoDepth(middle.gridX, coveredFrom, 12));

    // The portcullis texture is already skewed to the arch, so it is placed at
    // the arch's top-left corner and left alone. Scaling Y from the top retracts
    // it upwards into the lintel without needing a mask.
    const door = this.scene.add.image(
      pos.x - GATE_TEXTURE_WIDTH / 2 + GATE_DOOR.x,
      pos.y - GATE_TEXTURE_HEIGHT * GATE_ORIGIN_Y + GATE_DOOR.y,
      'citadel_gate_door'
    );
    door.setOrigin(0, 0);
    door.setDepth(getIsoDepth(middle.gridX, coveredFrom, 13));

    this.gates.push({
      image,
      door,
      ownerId,
      gridX: middle.gridX,
      gridY: middle.gridY,
      open: 0
    });
  }

  /** Draws the fallback floor, wall and portcullis textures if a load failed. */
  private ensureFallbackTextures() {
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

    if (!scene.textures.exists('citadel_stairs')) {
      const g = scene.add.graphics();
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const x = 70 + i * 8;
        const y = 220 - i * 11;
        g.fillStyle(0xa4aab4, 1);
        g.fillRect(x - 58, y - 12, 116, 12);
        g.fillStyle(0x5b606a, 1);
        g.fillRect(x - 58, y, 116, 12);
      }
      g.generateTexture('citadel_stairs', STAIRS_TEXTURE_WIDTH, STAIRS_TEXTURE_HEIGHT);
      g.destroy();
    }

    if (!scene.textures.exists('citadel_gate_door')) {
      const g = scene.add.graphics();
      const { width, height } = GATE_DOOR;

      g.fillStyle(0x1c1f24, 1);
      g.fillRect(0, 0, width, height);

      g.lineStyle(2, 0x4a4f58, 1);
      for (let x = 8; x < width; x += 10) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, height);
        g.strokePath();
      }

      g.lineStyle(3, 0x3c4149, 1);
      for (const fraction of [0.2, 0.55, 0.9]) {
        const y = height * fraction;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(width, y);
        g.strokePath();
      }

      g.generateTexture('citadel_gate_door', width, height);
      g.destroy();
    }
  }
}

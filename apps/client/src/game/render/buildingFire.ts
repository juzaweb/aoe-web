import type * as Phaser from 'phaser';
import { TILE_WIDTH } from '@chien-quoc/shared';

/**
 * Share of max HP below which a finished building is visibly on fire.
 *
 * The health bar already turns amber at this boundary, so the flames and the
 * bar tell the same story. Strictly below: a building sitting exactly on 50 %
 * is still "half healthy" and stays clean.
 */
export const BURN_HP_RATIO = 0.5;

/** Procedural textures, generated on the first burning building of a scene. */
const FLAME_TEXTURE = 'fx_fire_flame';
const SMOKE_TEXTURE = 'fx_fire_smoke';

/** The minimum a building needs to expose for the burn rule. */
export interface BurningBuildingState {
  isConstructed?: boolean;
  hp?: number;
  maxHp?: number;
}

/** What the effect reads from a building on top of its health. */
export interface BuildingFireSnapshot extends BurningBuildingState {
  sizeX?: number;
}

/**
 * Whether a building should burn.
 *
 * A foundation is never on fire (its hp is a construction bar, not damage), a
 * destroyed building is not drawn at all, and a heal or repair above the
 * threshold puts the flames out.
 */
export function isBuildingBurning(building: BurningBuildingState | null | undefined): boolean {
  if (!building || building.isConstructed !== true) return false;

  const hp = building.hp;
  const maxHp = building.maxHp;
  if (typeof hp !== 'number' || typeof maxHp !== 'number') return false;
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return false;
  if (hp <= 0) return false;

  return hp / maxHp < BURN_HP_RATIO;
}

/** The two emitters attached to one building container. */
interface BuildingFire {
  flame: Phaser.GameObjects.Particles.ParticleEmitter;
  smoke: Phaser.GameObjects.Particles.ParticleEmitter;
}

/** Where the fire sits in container space, derived from the drawn artwork. */
interface FireOrigin {
  y: number;
  spread: number;
}

function fireOrigin(
  container: Phaser.GameObjects.Container,
  building: BuildingFireSnapshot
): FireOrigin {
  const image = container.getData('buildingImage') as Phaser.GameObjects.Image | undefined;
  // Start a little below the top edge so the flames read as coming out of the
  // roof rather than floating above it. A missing image (should not happen for
  // a constructed building) falls back to the container origin.
  const topY = image
    ? image.y - image.displayHeight / 2 + Math.min(18, image.displayHeight * 0.12)
    : -20;
  const footprint = Math.max(1, building?.sizeX ?? 1) * TILE_WIDTH;
  return {
    y: topY,
    spread: Math.max(10, Math.min(46, footprint / 4))
  };
}

/**
 * Draws the two soft blobs the emitters reuse. Canvas rather than shader so the
 * effect also works on the WebGL fallback and costs two textures per scene.
 */
function ensureBuildingFireTextures(scene: Phaser.Scene) {
  if (typeof document === 'undefined') return;

  if (!scene.textures.exists(FLAME_TEXTURE)) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(16, 30, 0, 16, 30, 18);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.8)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      // An upright ellipse reads as a flame tongue rather than a round puff.
      ctx.save();
      ctx.translate(16, 26);
      ctx.scale(0.62, 1.15);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
      scene.textures.addCanvas(FLAME_TEXTURE, canvas);
    }
  }

  if (!scene.textures.exists(SMOKE_TEXTURE)) {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(20, 20, 0, 20, 20, 20);
      gradient.addColorStop(0, 'rgba(255,255,255,0.75)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.arc(20, 20, 20, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      scene.textures.addCanvas(SMOKE_TEXTURE, canvas);
    }
  }
}

function createEmitters(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  building: BuildingFireSnapshot
): BuildingFire | null {
  ensureBuildingFireTextures(scene);
  // A canvas context can be unavailable (tests, an exotic renderer). Skip the
  // effect rather than asking Phaser for a texture that was never created.
  if (!scene.textures.exists(FLAME_TEXTURE) || !scene.textures.exists(SMOKE_TEXTURE)) {
    return null;
  }
  const origin = fireOrigin(container, building);

  const flame = scene.add.particles(0, origin.y, FLAME_TEXTURE, {
    x: { min: -origin.spread, max: origin.spread },
    speedY: { min: -95, max: -55 },
    speedX: { min: -14, max: 14 },
    lifespan: { min: 380, max: 780 },
    scale: { start: 0.9, end: 0.1 },
    alpha: { start: 0.95, end: 0 },
    tint: [0xffe066, 0xffab2e, 0xf97316, 0xef4444],
    blendMode: 'ADD',
    frequency: 45,
    quantity: 1
  });

  const smoke = scene.add.particles(0, origin.y - 8, SMOKE_TEXTURE, {
    x: { min: -origin.spread * 0.5, max: origin.spread * 0.5 },
    speedY: { min: -52, max: -26 },
    speedX: { min: -8, max: 8 },
    lifespan: { min: 1200, max: 2000 },
    scale: { start: 0.32, end: 1 },
    alpha: { start: 0.3, end: 0 },
    tint: 0x6b7280,
    frequency: 150,
    quantity: 1
  });

  // Insert directly above the artwork so the health bar and level badge stay
  // legible while the building is burning. Lazy creation means other buildings
  // never pay for the emitters.
  const image = container.getData('buildingImage') as
    | Phaser.GameObjects.Image
    | undefined;
  const insertAt = image ? container.getIndex(image) + 1 : container.length;
  container.addAt(flame, insertAt);
  container.addAt(smoke, insertAt + 1);

  return { flame, smoke };
}

function reposition(fire: BuildingFire, y: number) {
  // Only the vertical anchor moves: a building's footprint (and therefore the
  // horizontal spread) cannot change after it was placed.
  fire.flame.setPosition(0, y);
  fire.smoke.setPosition(0, y - 8);
}

/**
 * Starts or stops the flames for one building after an hp/level change.
 *
 * Emitters are created lazily and stopped rather than destroyed, so light
 * damage oscillation does not allocate a new emitter pair each time. The
 * container owns them: removing the building destroys both.
 */
export function syncBuildingFire(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  building: BuildingFireSnapshot
) {
  let fire = container.getData('buildingFire') as BuildingFire | undefined;
  const burning = isBuildingBurning(building);

  if (!burning) {
    if (fire) {
      if (fire.flame.emitting) fire.flame.stop();
      if (fire.smoke.emitting) fire.smoke.stop();
    }
    return;
  }

  if (!fire) {
    const created = createEmitters(scene, container, building);
    if (!created) return;
    fire = created;
    container.setData('buildingFire', fire);
  } else {
    // A tier swap moves the artwork, and the fire has to move with it.
    reposition(fire, fireOrigin(container, building).y);
  }

  if (!fire.flame.emitting) fire.flame.start();
  if (!fire.smoke.emitting) fire.smoke.start();
}

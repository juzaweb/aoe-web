import type * as Phaser from 'phaser';

/**
 * Phaser blend mode for additive particle blending (Phaser.BlendModes.ADD = 1).
 * Kept as numeric constant so the module can import types only and run in test runners
 * without requiring browser window/navigator globals.
 */
const BLEND_MODE_ADD = 1;

/**
 * Damage severity tiers for the Town Center fire effect.
 *
 *   - 'none': HP >= 50% or building not constructed yet.
 *   - 'moderate': 25% <= HP < 50% (light flames and rising smoke).
 *   - 'heavy': HP < 25% (intense roaring fire and heavy billowing smoke).
 */
export type DamageSeverity = 'none' | 'moderate' | 'heavy';

/**
 * Computes damage severity tier based on building construction state and HP ratio.
 */
export function getDamageSeverity(
  hp: number,
  maxHp: number,
  isConstructed: boolean
): DamageSeverity {
  if (!isConstructed || !Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) {
    return 'none';
  }
  const ratio = hp / maxHp;
  if (ratio < 0.25) return 'heavy';
  if (ratio < 0.5) return 'moderate';
  return 'none';
}

/**
 * Ensures procedural canvas textures for fire, smoke, and ember particles exist
 * in the Phaser texture manager.
 */
export function ensureFireParticleTextures(scene: Phaser.Scene): void {
  if (!scene?.textures) return;

  // 1. Soft radial fire particle
  if (!scene.textures.exists('particle_fire')) {
    const canvas = scene.textures.createCanvas('particle_fire', 16, 16);
    if (canvas?.context) {
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.25, 'rgba(255, 220, 50, 0.95)');
      grad.addColorStop(0.6, 'rgba(249, 115, 22, 0.7)');
      grad.addColorStop(0.85, 'rgba(220, 38, 38, 0.3)');
      grad.addColorStop(1, 'rgba(150, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
      canvas.refresh();
    }
  }

  // 2. Soft expanding smoke cloud particle
  if (!scene.textures.exists('particle_smoke')) {
    const canvas = scene.textures.createCanvas('particle_smoke', 32, 32);
    if (canvas?.context) {
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(55, 65, 81, 0.6)');
      grad.addColorStop(0.4, 'rgba(31, 41, 55, 0.4)');
      grad.addColorStop(0.8, 'rgba(17, 24, 39, 0.15)');
      grad.addColorStop(1, 'rgba(10, 10, 10, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
      canvas.refresh();
    }
  }

  // 3. Bright ember spark particle
  if (!scene.textures.exists('particle_ember')) {
    const canvas = scene.textures.createCanvas('particle_ember', 8, 8);
    if (canvas?.context) {
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
      grad.addColorStop(0, 'rgba(255, 255, 220, 1)');
      grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.85)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 8, 8);
      canvas.refresh();
    }
  }
}

/**
 * Manages procedural particle emitters for Town Center fire and smoke effects.
 */
export class TownCenterFireEffect {
  private currentSeverity: DamageSeverity = 'none';
  private moderateSmoke?: Phaser.GameObjects.Particles.ParticleEmitter;
  private moderateFire?: Phaser.GameObjects.Particles.ParticleEmitter;

  private heavySmoke1?: Phaser.GameObjects.Particles.ParticleEmitter;
  private heavySmoke2?: Phaser.GameObjects.Particles.ParticleEmitter;
  private heavyFire1?: Phaser.GameObjects.Particles.ParticleEmitter;
  private heavyFire2?: Phaser.GameObjects.Particles.ParticleEmitter;
  private heavyFire3?: Phaser.GameObjects.Particles.ParticleEmitter;
  private heavyEmbers?: Phaser.GameObjects.Particles.ParticleEmitter;

  private isDestroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly container: Phaser.GameObjects.Container
  ) {
    ensureFireParticleTextures(scene);
    this.createEmitters();
  }

  /**
   * Builds the particle emitters and attaches them to the Town Center container.
   */
  private createEmitters(): void {
    if (!this.scene.add?.particles) return;

    // --- Moderate damage emitters ---
    // Single light smoke plume from roof
    this.moderateSmoke = this.scene.add.particles(-20, -180, 'particle_smoke', {
      emitting: false,
      frequency: 130,
      lifespan: { min: 900, max: 1500 },
      speedY: { min: -35, max: -65 },
      speedX: { min: -10, max: 15 },
      scale: { start: 0.35, end: 1.1 },
      alpha: { start: 0.45, end: 0 }
    });

    // Single small licking flame
    this.moderateFire = this.scene.add.particles(-20, -165, 'particle_fire', {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 85,
      lifespan: { min: 350, max: 600 },
      speedY: { min: -25, max: -50 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.4, end: 0.1 },
      alpha: { start: 0.9, end: 0 }
    });

    // --- Heavy damage emitters ---
    // Billowing smoke columns
    this.heavySmoke1 = this.scene.add.particles(-45, -160, 'particle_smoke', {
      emitting: false,
      frequency: 75,
      lifespan: { min: 1100, max: 1800 },
      speedY: { min: -40, max: -80 },
      speedX: { min: -12, max: 18 },
      scale: { start: 0.45, end: 1.8 },
      alpha: { start: 0.65, end: 0 }
    });

    this.heavySmoke2 = this.scene.add.particles(35, -180, 'particle_smoke', {
      emitting: false,
      frequency: 80,
      lifespan: { min: 1000, max: 1700 },
      speedY: { min: -35, max: -75 },
      speedX: { min: -15, max: 15 },
      scale: { start: 0.4, end: 1.6 },
      alpha: { start: 0.6, end: 0 }
    });

    // Roaring fires across multiple sections of the Town Center
    this.heavyFire1 = this.scene.add.particles(-45, -145, 'particle_fire', {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 40,
      lifespan: { min: 450, max: 800 },
      speedY: { min: -35, max: -75 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.6, end: 0.15 },
      alpha: { start: 0.95, end: 0 }
    });

    this.heavyFire2 = this.scene.add.particles(0, -190, 'particle_fire', {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 45,
      lifespan: { min: 400, max: 750 },
      speedY: { min: -40, max: -80 },
      speedX: { min: -12, max: 12 },
      scale: { start: 0.55, end: 0.12 },
      alpha: { start: 0.95, end: 0 }
    });

    this.heavyFire3 = this.scene.add.particles(35, -165, 'particle_fire', {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 40,
      lifespan: { min: 420, max: 780 },
      speedY: { min: -35, max: -70 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.5, end: 0.15 },
      alpha: { start: 0.95, end: 0 }
    });

    // Floating embers and sparks
    this.heavyEmbers = this.scene.add.particles(0, -160, 'particle_ember', {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 60,
      lifespan: { min: 700, max: 1200 },
      speedY: { min: -50, max: -110 },
      speedX: { min: -25, max: 25 },
      scale: { start: 0.6, end: 0.1 },
      alpha: { start: 1, end: 0 }
    });

    const allEmitters = [
      this.moderateSmoke,
      this.moderateFire,
      this.heavySmoke1,
      this.heavySmoke2,
      this.heavyFire1,
      this.heavyFire2,
      this.heavyFire3,
      this.heavyEmbers
    ];

    for (const emitter of allEmitters) {
      if (emitter) {
        this.container.add(emitter);
      }
    }
  }

  /**
   * Updates emitter emission based on the current HP and construction progress.
   */
  update(hp: number, maxHp: number, isConstructed: boolean): void {
    if (this.isDestroyed) return;

    const severity = getDamageSeverity(hp, maxHp, isConstructed);
    if (severity === this.currentSeverity) return;
    this.currentSeverity = severity;

    if (severity === 'none') {
      this.stopAll();
    } else if (severity === 'moderate') {
      this.setModerateActive();
    } else if (severity === 'heavy') {
      this.setHeavyActive();
    }
  }

  private setModerateActive(): void {
    // Stop heavy emitters
    this.heavySmoke1?.stop();
    this.heavySmoke2?.stop();
    this.heavyFire1?.stop();
    this.heavyFire2?.stop();
    this.heavyFire3?.stop();
    this.heavyEmbers?.stop();

    // Start moderate emitters
    this.moderateSmoke?.start();
    this.moderateFire?.start();
  }

  private setHeavyActive(): void {
    // Stop moderate emitters
    this.moderateSmoke?.stop();
    this.moderateFire?.stop();

    // Start heavy emitters
    this.heavySmoke1?.start();
    this.heavySmoke2?.start();
    this.heavyFire1?.start();
    this.heavyFire2?.start();
    this.heavyFire3?.start();
    this.heavyEmbers?.start();
  }

  private stopAll(): void {
    this.moderateSmoke?.stop();
    this.moderateFire?.stop();
    this.heavySmoke1?.stop();
    this.heavySmoke2?.stop();
    this.heavyFire1?.stop();
    this.heavyFire2?.stop();
    this.heavyFire3?.stop();
    this.heavyEmbers?.stop();
  }

  /**
   * Returns current active damage severity.
   */
  getSeverity(): DamageSeverity {
    return this.currentSeverity;
  }

  /**
   * Destroys all particle emitters and detaches from the container.
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.stopAll();

    const allEmitters = [
      this.moderateSmoke,
      this.moderateFire,
      this.heavySmoke1,
      this.heavySmoke2,
      this.heavyFire1,
      this.heavyFire2,
      this.heavyFire3,
      this.heavyEmbers
    ];

    for (const emitter of allEmitters) {
      if (emitter) {
        try {
          emitter.destroy();
        } catch {
          // Ignore if already destroyed
        }
      }
    }
  }
}

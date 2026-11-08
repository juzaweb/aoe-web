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

interface EmitterSpec {
  x: number;
  y: number;
  texture: string;
  config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;
}

const MODERATE_EMITTER_SPECS: readonly EmitterSpec[] = [
  // Single light smoke plume from roof
  {
    x: -20,
    y: -180,
    texture: 'particle_smoke',
    config: {
      emitting: false,
      frequency: 130,
      lifespan: { min: 900, max: 1500 },
      speedY: { min: -35, max: -65 },
      speedX: { min: -10, max: 15 },
      scale: { start: 0.35, end: 1.1 },
      alpha: { start: 0.45, end: 0 }
    }
  },
  // Single small licking flame
  {
    x: -20,
    y: -165,
    texture: 'particle_fire',
    config: {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 85,
      lifespan: { min: 350, max: 600 },
      speedY: { min: -25, max: -50 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.4, end: 0.1 },
      alpha: { start: 0.9, end: 0 }
    }
  }
];

const HEAVY_EMITTER_SPECS: readonly EmitterSpec[] = [
  // Billowing smoke column 1
  {
    x: -45,
    y: -160,
    texture: 'particle_smoke',
    config: {
      emitting: false,
      frequency: 75,
      lifespan: { min: 1100, max: 1800 },
      speedY: { min: -40, max: -80 },
      speedX: { min: -12, max: 18 },
      scale: { start: 0.45, end: 1.8 },
      alpha: { start: 0.65, end: 0 }
    }
  },
  // Billowing smoke column 2
  {
    x: 35,
    y: -180,
    texture: 'particle_smoke',
    config: {
      emitting: false,
      frequency: 80,
      lifespan: { min: 1000, max: 1700 },
      speedY: { min: -35, max: -75 },
      speedX: { min: -15, max: 15 },
      scale: { start: 0.4, end: 1.6 },
      alpha: { start: 0.6, end: 0 }
    }
  },
  // Roaring fire 1
  {
    x: -45,
    y: -145,
    texture: 'particle_fire',
    config: {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 40,
      lifespan: { min: 450, max: 800 },
      speedY: { min: -35, max: -75 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.6, end: 0.15 },
      alpha: { start: 0.95, end: 0 }
    }
  },
  // Roaring fire 2 (central tower top)
  {
    x: 0,
    y: -190,
    texture: 'particle_fire',
    config: {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 45,
      lifespan: { min: 400, max: 750 },
      speedY: { min: -40, max: -80 },
      speedX: { min: -12, max: 12 },
      scale: { start: 0.55, end: 0.12 },
      alpha: { start: 0.95, end: 0 }
    }
  },
  // Roaring fire 3
  {
    x: 35,
    y: -165,
    texture: 'particle_fire',
    config: {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 40,
      lifespan: { min: 420, max: 780 },
      speedY: { min: -35, max: -70 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.5, end: 0.15 },
      alpha: { start: 0.95, end: 0 }
    }
  },
  // Floating embers and sparks
  {
    x: 0,
    y: -160,
    texture: 'particle_ember',
    config: {
      emitting: false,
      blendMode: BLEND_MODE_ADD,
      frequency: 60,
      lifespan: { min: 700, max: 1200 },
      speedY: { min: -50, max: -110 },
      speedX: { min: -25, max: 25 },
      scale: { start: 0.6, end: 0.1 },
      alpha: { start: 1, end: 0 }
    }
  }
];

/**
 * Manages procedural particle emitters for Town Center fire and smoke effects.
 */
export class TownCenterFireEffect {
  private currentSeverity: DamageSeverity = 'none';
  private readonly emittersBySeverity: Record<
    'moderate' | 'heavy',
    Phaser.GameObjects.Particles.ParticleEmitter[]
  > = {
    moderate: [],
    heavy: []
  };
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

    const buildGroup = (
      severity: 'moderate' | 'heavy',
      specs: readonly EmitterSpec[]
    ) => {
      for (const spec of specs) {
        const emitter = this.scene.add.particles(spec.x, spec.y, spec.texture, spec.config);
        if (emitter) {
          this.container.add(emitter);
          this.emittersBySeverity[severity].push(emitter);
        }
      }
    };

    buildGroup('moderate', MODERATE_EMITTER_SPECS);
    buildGroup('heavy', HEAVY_EMITTER_SPECS);
  }

  /**
   * Updates emitter emission based on the current HP and construction progress.
   */
  update(hp: number, maxHp: number, isConstructed: boolean): void {
    if (this.isDestroyed) return;

    const severity = getDamageSeverity(hp, maxHp, isConstructed);
    if (severity === this.currentSeverity) return;
    this.currentSeverity = severity;

    for (const [tier, emitters] of Object.entries(this.emittersBySeverity)) {
      const active = tier === severity;
      for (const emitter of emitters) {
        if (active) {
          emitter.start();
        } else {
          emitter.stop();
        }
      }
    }
  }

  /**
   * Returns current active damage severity.
   */
  getSeverity(): DamageSeverity {
    return this.currentSeverity;
  }

  /**
   * Returns registered emitters for a given severity tier (used in tests and debugging).
   */
  getEmitters(severity: 'moderate' | 'heavy'): readonly Phaser.GameObjects.Particles.ParticleEmitter[] {
    return this.emittersBySeverity[severity];
  }

  /**
   * Destroys all particle emitters and detaches from the container.
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    for (const emitters of Object.values(this.emittersBySeverity)) {
      for (const emitter of emitters) {
        try {
          emitter.stop();
          emitter.destroy();
        } catch {
          // Ignore if already destroyed
        }
      }
      emitters.length = 0;
    }
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DamageSeverity,
  TownCenterFireEffect,
  ensureFireParticleTextures,
  getDamageSeverity
} from './BuildingFireEffect.js';

describe('getDamageSeverity', () => {
  it('returns none when building is not constructed (foundation)', () => {
    expect(getDamageSeverity(0, 1000, false)).toBe('none');
    expect(getDamageSeverity(200, 1000, false)).toBe('none');
    expect(getDamageSeverity(400, 1000, false)).toBe('none');
    expect(getDamageSeverity(1000, 1000, false)).toBe('none');
  });

  it('returns none when HP is at or above 50% of maxHp', () => {
    expect(getDamageSeverity(1000, 1000, true)).toBe('none');
    expect(getDamageSeverity(750, 1000, true)).toBe('none');
    expect(getDamageSeverity(500, 1000, true)).toBe('none');
  });

  it('returns moderate when HP is between 25% and 50%', () => {
    expect(getDamageSeverity(499, 1000, true)).toBe('moderate');
    expect(getDamageSeverity(300, 1000, true)).toBe('moderate');
    expect(getDamageSeverity(250, 1000, true)).toBe('moderate');
  });

  it('returns heavy when HP is strictly below 25%', () => {
    expect(getDamageSeverity(249, 1000, true)).toBe('heavy');
    expect(getDamageSeverity(100, 1000, true)).toBe('heavy');
    expect(getDamageSeverity(1, 1000, true)).toBe('heavy');
    expect(getDamageSeverity(0, 1000, true)).toBe('heavy');
    expect(getDamageSeverity(-50, 1000, true)).toBe('heavy');
  });

  it('handles invalid numbers safely', () => {
    expect(getDamageSeverity(NaN, 1000, true)).toBe('none');
    expect(getDamageSeverity(100, NaN, true)).toBe('none');
    expect(getDamageSeverity(100, 0, true)).toBe('none');
    expect(getDamageSeverity(100, -100, true)).toBe('none');
    expect(getDamageSeverity(Infinity, 1000, true)).toBe('none');
    expect(getDamageSeverity(100, Infinity, true)).toBe('none');
  });
});

describe('ensureFireParticleTextures', () => {
  it('does nothing when scene or textures manager is missing', () => {
    expect(() => ensureFireParticleTextures(null as any)).not.toThrow();
    expect(() => ensureFireParticleTextures({} as any)).not.toThrow();
  });

  it('creates particle textures once when textures exist', () => {
    const existsMap = new Map<string, boolean>();
    const mockContext = {
      createRadialGradient: vi.fn().mockReturnValue({
        addColorStop: vi.fn()
      }),
      fillStyle: '',
      fillRect: vi.fn()
    };
    const mockCanvas = {
      context: mockContext,
      refresh: vi.fn()
    };
    const mockTextures = {
      exists: vi.fn((key: string) => existsMap.get(key) ?? false),
      createCanvas: vi.fn((key: string) => {
        existsMap.set(key, true);
        return mockCanvas;
      })
    };
    const mockScene = { textures: mockTextures } as any;

    ensureFireParticleTextures(mockScene);

    expect(mockTextures.createCanvas).toHaveBeenCalledWith('particle_fire', 16, 16);
    expect(mockTextures.createCanvas).toHaveBeenCalledWith('particle_smoke', 32, 32);
    expect(mockTextures.createCanvas).toHaveBeenCalledWith('particle_ember', 8, 8);
    expect(mockCanvas.refresh).toHaveBeenCalledTimes(3);

    // Calling again does not recreate already existing textures
    mockTextures.createCanvas.mockClear();
    ensureFireParticleTextures(mockScene);
    expect(mockTextures.createCanvas).not.toHaveBeenCalled();
  });
});

describe('TownCenterFireEffect', () => {
  let createdEmitters: any[];
  let mockScene: any;
  let mockContainer: any;

  beforeEach(() => {
    createdEmitters = [];
    mockScene = {
      textures: {
        exists: vi.fn().mockReturnValue(true),
        createCanvas: vi.fn()
      },
      add: {
        particles: vi.fn((x: number, y: number, texture: string, config: any) => {
          const emitter = {
            x,
            y,
            texture,
            config,
            emitting: false,
            start: vi.fn(function (this: any) {
              this.emitting = true;
            }),
            stop: vi.fn(function (this: any) {
              this.emitting = false;
            }),
            destroy: vi.fn()
          };
          createdEmitters.push(emitter);
          return emitter;
        })
      }
    };

    mockContainer = {
      children: [] as any[],
      add: vi.fn((child: any) => {
        mockContainer.children.push(child);
      })
    };
  });

  it('initializes emitters and groups them by severity tier', () => {
    const effect = new TownCenterFireEffect(mockScene, mockContainer);

    expect(createdEmitters.length).toBe(8);
    expect(mockContainer.add).toHaveBeenCalledTimes(8);
    expect(effect.getSeverity()).toBe('none');

    const moderate = effect.getEmitters('moderate');
    const heavy = effect.getEmitters('heavy');

    expect(moderate.length).toBe(2);
    expect(heavy.length).toBe(6);
    expect(createdEmitters.every((e) => !e.emitting)).toBe(true);
  });

  it('transitions between severity states and activates only matching tier', () => {
    const effect = new TownCenterFireEffect(mockScene, mockContainer);
    const moderate = effect.getEmitters('moderate');
    const heavy = effect.getEmitters('heavy');

    // 1. Initial state (full HP) -> all idle
    effect.update(2400, 2400, true);
    expect(effect.getSeverity()).toBe('none');
    expect(moderate.every((e: any) => !e.emitting)).toBe(true);
    expect(heavy.every((e: any) => !e.emitting)).toBe(true);

    // 2. Moderate damage (40% HP) -> moderate active, heavy stopped
    effect.update(960, 2400, true);
    expect(effect.getSeverity()).toBe('moderate');
    expect(moderate.every((e: any) => e.emitting)).toBe(true);
    expect(heavy.every((e: any) => !e.emitting)).toBe(true);

    // 3. Heavy damage (20% HP) -> heavy active, moderate stopped
    effect.update(480, 2400, true);
    expect(effect.getSeverity()).toBe('heavy');
    expect(moderate.every((e: any) => !e.emitting)).toBe(true);
    expect(heavy.every((e: any) => e.emitting)).toBe(true);

    // 4. Repaired back to moderate -> moderate active, heavy stopped
    effect.update(800, 2400, true);
    expect(effect.getSeverity()).toBe('moderate');
    expect(moderate.every((e: any) => e.emitting)).toBe(true);
    expect(heavy.every((e: any) => !e.emitting)).toBe(true);

    // 5. Repaired back to healthy (>= 50%) -> all stopped
    effect.update(1500, 2400, true);
    expect(effect.getSeverity()).toBe('none');
    expect(moderate.every((e: any) => !e.emitting)).toBe(true);
    expect(heavy.every((e: any) => !e.emitting)).toBe(true);
  });

  it('stops all emitters when building is unconstructed', () => {
    const effect = new TownCenterFireEffect(mockScene, mockContainer);
    const moderate = effect.getEmitters('moderate');
    const heavy = effect.getEmitters('heavy');

    // Damaged
    effect.update(200, 2400, true);
    expect(effect.getSeverity()).toBe('heavy');
    expect(heavy.every((e: any) => e.emitting)).toBe(true);

    // State becomes unconstructed (foundation)
    effect.update(200, 2400, false);
    expect(effect.getSeverity()).toBe('none');
    expect(moderate.every((e: any) => !e.emitting)).toBe(true);
    expect(heavy.every((e: any) => !e.emitting)).toBe(true);
  });

  it('destroys all emitters cleanly and ignores double destroy', () => {
    const effect = new TownCenterFireEffect(mockScene, mockContainer);
    effect.destroy();

    for (const emitter of createdEmitters) {
      expect(emitter.destroy).toHaveBeenCalledTimes(1);
    }

    // Subsequent destroy is a safe no-op
    expect(() => effect.destroy()).not.toThrow();
    for (const emitter of createdEmitters) {
      expect(emitter.destroy).toHaveBeenCalledTimes(1);
    }
  });
});

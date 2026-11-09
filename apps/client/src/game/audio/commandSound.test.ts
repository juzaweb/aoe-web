import { describe, expect, it, vi } from 'vitest';
import { CommandSound, commandSoundSpec, type CommandSoundKind } from './commandSound.js';

const KINDS: CommandSoundKind[] = ['move', 'attack', 'gather', 'build', 'rally', 'stop', 'select', 'cancel'];

function makeContext(state: 'suspended' | 'running' = 'running') {
  const osc = {
    type: '',
    frequency: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn()
    },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn()
    },
    connect: vi.fn()
  };
  const ctx = {
    state,
    currentTime: 0.5,
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    resume: vi.fn(() => Promise.resolve()),
    destination: {}
  };
  return { ctx, osc, gain };
}

describe('command acknowledgement sound (UIX-01)', () => {
  it('every order kind has a short, quiet, distinguishable tone', () => {
    const specs = KINDS.map((kind) => commandSoundSpec(kind));
    specs.forEach((spec) => {
      expect(spec.duration).toBeGreaterThan(0);
      expect(spec.duration).toBeLessThanOrEqual(0.1);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(0.06);
      expect(spec.from).toBeGreaterThan(0);
      expect(spec.to).toBeGreaterThan(0);
    });
    // Pitches must differ, otherwise the "which order landed" cue is lost.
    const starts = new Set(specs.map((spec) => spec.from));
    expect(starts.size).toBe(specs.length);
  });

  it('no context -> no throw and the factory is only consulted once', () => {
    const factory = vi.fn(() => null);
    const sound = new CommandSound(factory, true);
    expect(() => sound.play('move')).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(1);
    sound.play('move');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disabled -> the factory is never called', () => {
    const factory = vi.fn(() => null);
    const sound = new CommandSound(factory, false);
    sound.play('attack');
    expect(factory).not.toHaveBeenCalled();
    sound.setEnabled(true);
    sound.play('attack');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('enabled -> one oscillator per order, started and stopped', () => {
    const { ctx, osc } = makeContext();
    const sound = new CommandSound(() => ctx, true);
    sound.play('gather');
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
    // A second order reuses the context and the oscillator factory.
    sound.play('move');
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('suspended -> resume is requested', () => {
    const { ctx } = makeContext('suspended');
    const sound = new CommandSound(() => ctx, true);
    sound.play('build');
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('a throwing context is swallowed', () => {
    const sound = new CommandSound(
      () => ({
        state: 'running',
        currentTime: 0,
        createOscillator: () => {
          throw new Error('audio device gone');
        },
        createGain: () => ({ gain: {} as never, connect: () => {} }),
        resume: () => Promise.resolve(),
        destination: {}
      }),
      true
    );
    expect(() => sound.play('stop')).not.toThrow();
  });
});

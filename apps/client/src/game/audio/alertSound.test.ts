import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnderAttackSound } from './alertSound.js';

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
    currentTime: 1.25,
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    resume: vi.fn(() => Promise.resolve()),
    destination: {}
  };
  return { ctx, osc, gain };
}

describe('UnderAttackSound (AUD-01)', () => {
  it('no context -> no throw and factory called once', () => {
    const factory = vi.fn(() => null);
    const sound = new UnderAttackSound(factory, true);
    expect(() => sound.play()).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(1);
    sound.play();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disabled -> factory is never called', () => {
    const factory = vi.fn(() => null);
    const sound = new UnderAttackSound(factory, false);
    sound.play();
    expect(factory).not.toHaveBeenCalled();
    sound.setEnabled(true);
    // enabling does not retroactively play; but next play calls factory
    sound.play();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('enabled -> factory called once, oscillator start/stop called', () => {
    const { ctx, osc } = makeContext();
    const factory = vi.fn(() => ctx);
    const sound = new UnderAttackSound(factory, true);
    sound.play();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
    // second play reuses context
    sound.play();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('suspended -> resume is called', () => {
    const { ctx } = makeContext('suspended');
    const factory = vi.fn(() => ctx);
    const sound = new UnderAttackSound(factory, true);
    sound.play();
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('play twice reuses the same context', () => {
    const { ctx } = makeContext();
    const factory = vi.fn(() => ctx);
    const sound = new UnderAttackSound(factory, true);
    sound.play();
    sound.play();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('setEnabled only toggles flag, does not touch context', () => {
    const { ctx } = makeContext();
    const factory = vi.fn(() => ctx);
    const sound = new UnderAttackSound(factory, true);
    sound.play();
    const callsBefore = factory.mock.calls.length;
    sound.setEnabled(false);
    sound.play();
    expect(factory.mock.calls.length).toBe(callsBefore);
  });
});

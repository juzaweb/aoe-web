import { SynthVoice, type ToneSpec } from './synthVoice.js';

/**
 * UIX-01 (audio half): a short synthesized acknowledgement for an order.
 *
 * The repo has no SFX asset pipeline, so the click is one oscillator per order.
 * It is deliberately tiny — 50-90 ms — and pitched by order type, so a move and
 * an attack are distinguishable without looking at the screen.
 */
export type CommandSoundKind =
  | 'move'
  | 'attack'
  | 'gather'
  | 'build'
  | 'rally'
  | 'stop'
  | 'select'
  | 'cancel';

const TONES: Record<CommandSoundKind, ToneSpec> = {
  move: { type: 'triangle', from: 620, to: 880, duration: 0.07, gain: 0.05, attack: 0.004 },
  attack: { type: 'square', from: 300, to: 220, duration: 0.09, gain: 0.05, attack: 0.004 },
  gather: { type: 'sine', from: 740, to: 980, duration: 0.07, gain: 0.05, attack: 0.004 },
  build: { type: 'triangle', from: 420, to: 560, duration: 0.08, gain: 0.05, attack: 0.004 },
  rally: { type: 'sine', from: 880, to: 1040, duration: 0.06, gain: 0.045, attack: 0.004 },
  stop: { type: 'square', from: 480, to: 360, duration: 0.06, gain: 0.04, attack: 0.004 },
  select: { type: 'sine', from: 660, to: 760, duration: 0.05, gain: 0.04, attack: 0.004 },
  cancel: { type: 'square', from: 320, to: 240, duration: 0.06, gain: 0.04, attack: 0.004 }
};

export function commandSoundSpec(kind: CommandSoundKind): ToneSpec {
  return TONES[kind];
}

export class CommandSound extends SynthVoice {
  play(kind: CommandSoundKind): void {
    this.playTone(commandSoundSpec(kind));
  }
}

let singleton: CommandSound | null = null;

export function playCommandSound(kind: CommandSoundKind): void {
  if (!singleton) singleton = new CommandSound();
  singleton.play(kind);
}

/** Driven by `audioSettings.ts`, the single user-facing sound switch (UIX-16). */
export function setCommandSoundEnabled(enabled: boolean): void {
  if (!singleton) singleton = new CommandSound();
  singleton.setEnabled(enabled);
}

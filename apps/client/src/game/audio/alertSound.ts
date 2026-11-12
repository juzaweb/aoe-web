import { SynthVoice, type ToneSpec } from './synthVoice.js';

/**
 * AUD-01: Web Audio synthesis for the "under attack" alert.
 *
 * A short synthesized beep (square wave 880 -> 660 Hz, ~220 ms). The shared
 * oscillator/context plumbing lives in `synthVoice.ts`; only the note is here.
 */

const ALERT_TONE: ToneSpec = {
  type: 'square',
  from: 880,
  to: 660,
  duration: 0.22,
  gain: 0.2,
  attack: 0.02
};

export class UnderAttackSound extends SynthVoice {
  play(): void {
    this.playTone(ALERT_TONE);
  }
}

let singleton: UnderAttackSound | null = null;

export function playUnderAttackAlert(): void {
  if (!singleton) singleton = new UnderAttackSound();
  singleton.play();
}

/** Driven by `audioSettings.ts`, the single user-facing sound switch (UIX-16). */
export function setUnderAttackAlertEnabled(enabled: boolean): void {
  if (!singleton) singleton = new UnderAttackSound();
  singleton.setEnabled(enabled);
}

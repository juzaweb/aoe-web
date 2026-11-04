/**
 * AUD-01: Web Audio synthesis for the "under attack" alert.
 *
 * The repo has no audio asset pipeline, so the alert is a short synthesized
 * beep (square wave 880 -> 660 Hz, ~220 ms) built on the Web Audio API. This
 * module is deliberately free of Phaser/React so it can be unit-tested in a
 * node environment with a fake `AudioContext`.
 */

export interface AudioParamLike {
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

export interface OscillatorNodeLike {
  type: string;
  frequency: AudioParamLike;
  connect(node: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainNodeLike {
  gain: AudioParamLike;
  connect(node: unknown): void;
}

export interface AudioContextLike {
  state: 'suspended' | 'running' | 'closed';
  currentTime: number;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  resume(): Promise<void>;
  destination: unknown;
}

export interface AlertSoundOptions {
  /** Master enable switch; defaults to true. */
  enabled?: boolean;
}

/**
 * Default factory: feature-detect an `AudioContext`/`webkitAudioContext` on
 * `window`. Returns `null` when unavailable (SSR / old browser / no window).
 */
export function defaultFactory(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export class UnderAttackSound {
  private context: AudioContextLike | null | undefined;
  private enabled: boolean;

  constructor(
    private readonly contextFactory: () => AudioContextLike | null = defaultFactory,
    enabled: boolean = true
  ) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  play(): void {
    if (!this.enabled) return;
    try {
      if (this.context === undefined) {
        this.context = this.contextFactory();
      }
      const ctx = this.context;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      const now = ctx.currentTime;
      const duration = 0.22;

      osc.frequency.setValueAtTime(880, now);
      osc.frequency.linearRampToValueAtTime(660, now + duration);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Never propagate to the caller (banner/HUD must keep working).
    }
  }
}

let singleton: UnderAttackSound | null = null;

export function playUnderAttackAlert(): void {
  if (!singleton) singleton = new UnderAttackSound();
  singleton.play();
}

export function setUnderAttackAlertEnabled(enabled: boolean): void {
  if (!singleton) singleton = new UnderAttackSound();
  singleton.setEnabled(enabled);
}

/**
 * Shared Web Audio plumbing for the game's synthesized sounds.
 *
 * The repo has no audio asset pipeline, so every cue is a short oscillator
 * burst. The lifecycle (lazy `AudioContext`, suspended-context resume, the
 * "audio must never break input" contract) is identical for each cue, so it
 * lives here instead of being copied into every sound module.
 *
 * Deliberately free of Phaser/React so it can be unit-tested in a node
 * environment with a fake `AudioContext`.
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

/**
 * Feature-detect an `AudioContext`/`webkitAudioContext` on `window`. Returns
 * `null` when unavailable (SSR / old browser / no window).
 */
export function defaultAudioContextFactory(): AudioContextLike | null {
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

/** One synthesized note: a frequency sweep shaped by a short envelope. */
export interface ToneSpec {
  /** Oscillator waveform; `square` cuts through battle noise better. */
  type: string;
  /** Start and end frequency in hertz; the ramp is the cue's character. */
  from: number;
  to: number;
  /** Seconds. */
  duration: number;
  /** Peak gain, kept low: these cues are frequent. */
  gain: number;
  /** Seconds of attack ramp, which avoids a click on some devices. */
  attack: number;
}

/**
 * A lazily-created Web Audio context that can play one note per call.
 *
 * The context is created on first playback, never at import time: browsers
 * refuse to start audio before a user gesture, and a module that allocates a
 * context on load would be suspended forever on a page that never clicked.
 */
export class SynthVoice {
  private context: AudioContextLike | null | undefined;
  private enabled: boolean;

  constructor(
    private readonly contextFactory: () => AudioContextLike | null = defaultAudioContextFactory,
    enabled: boolean = true
  ) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  protected playTone(tone: ToneSpec): void {
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

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.from, now);
      osc.frequency.linearRampToValueAtTime(tone.to, now + tone.duration);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(tone.gain, now + tone.attack);
      gain.gain.linearRampToValueAtTime(0, now + tone.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + tone.duration);
    } catch {
      // Never propagate to the caller (input/HUD must keep working).
    }
  }
}

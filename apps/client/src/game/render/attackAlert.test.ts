import { describe, expect, it } from 'vitest';
import {
  ATTACK_ALERT_COOLDOWN_MS,
  ATTACK_PING_DURATION_MS,
  MAX_ATTACK_PINGS,
  capAttackPings,
  pruneAttackPings,
  shouldAlert,
  type AttackPing
} from './attackAlert.js';

describe('shouldAlert', () => {
  it('alerts when our entity loses HP', () => {
    expect(shouldAlert(100, 80, 'me', 'me')).toBe(true);
  });

  it('does not alert on initial snapshot (no previous HP)', () => {
    expect(shouldAlert(undefined, 80, 'me', 'me')).toBe(false);
  });

  it('does not alert for other owners', () => {
    expect(shouldAlert(100, 80, 'enemy', 'me')).toBe(false);
  });

  it('does not alert when myOwnerId is unresolved', () => {
    expect(shouldAlert(100, 80, 'me', '')).toBe(false);
  });

  it('does not alert when HP is unchanged', () => {
    expect(shouldAlert(100, 100, 'me', 'me')).toBe(false);
  });

  it('does not alert when HP increases', () => {
    expect(shouldAlert(80, 100, 'me', 'me')).toBe(false);
  });
});

describe('pruneAttackPings', () => {
  const pings: AttackPing[] = [
    { x: 1, y: 1, startMs: 1000, durationMs: 3000 },
    { x: 2, y: 2, startMs: 3500, durationMs: 3000 }
  ];

  it('keeps pings still alive', () => {
    expect(pruneAttackPings(pings, 2000)).toHaveLength(2);
  });

  it('drops expired pings', () => {
    const result = pruneAttackPings(pings, 4500);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(2);
  });

  it('drops a ping exactly at its expiry', () => {
    const result = pruneAttackPings([{ x: 0, y: 0, startMs: 1000, durationMs: 3000 }], 4000);
    expect(result).toHaveLength(0);
  });
});

describe('capAttackPings', () => {
  it('returns a copy when under the cap', () => {
    const pings: AttackPing[] = [{ x: 0, y: 0, startMs: 0, durationMs: 1000 }];
    const result = capAttackPings(pings, 12);
    expect(result).toEqual(pings);
    expect(result).not.toBe(pings);
  });

  it('drops oldest pings when over the cap', () => {
    const pings: AttackPing[] = Array.from({ length: 5 }, (_, i) => ({
      x: i,
      y: 0,
      startMs: i,
      durationMs: 1000
    }));
    const result = capAttackPings(pings, 3);
    expect(result.map((p) => p.x)).toEqual([2, 3, 4]);
  });

  it('returns empty for non-positive max', () => {
    expect(capAttackPings([{ x: 0, y: 0, startMs: 0, durationMs: 1 }], 0)).toEqual([]);
  });
});

describe('constants', () => {
  it('matches the plan values', () => {
    expect(ATTACK_ALERT_COOLDOWN_MS).toBe(4000);
    expect(ATTACK_PING_DURATION_MS).toBe(3000);
    expect(MAX_ATTACK_PINGS).toBe(12);
  });
});

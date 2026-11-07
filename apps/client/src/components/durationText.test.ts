import { describe, expect, it } from 'vitest';
import { formatDuration } from './durationText.js';

describe('upgrade duration text (LVL2)', () => {
  it('shows seconds, minutes and hours with a zero minute part dropped', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(720_000)).toBe('12m');
    expect(formatDuration(3_600_000)).toBe('1h');
    expect(formatDuration(6 * 3_600_000 + 42 * 60_000)).toBe('6h42');
  });

  it('keeps the last steps of the ladder readable instead of dumping raw seconds', () => {
    // The documented level 1 -> 2 and 9 -> 10 Town Center steps.
    expect(formatDuration(7_500)).toBe('7s');
    expect(formatDuration(49_207_500)).toBe('13h40');
    expect(formatDuration(13 * 3_600_000)).toBe('13h');
  });

  it('rounds down, so a timer never looks further along than it is', () => {
    expect(formatDuration(59_999)).toBe('59s');
    expect(formatDuration(60_999)).toBe('1m');
    expect(formatDuration(3_599_999)).toBe('59m');
  });

  it('falls back to zero for empty or broken timers', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

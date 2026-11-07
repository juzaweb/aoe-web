import { describe, expect, it } from 'vitest';
import { RejectCode } from '@chien-quoc/shared';
import { REJECT_VISUALS, getRejectVisual } from './rejectVisuals.js';

describe('rejectVisuals', () => {
  it('maps each RejectCode to a visual', () => {
    const codes = Object.values(RejectCode);
    expect(codes).toHaveLength(8);
    for (const code of codes) {
      const v = getRejectVisual(code);
      expect(v).toBe(REJECT_VISUALS[code]);
      expect(v.iconKey).toBeTruthy();
      expect(v.containerClass).toContain('absolute');
    }
  });

  it('returns distinct icon keys for all groups', () => {
    const keys = Object.values(RejectCode).map((c) => getRejectVisual(c).iconKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('null falls back to default red AlertCircle', () => {
    const v = getRejectVisual(null);
    expect(v.iconKey).toBe('AlertCircle');
    expect(v.containerClass).toContain('red');
  });

  it('unknown code falls back to default', () => {
    const v = getRejectVisual('NOPE' as unknown as RejectCode);
    expect(v.iconKey).toBe('AlertCircle');
  });
});

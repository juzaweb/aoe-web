import { describe, expect, it } from 'vitest';
import { SESSION_ALREADY_ACTIVE, SESSION_BUSY } from '@chien-quoc/shared';
import { classifySessionJoinError } from './api.js';

describe('classifySessionJoinError', () => {
  it('maps the live-session rejection to "taken"', () => {
    expect(classifySessionJoinError({ code: SESSION_ALREADY_ACTIVE })).toBe('taken');
  });

  it('maps the in-flight join rejection to "busy"', () => {
    expect(classifySessionJoinError({ code: SESSION_BUSY })).toBe('busy');
  });

  it('ignores the same code sent as a string', () => {
    expect(classifySessionJoinError({ code: String(SESSION_ALREADY_ACTIVE) })).toBeNull();
  });

  it('returns null for unrelated errors and non-objects', () => {
    expect(classifySessionJoinError({ code: 525 })).toBeNull();
    expect(classifySessionJoinError(null)).toBeNull();
    expect(classifySessionJoinError(undefined)).toBeNull();
    expect(classifySessionJoinError('4009')).toBeNull();
  });
});

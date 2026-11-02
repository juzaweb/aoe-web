import { beforeEach, describe, expect, it } from 'vitest';
import { zonePersistence } from './ZonePersistence.js';

describe('zonePersistence', () => {
  beforeEach(() => zonePersistence.reset());

  it('makes the newest room the only writer of a zone', () => {
    const first = zonePersistence.claim('battlefield');
    const second = zonePersistence.claim('battlefield');

    expect(zonePersistence.isCurrent('battlefield', first)).toBe(false);
    expect(zonePersistence.isCurrent('battlefield', second)).toBe(true);
  });

  it('keeps zones independent', () => {
    const battlefield = zonePersistence.claim('battlefield');
    const kingdom = zonePersistence.claim('kingdom:user-1');

    expect(zonePersistence.isCurrent('battlefield', battlefield)).toBe(true);
    expect(zonePersistence.isCurrent('kingdom:user-1', kingdom)).toBe(true);
  });

  it('does not let a stale release free the successor', () => {
    const first = zonePersistence.claim('battlefield');
    const second = zonePersistence.claim('battlefield');

    zonePersistence.release('battlefield', first);

    expect(zonePersistence.isCurrent('battlefield', second)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { EntityIdAllocator } from './EntityIdAllocator.js';

describe('EntityIdAllocator', () => {
  it('starts above the legacy per-room base', () => {
    const ids = new EntityIdAllocator();
    expect(ids.nextId()).toBe(1001);
  });

  it('advances past an id already persisted in any zone', () => {
    const ids = new EntityIdAllocator();
    ids.observe('b_5000');
    ids.observe('u_4100');
    ids.observe('res_7000');

    expect(ids.nextId()).toBe(7001);
  });

  it('ignores ids without a numeric suffix', () => {
    const ids = new EntityIdAllocator();
    ids.observe('transfer-abc');
    expect(ids.nextId()).toBe(1001);
  });

  it('never rewinds when an older id is observed', () => {
    const ids = new EntityIdAllocator();
    ids.observe('b_9000');
    ids.observe('b_12');
    expect(ids.nextId()).toBe(9001);
  });
});

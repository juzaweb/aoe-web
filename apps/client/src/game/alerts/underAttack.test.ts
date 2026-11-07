import { beforeEach, describe, expect, it } from 'vitest';
import { UnderAttackTracker } from './underAttack.js';

describe('UnderAttackTracker', () => {
  let tracker: UnderAttackTracker;

  beforeEach(() => {
    tracker = new UnderAttackTracker(4000, 4000);
  });

  it('first record stores hp and raises no alert', () => {
    const r = tracker.record('u1', 'me', 'me', 100, 5, 5, 1000);
    expect(r.damaged).toBe(false);
    expect(r.ping).toBeNull();
    expect(r.showBanner).toBe(false);
    expect(tracker.activePings(1000)).toHaveLength(0);
  });

  it('hp drop on an owned entity raises damaged/ping/banner', () => {
    tracker.record('u1', 'me', 'me', 100, 5, 5, 1000);
    const r = tracker.record('u1', 'me', 'me', 80, 5, 5, 2000);
    expect(r.damaged).toBe(true);
    expect(r.ping).not.toBeNull();
    expect(r.ping?.gx).toBe(5);
    expect(r.ping?.gy).toBe(5);
    expect(r.showBanner).toBe(true);
    expect(tracker.activePings(2000)).toHaveLength(1);
  });

  it('hp drop on an enemy entity raises no alert but stores lastHp', () => {
    tracker.record('u2', 'enemy', 'me', 100, 1, 1, 1000);
    const r = tracker.record('u2', 'enemy', 'me', 70, 1, 1, 2000);
    expect(r.damaged).toBe(true);
    expect(r.ping).toBeNull();
    expect(r.showBanner).toBe(false);
    // later, if ownership resolves to enemy? still no; but lastHp stored
    const r2 = tracker.record('u2', 'enemy', 'me', 50, 1, 1, 3000);
    expect(r2.damaged).toBe(true);
  });

  it('hp increase raises no alert', () => {
    tracker.record('b1', 'me', 'me', 50, 2, 2, 1000);
    const r = tracker.record('b1', 'me', 'me', 100, 2, 2, 2000);
    expect(r.damaged).toBe(false);
    expect(r.ping).toBeNull();
    expect(r.showBanner).toBe(false);
  });

  it('banner is throttled within cooldown', () => {
    tracker.record('u1', 'me', 'me', 100, 1, 1, 1000);
    const r1 = tracker.record('u1', 'me', 'me', 90, 1, 1, 2000);
    expect(r1.showBanner).toBe(true);
    // second hit within cooldown
    tracker.record('u1', 'me', 'me', 90, 1, 1, 2100); // no drop? need drop
    // reset hp then drop
    tracker.record('u1', 'me', 'me', 85, 1, 1, 2200); // 90->85 drop
    // Wait ensure damaged
    const r2 = tracker.record('u1', 'me', 'me', 80, 1, 1, 2300);
    // Actually above record at 2200 already drop 90->85 and may banner? cooldown 4000 from 2000 => 2200 < 6000 so no banner. Let's just assert banner false for hit within cooldown
    expect(r2.showBanner).toBe(false);
  });

  it('banner shows again after cooldown', () => {
    tracker.record('u1', 'me', 'me', 100, 1, 1, 1000);
    tracker.record('u1', 'me', 'me', 90, 1, 1, 2000); // banner
    tracker.record('u1', 'me', 'me', 80, 1, 1, 7000); // 5000ms later
    const r = tracker.record('u1', 'me', 'me', 70, 1, 1, 7100);
    // The hit at 7000 already may have banner? cooldown from 2000: 7000-2000=5000>=4000 => banner at 7000. At 7100 cooldown not passed (100ms) => no. Let's instead test single later hit.
    // Redo clean:
    const t2 = new UnderAttackTracker(4000, 4000);
    t2.record('a', 'me', 'me', 100, 1, 1, 1000);
    t2.record('a', 'me', 'me', 90, 1, 1, 2000); // banner
    const rLate = t2.record('a', 'me', 'me', 80, 1, 1, 6500);
    expect(rLate.showBanner).toBe(true);
    void r;
  });

  it('ping updates position on new hit', () => {
    tracker.record('u1', 'me', 'me', 100, 1, 1, 1000);
    tracker.record('u1', 'me', 'me', 90, 1, 1, 2000);
    tracker.record('u1', 'me', 'me', 80, 9, 9, 7000);
    const pings = tracker.activePings(7000);
    expect(pings).toHaveLength(1);
    expect(pings[0].gx).toBe(9);
    expect(pings[0].gy).toBe(9);
  });

  it('expired pings are pruned', () => {
    tracker.record('u1', 'me', 'me', 100, 1, 1, 1000);
    tracker.record('u1', 'me', 'me', 90, 1, 1, 2000);
    expect(tracker.activePings(7000)).toHaveLength(0);
  });

  it('forget removes tracking and ping', () => {
    tracker.record('u1', 'me', 'me', 100, 1, 1, 1000);
    tracker.record('u1', 'me', 'me', 90, 1, 1, 2000);
    tracker.forget('u1');
    expect(tracker.activePings(2000)).toHaveLength(0);
    // first record again no alert
    const r = tracker.record('u1', 'me', 'me', 80, 1, 1, 3000);
    expect(r.damaged).toBe(false);
  });

  it('clear removes everything and resets banner cooldown', () => {
    tracker.record('u1', 'me', 'me', 100, 1, 1, 1000);
    tracker.record('u1', 'me', 'me', 90, 1, 1, 2000);
    tracker.clear();
    expect(tracker.activePings(2000)).toHaveLength(0);
    tracker.record('u2', 'me', 'me', 100, 2, 2, 3000);
    const r = tracker.record('u2', 'me', 'me', 80, 2, 2, 3100);
    expect(r.showBanner).toBe(true);
  });

  it('myOwnerId empty stores lastHp but no ping', () => {
    tracker.record('u1', 'me', '', 100, 1, 1, 1000);
    const r = tracker.record('u1', 'me', '', 80, 1, 1, 2000);
    expect(r.damaged).toBe(true);
    expect(r.ping).toBeNull();
    expect(r.showBanner).toBe(false);
  });

  it('multiple entities produce multiple pings, banner once', () => {
    tracker.record('a', 'me', 'me', 100, 1, 1, 1000);
    tracker.record('b', 'me', 'me', 100, 5, 5, 1000);
    const r1 = tracker.record('a', 'me', 'me', 90, 1, 1, 2000);
    const r2 = tracker.record('b', 'me', 'me', 90, 5, 5, 2001);
    expect(r1.showBanner).toBe(true);
    expect(r2.showBanner).toBe(false);
    expect(tracker.activePings(2001)).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { UnitState } from '../schema/UnitState.js';
import { UNIT_SEPARATION, UnitSeparation } from './unitSeparation.js';

/**
 * A stand-in for `MapSchema` that keeps insertion order, which is all
 * {@link UnitSeparation} needs and all a real room gives it.
 */
class FakeUnits {
  readonly units: UnitState[] = [];
  get size() {
    return this.units.length;
  }
  forEach(cb: (unit: UnitState) => void) {
    for (const unit of this.units) cb(unit);
  }
  add(id: string, x: number, y: number, overrides: Partial<UnitState> = {}) {
    const unit = new UnitState();
    unit.id = id;
    unit.x = x;
    unit.y = y;
    unit.targetX = x;
    unit.targetY = y;
    Object.assign(unit, overrides);
    this.units.push(unit);
    return unit;
  }
}

const noWalls = () => false;

function minPairDistance(units: UnitState[]): number {
  let min = Infinity;
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      min = Math.min(min, Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y));
    }
  }
  return min;
}

const MAP_WIDTH = 110;
const MAP_HEIGHT = 110;

function run(separation: UnitSeparation, units: FakeUnits, ticks: number, dt = 0.05) {
  for (let tick = 0; tick < ticks; tick++) {
    separation.separate(units, dt, MAP_WIDTH, MAP_HEIGHT, noWalls);
  }
}

describe('UnitSeparation', () => {
  it('moves both units of a stacked pair, so neither is the anchor', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 30, 30);
    const b = units.add('u_2', 30, 30);

    run(new UnitSeparation(), units, 1);

    expect(a.x === 30 && a.y === 30).toBe(false);
    expect(b.x === 30 && b.y === 30).toBe(false);
  });

  it('caps one tick of shove at the configured speed', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 30, 30);
    units.add('u_2', 30.05, 30);

    // 2 tiles/s at a 50 ms tick is 0.1 tiles of travel for the pair.
    run(new UnitSeparation(), units, 1);

    expect(Math.abs(a.x - 30)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('settles units at least half a tile apart, whatever the tuned constant is', () => {
    // Independent of UNIT_SEPARATION on purpose: half a tile is the width of a
    // unit's body, and anything closer reads as one figure on screen.
    const units = new FakeUnits();
    for (let i = 0; i < 6; i++) units.add(`u_${i}`, 40, 40);

    run(new UnitSeparation(), units, 60);

    expect(minPairDistance(units.units)).toBeGreaterThan(0.5);
  });

  it('never overshoots the target distance in one tick', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 30, 30);
    // 0.55 apart: the remaining 0.05 gap is smaller than the 0.05 per-unit tick
    // budget, which is exactly where a full-gap push overshoots instead of landing
    // on the separation.
    const b = units.add('u_2', 30.55, 30);
    const before = Math.hypot(b.x - a.x, b.y - a.y);

    run(new UnitSeparation(), units, 1);

    const after = Math.hypot(b.x - a.x, b.y - a.y);
    // A full-gap push would jump the pair to twice the gap and then bounce back.
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(UNIT_SEPARATION + 1e-9);
  });

  it('never moves one unit more than the tick budget, however crowded', () => {
    const units = new FakeUnits();
    for (let i = 0; i < 9; i++) units.add(`u_${i}`, 40 + (i % 3) * 0.05, 40 + Math.floor(i / 3) * 0.05);
    const before = units.units.map((u) => ({ x: u.x, y: u.y }));

    run(new UnitSeparation(), units, 1);

    // 2 tiles/s at a 50 ms tick.
    for (let i = 0; i < units.units.length; i++) {
      const moved = Math.hypot(units.units[i].x - before[i].x, units.units[i].y - before[i].y);
      expect(moved).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('settles a stack of eight to exactly one separation apart', () => {
    const units = new FakeUnits();
    for (let i = 0; i < 8; i++) units.add(`u_${i}`, 40, 40);

    run(new UnitSeparation(), units, 60);

    expect(minPairDistance(units.units)).toBeGreaterThan(UNIT_SEPARATION * 0.99);
  });

  it('finds an overlap behind a farther unit in the next bucket', () => {
    // Bucket 0 starts at x = 0 and holds 0.59; bucket 1 holds 1.19 then 0.61. A
    // `break` on the first candidate (dx = 0.6) would skip 0.61, which really is
    // within reach — inside a bucket the counting sort keeps insertion order, not
    // x order.
    const units = new FakeUnits();
    units.add('far_first', 1.19, 30.0);
    units.add('close_second', 0.61, 30.0);
    units.add('anchor', 0.59, 30.0);

    run(new UnitSeparation(), units, 80);

    const [far, close] = units.units;
    expect(Math.hypot(far.x - close.x, far.y - close.y)).toBeGreaterThan(UNIT_SEPARATION * 0.99);
  });

  it('separates pairs that straddle a bucket boundary', () => {
    // The counting sort puts these in adjacent buckets; a `break` on the neighbouring
    // bucket instead of a distance check would leave them stacked forever.
    const units = new FakeUnits();
    units.add('u_1', 30.0, 30.0);
    units.add('u_2', 30.55, 30.0);
    units.add('u_3', 30.61, 30.02);

    run(new UnitSeparation(), units, 60);

    expect(minPairDistance(units.units)).toBeGreaterThan(UNIT_SEPARATION * 0.99);
  });

  it('is deterministic for exactly co-located units', () => {
    const build = () => {
      const units = new FakeUnits();
      units.add('u_1', 30, 30);
      units.add('u_2', 30, 30);
      return units;
    };
    const first = build();
    const second = build();
    run(new UnitSeparation(), first, 5);
    run(new UnitSeparation(), second, 5);

    expect(first.units[0].x).toBeCloseTo(second.units[0].x, 10);
    expect(first.units[0].y).toBeCloseTo(second.units[0].y, 10);
  });

  it('leaves units that are already apart untouched', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 30, 30);
    const b = units.add('u_2', 30 + UNIT_SEPARATION + 0.01, 30);

    run(new UnitSeparation(), units, 5);

    expect(a.x).toBe(30);
    expect(b.x).toBe(30 + UNIT_SEPARATION + 0.01);
  });

  it('keeps a walking unit on course and does not cancel its order', () => {
    const units = new FakeUnits();
    const walker = units.add('u_1', 30, 30, { actionState: 'MOVING' });
    walker.targetX = 50;
    units.add('u_2', 30, 30);

    run(new UnitSeparation(), units, 3);

    expect(walker.targetX).toBe(50);
    expect(walker.actionState).toBe('MOVING');
  });

  it('moves a parked unit destination with the shove so the pair cannot buzz', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 30, 30);
    const b = units.add('u_2', 30, 30);

    run(new UnitSeparation(), units, 40);
    // The invariant the shift exists for: a parked unit has no walk-back distance
    // left, so the room's movement step cannot drag it back onto its neighbour.
    for (const unit of units.units) {
      expect(Math.hypot(unit.targetX - unit.x, unit.targetY - unit.y)).toBeLessThan(0.2);
    }

    const settled = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    run(new UnitSeparation(), units, 40);

    expect(a.x).toBeCloseTo(settled.ax, 9);
    expect(a.y).toBeCloseTo(settled.ay, 9);
    expect(b.x).toBeCloseTo(settled.bx, 9);
    expect(b.y).toBeCloseTo(settled.by, 9);
  });

  it('never pushes a unit onto a blocked tile', () => {
    const units = new FakeUnits();
    // Both units sit hard against the left edge of tile 31, and everything except
    // column 30 is a wall: only a leftward shove is legal, so the pair has to
    // spread along y or not move rather than cross into the wall.
    const a = units.add('u_1', 30.98, 30.5);
    const b = units.add('u_2', 30.98, 30.5);
    const wallRight = (x: number) => x !== 30;

    const separation = new UnitSeparation();
    for (let tick = 0; tick < 40; tick++) separation.separate(units, 0.05, MAP_WIDTH, MAP_HEIGHT, wallRight);

    for (const unit of [a, b]) {
      expect(Math.floor(unit.x)).toBe(30);
    }
    expect(minPairDistance(units.units)).toBeGreaterThan(UNIT_SEPARATION * 0.99);
  });

  it('still separates two harvesters standing on a blocked node tile', () => {
    const units = new FakeUnits();
    units.add('u_1', 30.2, 30.2);
    units.add('u_2', 30.2, 30.2);
    // The node tile both units already stand on is blocked; they must be allowed
    // to step off it, or they would stay stacked forever.
    const blocked = (x: number, y: number) => x !== 30 || y !== 30;

    run(new UnitSeparation(), units, 1);
    const separation = new UnitSeparation();
    for (let tick = 0; tick < 20; tick++) separation.separate(units, 0.05, MAP_WIDTH, MAP_HEIGHT, blocked);

    expect(minPairDistance(units.units)).toBeGreaterThan(0.01);
  });

  it('clamps a shove to the map instead of pushing a unit off the world', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 0, 0);
    units.add('u_2', 0, 0);

    // A wall of buildings along both axes leaves the corner as the only legal
    // place to stand, so the shove has to be discarded rather than wrapped.
    for (let tick = 0; tick < 10; tick++) {
      new UnitSeparation().separate(units, 0.05, MAP_WIDTH, MAP_HEIGHT, noWalls);
    }

    for (const unit of units.units) {
      expect(unit.x).toBeGreaterThanOrEqual(0);
      expect(unit.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('does nothing with fewer than two units', () => {
    const units = new FakeUnits();
    const solo = units.add('u_1', 30, 30);

    run(new UnitSeparation(), units, 5);

    expect(solo.x).toBe(30);
    expect(solo.y).toBe(30);
  });

  it('ignores a non-positive tick instead of dividing by it', () => {
    const units = new FakeUnits();
    const a = units.add('u_1', 30, 30);
    units.add('u_2', 30, 30);

    run(new UnitSeparation(), units, 1, 0);

    expect(a.x).toBe(30);
  });
});

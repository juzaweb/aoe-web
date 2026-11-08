import { citadelLayoutFor } from '@chien-quoc/shared';
import { describe, expect, it } from 'vitest';
import {
  CITADEL_GATE_ROOF_RISE,
  CITADEL_WALL_RISE,
  CitadelSurface
} from './citadelSurface.js';

describe('CitadelSurface', () => {
  const layout = citadelLayoutFor(50, 50);
  const surface = new CitadelSurface([layout]);
  const stair = layout.stairs[0];

  it('lifts a wall-top unit by the wall rise', () => {
    const tile = layout.walls.find(
      (wall) =>
        wall.gridY === stair.wall.gridY && wall.gridX === layout.originX
    )!;
    expect(surface.liftAt(tile.gridX + 0.5, tile.gridY + 0.5)).toBe(
      CITADEL_WALL_RISE
    );
  });

  it('lifts the gate roof above the wall run', () => {
    const gate = layout.gates[0];
    expect(surface.liftAt(gate.gridX + 0.5, gate.gridY + 0.5)).toBe(
      CITADEL_GATE_ROOF_RISE
    );
  });

  it('interpolates along the stair flight', () => {
    expect(surface.liftAt(stair.bottom.gridX + 0.5, stair.bottom.gridY + 0.5)).toBe(0);
    expect(surface.liftAt(stair.top.gridX + 0.5, stair.top.gridY + 0.5)).toBe(
      CITADEL_WALL_RISE
    );
    const mid = surface.liftAt(
      (stair.bottom.gridX + stair.top.gridX) / 2 + 0.5,
      stair.bottom.gridY + 0.5
    );
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(CITADEL_WALL_RISE);
  });

  it('leaves open ground at zero', () => {
    expect(surface.liftAt(layout.innerMinX + 0.5, layout.innerMinY + 0.5)).toBe(0);
  });
});

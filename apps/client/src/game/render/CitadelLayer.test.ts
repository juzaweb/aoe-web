import { citadelLayoutFor } from '@chien-quoc/shared';
import { describe, expect, it } from 'vitest';
import {
  GATE_COVER_NORTH_TILES,
  GATE_COVER_SOUTH_TILES,
  citadelGateCoveredYRange
} from './CitadelLayer.js';

describe('CitadelLayer gate coverage', () => {
  it('covers exactly 6 tiles in total along the east wall', () => {
    const layout = citadelLayoutFor(50, 50);
    const { coveredFrom, coveredTo } = citadelGateCoveredYRange(layout.gates);

    // Gate width is 3 tiles. With 1 tile north and 2 tiles south, total covered span is 6 tiles.
    expect(coveredTo - coveredFrom + 1).toBe(6);
    expect(GATE_COVER_NORTH_TILES).toBe(1);
    expect(GATE_COVER_SOUTH_TILES).toBe(2);
  });

  it('keeps the wall tile immediately north of the north tower without leaving a gap', () => {
    const layout = citadelLayoutFor(50, 50);
    const { coveredFrom, coveredTo } = citadelGateCoveredYRange(layout.gates);

    const eastWallX = layout.originX + layout.sizeX - 1;
    const eastWalls = layout.walls.filter((w) => w.gridX === eastWallX);

    const firstGateY = layout.gates[0].gridY;
    const lastGateY = layout.gates[layout.gates.length - 1].gridY;

    // The tile directly north of the gatehouse tower is firstGateY - 2 (e.g. tile 49).
    // It must NOT be skipped, so it connects directly into the north tower.
    const tileNorthOfGatehouse = eastWalls.find((w) => w.gridY === firstGateY - 2);
    expect(tileNorthOfGatehouse).toBeDefined();

    const isTileSkipped = (gridY: number) => gridY >= coveredFrom && gridY <= coveredTo;
    expect(isTileSkipped(firstGateY - 2)).toBe(false);

    // Wall tiles within coveredFrom..coveredTo are skipped because gate.png draws them
    const skippedWalls = eastWalls.filter(
      (w) => w.gridY >= coveredFrom && w.gridY <= coveredTo
    );
    // Out of the 6 covered tiles, 3 are gate openings (not in layout.walls).
    // The remaining 3 are the 1 north tower tile and 2 south wall/tower tiles.
    expect(skippedWalls).toHaveLength(3);
    expect(skippedWalls.map((w) => w.gridY)).toEqual([
      firstGateY - 1, // North tower tile
      lastGateY + 1,  // South tower tile
      lastGateY + 2   // Southern wall front extension
    ]);
  });

  it('handles empty gate arrays gracefully without skipping any tiles', () => {
    const { coveredFrom, coveredTo } = citadelGateCoveredYRange([]);
    expect(coveredFrom).toBe(0);
    expect(coveredTo).toBe(-1);
    expect(coveredTo >= coveredFrom).toBe(false);
  });

  it('handles unsorted gate arrays correctly', () => {
    const unsortedGates = [{ gridY: 53 }, { gridY: 51 }, { gridY: 52 }];
    const { coveredFrom, coveredTo } = citadelGateCoveredYRange(unsortedGates);
    expect(coveredFrom).toBe(50);
    expect(coveredTo).toBe(55);
  });
});

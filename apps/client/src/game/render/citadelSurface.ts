import { CitadelLayout, citadelLayoutFor } from '@chien-quoc/shared';

/**
 * Screen-space height of the citadel wall top, in texture pixels.
 *
 * Shared with the asset pipeline (`scripts/process_citadel_assets.py`), which
 * draws `citadel/wall.png` at the same rise. A unit standing on the wall is
 * lifted by exactly this much so its feet land on the cap.
 */
export const CITADEL_WALL_RISE = 120;

/**
 * Height of the gatehouse roof, in texture pixels.
 *
 * `citadel/gate.png` keeps its 150 px wall front, so the roof between its
 * towers sits 30 px above the plain wall run. Units walking across the gate
 * step up onto it instead of clipping through the merlons.
 */
export const CITADEL_GATE_ROOF_RISE = 150;

/** Tile classification and height lookup for one or more citadels. */
export class CitadelSurface {
  private readonly wallTops = new Set<string>();
  private readonly gateRoofs = new Set<string>();

  constructor(layouts: readonly CitadelLayout[]) {
    for (const layout of layouts) {
      for (const tile of layout.walls) {
        this.wallTops.add(`${tile.gridX},${tile.gridY}`);
      }
      for (const gate of layout.gates) {
        this.gateRoofs.add(`${gate.gridX},${gate.gridY}`);
        this.wallTops.add(`${gate.gridX},${gate.gridY}`);
      }

      // The gate sprite draws six tiles of east-wall front: one north of the
      // opening, the three gate tiles and two south. All six are roof surface.
      if (layout.gates.length > 0) {
        const minGateY = Math.min(...layout.gates.map((gate) => gate.gridY));
        const maxGateY = Math.max(...layout.gates.map((gate) => gate.gridY));
        const eastX = layout.originX + layout.sizeX - 1;
        for (let y = minGateY - 1; y <= maxGateY + 2; y++) {
          this.gateRoofs.add(`${eastX},${y}`);
        }
      }
    }
  }

  /**
   * Vertical lift for a unit at continuous grid `(x, y)`.
   *
   * Only the gate roof and the wall crest sit above the courtyard floor.
   */
  liftAt(x: number, y: number): number {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const key = `${tileX},${tileY}`;

    if (this.gateRoofs.has(key)) return CITADEL_GATE_ROOF_RISE;
    if (this.wallTops.has(key)) return CITADEL_WALL_RISE;
    return 0;
  }
}

/** Builds a surface lookup from the town centers currently in the room. */
export function citadelSurfaceFor(
  townCenters: Iterable<{ gridX: number; gridY: number }>
): CitadelSurface | null {
  const layouts: CitadelLayout[] = [];
  for (const townCenter of townCenters) {
    layouts.push(citadelLayoutFor(townCenter.gridX, townCenter.gridY));
  }
  return layouts.length > 0 ? new CitadelSurface(layouts) : null;
}

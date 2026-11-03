import {
  BATTLEFIELD_MAP_SIZE,
  KINGDOM_MAP_SIZE,
  MapZoneKind,
  zoneKindOf
} from '../constants/index.js';
import { gridToScreen } from './isoMath.js';

export interface RoadSplinePoint {
  x: number;
  y: number;
  variant: number;
}

/** Everything the terrain generator needs to know about one map. */
export interface MapTerrain {
  width: number;
  height: number;
  kind: MapZoneKind;
}

export const TERRAIN_BATTLEFIELD: MapTerrain = { ...BATTLEFIELD_MAP_SIZE, kind: 'battlefield' };
export const TERRAIN_KINGDOM: MapTerrain = { ...KINGDOM_MAP_SIZE, kind: 'kingdom' };

/** Kingdom layouts keep this radius around the Town Center free of roads. */
export const KINGDOM_PLAZA_RADIUS = 7;

/** Terrain layout of the map `zone` lives on. */
export function terrainForZone(zone: string): MapTerrain {
  return zoneKindOf(zone) === 'kingdom' ? TERRAIN_KINGDOM : TERRAIN_BATTLEFIELD;
}

/** Cache key for one layout; every map size has exactly one set of roads. */
function layoutKey(terrain: MapTerrain): string {
  return `${terrain.kind}:${terrain.width}x${terrain.height}`;
}

// ---------------------------------------------------------------------------
// Road geometry
// ---------------------------------------------------------------------------

/** Battlefield: East-West Grand Imperial Highway. */
function battlefieldHighwayY(gx: number, height: number): number {
  return height / 2 + 22 * Math.sin(gx * 0.045) + 9 * Math.cos(gx * 0.09) + 4 * Math.sin(gx * 0.16);
}

/** Battlefield: North-South Royal Silk Axis. */
function battlefieldAxisX(gy: number, width: number): number {
  return width / 2 + 22 * Math.sin(gy * 0.045) + 9 * Math.cos(gy * 0.09) + 4 * Math.sin(gy * 0.16);
}

/** Kingdom: northwest - southeast diagonal through the plaza. */
function kingdomDiagonalY(gx: number): number {
  return gx + 3 * Math.sin(gx * 0.09);
}

/** Kingdom: northeast - southwest diagonal through the plaza. */
function kingdomCounterDiagonalY(gx: number, height: number): number {
  return height - 1 - gx + 3 * Math.sin(gx * 0.07);
}

/**
 * True inside the kingdom's central plaza.
 *
 * The Town Center is placed dead centre and the spawn footprint check rejects
 * road tiles, so a road through the centre would push the base off centre. The
 * plaza also keeps generated resource nodes out of the starting build area; the
 * roads still radiate from it as four arms.
 */
export function isPlazaTile(gx: number, gy: number, terrain: MapTerrain): boolean {
  if (terrain.kind !== 'kingdom') return false;
  const cx = terrain.width / 2;
  const cy = terrain.height / 2;
  return Math.hypot(gx - cx, gy - cy) <= KINGDOM_PLAZA_RADIUS;
}

/**
 * Raw deterministic road test for one integer tile, without the lookup table.
 * Used to build the cached grid for a layout.
 */
function computeIsDirtRoadTile(gx: number, gy: number, terrain: MapTerrain): boolean {
  if (terrain.kind === 'kingdom') {
    if (isPlazaTile(gx, gy, terrain)) return false;
    const inRange = gx >= 4 && gx < terrain.width - 4;
    if (!inRange) return false;

    if (Math.abs(gy - kingdomDiagonalY(gx)) <= 1.15) return true;
    if (Math.abs(gy - kingdomCounterDiagonalY(gx, terrain.height)) <= 1.15) return true;
    return false;
  }

  // 1. East-West Grand Imperial Highway
  const ewCenterY = battlefieldHighwayY(gx, terrain.height);
  if (Math.abs(gy - ewCenterY) <= 1.35) {
    return true;
  }

  // 2. North-South Royal Silk Axis
  const nsCenterX = battlefieldAxisX(gy, terrain.width);
  if (Math.abs(gx - nsCenterX) <= 1.35) {
    return true;
  }

  // 3. Northwest - Southeast Diagonal Route
  const nwSeLine = gx - gy;
  const nwSeMeander = 12 * Math.sin((gx + gy) * 0.035);
  if (Math.abs(nwSeLine - nwSeMeander) <= 1.15) {
    return true;
  }

  // 4. Northeast - Southwest Diagonal Route
  const neSwLine = gx + gy - terrain.height;
  const neSwMeander = 12 * Math.sin((gx - gy) * 0.035);
  if (Math.abs(neSwLine - neSwMeander) <= 1.15) {
    return true;
  }

  // 5. Central Grand Crossroads Hub
  const distCenter = Math.hypot(gx - terrain.width / 2, gy - terrain.height / 2);
  if (distCenter <= 4.5) {
    return true;
  }

  return false;
}

const roadSplineCache = new Map<string, RoadSplinePoint[]>();
const dirtRoadGridCache = new Map<string, Uint8Array>();

/**
 * Pre-calculated dense spline points for rendering continuous organic AoE dirt
 * roads, cached per layout.
 */
export function getRoadSplinePoints(terrain: MapTerrain = TERRAIN_BATTLEFIELD): RoadSplinePoint[] {
  const key = layoutKey(terrain);
  const cached = roadSplineCache.get(key);
  if (cached) return cached;

  const { width, height } = terrain;
  const points: RoadSplinePoint[] = [];
  const addPoint = (gx: number, gy: number, seed: number) => {
    if (gx < 0 || gx >= width || gy < 0 || gy >= height) return;
    if (isPlazaTile(gx, gy, terrain)) return;
    const screen = gridToScreen(gx, gy);
    const variant = (Math.abs(Math.floor(seed)) % 3) + 1;
    points.push({
      x: Math.round(screen.x),
      y: Math.round(screen.y),
      variant
    });
  };

  const step = 0.35;

  if (terrain.kind === 'kingdom') {
    // A pair of diagonals crossing under the plaza: the Town Center sits in the
    // gap, and the roads leave it as four arms instead of cutting it in half.
    for (let gx = 4; gx < width - 4; gx += step) {
      addPoint(gx, kingdomDiagonalY(gx), gx * 7.13);
    }
    for (let gx = 4; gx < width - 4; gx += step) {
      addPoint(gx, kingdomCounterDiagonalY(gx, height), gx * 5.41);
    }
  } else {
    // 1. East-West Grand Imperial Highway
    for (let gx = 0; gx < width; gx += step) {
      addPoint(gx, battlefieldHighwayY(gx, height), gx * 7.13);
    }

    // 2. North-South Royal Silk Axis
    for (let gy = 0; gy < height; gy += step) {
      addPoint(battlefieldAxisX(gy, width), gy, gy * 5.41);
    }

    // 3. Northwest - Southeast Diagonal Route
    for (let s = 5; s < width - 5; s += step) {
      const meander = 12 * Math.sin(s * 0.07);
      addPoint(s + meander / 2, s - meander / 2, s * 9.27);
    }

    // 4. Northeast - Southwest Diagonal Route
    for (let s = 5; s < width - 5; s += step) {
      const meander = 12 * Math.sin((s - (height - s)) * 0.035);
      addPoint(s, height - s + meander, s * 3.82);
    }

    // 5. Central Crossroads Hub Plaza
    const hubX = width / 2;
    const hubY = height / 2;
    for (let r = 0.8; r <= 3.8; r += 1.0) {
      const count = Math.round(r * 8);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        addPoint(hubX + r * Math.cos(angle), hubY + r * Math.sin(angle), i * 4.1);
      }
    }
  }

  roadSplineCache.set(key, points);
  return points;
}

/**
 * Builds the one-byte-per-tile road lookup for one layout.
 *
 * Re-evaluating the trigonometry on every call used to be the bottleneck of
 * spawn footprint scans (thousands of calls per join); the table turns each
 * query into an indexed read.
 */
function getDirtRoadGrid(terrain: MapTerrain): Uint8Array {
  const key = layoutKey(terrain);
  const cached = dirtRoadGridCache.get(key);
  if (cached) return cached;

  const { width, height } = terrain;
  const grid = new Uint8Array(width * height);
  for (let gy = 0; gy < height; gy++) {
    const rowOffset = gy * width;
    for (let gx = 0; gx < width; gx++) {
      if (computeIsDirtRoadTile(gx, gy, terrain)) {
        grid[rowOffset + gx] = 1;
      }
    }
  }

  dirtRoadGridCache.set(key, grid);
  return grid;
}

/**
 * Deterministically checks whether a given (gx, gy) coordinate belongs to a dirt
 * road on `terrain`.
 *
 * The layout is required: the battlefield and a kingdom have different roads, so
 * a default here would silently test the wrong map.
 */
export function isDirtRoadTile(gx: number, gy: number, terrain: MapTerrain): boolean {
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  if (ix < 0 || ix >= terrain.width || iy < 0 || iy >= terrain.height) {
    return false;
  }

  return getDirtRoadGrid(terrain)[iy * terrain.width + ix] === 1;
}

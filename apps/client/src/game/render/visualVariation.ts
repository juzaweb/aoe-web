/**
 * Deterministic visual variation helpers.
 *
 * The terrain used to pick its grass tile with `(gx * 7 + gy * 13) % 3`, which
 * is algebraically `(gx + gy) % 3` and therefore paints diagonal stripes across
 * the whole map. Everything here is a pure function of coordinates (and an
 * optional seed) so two clients see the same forest without the server
 * replicating a single variant, and so the renderer can call it every frame
 * without allocating.
 *
 * No Phaser import: the module is unit-tested under Node.
 */

/** Cheap 32-bit integer hash in [0, 1). Stable across engines and platforms. */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hash of a string id (resource nodes, buildings) into [0, 1). */
export function hashString(value: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Murmur3 finaliser: FNV alone leaves short sequential ids (node-1, node-2,
  // ...) correlated in their low bits, which showed up as a 62/38 mirror split.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinear value noise on the integer lattice, in [0, 1]. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

/** Fractal value noise in [0, 1], used for low-frequency tint fields. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + i * 101);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

/** One of the three grass textures, hashed per tile (never `(gx + gy) % 3`). */
export function grassTextureIndex(gx: number, gy: number): 1 | 2 | 3 {
  const pick = Math.floor(hash2(gx, gy, 0x9e3779b1) * 3);
  return (pick >= 2 ? 3 : pick + 1) as 1 | 2 | 3;
}

/** 0xfff3e4 (dry, warm) <-> 0xe8f5e4 (lush, cool), blended by low-freq noise. */
const TINT_DRY = { r: 255, g: 243, b: 228 };
const TINT_LUSH = { r: 232, g: 245, b: 228 };

/**
 * Per-tile grass tint as a Phaser tint integer.
 *
 * A 30-50 tile field keeps the variation readable at play zoom (a per-tile
 * random tint would just look like noise) while every channel stays above 0.84,
 * so no tile gets noticeably darker than its neighbour.
 */
export function grassTint(gx: number, gy: number): number {
  const t = fbm(gx / 40, gy / 40, 0x51ed, 4);
  const r = Math.round(lerp(TINT_DRY.r, TINT_LUSH.r, t));
  const g = Math.round(lerp(TINT_DRY.g, TINT_LUSH.g, t));
  const b = Math.round(lerp(TINT_DRY.b, TINT_LUSH.b, t));
  return (r << 16) | (g << 8) | b;
}

export interface ResourceLook {
  scale: number;
  flipX: boolean;
  tint: number;
  offsetX: number;
  offsetY: number;
}

const TREE_TINT_MIN = { r: 223, g: 232, b: 207 };
const WHITE = { r: 255, g: 255, b: 255 };

/**
 * Variation for one resource node sprite.
 *
 * Trees get the widest range because a forest is mostly trees: scale 0.90-1.15,
 * a coin-flip mirror and a slight cool tint break up the four silhouettes.
 * Ore and bushes move much less, so their type stays readable and the node never
 * looks like a different resource.
 */
export function resourceLook(id: string, type: string): ResourceLook {
  const h1 = hashString(id, 11);
  const h2 = hashString(id, 23);
  const h3 = hashString(id, 37);
  if (type === 'TREE') {
    return {
      scale: 0.9 + h1 * 0.25,
      flipX: h2 < 0.5,
      tint:
        (Math.round(lerp(TREE_TINT_MIN.r, WHITE.r, h3)) << 16) |
        (Math.round(lerp(TREE_TINT_MIN.g, WHITE.g, h3)) << 8) |
        Math.round(lerp(TREE_TINT_MIN.b, WHITE.b, h3)),
      offsetX: (h2 - 0.5) * 3,
      offsetY: -h3 * 2
    };
  }
  return {
    scale: 0.96 + h1 * 0.09,
    flipX: false,
    tint: 0xffffff,
    offsetX: 0,
    offsetY: 0
  };
}

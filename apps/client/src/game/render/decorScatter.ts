import { MapTerrain, isDirtRoadTile } from '@chien-quoc/shared';
import { fbm, hash2, hashString } from './visualVariation.js';

/**
 * Deterministic ground-cover scatter.
 *
 * The rule is pure: the same tile always grows the same plant, so the decoration
 * is identical for every client and on every reload without the server
 * replicating anything. Only tiles inside the visible viewport are asked, so a
 * 220x220 map never costs more than a screenful of queries.
 *
 * Decor is deliberately sparse (a few percent of tiles) and grouped: plant
 * density comes from a low-frequency field, so flowers appear in patches instead
 * of as an even noise. The per-tile roll then thins each patch out.
 */

/** Grass (and border forest) drawn beyond the playable map edge. */
export const MAP_APRON_TILES = 4;

export type DecorCategory = 'forb' | 'rock' | 'border-tree';

export interface DecorChoice {
  category: DecorCategory;
  /** 1-based index into the category's texture list. */
  variant: number;
  scale: number;
  flipX: boolean;
  /** Sway phase in radians; the renderer advances it with time. */
  phase: number;
}

/** Forb variants split by measured look: flowers vs green tufts. */
export const FLOWER_FORBS = [1, 4, 12];
export const GRASS_FORBS = [2, 3, 5, 6, 7, 8, 9, 10, 11];

const ROCK_CHANCE = 0.008;
const BUSH_CHANCE = 0.012;
const FLOWER_MAX = 0.12;
const GRASS_MAX = 0.14;

function smooth01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function pick<T>(list: T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}

function forbVariant(seedRoll: number, flower: boolean): number {
  return pick(flower ? FLOWER_FORBS : GRASS_FORBS, seedRoll);
}

/** Tile key used by the blocked set. */
export function tileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

/**
 * Ground cover on one playable tile, or null.
 *
 * `blocked` holds tiles occupied by a resource node, a building footprint or the
 * plaza, so decor never grows through a trunk or a foundation.
 */
export function decorAt(
  gx: number,
  gy: number,
  terrain: MapTerrain,
  blocked: ReadonlySet<string>
): DecorChoice | null {
  if (gx < 0 || gy < 0 || gx >= terrain.width || gy >= terrain.height) return null;
  if (blocked.has(tileKey(gx, gy))) return null;
  if (isDirtRoadTile(gx, gy, terrain)) return null;

  const roll = hash2(gx, gy, 0x1a2b);
  if (roll < ROCK_CHANCE) {
    return {
      category: 'rock',
      variant: Math.floor(hash2(gx, gy, 0x2b3c) * 6) + 1,
      scale: 0.7 + hash2(gx, gy, 0x3c4d) * 0.3,
      flipX: hash2(gx, gy, 0x4d5e) < 0.5,
      phase: 0
    };
  }
  if (roll < ROCK_CHANCE + BUSH_CHANCE) {
    return {
      category: 'forb',
      variant: pick(GRASS_FORBS, hash2(gx, gy, 0x5e6f)),
      scale: 0.55 + hash2(gx, gy, 0x6f70) * 0.25,
      flipX: hash2(gx, gy, 0x7081) < 0.5,
      phase: hash2(gx, gy, 0x8192) * Math.PI * 2
    };
  }

  const flowerField = fbm(gx / 26, gy / 26, 0x9a1b, 3);
  const flowerChance = smooth01((flowerField - 0.58) / 0.42) * FLOWER_MAX;
  if (hash2(gx, gy, 0xa1b2) < flowerChance) {
    return {
      category: 'forb',
      variant: forbVariant(hash2(gx, gy, 0xb2c3), true),
      scale: 0.5 + hash2(gx, gy, 0xc3d4) * 0.3,
      flipX: hash2(gx, gy, 0xd4e5) < 0.5,
      phase: hash2(gx, gy, 0xe5f6) * Math.PI * 2
    };
  }

  const grassField = fbm(gx / 21, gy / 21, 0x7c2d, 3);
  const grassChance = smooth01((grassField - 0.55) / 0.45) * GRASS_MAX;
  if (hash2(gx, gy, 0xf607) < grassChance) {
    return {
      category: 'forb',
      variant: forbVariant(hash2(gx, gy, 0x1122), false),
      scale: 0.45 + hash2(gx, gy, 0x2233) * 0.3,
      flipX: hash2(gx, gy, 0x3344) < 0.5,
      phase: hash2(gx, gy, 0x4455) * Math.PI * 2
    };
  }

  return null;
}

/**
 * Border forest outside the map.
 *
 * Ring 1 (first tile beyond the edge) is dense, ring 2 thinner, ring 3 sparse,
 * so the edge fades instead of ending on a hard line. Trees are much larger than
 * ground cover, so the per-tile chance is lower than the visible overlap
 * suggests.
 */
export function borderDecorAt(gx: number, gy: number, terrain: MapTerrain): DecorChoice | null {
  const ring = Math.max(-gx, gx - (terrain.width - 1), -gy, gy - (terrain.height - 1));
  if (ring < 1 || ring > MAP_APRON_TILES) return null;
  const density = [0.22, 0.13, 0.07, 0.03][ring - 1] ?? 0;
  if (hash2(gx, gy, 0x5566) >= density) return null;
  return {
    category: 'border-tree',
    variant: Math.floor(hash2(gx, gy, 0x6677) * 3) + 1,
    scale: 0.8 + hash2(gx, gy, 0x7788) * 0.3,
    flipX: hash2(gx, gy, 0x8899) < 0.5,
    phase: hash2(gx, gy, 0x99aa) * Math.PI * 2
  };
}

/**
 * One or two grass tufts at the base of a resource tree.
 *
 * A bare trunk on a flat tile reads as a sticker; a couple of tufts around the
 * root, offset inside the same tile, tie the sprite to the ground.
 */
export function canopyDecor(treeId: string, gx: number, gy: number): DecorChoice[] {
  const id = hashString(treeId, 0x71);
  const count = hash2(gx, gy, 0xab12) + id * 0.3 < 0.55 ? 2 : 1;
  const out: DecorChoice[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      category: 'forb',
      variant: pick(GRASS_FORBS, (id + hash2(gx, gy, 0xbc23 + i)) % 1),
      scale: 0.35 + hash2(gx, gy, 0xcd34 + i) * 0.2,
      flipX: hash2(gx, gy, 0xde45 + i) < 0.5,
      phase: hash2(gx, gy, 0xef56 + i) * Math.PI * 2
    });
  }
  return out;
}

import type { DecorCategory } from './decorScatter.js';

/**
 * Texture keys and file names for the decorative sprites built by
 * `scripts/assets/build.py` (`decor.*` targets).
 *
 * Keep this list in sync with `apps/client/public/assets/decor/`: the manifest
 * owns the files, this table is the only place the renderer learns about them.
 */
export interface DecorCategoryArt {
  readonly prefix: string;
  /** File-name stem: `forb_01.png`, `border_tree_01.png`. */
  readonly dir: string;
  readonly count: number;
}

export const DECOR_ART: Record<DecorCategory, DecorCategoryArt> = {
  forb: { prefix: 'decor_forb_', dir: 'forb', count: 12 },
  rock: { prefix: 'decor_rock_', dir: 'rock', count: 6 },
  'border-tree': { prefix: 'decor_border_tree_', dir: 'border_tree', count: 3 }
};

/** Phaser texture key for one decor variant (1-based, matching the manifest). */
export function decorTextureKey(category: DecorCategory, variant: number): string {
  const art = DECOR_ART[category];
  const clamped = Math.min(art.count, Math.max(1, Math.round(variant)));
  return `${art.prefix}${clamped}`;
}

/** Every key the scene has to preload, as `{ key, url }` pairs. */
export function decorPreloadList(version: string): Array<{ key: string; url: string }> {
  const list: Array<{ key: string; url: string }> = [];
  for (const art of Object.values(DECOR_ART)) {
    for (let i = 1; i <= art.count; i++) {
      const file = `${art.dir}_${String(i).padStart(2, '0')}.png`;
      list.push({ key: `${art.prefix}${i}`, url: `/assets/decor/${file}?${version}` });
    }
  }
  return list;
}

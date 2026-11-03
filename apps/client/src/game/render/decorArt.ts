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
  readonly count: number;
}

export const DECOR_ART: Record<DecorCategory, DecorCategoryArt> = {
  forb: { prefix: 'decor_forb_', count: 12 },
  rock: { prefix: 'decor_rock_', count: 6 },
  'border-tree': { prefix: 'decor_border_tree_', count: 3 }
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
  for (const [category, art] of Object.entries(DECOR_ART)) {
    const dir = category === 'border-tree' ? 'border_tree' : category;
    for (let i = 1; i <= art.count; i++) {
      const file = `${dir}_${String(i).padStart(2, '0')}.png`;
      list.push({ key: `${art.prefix}${i}`, url: `/assets/decor/${file}?${version}` });
    }
  }
  return list;
}

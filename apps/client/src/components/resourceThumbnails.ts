import type { ResourceNodeType } from '@chien-quoc/shared';

/**
 * One map from a resource node to its portrait sheet.
 *
 * The selection strip and the entity sheet both draw the node the player
 * selected. They used to build the path independently — one as a chained
 * ternary, the other as a lookup table with the same values — which is exactly
 * the shape that lets one surface show a tree and the other a bush. Same
 * `?v=` cache-busting version as the other art tables.
 */
const RESOURCE_ART: Record<ResourceNodeType, string> = {
  TREE: 'tree',
  GOLD_MINE: 'gold',
  STONE_MINE: 'stone',
  BERRY_BUSH: 'berry'
};

/**
 * Portrait URL for a resource node subtype.
 *
 * An unknown subtype falls back to the berry bush, matching the previous
 * behaviour: a node type added later shows *a* resource instead of a 404.
 */
export function resourceThumbnail(subType: string): string {
  const art = RESOURCE_ART[subType as ResourceNodeType] ?? RESOURCE_ART.BERRY_BUSH;
  return `/assets/resources/${art}.png?v=3`;
}

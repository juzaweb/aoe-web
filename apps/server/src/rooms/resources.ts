import { MapTerrain, RESOURCE_REGROW_MS, ResourceType, isPlazaTile } from '@chien-quoc/shared';

/**
 * Id prefix of the resources handed out with a new empire's Town Center.
 *
 * Like a felled tree in AoE, those are consumed permanently: the player must
 * expand to the map's edge ring for a renewable supply. Carrying the marker in
 * the row id (rather than a schema field or a column) means it is saved and
 * restored with the node for free.
 */
export const STARTER_RESOURCE_PREFIX = 'res_starter_';

/** Id for a starter node, given the value from the shared entity sequence. */
export function starterResourceId(id: number): string {
  return `${STARTER_RESOURCE_PREFIX}${id}`;
}

/** True for a node placed by `spawnInitialBase`. */
function isStarterResourceNode(node: { id: string }): boolean {
  return node.id.startsWith(STARTER_RESOURCE_PREFIX);
}

/**
 * Whether a depleted node is gone for good instead of refilling later.
 *
 * Starter nodes are recognised by their id. A save made before the prefix
 * existed is recognised by position instead: generated nodes are never placed
 * on a plaza tile (see `generateWorldResources`), so a plaza node can only be
 * a starter node.
 */
export function isOneOffResourceNode(
  node: { id: string; gridX: number; gridY: number },
  terrain: MapTerrain
): boolean {
  return isStarterResourceNode(node) || isPlazaTile(node.gridX, node.gridY, terrain);
}

/** How long a depleted node waits before refilling, by resource type. */
export function regrowDelayMs(resourceType: string): number {
  return RESOURCE_REGROW_MS[resourceType as ResourceType] ?? RESOURCE_REGROW_MS.wood;
}

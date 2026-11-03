/**
 * Which of the four tree silhouettes a resource node draws.
 *
 * Kept in its own Phaser-free module so tests can exercise it under Node, and
 * because the rule is presentation-only: it derives from the replicated grid
 * position rather than a random draw, so every client lands on the same
 * variant and a node keeps its look across reloads.
 *
 * Returns 1..4, where 1 is the canonical `res_node_TREE` texture.
 */
export function treeVariant(gridX: number, gridY: number): number {
  return (Math.abs(gridX * 31 + gridY * 17) % 4) + 1;
}

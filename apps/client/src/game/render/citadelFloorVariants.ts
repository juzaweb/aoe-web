import { hash2 } from './visualVariation.js';

/**
 * Which of the three citadel floor diamonds a tile draws.
 *
 * The compound is 26x26, so 576 stones used to be the *same* 128x64 diamond over
 * and over, which read as one flat plate: no joint variation, no damp patches,
 * no stone-to-stone difference. Three textures fix that, and picking between them
 * from the grid position means the result is free — no extra state on the wire,
 * no server change, and every client draws the same courtyard.
 *
 * `hash2` rather than `(x + y) % 3`: a linear rule paints diagonal stripes
 * across the floor, which is exactly the bug the grass tiling already hit.
 *
 * Returns 0 for the base `citadel_floor` texture, 1 and 2 for `citadel_floor_1`
 * and `citadel_floor_2`. Phaser-free so the rule is unit-tested under Node.
 */
export function floorVariantAt(gridX: number, gridY: number): 0 | 1 | 2 {
  const pick = Math.floor(hash2(gridX, gridY, 0x1f2e3d4c) * 3);
  return (pick >= 2 ? 2 : pick) as 0 | 1 | 2;
}

/** Phaser texture key for a variant, with the base texture as the fallback. */
export function floorTextureKey(variant: 0 | 1 | 2): string {
  return variant === 0 ? 'citadel_floor' : `citadel_floor_${variant}`;
}

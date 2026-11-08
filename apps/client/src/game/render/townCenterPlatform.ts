/**
 * Raised stone terrace under the Town Center.
 *
 * The PNG is built by `scripts/process_citadel_assets.py`, which also owns the
 * geometry. The constants below are the client half of that contract: if the
 * generator changes the rise or the canvas, these numbers must move with it or
 * the building will float above (or sink into) its own base.
 *
 * The artwork is drawn by `CitadelLayer` at the Town Center's tile, one rise
 * above the floor. `EntityRenderer` lifts the building sprite by the same rise,
 * so the base of the art lands on the terrace.
 */
export const TC_PLATFORM_TEXTURE = 'citadel_tc_platform';

/** Pixels the terrace top sits above the citadel floor. */
export const TC_PLATFORM_RISE = 48;

/**
 * Origin of the terrace image: the top-face centre, in texture pixels over the
 * shipped canvas (784x555, anchor 392/200).
 */
export const TC_PLATFORM_ORIGIN_X = 392 / 784;
export const TC_PLATFORM_ORIGIN_Y = 200 / 555;

/**
 * How far to lift a building's art, in container pixels.
 *
 * Only the Town Center gets a terrace, only in a kingdom (the battlefield has no
 * citadel layer), and only when the texture actually loaded. A missing PNG has
 * to leave the building on the ground rather than hovering over nothing.
 */
export function townCenterLift(
  type: string,
  hasTexture: (textureKey: string) => boolean,
  isKingdom: boolean
): number {
  return type === 'TOWN_CENTER' && isKingdom && hasTexture(TC_PLATFORM_TEXTURE)
    ? TC_PLATFORM_RISE
    : 0;
}

/**
 * Shared conventions for the directional unit art.
 *
 * Every directional sheet stores one row per compass direction and one column
 * per animation frame, so a Phaser spritesheet frame index is
 * `directionIndex * framesPerDirection + frame`. Row order is compass-from-east
 * (E, SE, S, SW, W, NW, N, NE) so the index falls straight out of
 * `atan2(screenDy, screenDx)` for every action, not just the walk.
 *
 * How many columns a sheet has is per unit *and* per action (the villager walk
 * cycle is 11 frames, its idle only 4), so it arrives as an argument rather than
 * a module constant; `unitArt.ts` owns that config.
 *
 * Sheets live at `assets/units/actions/<unit>_<action>.png`; the legacy
 * single-facing `<unit>_sheet.png` stays on disk as the fallback for units that
 * have not been redrawn yet.
 */
export const DIRECTION_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

export type DirectionName = (typeof DIRECTION_NAMES)[number];

/** Facing used before a unit has moved: toward the viewer. */
export const DEFAULT_DIRECTION_INDEX = 2;

export type UnitAction = 'idle' | 'walk' | 'carry' | 'attack' | 'death' | 'build' | 'gather';

export const UNIT_ACTIONS: readonly UnitAction[] = [
  'idle',
  'walk',
  'carry',
  'attack',
  'death',
  'build',
  'gather'
];

export const ACTION_FRAME_RATE: Record<UnitAction, number> = {
  idle: 4,
  walk: 8,
  carry: 8,
  attack: 10,
  death: 7,
  build: 7,
  gather: 7
};

/** One-shot clips stop on their last frame; looping ones repeat forever. */
export const ACTION_REPEAT: Record<UnitAction, number> = {
  idle: -1,
  walk: -1,
  carry: -1,
  attack: -1,
  death: 0,
  build: -1,
  gather: -1
};

/** Angular width of one compass row, in radians (360° / 8). */
export const DIRECTION_STEP_RAD = Math.PI / 4;

/**
 * How far past the boundary between two rows a heading has to be before the
 * sprite switches row, in radians.
 *
 * Without it, a unit walking close to a 22.5° boundary re-quantizes between the
 * two neighbouring rows whenever the measured heading jitters by a fraction of a
 * degree, which reads as a shivering sprite. 7.5° absorbs that jitter and is
 * still narrow enough that a deliberate turn switches row immediately.
 */
export const DIRECTION_HYSTERESIS_RAD = Math.PI / 24;

/** Signed shortest rotation from `from` to `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Centre angle of one compass row, in the sheet's screen-space convention. */
export function directionAngle(direction: number): number {
  return direction * DIRECTION_STEP_RAD;
}

/** Compass index of a screen-space heading, with no hysteresis. */
export function directionIndexFromAngle(angleRad: number): number {
  const index = Math.round(angleRad / DIRECTION_STEP_RAD);
  return ((index % 8) + 8) % 8;
}

/**
 * Screen-space heading as a compass index. Phaser's y axis points down, so
 * positive dy is "south", which is why the sheet's row order starts at east and
 * turns clockwise.
 */
export function directionIndex(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return DEFAULT_DIRECTION_INDEX;
  return directionIndexFromAngle(Math.atan2(dy, dx));
}

/**
 * Compass index of a heading, holding `current` until the heading is clear of it.
 *
 * The hold band is the half-width of a row (`DIRECTION_STEP_RAD / 2`) plus
 * `hysteresisRad`, so the row only changes once the heading is decisively in the
 * next 45° sector.
 */
export function quantizeDirection(
  angleRad: number,
  current: number,
  hysteresisRad: number = DIRECTION_HYSTERESIS_RAD
): number {
  const candidate = directionIndexFromAngle(angleRad);
  if (candidate === current) return current;
  const offsetFromCurrent = Math.abs(shortestAngleDelta(directionAngle(current), angleRad));
  return offsetFromCurrent >= DIRECTION_STEP_RAD / 2 + hysteresisRad ? candidate : current;
}

/**
 * Texture key of a unit's action sheet, e.g. `unit_SPEARMAN_act_walk`.
 *
 * The `act_` infix keeps these apart from the legacy single-frame keys
 * (`unit_SPEARMAN_idle`, `unit_SPEARMAN_sheet`), which are still loaded as
 * fallbacks; sharing a key would leave Phaser holding whichever loaded last.
 */
export function unitActionTexture(unitType: string, action: UnitAction): string {
  return `unit_${unitType}_act_${action}`;
}

/**
 * Texture key of the team-colour layer drawn over an action sheet.
 *
 * The accent sheet is the same grid as the body sheet and is only ever drawn on
 * top of it, tinted with the owner's colour, so it needs the body's texture key
 * plus a suffix rather than a second naming scheme.
 */
export function unitActionAccentTexture(unitType: string, action: UnitAction): string {
  return `${unitActionTexture(unitType, action)}_accent`;
}

/** Animation key of one action in one facing, e.g. `spearman_walk_SE`. */
export function unitActionKey(unitType: string, action: UnitAction, direction: number): string {
  return `${unitType.toLowerCase()}_${action}_${DIRECTION_NAMES[direction]}`;
}

/** Animation key of the team-colour layer, e.g. `archer_walk_SE_accent`. */
export function unitActionAccentKey(unitType: string, action: UnitAction, direction: number): string {
  return `${unitActionKey(unitType, action, direction)}_accent`;
}

/** Frame indices of one row of an action sheet. */
export function actionRowFrames(direction: number, framesPerDirection: number): number[] {
  const first = direction * framesPerDirection;
  return Array.from({ length: framesPerDirection }, (_, index) => first + index);
}

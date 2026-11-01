/**
 * Shared conventions for the directional unit art.
 *
 * Every directional sheet stores one row per compass direction and one column
 * per animation frame, so a Phaser spritesheet frame index is
 * `directionIndex * FRAMES_PER_DIRECTION + frame`. Row order is compass-from-east
 * (E, SE, S, SW, W, NW, N, NE) so the index falls straight out of
 * `atan2(screenDy, screenDx)` for every action, not just the walk.
 *
 * Sheets live at `assets/units/actions/<unit>_<action>.png`; the legacy
 * single-facing `<unit>_sheet.png` stays on disk as the fallback for units that
 * have not been redrawn yet.
 */
export const DIRECTION_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

export type DirectionName = (typeof DIRECTION_NAMES)[number];

export const FRAMES_PER_DIRECTION = 4;

/** Facing used before a unit has moved: toward the viewer. */
export const DEFAULT_DIRECTION_INDEX = 2;

export type UnitAction = 'idle' | 'walk' | 'attack' | 'death' | 'build' | 'gather';

export const UNIT_ACTIONS: readonly UnitAction[] = ['idle', 'walk', 'attack', 'death', 'build', 'gather'];

export const ACTION_FRAME_RATE: Record<UnitAction, number> = {
  idle: 4,
  walk: 8,
  attack: 10,
  death: 7,
  build: 7,
  gather: 7
};

/** One-shot clips stop on their last frame; looping ones repeat forever. */
export const ACTION_REPEAT: Record<UnitAction, number> = {
  idle: -1,
  walk: -1,
  attack: -1,
  death: 0,
  build: -1,
  gather: -1
};

/** Frame size of each unit's action sheets, in pixels per cell. */
export const UNIT_FRAME_SIZE: Record<string, number> = {
  VILLAGER: 128,
  SPEARMAN: 128,
  ARCHER: 128,
  CAVALRY: 160
};

/**
 * Which action sheets each unit ships. The villager predates the action set and
 * only has the directional walk sheet; its other states fall back to the legacy
 * single-facing sheet.
 */
export const UNIT_ACTION_SETS: Record<string, readonly UnitAction[]> = {
  VILLAGER: ['walk'],
  SPEARMAN: UNIT_ACTIONS,
  ARCHER: UNIT_ACTIONS,
  CAVALRY: UNIT_ACTIONS
};

/**
 * Units that ship directional sheets. Units absent from this list keep the
 * legacy single-facing sheet and are flipped horizontally instead.
 */
export const DIRECTIONAL_UNITS = Object.keys(UNIT_ACTION_SETS);

/**
 * Screen-space heading as a compass index. Phaser's y axis points down, so
 * positive dy is "south", which is why the sheet's row order starts at east and
 * turns clockwise.
 */
export function directionIndex(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return DEFAULT_DIRECTION_INDEX;
  const step = Math.PI / 4;
  const index = Math.round(Math.atan2(dy, dx) / step);
  return ((index % 8) + 8) % 8;
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

/** Animation key of one action in one facing, e.g. `spearman_walk_SE`. */
export function unitActionKey(unitType: string, action: UnitAction, direction: number): string {
  return `${unitType.toLowerCase()}_${action}_${DIRECTION_NAMES[direction]}`;
}

/** Frame indices of one row of an action sheet. */
export function actionRowFrames(direction: number): number[] {
  const first = direction * FRAMES_PER_DIRECTION;
  return Array.from({ length: FRAMES_PER_DIRECTION }, (_, index) => first + index);
}

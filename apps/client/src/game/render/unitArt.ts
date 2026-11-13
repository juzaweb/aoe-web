import type { UnitAction } from './unitDirections.js';
import { ACTION_FRAME_RATE, ACTION_REPEAT } from './unitDirections.js';

/**
 * Per-unit artwork geometry and clip schedule.
 *
 * The sheets themselves are plain grids: one row per compass direction, one
 * column per frame, at `frameWidth x frameHeight` per cell. Everything that
 * differs between units lives here so `WorldScene` (loading) and `EntityRenderer`
 * (drawing) only ever read config instead of branching on unit type.
 */
interface UnitActionTiming {
  /** Playback rate override; `ACTION_FRAME_RATE[action]` when omitted. */
  fps?: number;
  /** Repeat override; `ACTION_REPEAT[action]` when omitted. */
  repeat?: number;
}

/**
 * One action's art. Either the unit ships its own sheet, or it replays another
 * action's - villagers chop and hammer with their melee swing and the pack ships
 * no gather/build animation, so both alias `attack` rather than carrying a
 * byte-identical copy of it.
 *
 * The frame count is deliberately *not* restated on an alias: it is read from the
 * action being replayed, so the two cannot drift apart.
 */
export type UnitActionArt =
  | (UnitActionTiming & { frames: number; alias?: undefined })
  | (UnitActionTiming & { alias: UnitAction; frames?: undefined });

export interface UnitArt {
  frameWidth: number;
  frameHeight: number;
  /** Sprite scale, so figures of differently sized sheets match on the ground. */
  scale: number;
  /**
   * Sprite offset from the unit's feet anchor, in display px. Derived from the
   * sole row inside the sheet: `(soleY - frameHeight / 2) * scale`.
   */
  offsetY: number;
  bodyOffsetY: number;
  bodyRadiusX: number;
  bodyRadiusY: number;
  ringRadiusX: number;
  ringRadiusY: number;
  /**
   * Directional action sets this unit ships. An action that is missing falls
   * back to the legacy single-facing sheet (`<unit>_sheet.png`) clips.
   */
  actions: Partial<Record<UnitAction, UnitActionArt>>;
  /**
   * TEAM-04: the unit also ships a second, translucent copy of every action
   * sheet (`<unit>_<action>_accent.png`) whose alpha covers only the dyed cloth.
   * The renderer tints that layer with the owner's colour, so one set of renders
   * serves every team colour.
   *
   * Off for the units still drawn from painted 2D art: they have no second
   * layer, and `setTint` on the body would recolour the whole figure.
   */
  accentSheet?: boolean;
}

/**
 * Fallback for a unit type with no entry: the legacy 128 px single-facing art
 * that every unit was originally drawn on.
 */
export const DEFAULT_UNIT_ART: UnitArt = {
  frameWidth: 128,
  frameHeight: 128,
  scale: 0.72,
  offsetY: -40,
  bodyOffsetY: -37,
  bodyRadiusX: 36,
  bodyRadiusY: 40,
  ringRadiusX: 26,
  ringRadiusY: 13,
  actions: {}
};

/**
 * Geometry of the pack's 148x130 cell, shared by every unit drawn on it: feet on
 * row ~106, figure ~86 px tall, so 0.92 draws it at the same height as the 110 px
 * procedural art it replaced. Soldiers use the same numbers as the villager so
 * their feet land on the same ground line on the same tile.
 */
const PACK_FIGURE: Omit<UnitArt, 'actions'> = {
  frameWidth: 148,
  frameHeight: 130,
  scale: 0.92,
  offsetY: -38,
  bodyOffsetY: -37,
  bodyRadiusX: 36,
  bodyRadiusY: 40,
  ringRadiusX: 26,
  ringRadiusY: 13
};

export const UNIT_ART: Record<string, UnitArt> = {
  /** Sheets are the OpenGameArt "400+ Items" pack (SKYZ0R, CC-BY 4.0). */
  VILLAGER: {
    ...PACK_FIGURE,
    actions: {
      idle: { frames: 4 },
      // 11 frames at 16 fps keeps the walk cycle around 0.7 s; the legacy sheet
      // had 4 frames at 8 fps (0.5 s) and read as a scurry.
      walk: { frames: 11, fps: 16 },
      // The pack has no "carry" animation, so the load is a worn layer: the same
      // walk cycle with `Satchel` composited on top. Same frame count and rate as
      // `walk` on purpose, so picking up a load does not change the stride.
      carry: { frames: 11, fps: 16 },
      attack: { frames: 10, fps: 12 },
      death: { frames: 8, fps: 9 },
      gather: { alias: 'attack', fps: 9 },
      build: { alias: 'attack', fps: 9 }
    }
  },
  /**
   * Rendered from the project's own 3D soldier model (`scripts/raw_downloads/models/linh.glb`)
   * onto 192x168 cells so the raised/extended blade never clips the frame edge,
   * with the feet anchored on the same ground line as the other units
   * (`soleY 145`). PHASE 30 also ships the accent layer for team colours, which
   * is why this is the only unit with `accentSheet` on.
   */
  SPEARMAN: {
    ...PACK_FIGURE,
    frameWidth: 192,
    frameHeight: 168,
    scale: 0.95,
    offsetY: -58,
    accentSheet: true,
    actions: {
      idle: { frames: 4 },
      walk: { frames: 11, fps: 16 },
      attack: { frames: 10, fps: 12 },
      death: { frames: 8, fps: 9 }
    }
  },
  /**
   * The archer's attack sheet is built from the pack's `3_Bow` draw-and-loose,
   * not its melee `2_Attack` swing: only the client's action name is fixed, so
   * the animation behind it is a build-time choice.
   */
  ARCHER: {
    ...PACK_FIGURE,
    actions: {
      idle: { frames: 4 },
      walk: { frames: 11, fps: 16 },
      // Nine frames at 10 fps is 0.9 s, inside the archer's 1400 ms attack
      // cooldown, so the next order never cuts the draw short.
      attack: { frames: 9, fps: 10 },
      death: { frames: 8, fps: 9 }
    }
  },
  // Cavalry has no directional art: the pack is humanoid only and ships no
  // mounted base, so it keeps the procedurally drawn legacy sheet.
  CAVALRY: {
    frameWidth: 160,
    frameHeight: 160,
    scale: 0.75,
    offsetY: -52,
    bodyOffsetY: -43,
    bodyRadiusX: 50,
    bodyRadiusY: 46,
    ringRadiusX: 40,
    ringRadiusY: 20,
    actions: {}
  }
};

/** Art config for a unit type, falling back to the legacy geometry. */
export function unitArt(unitType: string): UnitArt {
  return UNIT_ART[unitType] ?? DEFAULT_UNIT_ART;
}

/**
 * Frames per direction of `action`'s sheet, following an alias to the action it
 * replays.
 *
 * Throws rather than defaulting: a missing action or an alias cycle is a config
 * mistake, and silently drawing the wrong number of frames is the exact failure
 * the sheet tests exist to catch.
 */
export function resolveActionFrames(actions: UnitArt['actions'], action: UnitAction): number {
  const seen = new Set<UnitAction>();
  let current = action;
  for (;;) {
    if (seen.has(current)) throw new Error(`unit art: alias cycle at "${current}"`);
    seen.add(current);
    const spec = actions[current];
    if (!spec) throw new Error(`unit art: no art for action "${current}"`);
    if (spec.alias === undefined) return spec.frames;
    current = spec.alias;
  }
}

/** `resolveActionFrames` for a registered unit type. */
export function actionFrameCount(unitType: string, action: UnitAction): number {
  return resolveActionFrames(unitArt(unitType).actions, action);
}

/** One directional sheet file a unit has to load. */
export interface UnitSheet {
  /** Action whose file this is (`attack` for an aliased gather/build). */
  sheetAction: UnitAction;
  frames: number;
}

/** The distinct sheet files of a unit, one entry per file. */
export function unitSheets(unitType: string): UnitSheet[] {
  const art = unitArt(unitType);
  const seen = new Set<UnitAction>();
  const sheets: UnitSheet[] = [];
  for (const [action, spec] of Object.entries(art.actions) as [UnitAction, UnitActionArt][]) {
    const sheetAction = spec.alias ?? action;
    if (seen.has(sheetAction)) continue;
    seen.add(sheetAction);
    sheets.push({ sheetAction, frames: resolveActionFrames(art.actions, sheetAction) });
  }
  return sheets;
}

/** One directional clip a unit has to register: an animation per action, per facing. */
export interface UnitClip {
  action: UnitAction;
  sheetAction: UnitAction;
  frames: number;
  frameRate: number;
  repeat: number;
}

/** Every (action, facing) clip a unit ships, in registration order. */
export function unitClips(unitType: string): UnitClip[] {
  const art = unitArt(unitType);
  return (Object.entries(art.actions) as [UnitAction, UnitActionArt][]).map(([action, spec]) => ({
    action,
    sheetAction: spec.alias ?? action,
    frames: resolveActionFrames(art.actions, spec.alias ?? action),
    frameRate: spec.fps ?? ACTION_FRAME_RATE[action],
    repeat: spec.repeat ?? ACTION_REPEAT[action]
  }));
}

/** Whether the unit ships a directional walk sheet, i.e. draws 8 rotations. */
export function hasDirectionalArt(unitType: string): boolean {
  return unitArt(unitType).actions.walk !== undefined;
}

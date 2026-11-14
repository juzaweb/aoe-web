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
  /**
   * Pause between loops, in ms. Lets a one-second attack clip match a slower
   * blueprint cooldown without redrawing it: the unit holds its rest frame
   * during the reload instead of dry-firing every second.
   */
  repeatDelay?: number;
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
   * Whether every action also ships a `<unit>_<action>_accent.png` layer: the
   * team-colour mask, rendered white so the client can multiply the owner's
   * colour over it. Absent means the unit has no team colour.
   */
  accent?: boolean;
  /**
   * Projectile art a ranged unit looses. Defaults to `arrow`, which is what
   * archers and towers draw; the catapult throws a boulder.
   */
  projectile?: 'arrow' | 'boulder';
  /**
   * Delay between the attack clip starting and its projectile leaving, in ms.
   * Defaults to the archer's 700 ms draw when omitted.
   */
  releaseMs?: number;
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
   * Rendered from the 3D knight-with-sword model onto 192x168 cells so the
   * raised/extended blade never clips the frame edge while keeping feet anchored
   * on the same ground line as the other units (`soleY ~145`).
   */
  SPEARMAN: {
    ...PACK_FIGURE,
    frameWidth: 192,
    frameHeight: 168,
    scale: 0.95,
    offsetY: -58,
    // The tunic mask is derived from the shipped sheet pixels by
    // `scripts/build_team_accent.py`, then multiplied by the owner colour in
    // `entityAccent.ts` exactly like the archer's rendered mask.
    accent: true,
    actions: {
      idle: { frames: 4 },
      walk: { frames: 11, fps: 16 },
      attack: { frames: 10, fps: 12 },
      death: { frames: 8, fps: 9 }
    }
  },
  /**
   * Rendered in Blender from the local Mixamo soldier and the bow `.glb`, the
   * same way the spearman and the cavalry are, see `scripts/blender/`. The pack
   * has no archer holding a bow this size, so the unit is rebuilt rather than
   * recoloured.
   *
   * 192x168 cells at the spearman's 0.0183 m/px, so the two infantrymen stand at
   * the same height on the same tile (`soleY ~144`, the row `offsetY` is derived
   * from). The cell is square to the spearman's because the drawn bow reaches
   * above the helmet.
   */
  ARCHER: {
    ...PACK_FIGURE,
    frameWidth: 192,
    frameHeight: 168,
    scale: 0.95,
    offsetY: -58,
    // The tunic is masked by `scripts/blender/team_accent.py` and rendered as a
    // second, white-only layer; `EntityRenderer` tints it with the owner colour.
    accent: true,
    actions: {
      idle: { frames: 4 },
      walk: { frames: 11, fps: 16 },
      // Ten frames at 10 fps, released on the eighth (0.7 s) to match
      // `ARCHER_DRAW_MS`; the whole clip is 1.0 s, inside the 1400 ms cooldown,
      // so the next order never cuts the loose short.
      attack: { frames: 10, fps: 10 },
      death: { frames: 8, fps: 9 }
    }
  },
  /**
   * The stone-throwing engine, rendered in Blender from the local
   * `maybanda.glb` (see `scripts/blender/`). The Siege Workshop trains it.
   *
   * 224x208 cells at 0.0125 m/px -- almost 1.5x the infantry's pixel density so
   * the source's 1.7 m engine draws at siege-engine size instead of like a
   * handcart. `offsetY` is measured from the near wheels' sole row (~row 186):
   * a wide cart on a 20 degree camera projects its near pair lower than the
   * world origin, so the rows legitimately spread 15 px.
   */
  CATAPULT: {
    frameWidth: 224,
    frameHeight: 208,
    scale: 0.95,
    offsetY: -78,
    // The hit ellipse covers the frame and counterweight, not the raised arm.
    bodyOffsetY: -58,
    bodyRadiusX: 60,
    bodyRadiusY: 42,
    ringRadiusX: 52,
    ringRadiusY: 24,
    // The counterweight box is painted in the owner's colour; the mask is
    // rendered by `catapult_scene.select_accent_faces`.
    accent: true,
    projectile: 'boulder',
    releaseMs: 700,
    actions: {
      idle: { frames: 4 },
      walk: { frames: 11, fps: 16 },
      // Ten frames at 10 fps: the arm winches down for 0.6 s, releases on the
      // eighth (0.7 s) and settles for the rest of the second. The reload is a
      // 2 s pause after that second, so the clip loops exactly on the server's
      // 3000 ms cooldown and the boulder leaves on the arm's release every time.
      attack: { frames: 10, fps: 10, repeatDelay: 2000 },
      death: { frames: 8, fps: 9 }
    }
  },
  /**
   * Rendered in Blender from the two local .blend sources (an armoured warhorse
   * and a Mixamo-rigged knight seated on it), see `scripts/blender/`. The pack is
   * humanoid only and ships no mounted base, so this is the one unit whose art
   * is not from an upstream pack.
   *
   * 224 px cells: the mounted pair is longer and taller than a soldier, the
   * attack holds a sword swung over the rider's head, and the death clip lays
   * the whole mount across the frame. The 4.1 m camera square puts the tile's
   * ground point ~25 px above the cell bottom, so the hooves facing the viewer
   * stay inside the frame; `offsetY` is that row's distance from the cell centre
   * at this scale.
   */
  CAVALRY: {
    frameWidth: 224,
    frameHeight: 224,
    scale: 0.9,
    offsetY: -79,
    bodyOffsetY: -44,
    bodyRadiusX: 54,
    bodyRadiusY: 46,
    ringRadiusX: 46,
    ringRadiusY: 22,
    // Same image-space mask as the spearman: the rider's tabard is the cloth
    // band, the horse armour is not, so the mount keeps its steel.
    accent: true,
    actions: {
      idle: { frames: 4 },
      // 11 frames at 8 fps is a 1.35 s stride. The cavalry's 4 tiles/second run
      // the clip at ~1.8x, which lands the stride near 0.75 s — a canter rather
      // than the 0.38 s scurry a 16 fps cycle would produce at that speed.
      walk: { frames: 11, fps: 8 },
      attack: { frames: 10, fps: 12 },
      death: { frames: 8, fps: 9 }
    }
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
  repeatDelay: number;
}

/** Every (action, facing) clip a unit ships, in registration order. */
export function unitClips(unitType: string): UnitClip[] {
  const art = unitArt(unitType);
  return (Object.entries(art.actions) as [UnitAction, UnitActionArt][]).map(([action, spec]) => ({
    action,
    sheetAction: spec.alias ?? action,
    frames: resolveActionFrames(art.actions, spec.alias ?? action),
    frameRate: spec.fps ?? ACTION_FRAME_RATE[action],
    repeat: spec.repeat ?? ACTION_REPEAT[action],
    repeatDelay: spec.repeatDelay ?? 0
  }));
}

/** Whether the unit ships a directional walk sheet, i.e. draws 8 rotations. */
export function hasDirectionalArt(unitType: string): boolean {
  return unitArt(unitType).actions.walk !== undefined;
}

/**
 * Whether the unit ships the team-colour layer alongside its body sheets.
 *
 * Deliberately just the flag: the accent is never loaded or drawn on its own, so
 * a unit that sets it without directional art simply never draws one, and a
 * second condition here would be an untested way to say the same thing.
 */
export function hasTeamAccent(unitType: string): boolean {
  return unitArt(unitType).accent === true;
}

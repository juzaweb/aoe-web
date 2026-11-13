/**
 * TEAM-05: the team-colour accent layer.
 *
 * A directional unit sheet ships twice: an opaque body layer, and an accent layer
 * that covers only the dyed cloth on the model (see `docs/plans/30-team-color-unit-sheets.md`).
 * The accent is drawn as a second sprite on top of the body and tinted with the
 * owner's colour, which is how the model gets team colours without re-baking art
 * per colour.
 *
 * Everything here is deliberately free of Phaser so the decisions - whether the
 * accent exists, what colour it gets - can be unit-tested, in the same spirit as
 * `ownerColor.ts`.
 */
import type { OwnerColorRegistry } from './ownerColor.js';
import type { UnitAction } from './unitDirections.js';
import { DIRECTION_NAMES, unitActionTexture } from './unitDirections.js';
import { unitArt } from './unitArt.js';

/**
 * How far above the body the accent is drawn, in display-list steps.
 *
 * Inside a unit's container the step is implicit (the accent is inserted right
 * after the body sprite); corpses place the accent as its own scene object and
 * need the number.
 */
export const ACCENT_DEPTH_OFFSET = 1;

/**
 * Debug switch for the accent layer (TEAM-05). Off draws the body alone, so the
 * cost of the extra sprites can be measured against the same scene.
 */
let accentEnabled = true;

export function setAccentEnabled(enabled: boolean): void {
  accentEnabled = enabled;
}

export function isAccentEnabled(): boolean {
  return accentEnabled;
}

/**
 * Texture key of one action's accent sheet, e.g. `unit_SPEARMAN_act_walk_accent`.
 *
 * It mirrors `unitActionTexture` exactly, so a body sheet and its accent sheet
 * can never be confused for one another by Phaser's texture cache.
 */
export function accentTexture(unitType: string, action: UnitAction): string {
  return `${unitActionTexture(unitType, action)}_accent`;
}

/**
 * Animation key of one accent clip, e.g. `spearman_walk_accent_SE`.
 *
 * The accent clip is registered from the same frame range as the body clip
 * (`directionIndex * frames + frame`), so the two cannot drift apart by a frame.
 */
export function accentActionKey(
  unitType: string,
  action: UnitAction,
  direction: number
): string {
  return `${unitType.toLowerCase()}_${action}_accent_${DIRECTION_NAMES[direction]}`;
}

/** Depth of an accent drawn as its own scene object, one step above the body. */
export function accentDepth(bodyDepth: number): number {
  return bodyDepth + ACCENT_DEPTH_OFFSET;
}

/**
 * Owner of every unit that recently left the world, keyed by unit id.
 *
 * A corpse keeps the id of the unit it came from, but the server deletes the unit
 * and only then publishes the corpse (`CombatSystem.killUnit`), so by the time the
 * corpse arrives its owner is no longer in `state.units`. This index is what lets
 * a fallen soldier keep its team colour without a field on the wire (D8 leaves the
 * protocol alone).
 *
 * Units can also leave the world without dying - travelling between maps, a
 * kingdom being wiped - and keep their entry, so the index is capped instead of
 * grown forever.
 */
export class RecentOwnerIndex {
  private readonly owners = new Map<string, string>();

  constructor(private readonly capacity: number = 512) {}

  remember(unitId: string, ownerId: string): void {
    if (!unitId || !ownerId) return;
    this.owners.set(unitId, ownerId);
    while (this.owners.size > this.capacity) {
      // Insertion order: the first key is the oldest and goes first.
      const oldest = this.owners.keys().next();
      if (oldest.done) break;
      this.owners.delete(oldest.value);
    }
  }

  /** Owner remembered for a unit id, or '' when it was never seen alive. */
  ownerOf(unitId: string): string {
    return this.owners.get(unitId) ?? '';
  }

  /** Drops one unit once its corpse is gone. */
  forget(unitId: string): void {
    this.owners.delete(unitId);
  }

  /** Called when the world is torn down: no corpse outlives its map. */
  clear(): void {
    this.owners.clear();
  }
}

export interface AccentQuery {
  unitType: string;
  /** Owner of the entity; unresolved owners fall back to `UNKNOWN_OWNER_COLOR`. */
  ownerId: string;
  /** Whether the accent sheet this entity would draw is in the texture cache. */
  sheetAvailable: boolean;
}

export interface AccentDecision {
  /** Whether an accent sprite should be drawn at all. */
  enabled: boolean;
  /** Colour to multiply into the accent layer - always the owner's colour. */
  tint: number;
}

/**
 * Whether this entity gets an accent layer, and in what colour.
 *
 * A unit whose art has no accent sheet, or whose accent PNG failed to load, is
 * drawn body-only: the unit loses its team colour but the scene keeps rendering
 * (the "missing accent file" edge case in the plan).
 */
export function resolveAccent(query: AccentQuery, colors: OwnerColorRegistry): AccentDecision {
  const wanted = unitArt(query.unitType).accentSheet === true && query.sheetAvailable;
  return {
    enabled: wanted && accentEnabled,
    tint: colors.colorOf(query.ownerId)
  };
}

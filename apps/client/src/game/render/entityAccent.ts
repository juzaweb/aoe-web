/**
 * The team-colour layer: rules and sprite plumbing, kept out of `EntityRenderer`.
 *
 * A unit ships a second sheet per action — the tunic alone, rendered white, on
 * the same grid as the body. The renderer draws it over the body sprite and
 * tints it with the owner's colour, which is the multiply-based team colour the
 * AoE series uses.
 *
 * Everything here is expressed against the narrow `AccentHost` interface rather
 * than `Phaser.Scene`/`Phaser.GameObjects.Sprite`, so the play/hide/tint rules
 * are unit-tested with plain objects instead of a running game.
 */

import { UNKNOWN_OWNER_COLOR } from './ownerColor.js';
import {
  DEFAULT_DIRECTION_INDEX,
  DIRECTION_NAMES,
  actionRowFrames,
  unitActionAccentKey,
  unitActionAccentTexture
} from './unitDirections.js';
import type { UnitAction } from './unitDirections.js';
import { hasTeamAccent, unitClips } from './unitArt.js';

/**
 * The subset of `Phaser.Scene` the accent layer needs.
 *
 * Generic over the sprite type so a caller holding a real `Phaser.GameObjects.Sprite`
 * gets one back and can hand it to `container.add` without a cast, while tests
 * substitute a plain recording object.
 */
export interface AccentHost<S extends AccentSprite = AccentSprite> {
  textures: { exists(key: string): boolean };
  anims: { exists(key: string): boolean };
  add: {
    sprite(x: number, y: number, texture: string, frame: number): S;
  };
}

/** The subset of a Phaser sprite the accent layer drives. */
export interface AccentSprite {
  visible: boolean;
  tintTopLeft: number;
  anims: {
    currentAnim: { key: string } | null | undefined;
    timeScale: number;
  };
  setVisible(visible: boolean): unknown;
  setTint(color: number): unknown;
  setScale(scale: number): unknown;
  play(key: string): unknown;
}

/**
 * Clip key of the team-colour layer that mirrors a body clip.
 *
 * Derived from the body's own key rather than rebuilt from (unit, action,
 * direction): the two clips must always describe the same frame grid, and a
 * second spelling of the key is exactly how they drift apart.
 */
export function accentClipKey(bodyClipKey: string): string {
  return `${bodyClipKey}_accent`;
}

/**
 * Tint of a team-colour layer.
 *
 * The layer is a white mask, so an untinted sprite would paint the tunic pure
 * white. An owner colour can be missing — a corpse outliving its player entry,
 * a unit restored from the database before its owner logs in — and the grey the
 * ownership ring already uses for that case reads as "colour unknown" instead of
 * "no team colour".
 */
export function accentTint(ownerColor: number | undefined): number {
  return ownerColor ?? UNKNOWN_OWNER_COLOR;
}

/**
 * Builds one accent sprite for an action and facing, or null when the unit
 * ships no mask for that action.
 *
 * The sprite is positioned in the caller's container: `offsetY` is the cell's
 * art offset for a living unit and 0 for a corpse, which already sits at the
 * cell origin.
 */
export function createAccentSprite<S extends AccentSprite>(
  host: AccentHost<S>,
  unitType: string,
  action: UnitAction,
  offsetY: number,
  scale: number,
  ownerColor: number | undefined
): S | null {
  const texture = unitActionAccentTexture(unitType, action);
  if (!host.textures.exists(texture)) return null;

  const sprite = host.add.sprite(0, offsetY, texture, 0);
  sprite.setScale(scale);
  sprite.setTint(accentTint(ownerColor));

  const clip = unitActionAccentKey(unitType, action, DEFAULT_DIRECTION_INDEX);
  if (host.anims.exists(clip)) sprite.play(clip);
  return sprite;
}

/** Repaints the layer, skipping the write when the colour did not change. */
export function paintAccent(accent: AccentSprite, ownerColor: number): void {
  const color = accentTint(ownerColor);
  if (accent.tintTopLeft !== color) accent.setTint(color);
}

/**
 * Mirrors the body's clip on the accent layer.
 *
 * Hides the layer rather than leaving it on its last frame when the body falls
 * back to a legacy clip with no mask, so a stale tunic never outlives its body,
 * and copies the body's playback rate so the two never drift apart while
 * walking.
 */
export function syncAccent(
  host: AccentHost,
  accent: AccentSprite,
  bodyClipKey: string,
  timeScale: number
): void {
  const clip = accentClipKey(bodyClipKey);
  if (!host.anims.exists(clip)) {
    if (accent.visible) accent.setVisible(false);
    return;
  }

  if (accent.anims.currentAnim?.key !== clip) accent.play(clip);
  if (!accent.visible) accent.setVisible(true);
  if (accent.anims.currentAnim && accent.anims.timeScale !== timeScale) {
    accent.anims.timeScale = timeScale;
  }
}

/** One animation clip the client must register for the accent layer. */
export interface AccentClipSpec {
  key: string;
  texture: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

/**
 * Every accent clip a unit needs, over all its actions and eight facings.
 *
 * The clips mirror the body's own division (`unitClips`), so an aliased action
 * borrows the sheet it replays instead of duplicating a byte-identical column
 * set; units without a mask, or whose sheet is missing from the loader, produce
 * nothing.
 */
export function accentClipSpecs(
  unitType: string,
  textureExists: (key: string) => boolean
): AccentClipSpec[] {
  if (!hasTeamAccent(unitType)) return [];

  const specs: AccentClipSpec[] = [];
  for (const clip of unitClips(unitType)) {
    const texture = unitActionAccentTexture(unitType, clip.sheetAction);
    if (!textureExists(texture)) continue;
    DIRECTION_NAMES.forEach((_, direction) => {
      specs.push({
        key: unitActionAccentKey(unitType, clip.action, direction),
        texture,
        frames: actionRowFrames(direction, clip.frames),
        frameRate: clip.frameRate,
        repeat: clip.repeat
      });
    });
  }
  return specs;
}

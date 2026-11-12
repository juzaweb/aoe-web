import React from 'react';
import {
  ArrowUpCircle,
  Ban,
  CircleSlash,
  Eraser,
  Hammer,
  Hand,
  Landmark,
  LogOut,
  Repeat,
  RotateCcw,
  Route,
  Shield,
  Swords,
  Trash2,
  Undo2,
  UserX,
  X
} from 'lucide-react';
import { buildingIcon } from '../buildingIcons.js';

/**
 * DOCK-04: the vector glyph of a command that ships no PNG thumbnail.
 *
 * A dock slot is 38 px and always asks for a picture, but only buildings and
 * units have art. The brushes, the order keys and the cancel keys are pure
 * commands, so they carry an `art` key instead of a file path and land here.
 * The table is deliberately separate from `buildingIcons`: those glyphs mean
 * "this building", these mean "this action", and sharing a table would tempt a
 * later change into reusing a building icon for a brush.
 */
type IconComponent = React.ComponentType<{ size?: number | string; className?: string }>;

const COMMAND_ICONS: Record<string, IconComponent> = {
  // Brushes. `WALL_ERASE` cannot reuse BrickWall: the WALL build command already
  // draws that glyph, and two identical slots would be indistinguishable.
  ROAD: Route,
  ROAD_ERASE: Eraser,
  WALL_ERASE: CircleSlash,
  // Orders. Stop uses the same hand as the mobile bar so the two docks teach one
  // symbol per order.
  STOP: Hand,
  STANCE: Shield,
  ATTACK: Swords,
  PATROL: Repeat,
  CLEAR: X,
  HOME: Landmark,
  // Cancels. Three different undo arrows: the player has to tell a refunded
  // unit, an upgrade and a research apart at 38 px without reading a tooltip.
  CANCEL_TRAIN: UserX,
  CANCEL_UPGRADE: Undo2,
  CANCEL_RESEARCH: RotateCcw,
  UPGRADE: ArrowUpCircle,
  CANCEL_BUILDING: Ban,
  DELETE_BUILDING: Trash2,
  RETREAT: LogOut
};

/**
 * Units reuse the combat glyph. The dock only reaches this fallback for a
 * research command whose unit ships no usable thumbnail, and Swords already
 * means "unit" everywhere else in the HUD.
 */
const UNIT_ICONS: Record<string, IconComponent> = {
  VILLAGER: Swords,
  SPEARMAN: Swords,
  ARCHER: Swords,
  CAVALRY: Swords
};

/** Generic last resort, so a future `art` key can never render an empty slot. */
function fallbackIcon(size: number): React.ReactNode {
  return <Hammer size={size} />;
}

/**
 * Resolve a `DockCommand.art` key to a glyph.
 *
 * Order matters: command glyphs first (they are the actions), then unit types,
 * then the building table. `buildingIcon` returns `null` for an unknown type,
 * which is what distinguishes "no glyph" from "a glyph exists", so a key this
 * module has never seen still renders the generic hammer instead of nothing.
 */
export function dockCommandIcon(art: string, size = 22): React.ReactNode {
  const CommandIcon = COMMAND_ICONS[art] ?? UNIT_ICONS[art];
  if (CommandIcon) return <CommandIcon size={size} />;

  const building = buildingIcon(art, size);
  if (building) return building;

  return fallbackIcon(size);
}

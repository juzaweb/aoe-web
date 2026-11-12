import { MINIMAP_CSS_SIZE } from '../minimapArt.js';

/**
 * Geometry of the desktop command dock (DOCK-01).
 *
 * The dock replaces the two floating panels that used to sit over the map: a
 * 320 px entity card and a 336 px build panel. One fixed height is the whole
 * point — the map keeps a predictable strip and the dock never grows with a
 * selection, a queue or an upgrade panel (those moved into a popover).
 *
 * The numbers are exported rather than inlined so the components, the layout
 * test and the browser measurement all read the same budget.
 */

/** Height of the whole dock. Everything in it is this tall, nothing taller. */
export const DOCK_HEIGHT_PX = 156;

/**
 * Command grid: AoE's 5x3 card. Fifteen slots is not a coincidence — a villager
 * owns exactly 15 build commands (12 buildings plus road, road erase and wall
 * erase), so the whole build menu fits one page with no submenu.
 */
export const DOCK_COLUMNS = 5;
export const DOCK_ROWS = 3;
export const DOCK_SLOT_CAPACITY = DOCK_COLUMNS * DOCK_ROWS;

/** One command button. 38 px keeps the 3 rows inside the dock height. */
export const DOCK_SLOT_PX = 38;
export const DOCK_GAP_PX = 4;

/**
 * Vertical budget of the command card, added up so the layout test can prove it
 * still fits: padding + border + page header + gap + grid.
 */
export const DOCK_PADDING_PX = 6;
export const DOCK_BORDER_PX = 2;
export const DOCK_HEADER_PX = 14;

export const DOCK_CARD_INNER_HEIGHT_PX =
  DOCK_HEIGHT_PX - 2 * (DOCK_PADDING_PX + DOCK_BORDER_PX);

export const DOCK_GRID_HEIGHT_PX =
  DOCK_ROWS * DOCK_SLOT_PX + (DOCK_ROWS - 1) * DOCK_GAP_PX;

export const DOCK_CARD_WIDTH_PX =
  DOCK_COLUMNS * DOCK_SLOT_PX +
  (DOCK_COLUMNS - 1) * DOCK_GAP_PX +
  2 * (DOCK_PADDING_PX + DOCK_BORDER_PX);

/**
 * The radar keeps the raster it already ships and is padded to the dock height.
 * Derived from `MINIMAP_CSS_SIZE` rather than copied: a resized radar would
 * otherwise break the 156 px budget silently, because only the dock test would
 * notice and it would be asserting the wrong half of the pair.
 */
export const DOCK_MINIMAP_PX = MINIMAP_CSS_SIZE;
export const DOCK_MINIMAP_PADDING_PX = 6;

/** Outer margin between the dock and the viewport edge. */
export const DOCK_INSET_PX = 12;

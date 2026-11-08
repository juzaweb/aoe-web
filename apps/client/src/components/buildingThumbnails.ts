import type { BuildingType } from '@chien-quoc/shared';

/**
 * One map from a building type to its menu/panel thumbnail.
 *
 * The build menu and the selection panel used to build this path independently
 * — one with a hand-written `?v=` per type, the other with `subType.toLowerCase()`
 * — which meant a new building could get a correct icon in one place and a 404
 * in the other. One table, one cache-busting version.
 *
 * MIL-01: `STABLE` and `ARCHERY_RANGE` now ship their own 400x320 sheets from
 * the feudalwars OpenGameArt pack. A type absent from this table still renders
 * the vector icon instead, so a future building without art cannot request a
 * file that only 404s.
 */
export const BUILDING_THUMBNAIL: Partial<Record<BuildingType, string>> = {
  TOWN_CENTER: '/assets/buildings/town_center.png?v=3',
  BARRACKS: '/assets/buildings/barracks.png?v=3',
  STABLE: '/assets/buildings/stable.png?v=3',
  ARCHERY_RANGE: '/assets/buildings/archery_range.png?v=3',
  HOUSE: '/assets/buildings/house.png?v=15',
  FARM: '/assets/buildings/farm.png?v=3',
  TOWER: '/assets/buildings/tower.png?v=4',
  LUMBER_CAMP: '/assets/buildings/lumber_camp.png?v=2',
  MILL: '/assets/buildings/mill.png?v=2',
  MINING_CAMP: '/assets/buildings/mining_camp.png?v=2',
  PORTAL: '/assets/buildings/portal.png?v=3'
};

/** Thumbnail URL for `type`, or `null` when that building ships no sheet. */
export function buildingThumbnail(type: string): string | null {
  return BUILDING_THUMBNAIL[type as BuildingType] ?? null;
}

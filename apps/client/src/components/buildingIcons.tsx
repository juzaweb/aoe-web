import React from 'react';
import {
  BrickWall,
  Castle,
  DoorOpen,
  Hammer,
  House,
  Landmark,
  Pickaxe,
  ShieldAlert,
  Target,
  TowerControl,
  TreePine,
  Warehouse,
  Wheat,
  Zap
} from 'lucide-react';
import type { BuildingType } from '@chien-quoc/shared';

/**
 * One lucide glyph per building type.
 *
 * Every command surface (the mobile build sheet and the desktop command card)
 * needs a vector fallback for a building that ships no PNG thumbnail. Keeping
 * the table here means a new building gets its glyph in both, instead of one
 * surface quietly showing nothing.
 */
const BUILDING_ICONS: Record<BuildingType, React.ComponentType<{ size?: number | string }>> = {
  TOWN_CENTER: Landmark,
  CITADEL: Castle,
  BARRACKS: ShieldAlert,
  STABLE: Zap,
  ARCHERY_RANGE: Target,
  SIEGE_WORKSHOP: Hammer,
  HOUSE: House,
  FARM: Wheat,
  TOWER: TowerControl,
  WALL: BrickWall,
  LUMBER_CAMP: TreePine,
  MILL: Warehouse,
  MINING_CAMP: Pickaxe,
  PORTAL: DoorOpen
};

/**
 * Fallback glyph for a building type, or `null` when the type is unknown.
 *
 * `size` is passed through so the 20 px build sheet and the 18 px dock slot can
 * share the same table.
 */
export function buildingIcon(type: string, size = 20): React.ReactNode {
  const Icon = BUILDING_ICONS[type as BuildingType];
  if (!Icon) return null;
  return <Icon size={size} />;
}

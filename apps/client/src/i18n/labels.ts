/**
 * Lookups for names that live in shared blueprints.
 *
 * Blueprint names are English by design (they are also protocol-adjacent), so
 * the UI maps the type key to a catalog entry instead of translating the
 * blueprint string. The fallback keeps a blueprint added later readable even
 * before its catalog entry exists.
 */
import i18n from './index.js';
import { BUILDING_BLUEPRINTS, UNIT_BLUEPRINTS } from '@chien-quoc/shared';
import type { BuildingType, UnitType } from '@chien-quoc/shared';

export function buildingName(type: BuildingType): string {
  return i18n.t(`buildings.${type}.name`, {
    defaultValue: BUILDING_BLUEPRINTS[type]?.name ?? type
  });
}

export function buildingDescription(type: BuildingType): string {
  return i18n.t(`buildings.${type}.description`, {
    defaultValue: BUILDING_BLUEPRINTS[type]?.description ?? ''
  });
}

export function unitName(type: UnitType): string {
  return i18n.t(`units.${type}.name`, {
    defaultValue: UNIT_BLUEPRINTS[type]?.name ?? type
  });
}

export function unitDescription(type: UnitType): string {
  return i18n.t(`units.${type}.description`, {
    defaultValue: UNIT_BLUEPRINTS[type]?.description ?? ''
  });
}

/** Short resource label used in cost chips and the resource bar. */
export function resourceName(resource: string): string {
  return i18n.t(`resources.${resource}`, { defaultValue: resource });
}

export function stanceName(stance: string): string {
  return i18n.t(`stances.${stance}`, { defaultValue: stance });
}

export function houseTierName(tier: number): string {
  return i18n.t(`houseTiers.${tier}`, { defaultValue: '' });
}

/** Resource-node title from the node's subtype rather than the scene's label. */
export function resourceNodeName(subType: string | undefined): string | null {
  if (!subType) return null;
  const key = `resourceNodes.${subType}`;
  const label = i18n.t(key, { defaultValue: '' });
  return label || null;
}

import {
  RANGED_MIN_RANGE,
  UNIT_BLUEPRINTS,
  UnitType,
  WALL_RANGE_BONUS,
  getEffectiveUnitAttackPower,
  getUnitTrainerBuilding
} from '@chien-quoc/shared';

/**
 * The slice of replicated building state these selection rules read.
 *
 * Kept structural instead of importing the schema class so the rules can be
 * unit-tested with plain objects, like `alerts/foundationRemoval.ts`.
 */
export interface SelectionBuilding {
  type: string;
  ownerId: string;
  level?: number;
  isConstructed?: boolean;
}

export interface UnitCombatStats {
  attackPower?: number;
  attackRange?: number;
  attackCooldownMs?: number;
}

/**
 * Highest finished level of the building that trains `unitType` for `ownerId`.
 *
 * Mirrors the server's `trainerLevelOf`: foundations are ignored and a missing
 * trainer reads as level 1. That is what lets the unit card show the damage
 * `CombatSystem` will actually deal instead of the trainer-less blueprint.
 */
export function trainerLevelFor(
  buildings: Iterable<SelectionBuilding>,
  ownerId: string,
  unitType: string
): number {
  const trainerType = getUnitTrainerBuilding(unitType);
  if (!trainerType) return 1;

  let level = 1;
  for (const building of buildings) {
    if (
      building.type !== trainerType ||
      building.ownerId !== ownerId ||
      !building.isConstructed
    ) {
      continue;
    }
    level = Math.max(level, building.level ?? 1);
  }
  return level;
}

/**
 * Effective combat stats shown on a selected unit's card.
 *
 * Attack folds in the unit's research level, the owner's Town Center aura and
 * the trainer's level, matching `CombatSystem`; range and cooldown stay
 * blueprint rules. An unknown type yields no fields so the panel never invents
 * numbers for a unit the shared roster does not define.
 */
export function unitCombatStats(
  unitType: string,
  unitLevel: number,
  ownerTownCenterLevel: number,
  trainerLevel: number,
  onWall = false
): UnitCombatStats {
  const blueprint = UNIT_BLUEPRINTS[unitType as UnitType];
  if (!blueprint) return {};

  const wallBonus =
    onWall && blueprint.attackRange >= RANGED_MIN_RANGE ? WALL_RANGE_BONUS : 0;
  return {
    attackPower: getEffectiveUnitAttackPower(
      unitType as UnitType,
      unitLevel,
      ownerTownCenterLevel,
      trainerLevel
    ),
    attackRange: blueprint.attackRange + wallBonus,
    attackCooldownMs: blueprint.attackCooldownMs
  };
}

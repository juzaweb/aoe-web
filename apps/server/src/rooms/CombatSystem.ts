import {
  BUILDING_BLUEPRINTS,
  BuildingBlueprint,
  BuildingType,
  CitadelLayout,
  UNIT_BLUEPRINTS,
  UnitBlueprint,
  UnitType,
  citadelLayoutFor,
  clampRaidTownCenterHp,
  getBuildingLevelStats,
  getEffectiveUnitAttackPower,
  isCitadelInteriorTile,
  isRangedAttackRange
} from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { WorldState } from '../schema/WorldState.js';
import { CorpseState } from '../schema/CorpseState.js';
import {
  findNearestCitadelWallOrGate,
  hasCitadel,
  isCitadelBuilding,
  isProtectedCitadelInteriorBuilding
} from './citadel.js';
import { distanceToFootprint } from './geometry.js';


/**
 * What the combat system needs from the rest of the room. Kept as an interface
 * so this module owns damage, cooldowns and target resolution without knowing
 * how orders move units or how economy state is tracked.
 */
export interface CombatPorts {
  /** Queues a fresh route to a destination (used when a fight ends). */
  setWalkTarget(unit: UnitState, x: number, y: number): void;
  /** Falls back to the next queued waypoint, or IDLE. */
  resumeQueuedWaypoint(unit: UnitState): void;
  /** Drops transient per-unit state owned by another system (economy). */
  forgetEconomyState(unitId: string): void;
  /** Drops transient per-unit state owned by the movement system. */
  forgetMovementState(unitId: string): void;
  /** Recomputed when a unit is removed from the world. */
  updatePlayerPopulation(ownerId: string): void;
  /** Drops a corpse once the client has had time to play its death clip. */
  scheduleCorpseRemoval(corpseId: string): void;
  /**
   * Town Center level of a unit's owner (phase 25/D9). Damage is computed per
   * hit so a mid-fight upgrade applies to the next swing without touching the
   * unit's own research level.
   */
  townCenterLevelOf(ownerId: string): number;
  /**
   * Level of the building that trained `unitType` (phase 26). Read per hit like
   * the capital aura, so a barracks upgrade applies to living soldiers too.
   */
  trainerLevelOf(ownerId: string, unitType: UnitType): number;
  /** Re-derives an owner's cached building levels after a building is razed. */
  onBuildingRemoved(building: BuildingState): void;
}

/**
 * CMB-01: how far a `DEFENSIVE` unit may chase an auto-acquired target from the
 * spot where the fight started, in tiles. AoE2's defensive stance is "hold this
 * ground", so the unit walks back to its post instead of following a scout
 * across the map.
 */
const DEFENSIVE_LEASH_TILES = 4;

/**
 * Auto-acquisition priority. Soldiers pick the most dangerous thing they can
 * reach: enemy fighters first, then villagers (the economy), and only then
 * buildings. A lower number wins; distance breaks the tie within a tier.
 */
const AUTO_TARGET_PRIORITY = {
  MILITARY: 0,
  VILLAGER: 1,
  BUILDING: 2
} as const;

interface AutoTarget {
  id: string;
  type: 'unit' | 'building';
}

/**
 * Melee combat for units and ranged fire for defensive buildings (CMD-01,
 * SIM-03).
 *
 * The state lives in the room (`WorldState`); this class owns the rules and the
 * two cooldown maps that make them work: one keyed by unit id, one by building
 * id. Both are transient — nothing here is persisted, so after a restart every
 * attack is ready immediately, which costs at most one shot.
 */
export class CombatSystem {
  /**
   * Remaining cooldown before each unit may strike again, by unit id.
   *
   * A unit that dies is removed from this map by {@link forgetUnit}, so a dead
   * id cannot sit here forever and a recycled id cannot inherit a cooldown.
   */
  private readonly attackTimers: Map<string, number> = new Map();
  /**
   * Remaining cooldown per defensive building, keyed by building id. Separate
   * from `attackTimers` because that map is keyed by unit id and only touched
   * by {@link updateUnitCombat}.
   */
  private readonly towerTimers: Map<string, number> = new Map();
  /**
   * CMB-01: where a `DEFENSIVE` unit stood when it picked a fight on its own.
   * Only auto-acquired fights are leashed — a target the player clicked is a
   * direct order and is pursued anywhere, like AoE2.
   */
  private readonly engageAnchors: Map<string, { x: number; y: number }> = new Map();
  /**
   * Cached citadel geometry for this tick's target scans.
   *
   * `canEngagePosition` runs for every candidate of every unit, so rebuilding a
   * 100-tile wall layout per candidate would dwarf the combat work. The cache
   * is keyed by building count; a Town Center move only happens during the join
   * migration, before combat starts.
   */
  private citadelCacheSize = -1;
  private citadelCacheLayout: CitadelLayout | null = null;
  private citadelCacheOwnerId: string | null = null;

  constructor(
    private readonly state: WorldState,
    private readonly ports: CombatPorts
  ) {}

  /** Refreshes the cached citadel layout when the building set changes. */
  private citadelContext(): { layout: CitadelLayout | null; ownerId: string | null } {
    const size = this.state.buildings.size;
    if (size !== this.citadelCacheSize) {
      this.citadelCacheSize = size;
      this.citadelCacheLayout = null;
      this.citadelCacheOwnerId = null;
      if (!hasCitadel(this.state)) {
        return { layout: null, ownerId: null };
      }
      this.state.buildings.forEach((building: BuildingState) => {
        if (this.citadelCacheLayout || building.type !== 'TOWN_CENTER') return;
        this.citadelCacheLayout = citadelLayoutFor(building.gridX, building.gridY);
        this.citadelCacheOwnerId = building.ownerId;
      });
    }
    return { layout: this.citadelCacheLayout, ownerId: this.citadelCacheOwnerId };
  }

  /** Whether `(x, y)` is on the citadel courtyard floor. */
  private isInterior(x: number, y: number): boolean {
    const layout = this.citadelContext().layout;
    return layout
      ? isCitadelInteriorTile(layout, Math.floor(x), Math.floor(y))
      : false;
  }

  /**
   * CMD-01: before taking a step, a unit that is not already fighting checks for
   * the best enemy inside its aggro radius. Switching to ATTACKING parks the
   * current order in `previousActionState` so the unit picks it up again once the
   * fight is over.
   *
   * Auto-acquisition runs for idle and moving units too, not just attack-move and
   * patrol: a soldier left standing in a lane reacts to whatever walks past it.
   * Villagers have `aggroRadius = 0`, so an economy crew never picks a fight.
   */
  acquireAggroTarget(unit: UnitState, aggroRadius: number) {
    if (aggroRadius <= 0) return;
    if (unit.actionState === 'ATTACKING') return;
    // CMB-01: only the two engaging stances pick their own fights. A stand-ground
    // or no-attack unit waits to be told.
    if (unit.stance === 'STAND_GROUND' || unit.stance === 'NO_ATTACK') return;

    const enemy = this.findAutoTarget(unit, aggroRadius);
    if (!enemy) return;

    unit.previousActionState = unit.actionState;
    unit.actionState = 'ATTACKING';
    unit.targetEntityId = enemy.id;
    unit.targetEntityType = enemy.type;
    // The route belonged to the interrupted order; dropping it lets the chase
    // request a route to the enemy instead of following the old destination.
    unit.pathX.clear();
    unit.pathY.clear();
    // The leash measures from here, not from the unit's destination: a defensive
    // unit pushed by a patrol has already left its post by the time it engages.
    if (unit.stance === 'DEFENSIVE') {
      this.engageAnchors.set(unit.id, { x: unit.x, y: unit.y });
    }
  }

  /**
   * CMB-01: whether this fight was picked by the unit itself instead of ordered.
   *
   * Every explicit order in the command layer clears `previousActionState`, and
   * only {@link acquireAggroTarget} fills it back in, so a non-empty value here
   * is exactly "auto-acquired".
   */
  private isAutoAcquired(unit: UnitState): boolean {
    return unit.previousActionState !== '';
  }

  /**
   * CMB-01: whether the unit may keep moving towards its attack target this
   * tick.
   *
   * `STAND_GROUND` never steps — that is the whole stance, and it holds even for
   * an enemy the player clicked, which is why an out-of-reach order is dropped
   * instead of walked. `DEFENSIVE` steps freely on an explicit order but stops
   * once chasing a fight of its own carries it past the leash. A defender
   * standing in its own courtyard never walks out after an outside target: the
   * wall is what lets it shoot further than the target can answer.
   */
  canChaseTarget(unit: UnitState): boolean {
    if (unit.stance === 'STAND_GROUND') return false;
    if (this.isDefendingFromCourtyard(unit)) return false;
    const anchor = this.engageAnchors.get(unit.id);
    if (unit.stance !== 'DEFENSIVE' || !anchor) return true;
    return Math.hypot(unit.x - anchor.x, unit.y - anchor.y) < DEFENSIVE_LEASH_TILES;
  }

  /**
   * Whether the unit stands in its own citadel courtyard and is fighting a
   * target outside the walls.
   *
   * Such a defender holds its ground and keeps firing; walking out would trade
   * the wall's cover for nothing, and the target can only answer with its own
   * range from open ground.
   */
  private isDefendingFromCourtyard(unit: UnitState): boolean {
    const citadelOwnerId = this.citadelContext().ownerId;
    if (citadelOwnerId === null || unit.ownerId !== citadelOwnerId) return false;
    if (!this.isInterior(unit.x, unit.y)) return false;
    const point = this.targetPoint(unit);
    return point !== null && !this.isInterior(point.x, point.y);
  }

  /**
   * Whether the unit's attack target still exists in the snapshot. A unit with no
   * target at all counts as gone, so an `ATTACKING` state can never survive
   * without something to hit.
   */
  isTargetAlive(unit: UnitState): boolean {
    if (!unit.targetEntityId) return false;
    if (unit.targetEntityType === 'unit') return this.state.units.has(unit.targetEntityId);
    if (unit.targetEntityType === 'building') return this.state.buildings.has(unit.targetEntityId);
    return false;
  }

  /**
   * Ends a fight (CMD-01).
   *
   * The unit remembers what it was doing before it engaged in
   * `previousActionState`: a move or attack-move keeps walking to its
   * destination, a patrol keeps walking its route. Anything else falls back to
   * the queued waypoints, exactly like a finished plain attack.
   */
  endAttackOrder(unit: UnitState) {
    const resume = unit.previousActionState;
    unit.previousActionState = '';
    // The leash only spans one engagement; a stale anchor would make the next
    // fight start already out of bounds.
    this.engageAnchors.delete(unit.id);

    if (resume === 'MOVING' || resume === 'ATTACK_MOVE' || resume === 'PATROL') {
      unit.targetEntityId = '';
      unit.targetEntityType = '';
      unit.actionState = resume;
      // The chase route aimed at the enemy, not at the order's destination, so
      // the interrupted move has to be routed again from here.
      this.ports.setWalkTarget(unit, unit.targetX, unit.targetY);
      return;
    }

    this.ports.resumeQueuedWaypoint(unit);
  }

  /**
   * CMB-01 stance gate for an active attack.
   *
   * `NO_ATTACK` drops a fight the unit picked itself — the stance exists to stop
   * exactly that — while an explicit attack order is still honoured, since the
   * player asked for it. `STAND_GROUND` keeps the fight only while the target is
   * already inside its weapon range. `DEFENSIVE` keeps it until the chase runs
   * past its leash. Both end the order rather than leaving the unit `ATTACKING` a
   * target it will never touch, which would otherwise park it forever.
   */
  private keepsTarget(unit: UnitState, blueprint: UnitBlueprint): boolean {
    if (unit.stance === 'NO_ATTACK' && this.isAutoAcquired(unit)) {
      this.endAttackOrder(unit);
      return false;
    }

    // STAND_GROUND and a defensive unit past its leash share one thing: they
    // may not step towards the target. They still keep the fight while it is in
    // range.
    if (!this.canChaseTarget(unit)) {
      if (this.isTargetInWeaponRange(unit, blueprint)) return true;
      this.endAttackOrder(unit);
      return false;
    }

    return true;
  }

  /**
   * Current target position, or null when the target is gone.
   *
   * The citadel compound is measured at the nearest wall/gate point, the same
   * point its attack range uses, so "inside the courtyard" never mistakes the
   * virtual 26x26 box for an interior target.
   */
  private targetPoint(unit: UnitState): { x: number; y: number } | null {
    if (unit.targetEntityType === 'unit') {
      const target = this.state.units.get(unit.targetEntityId);
      if (!target) return null;
      return { x: target.x, y: target.y };
    }

    if (unit.targetEntityType === 'building') {
      const target = this.state.buildings.get(unit.targetEntityId);
      if (!target) return null;
      if (target.type === 'CITADEL') {
        const nearest = findNearestCitadelWallOrGate(this.state, target, unit.x, unit.y);
        return { x: nearest.x, y: nearest.y };
      }
      return {
        x: target.gridX + target.sizeX / 2,
        y: target.gridY + target.sizeY / 2
      };
    }

    return null;
  }

  /**
   * WALL: whether a weapon may reach a point at all.
   *
   * A ranged defender standing inside the courtyard may fire out over the wall,
   * but melee has to leave the compound to fight. A foreign attacker cannot
   * reach a target sealed inside the compound — the raid must break the walls
   * from outside.
   */
  private canEngagePosition(
    unit: UnitState,
    blueprint: UnitBlueprint,
    x: number,
    y: number
  ): boolean {
    const targetInside = this.isInterior(x, y);
    const citadelOwnerId = this.citadelContext().ownerId;
    if (citadelOwnerId === null) return true;

    if (unit.ownerId === citadelOwnerId) {
      const shooterInside = this.isInterior(unit.x, unit.y);
      if (shooterInside && !targetInside) {
        return isRangedAttackRange(blueprint.attackRange);
      }
      return true;
    }

    return !targetInside;
  }

  /** Whether the unit's current order still has a reachable target. */
  private canEngageTarget(unit: UnitState, blueprint: UnitBlueprint): boolean {
    const point = this.targetPoint(unit);
    if (!point) return false;
    return this.canEngagePosition(unit, blueprint, point.x, point.y);
  }

  /**
   * Distance in tiles from the unit to its current target, or null when the
   * target is gone. A building is measured to the centre of its footprint, which
   * is how every other range check in this file measures it.
   */
  private distanceToTarget(unit: UnitState): number | null {
    if (unit.targetEntityType === 'unit') {
      const target = this.state.units.get(unit.targetEntityId);
      if (!target) return null;
      return Math.hypot(target.x - unit.x, target.y - unit.y);
    }

    if (unit.targetEntityType === 'building') {
      const target = this.state.buildings.get(unit.targetEntityId);
      if (!target) return null;
      if (target.type === 'CITADEL') {
        const nearest = findNearestCitadelWallOrGate(this.state, target, unit.x, unit.y);
        return Math.hypot(nearest.x - unit.x, nearest.y - unit.y);
      }
      const centerX = target.gridX + target.sizeX / 2;
      const centerY = target.gridY + target.sizeY / 2;
      return Math.hypot(centerX - unit.x, centerY - unit.y);
    }

    return null;
  }

  /**
   * Weapon range against the current target type. A unit is hit from half a tile
   * around its centre, a building from one and a half around its footprint, so
   * the reach feels the same against a 1x1 tower and a 4x4 town centre.
   */
  private attackRangeAgainstTarget(unit: UnitState, blueprint: UnitBlueprint): number {
    return (
      blueprint.attackRange +
      (unit.targetEntityType === 'building' ? 1.5 : 0.5)
    );
  }

  /** Whether the target sits inside weapon range right now. */
  private isTargetInWeaponRange(unit: UnitState, blueprint: UnitBlueprint): boolean {
    if (!this.canEngageTarget(unit, blueprint)) return false;
    const dist = this.distanceToTarget(unit);
    return dist !== null && dist <= this.attackRangeAgainstTarget(unit, blueprint);
  }

  /** Per-tick work for a unit that is chasing or striking its target. */
  updateUnitCombat(unit: UnitState, deltaTime: number) {
    const blueprint = UNIT_BLUEPRINTS[unit.type as UnitType];
    if (!blueprint) return;

    // WALL: drop an order that can never connect (a melee defender sealed inside
    // the courtyard ordered onto an outside target, or an outsider ordered onto
    // a defender inside).
    if (!this.canEngageTarget(unit, blueprint)) {
      this.endAttackOrder(unit);
      return;
    }

    // LVL/D9: the unit's research level and its owner's Town Center aura both
    // scale damage; range and cooldown stay blueprint rules.
    const attackPower = getEffectiveUnitAttackPower(
      unit.type as UnitType,
      unit.level,
      this.ports.townCenterLevelOf(unit.ownerId),
      this.ports.trainerLevelOf(unit.ownerId, unit.type as UnitType)
    );

    // CMB-01 before the cooldown: a stance that has given up should not keep a
    // weapon timer parked against a target it is no longer fighting.
    if (!this.keepsTarget(unit, blueprint)) return;

    const remainingCooldown = (this.attackTimers.get(unit.id) ?? 0) - deltaTime;

    if (remainingCooldown > 0) {
      this.attackTimers.set(unit.id, remainingCooldown);
      return;
    }

    if (unit.targetEntityType === 'unit') {
      const targetUnit = this.state.units.get(unit.targetEntityId);
      if (!targetUnit || targetUnit.ownerId === unit.ownerId) {
        // Target died or changed hands: the order is over.
        this.endAttackOrder(unit);
        return;
      }

      if (!this.isTargetInWeaponRange(unit, blueprint)) return;

      targetUnit.hp -= attackPower;
      this.attackTimers.set(unit.id, blueprint.attackCooldownMs);

      if (targetUnit.hp <= 0) {
        this.killUnit(targetUnit);
        // The attacker resumes its stored order on this same tick, like before
        // the split: waiting for the next tick's liveness check would leave it
        // ATTACKING a target that no longer exists for one tick (50 ms).
        this.endAttackOrder(unit);
      }
      return;
    }

    if (unit.targetEntityType === 'building') {
      const targetBuilding = this.state.buildings.get(unit.targetEntityId);
      if (!targetBuilding || targetBuilding.ownerId === unit.ownerId || targetBuilding.hp <= 0) {
        // Building destroyed, captured, or reduced to 0 HP: order over.
        this.endAttackOrder(unit);
        return;
      }

      // Interior citadel buildings (Town Center, Barracks, Archery Range, Houses)
      // cannot be attacked; the raid must attack the Citadel compound walls/gate instead.
      if (isProtectedCitadelInteriorBuilding(this.state, targetBuilding)) {
        this.endAttackOrder(unit);
        return;
      }

      if (!this.isTargetInWeaponRange(unit, blueprint)) return;

      targetBuilding.hp -= attackPower;

      // Phase 23 & Citadel update: Town Center and Citadel buildings never disappear.
      // They can take full damage down to 0 HP (100% loss causes defeat), but are not deleted.
      const isCitadelOrTC =
        targetBuilding.type === 'CITADEL' ||
        targetBuilding.type === 'TOWN_CENTER' ||
        isCitadelBuilding(this.state, targetBuilding);

      if (isCitadelOrTC) {
        if (targetBuilding.hp < 0) targetBuilding.hp = 0;
      }

      this.attackTimers.set(unit.id, blueprint.attackCooldownMs);

      if (targetBuilding.hp <= 0) {
        if (!isCitadelOrTC) {
          this.destroyBuilding(targetBuilding);
        }
        this.endAttackOrder(unit);
      }
    }
  }

  /**
   * SIM-03: fires a defensive building's shot at the closest enemy unit in range.
   *
   * The cooldown counts down every tick and is only reset when a shot actually
   * lands, so a tower that had nothing to shoot fires the moment a target walks
   * in instead of waiting out a timer it never used.
   */
  updateTowerCombat(building: BuildingState, deltaTime: number, blueprint: BuildingBlueprint) {
    if (building.hp <= 0) {
      this.towerTimers.set(building.id, 0);
      return;
    }

    const remainingCooldown = (this.towerTimers.get(building.id) ?? 0) - deltaTime;

    if (remainingCooldown > 0) {
      this.towerTimers.set(building.id, remainingCooldown);
      return;
    }

    const target = this.nearestEnemyOf(building.ownerId, blueprint.attackRange, (other) =>
      distanceToFootprint(other.x, other.y, building)
    );
    if (!target) {
      // Ready, but nothing in range: stay at zero so the next arrival is shot
      // immediately rather than after a fresh cooldown.
      this.towerTimers.set(building.id, 0);
      return;
    }

    target.hp -= getBuildingLevelStats(
      building.type as BuildingType,
      building.level
    ).attackPower;
    this.towerTimers.set(building.id, blueprint.attackCooldownMs);

    if (target.hp <= 0) this.killUnit(target);
  }

  /**
   * Drops everything this system remembers about a unit.
   *
   * Called whenever a unit leaves the world, so the cooldown map cannot grow
   * with dead ids and a recycled id cannot inherit a stale cooldown.
   */
  forgetUnit(unitId: string) {
    this.attackTimers.delete(unitId);
    this.engageAnchors.delete(unitId);
  }

  /** Drops the cooldown of a building that was destroyed or cancelled. */
  forgetBuilding(buildingId: string) {
    this.towerTimers.delete(buildingId);
  }

  /** Removes a dead unit and everything keyed to it. */
  private killUnit(victim: UnitState) {
    const ownerId = victim.ownerId;
    this.state.units.delete(victim.id);
    this.forgetUnit(victim.id);
    this.ports.forgetEconomyState(victim.id);
    this.ports.forgetMovementState(victim.id);
    this.ports.updatePlayerPopulation(ownerId);
    this.publishCorpse(victim);
  }

  /**
   * Leaves a corpse where the unit fell, so the client can play one death clip.
   *
   * The simulation is already done with the unit at this point; this only feeds
   * the renderer. The linger is the room's business because the room owns the
   * clock.
   */
  private publishCorpse(victim: UnitState) {
    const corpse = new CorpseState();
    corpse.id = victim.id;
    corpse.unitType = victim.type;
    corpse.x = victim.x;
    corpse.y = victim.y;
    this.state.corpses.set(corpse.id, corpse);
    this.ports.scheduleCorpseRemoval(corpse.id);
  }

  private destroyBuilding(building: BuildingState) {
    const ownerId = building.ownerId;
    this.state.buildings.delete(building.id);
    this.forgetBuilding(building.id);
    this.ports.onBuildingRemoved(building);
    this.ports.updatePlayerPopulation(ownerId);
  }

  /**
   * Best enemy the unit may pick up on its own, or null.
   *
   * Priority is fixed by category (enemy soldiers, then villagers, then
   * buildings) and only distance breaks a tie inside the same category. The
   * radius is measured from the unit's centre to another unit, and from its
   * centre to the target building's footprint so a 4x4 Town Center is not
   * considered "farther" than a 1x1 tower standing next to it.
   *
   * A building the world cannot attack (the portal) is never auto-acquired.
   */
  private findAutoTarget(unit: UnitState, radius: number): AutoTarget | null {
    const blueprint = UNIT_BLUEPRINTS[unit.type as UnitType];
    if (!blueprint) return null;

    let best: AutoTarget | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    const consider = (target: AutoTarget, priority: number, distance: number) => {
      if (distance > radius) return;
      if (priority > bestPriority) return;
      if (priority === bestPriority && distance > bestDistance) return;
      best = target;
      bestPriority = priority;
      bestDistance = distance;
    };

    this.state.units.forEach((other: UnitState) => {
      if (other.ownerId === unit.ownerId) return;
      if (!this.canEngagePosition(unit, blueprint, other.x, other.y)) return;
      const otherBlueprint = UNIT_BLUEPRINTS[other.type as UnitType];
      const priority =
        otherBlueprint?.canHarvest === true
          ? AUTO_TARGET_PRIORITY.VILLAGER
          : AUTO_TARGET_PRIORITY.MILITARY;
      consider(
        { id: other.id, type: 'unit' },
        priority,
        Math.hypot(other.x - unit.x, other.y - unit.y)
      );
    });

    this.state.buildings.forEach((building: BuildingState) => {
      if (building.ownerId === unit.ownerId) return;
      if (building.hp <= 0) return;
      if (isProtectedCitadelInteriorBuilding(this.state, building)) return;
      const buildingBlueprint = BUILDING_BLUEPRINTS[building.type as BuildingType];
      if (buildingBlueprint?.attackable === false) return;
      const point =
        building.type === 'CITADEL'
          ? findNearestCitadelWallOrGate(this.state, building, unit.x, unit.y)
          : {
              x: building.gridX + building.sizeX / 2,
              y: building.gridY + building.sizeY / 2
            };
      if (!this.canEngagePosition(unit, blueprint, point.x, point.y)) return;
      const dist =
        building.type === 'CITADEL'
          ? Math.hypot(point.x - unit.x, point.y - unit.y)
          : distanceToFootprint(unit.x, unit.y, building);
      consider(
        { id: building.id, type: 'building' },
        AUTO_TARGET_PRIORITY.BUILDING,
        dist
      );
    });

    return best;
  }

  /**
   * Closest enemy unit the caller's distance function puts inside `radius`, or
   * null.
   *
   * The two callers measure distance differently on purpose: a unit measures
   * from its own centre (soldiers engage at body distance), a building from its
   * footprint edge (so `attackRange` means the same thing for a 1x1 tower and a
   * 4x4 town centre). Only the unit scan is shared; the metric is a parameter.
   *
   * Ties go to the last such unit, which is what `<=` here always did.
   */
  private nearestEnemyOf(
    ownerId: string,
    radius: number,
    distanceOf: (enemy: UnitState) => number
  ): UnitState | null {
    let nearest: UnitState | null = null;
    let nearestDist = radius;

    this.state.units.forEach((other: UnitState) => {
      if (other.ownerId === ownerId) return;
      const dist = distanceOf(other);
      if (dist <= nearestDist) {
        nearest = other;
        nearestDist = dist;
      }
    });

    return nearest;
  }
}

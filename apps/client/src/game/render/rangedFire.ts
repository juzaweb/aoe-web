import {
  BUILDING_BLUEPRINTS,
  UNIT_BLUEPRINTS,
  attackReach,
  distanceToFootprint,
  isRangedAttackRange,
  type BuildingType,
  type UnitBlueprint,
  type UnitType
} from '@chien-quoc/shared';
import { unitArt } from './unitArt.js';

/**
 * SIM-03 client half: decides when a ranged shooter releases an arrow.
 *
 * The authoritative simulation resolves a hit and never replicates a projectile,
 * so the client has to infer the volley from state it already holds: an archer
 * arrives with `actionState = 'ATTACKING'` and the id of what it is hitting, and
 * a tower carries nothing beyond its own footprint. Drawing an arrow for every
 * frame in which those fields look right would empty the quiver at frame rate,
 * so this module keeps one clock per shooter and reports at most one arrow per
 * cooldown — the same cadence the server applies to the damage.
 *
 * The result is data only (`RangedShot[]`). A separate Phaser layer owns the
 * arrow art and the flight animation, which keeps the projectile budget in one
 * place and lets every rule in this file be tested under Node.
 */

/**
 * How long an archer spends nocking and drawing before its first arrow exists,
 * in ms.
 *
 * The server lands its first hit on the tick the attack order connects — its
 * cooldown starts at zero — but the arrow cannot leave the bow before the draw
 * animation has played, so the first arrow of an engagement waits for the end of
 * that draw. Only the first one: the cadence after it is the blueprint cooldown,
 * counted from the arrow that just left, exactly as the server counts it.
 *
 * Units may override this through `UnitArt.releaseMs`; the catapult uses the
 * same 700 ms because its attack clip releases its arm on the eighth frame.
 */
export const ARCHER_DRAW_MS = 700;

/** Which projectile art this shot draws. */
export type ProjectileKind = 'arrow' | 'boulder';

/**
 * The action state a unit is replicated with while it trades blows.
 *
 * The server's action enum lives in the room, not in `packages/shared`, so the
 * client compares the replicated string. The server always pairs an empty
 * `targetEntityId` with a non-attacking state, which is why "not attacking" and
 * "no target" are treated the same below.
 */
const ATTACKING_ACTION_STATE = 'ATTACKING';

/**
 * The slice of replicated unit state the shot rule reads.
 *
 * Structural rather than the Colyseus schema class, like `SelectionBuilding` in
 * `scenes/selectionStats.ts`: the tests build plain objects, and the renderer can
 * hand over its own view of a unit without this module depending on the schema.
 */
export interface UnitShotSource {
  id: string;
  ownerId: string;
  /** Blueprint key, e.g. `'ARCHER'`. */
  type: string;
  /** Continuous grid position of the unit, in tiles. */
  x: number;
  y: number;
  /** Replicated action state; only `'ATTACKING'` means "weapon out". */
  actionState: string;
  /** Id of what the unit is hitting, empty when it is not fighting. */
  targetEntityId: string;
  /** `'unit'` or `'building'`; anything else is not shootable. */
  targetEntityType: string;
}

/** The slice of replicated building state the shot rule reads. */
export interface BuildingShotSource {
  id: string;
  ownerId: string;
  /** Blueprint key, e.g. `'TOWER'`. */
  type: string;
  /** Top-left corner of the footprint, in tiles. */
  gridX: number;
  gridY: number;
  /** Footprint size, in tiles. */
  sizeX: number;
  sizeY: number;
  /** A foundation has no weapon yet, so it never shoots. */
  isConstructed: boolean;
}

/**
 * Everything one update may look at.
 *
 * Each collection is read exactly once per update and processed in the order it
 * yields, so the caller may pass a Colyseus map, an array, or a one-shot
 * generator: the result does not depend on anything but that order.
 */
export interface RangedWorld {
  units: Iterable<UnitShotSource>;
  buildings: Iterable<BuildingShotSource>;
}

/** One arrow to draw now: where it leaves the bow and where it is aimed. */
export interface RangedShot {
  shooterId: string;
  shooterKind: 'unit' | 'building';
  /** Grid position the arrow starts from, in tiles. */
  fromX: number;
  fromY: number;
  targetId: string;
  /**
   * What was hit. Carried explicitly rather than re-derived by the renderer from
   * the sprite maps: a target's sprite is created a frame or two after the state
   * arrives, and guessing "no sprite yet, must be a building" would aim the
   * arrow at the wrong height for exactly those frames.
   */
  targetKind: 'unit' | 'building';
  /** Grid position the arrow is aimed at, in tiles. */
  toX: number;
  toY: number;
  /** What leaves the shooter: an archer/tower arrow or a catapult boulder. */
  projectile: ProjectileKind;
}

/**
 * Reusable buffer that turns a room's replicated units and buildings into the
 * plain shape {@link RangedFireSim} reads.
 *
 * Without it the scene would copy seven fields per unit per frame inside its own
 * update loop, mixing room plumbing into a 2 500-line renderer. Here the bridge
 * is small, testable under Node, and allocates nothing per frame: the slot
 * objects are reused and only the array lengths change.
 *
 * Both inputs are iterables of the shot-source shapes. A Colyseus `MapSchema`
 * iterates as `[key, value]` pairs, so the caller passes
 * `room.state.units.values()` — the order of that iterable is what the
 * simulation's determinism relies on.
 */
export class RangedWorldSnapshot implements RangedWorld {
  readonly units: UnitShotSource[] = [];
  readonly buildings: BuildingShotSource[] = [];

  /** Copies this frame's entities in and returns itself as the sim's input. */
  update(
    units: Iterable<UnitShotSource>,
    buildings: Iterable<BuildingShotSource>
  ): RangedWorld {
    let unitCount = 0;
    for (const unit of units) {
      const slot = this.units[unitCount] ?? ({} as UnitShotSource);
      this.units[unitCount] = slot;
      slot.id = unit.id;
      slot.ownerId = unit.ownerId;
      slot.type = unit.type;
      slot.x = unit.x;
      slot.y = unit.y;
      slot.actionState = unit.actionState;
      slot.targetEntityId = unit.targetEntityId;
      slot.targetEntityType = unit.targetEntityType;
      unitCount += 1;
    }
    // Truncating the array is what removes the entities that died this frame.
    this.units.length = unitCount;

    let buildingCount = 0;
    for (const building of buildings) {
      const slot = this.buildings[buildingCount] ?? ({} as BuildingShotSource);
      this.buildings[buildingCount] = slot;
      slot.id = building.id;
      slot.ownerId = building.ownerId;
      slot.type = building.type;
      slot.gridX = building.gridX;
      slot.gridY = building.gridY;
      slot.sizeX = building.sizeX;
      slot.sizeY = building.sizeY;
      slot.isConstructed = building.isConstructed;
      buildingCount += 1;
    }
    this.buildings.length = buildingCount;

    return this;
  }
}

/**
 * The point one arrow is aimed at, resolved from a replicated target id.
 *
 * A unit is aimed at its centre, a building at its footprint centre — the point
 * the arrow's impact effect expects, not the near edge the range check used.
 */
interface ResolvedTarget {
  id: string;
  x: number;
  y: number;
  /** The building whose footprint the range check must use, if the target is one. */
  footprint: BuildingShotSource | null;
}

/**
 * One shooter's firing clock.
 *
 * `readyAt` is an absolute scene-clock time rather than a countdown: the server
 * decrements a cooldown once per tick, but the client only gets frames, so a
 * countdown would drift with the frame rate. Anchoring the next shot to the one
 * that just left keeps the cadence a property of the volley, not of the browser.
 */
interface ShotTimer {
  /** Scene-clock ms at which the next arrow may leave. */
  readyAt: number;
  /** Update counter of the last frame this shooter was eligible. */
  stamp: number;
}

/**
 * The per-frame shot clock for every ranged shooter in the scene.
 *
 * One instance lives for the lifetime of a scene: the timers it holds are what
 * turn "this archer is attacking" into "this archer looses an arrow now", and
 * they have to survive between frames. `update` is the only way in, and it is a
 * pure function of `nowMs`, the world, and the timers accumulated so far, so a
 * recorded sequence of updates replays identically.
 *
 * A scene that rebinds to another room or is torn down calls {@link reset}; one
 * that removes a single entity calls {@link forget}. Stale timers are pruned on
 * the next update anyway, so a missed call cannot keep a dead id alive.
 */
export class RangedFireSim {
  /** One clock per engaged archer, keyed by unit id. */
  private readonly unitTimers = new Map<string, ShotTimer>();

  /** One clock per eligible tower, keyed by building id. */
  private readonly towerTimers = new Map<string, ShotTimer>();

  /**
   * Target indexes, rebuilt from the world at the start of every update.
   *
   * Reused instead of reallocated because this runs once per frame; the same
   * maps also answer "is this shooter still in the world?" for the pruning pass,
   * so one pass over each iterable pays for both.
   */
  private readonly unitIndex = new Map<string, UnitShotSource>();
  private readonly buildingIndex = new Map<string, BuildingShotSource>();

  /**
   * Scratch target, reused every frame: this loop runs over every unit in the
   * world on every frame, and a fresh object per archer would hand the garbage
   * collector thousands of short-lived objects a second. Read it immediately.
   */
  private readonly target: ResolvedTarget = { id: '', x: 0, y: 0, footprint: null };

  /** Monotonic update counter, used to stamp the shooters seen this frame. */
  private frame = 0;

  /**
   * Advances every shooter's clock and returns the arrows that leave a bow on
   * this frame.
   *
   * @param nowMs scene-clock time of this frame, in ms. The caller owns the
   *   timeline on purpose: the module never reads a wall clock, so a recorded
   *   sequence of updates replays identically.
   * @param world replicated units and buildings of this frame
   */
  update(nowMs: number, world: RangedWorld): RangedShot[] {
    this.frame += 1;
    this.indexWorld(world);

    const shots: RangedShot[] = [];

    // Units first, then buildings, each in the order the world handed them over:
    // a fixed order is what makes two identical frames produce identical arrows.
    for (const unit of this.unitIndex.values()) {
      const shot = this.updateArcher(nowMs, unit);
      if (shot) shots.push(shot);
    }

    for (const building of this.buildingIndex.values()) {
      const shot = this.updateTower(nowMs, building);
      if (shot) shots.push(shot);
    }

    this.prune(this.unitTimers);
    this.prune(this.towerTimers);
    return shots;
  }

  /**
   * Drops one shooter's clock.
   *
   * The scene calls this when it removes an entity itself (a death effect it has
   * already played, a building it has already torn down), so a recycled id
   * cannot inherit the old cadence.
   */
  forget(shooterId: string): void {
    this.unitTimers.delete(shooterId);
    this.towerTimers.delete(shooterId);
  }

  /**
   * Drops every clock.
   *
   * Called when the scene tears down or binds to a different room: the new world
   * must not fire on the old world's timers.
   */
  reset(): void {
    this.unitTimers.clear();
    this.towerTimers.clear();
    this.unitIndex.clear();
    this.buildingIndex.clear();
    this.frame = 0;
  }

  /**
   * Rebuilds the target indexes from this frame's world.
   *
   * A `Map` keeps insertion order, so iterating it back reproduces the order the
   * iterable produced and the caller's ordering survives the round trip.
   */
  private indexWorld(world: RangedWorld): void {
    this.unitIndex.clear();
    for (const unit of world.units) this.unitIndex.set(unit.id, unit);

    this.buildingIndex.clear();
    for (const building of world.buildings) this.buildingIndex.set(building.id, building);
  }

  /**
   * One ranged unit's clock. Returns the projectile it releases this frame, or null.
   */
  private updateArcher(nowMs: number, unit: UnitShotSource): RangedShot | null {
    const blueprint = UNIT_BLUEPRINTS[unit.type as UnitType];
    // A unit type a newer server added has no blueprint here; drawing nothing is
    // the only safe answer, and it must not leave a clock behind either.
    if (
      !blueprint ||
      !isRangedAttackRange(blueprint.attackRange) ||
      !this.aimAtTarget(unit, blueprint)
    ) {
      // Lowering the bow — no order, no target, out of range — also drops the
      // clock, so re-engaging draws from the start instead of firing the instant
      // the order is reissued.
      this.unitTimers.delete(unit.id);
      return null;
    }

    const art = unitArt(unit.type);
    let timer = this.unitTimers.get(unit.id);
    if (timer) {
      timer.stamp = this.frame;
    } else {
      timer = {
        readyAt: nowMs + (art.releaseMs ?? ARCHER_DRAW_MS),
        stamp: this.frame
      };
      this.unitTimers.set(unit.id, timer);
    }

    if (nowMs < timer.readyAt) return null;

    // The next arrow is counted from this one, the way the server resets its
    // cooldown after a hit: a late frame delays an arrow, it never earns a burst.
    timer.readyAt = nowMs + blueprint.attackCooldownMs;

    return {
      shooterId: unit.id,
      shooterKind: 'unit',
      fromX: unit.x,
      fromY: unit.y,
      targetId: this.target.id,
      targetKind: this.target.footprint ? 'building' : 'unit',
      toX: this.target.x,
      toY: this.target.y,
      projectile: art.projectile ?? 'arrow'
    };
  }

  /**
   * Whether the archer is in a position to shoot, and where the arrow goes.
   *
   * Fills `this.target` as a side effect; callers read it immediately.
   */
  private aimAtTarget(unit: UnitShotSource, blueprint: UnitBlueprint): boolean {
    if (unit.actionState !== ATTACKING_ACTION_STATE || !unit.targetEntityId) return false;
    if (!this.resolveTarget(unit.targetEntityType, unit.targetEntityId)) return false;

    // A building is measured to its footprint, a unit to its centre — the same
    // split the server's range checks make, and the reason an archer can stand
    // against a wall and still be in range of the building behind it. The reach
    // is the server's, margin included (`attackReach` in the shared package):
    // the server damages out to that number, so an arrow has to exist out to it
    // too, or the outer band of the archer's range loses HP with nothing in the
    // air to explain it.
    const targetKind: 'unit' | 'building' = this.target.footprint ? 'building' : 'unit';
    const distance = this.target.footprint
      ? distanceToFootprint(unit.x, unit.y, this.target.footprint)
      : Math.hypot(this.target.x - unit.x, this.target.y - unit.y);
    return distance <= attackReach(blueprint.attackRange, targetKind);
  }

  /**
   * Resolves a replicated target id into an aim point, filling `this.target`.
   *
   * Returns false when the id is gone (killed, despawned) or when the replicated
   * type and the entity do not agree. A stale target id is normal for the frame
   * or two between a kill and the order ending, and it must not become an arrow.
   */
  private resolveTarget(targetEntityType: string, targetEntityId: string): boolean {
    if (targetEntityType === 'unit') {
      const target = this.unitIndex.get(targetEntityId);
      if (!target) return false;
      this.target.id = target.id;
      this.target.x = target.x;
      this.target.y = target.y;
      this.target.footprint = null;
      return true;
    }

    if (targetEntityType === 'building') {
      const target = this.buildingIndex.get(targetEntityId);
      if (!target) return false;
      this.target.id = target.id;
      this.target.x = target.gridX + target.sizeX / 2;
      this.target.y = target.gridY + target.sizeY / 2;
      this.target.footprint = target;
      return true;
    }

    // `'resource'` and anything newer than this client: never an arrow target.
    return false;
  }

  /**
   * One tower's clock. Returns the arrow it releases this frame, or null.
   *
   * Mirrors `updateTowerCombat` in the server's combat system: the cooldown is
   * only spent when a shot actually lands, so a tower that had nothing to shoot
   * fires the tick a target walks in instead of waiting out a timer it never
   * used.
   */
  private updateTower(nowMs: number, building: BuildingShotSource): RangedShot | null {
    const blueprint = BUILDING_BLUEPRINTS[building.type as BuildingType];
    // SIM-03: only a constructed building with a real range shoots; every other
    // blueprint carries `attackRange: 0`. An unknown type (a newer server) is
    // skipped rather than trusted to have a weapon.
    if (!blueprint || !building.isConstructed || !isRangedAttackRange(blueprint.attackRange)) {
      this.towerTimers.delete(building.id);
      return null;
    }

    let timer = this.towerTimers.get(building.id);
    if (timer) {
      timer.stamp = this.frame;
    } else {
      // The server's tower cooldown starts at zero, so the first target that
      // walks into range is shot on the very next tick.
      timer = { readyAt: nowMs, stamp: this.frame };
      this.towerTimers.set(building.id, timer);
    }

    // Like the server, a tower on cooldown does not look for targets: nothing can
    // be fired before the clock runs out, and the scan is the expensive part.
    if (nowMs < timer.readyAt) return null;

    const target = this.nearestEnemyUnit(building, blueprint.attackRange);
    if (!target) return null;

    timer.readyAt = nowMs + blueprint.attackCooldownMs;

    return {
      shooterId: building.id,
      shooterKind: 'building',
      fromX: building.gridX + building.sizeX / 2,
      fromY: building.gridY + building.sizeY / 2,
      targetId: target.id,
      targetKind: 'unit',
      toX: target.x,
      toY: target.y,
      projectile: 'arrow'
    };
  }

  /**
   * Closest enemy unit inside `attackRange`, measured to the tower footprint.
   *
   * Mirrors the server's `nearestEnemyOf`: only units are scanned, the tower's
   * own owner is excluded, and ties go to the unit that comes later in the
   * world's order so an equidistant pair cannot make the tower alternate between
   * them frame after frame.
   */
  private nearestEnemyUnit(
    building: BuildingShotSource,
    attackRange: number
  ): UnitShotSource | null {
    let nearest: UnitShotSource | null = null;
    let nearestDistance = attackRange;

    for (const unit of this.unitIndex.values()) {
      if (unit.ownerId === building.ownerId) continue;
      const distance = distanceToFootprint(unit.x, unit.y, building);
      if (distance <= nearestDistance) {
        nearest = unit;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  /**
   * Drops timers whose shooter was not eligible this frame.
   *
   * Every eligible shooter stamps its entry with the current frame; anything
   * still carrying an older stamp belongs to a unit that died, a building that
   * was destroyed, or a shooter that stopped fighting, so it is deleted instead
   * of keeping the id alive for the rest of the session.
   */
  private prune(timers: Map<string, ShotTimer>): void {
    for (const [id, timer] of timers) {
      if (timer.stamp !== this.frame) timers.delete(id);
    }
  }
}

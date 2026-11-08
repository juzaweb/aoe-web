import { CitadelStair, citadelLayoutFor } from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { UnitState } from '../schema/UnitState.js';
import { WorldState } from '../schema/WorldState.js';
import { Pathfinder } from '../services/Pathfinder.js';
import {
  citadelGateTileSet,
  citadelOwnerIdOf,
  citadelWallTopTileSet,
  citadelWallTileSet,
  isOwnCitadelWallTop,
  isVirtualCitadelCompound
} from './citadel.js';
import { UnitSeparation } from './unitSeparation.js';

/**
 * SIM-01: how many path requests one tick may compute. A 220x220 corner-to-
 * corner search measures ~0.9 ms, so a 120-unit order would be a ~100 ms stall
 * if it were answered in one tick; spreading it over ticks keeps the simulation
 * at its 20 Hz cadence and every unit walks the straight line until its route
 * is ready.
 */
const MAX_PATHS_PER_TICK = 12;

/** Wall-clock budget for pathfinding inside one tick, in ms. */
const PATH_BUDGET_MS = 3;

/**
 * The blocked grid is rebuilt when the number of buildings or resource nodes
 * changes, and at least this often — a cheap safety net for anything that
 * changes a footprint without changing those counts.
 */
const BLOCKED_GRID_MAX_AGE_MS = 1000;

/**
 * Minimum gap between two obstacle-triggered re-routes for one unit, in
 * milliseconds. A route whose every alternative is walled off would otherwise be
 * re-searched on every tick: the search returns straight-line, the next tile is
 * still blocked, and the unit burns its share of the per-tick path budget
 * forever. Five hundred ms is invisible to the player and caps a stuck unit at
 * two searches per second.
 */
const REPATH_COOLDOWN_MS = 500;

/**
 * Minimum gap between two chase-route requests for one unit.
 *
 * Only matters when no route exists (a target boxed in by walls): without it a
 * soldier would queue a fresh, equally futile A* search on every tick.
 */
const CHASE_REPATH_COOLDOWN_MS = 250;

/**
 * Routing, waypoint queues and the movement half of every order (SIM-01,
 * CTL-05).
 *
 * The state lives in the room (`WorldState`); this class owns the route cache
 * and the queue of units waiting for one. Nothing here is persisted: after a
 * restart a unit that was mid-route keeps its `targetX/targetY` and walks the
 * straight line until its next order, which is the documented backlog gap.
 *
 * It needs no ports: every mutation is on the unit it was handed, so nothing
 * calls back into the room.
 */
export class MovementSystem {
  /** SIM-01: reused across searches; sized to this room's map on first use. */
  private pathfinderInstance: Pathfinder | null = null;
  private blockedGrid: Uint8Array | null = null;
  /** Ground grid with the citadel gate sealed to non-owners. */
  private blockedGridEnemy: Uint8Array | null = null;
  /** Wall-top grid: everything blocked except wall and gate-roof tiles. */
  private wallGrid: Uint8Array | null = null;
  private blockedGridBuildingCount = -1;
  private blockedGridResourceCount = -1;
  private blockedGridCitadelSignature = '';
  private blockedGridBuiltAt = 0;
  /** Unit ids waiting for a route, oldest first. `pendingPathIds` dedupes. */
  private pendingPaths: string[] = [];
  private pendingPathIds: Set<string> = new Set();
  /**
   * Destination each queued/active route is computed for, keyed by unit id.
   *
   * Plain moves store the same point as `unit.targetX/targetY`, but a chase
   * stores the target's live position without overwriting the move destination
   * the unit resumes once the fight ends.
   */
  private readonly pathGoals: Map<string, { x: number; y: number }> = new Map();
  /** Last obstacle-triggered re-route per unit, for `REPATH_COOLDOWN_MS`. */
  private readonly lastRepathAt: Map<string, number> = new Map();
  /** Last chase-route request per unit, for `CHASE_REPATH_COOLDOWN_MS`. */
  private readonly lastChaseRequestAt: Map<string, number> = new Map();
  /** Wall top plus gate roof, the only tiles an `onWall` unit may stand on. */
  private citadelWallTops: Set<string> = new Set();
  private citadelGates: Set<string> = new Set();
  /** Stair upper landings, the only wall-layer tiles that lead to ground. */
  private citadelStairTops: Set<string> = new Set();
  private citadelOwnerId: string | null = null;
  /**
   * Units walking towards a stair landing before changing route layer.
   *
   * The approach point is the tile the unit must reach; once there the unit
   * flips `onWall` and the final destination is routed again on the new layer.
   */
  private readonly pendingTransitions: Map<
    string,
    { approachX: number; approachY: number; targetX: number; targetY: number }
  > = new Map();

  /** MOV-02: anti-overlap pass; owns its scratch buffers. */
  private readonly separation = new UnitSeparation();

  /** Bound once so the per-tick separation pass does not allocate a closure. */
  private readonly isBlockedTileTest = (unit: UnitState, x: number, y: number) =>
    this.isBlockedTileFor(unit, x, y);

  constructor(private readonly state: WorldState) {}

  /**
   * A* workspace for this map.
   *
   * Built lazily because `WorldState.mapWidth/mapHeight` is only authoritative
   * after the room has set it; a kingdom (110x110) allocates a quarter of the
   * arrays a battlefield (220x220) needs.
   */
  private get pathfinder(): Pathfinder {
    this.pathfinderInstance ??= new Pathfinder(this.state.mapWidth, this.state.mapHeight);
    return this.pathfinderInstance;
  }

  /**
   * Gives a unit a new walking destination and queues a fresh route to it.
   *
   * Every order that moves a unit goes through here, so a stale route cannot
   * survive a new order: the old waypoints are dropped immediately and the new
   * one is computed on an upcoming tick. Nothing is queued for a destination the
   * unit is already standing on.
   */
  setWalkTarget(unit: UnitState, targetX: number, targetY: number) {
    unit.targetX = targetX;
    unit.targetY = targetY;
    this.pendingTransitions.delete(unit.id);
    // Refresh the gate/wall sets before classifying the destination.
    this.getBlockedGrid();

    const targetTileKey = `${Math.floor(targetX)},${Math.floor(targetY)}`;
    const targetOnWall =
      isOwnCitadelWallTop(this.state, unit.ownerId, Math.floor(targetX), Math.floor(targetY)) &&
      // The gate tile is both the ground passage and the gatehouse roof. A
      // ground order on it means "walk through the gate", never "climb".
      !(!unit.onWall && this.citadelGates.has(targetTileKey));
    if (targetOnWall === unit.onWall) {
      this.requestPath(unit, targetX, targetY);
      return;
    }

    const stairs = this.citadelStairs();
    if (stairs.length === 0) {
      // No stair means this citadel cannot be climbed; treat the click as a
      // normal move and let the goal-snap take the unit as close as it can.
      this.requestPath(unit, targetX, targetY);
      return;
    }

    // The landing is always the stair's upper ground tile: climbing arrives
    // there before stepping onto the wall, and descending leaves the wall onto
    // it before walking down the flight.
    let best = stairs[0];
    let bestDistance = Infinity;
    for (const stair of stairs) {
      const point = stair.top;
      const distance = Math.hypot(point.gridX + 0.5 - unit.x, point.gridY + 0.5 - unit.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = stair;
      }
    }

    const approach = best.top;
    const approachX = approach.gridX + 0.5;
    const approachY = approach.gridY + 0.5;
    this.pendingTransitions.set(unit.id, {
      approachX,
      approachY,
      targetX,
      targetY
    });
    this.requestPath(unit, approachX, approachY);
  }

  /** Stairs of the citadel this unit may use, or an empty list elsewhere. */
  private citadelStairs(): CitadelStair[] {
    const stairs: CitadelStair[] = [];
    this.state.buildings.forEach((building: BuildingState) => {
      if (building.type !== 'TOWN_CENTER') return;
      stairs.push(...citadelLayoutFor(building.gridX, building.gridY).stairs);
    });
    return stairs;
  }

  /**
   * Queues a route towards an enemy's current position without touching the
   * unit's stored move destination.
   *
   * A chasing unit has to detour around the same obstacles a move order does —
   * without this it walked the straight line and cut straight through a citadel
   * wall. `targetX/targetY` must keep pointing at the spot the unit resumes
   * after the fight, so the chase goal lives in its own map.
   */
  setChaseTarget(unit: UnitState, x: number, y: number) {
    this.pendingTransitions.delete(unit.id);
    const now = performance.now();
    const last = this.lastChaseRequestAt.get(unit.id);
    if (last !== undefined && now - last < CHASE_REPATH_COOLDOWN_MS) return;
    this.lastChaseRequestAt.set(unit.id, now);
    this.requestPath(unit, x, y);
  }

  /** Drops a pending stair transition without changing the unit's layer. */
  cancelElevationTransition(unitId: string) {
    this.pendingTransitions.delete(unitId);
  }

  /** Drops the current route and queues a fresh search to `x, y`. */
  private requestPath(unit: UnitState, x: number, y: number) {
    unit.pathX.clear();
    unit.pathY.clear();

    if (Math.hypot(x - unit.x, y - unit.y) < 0.01) {
      this.pathGoals.delete(unit.id);
      return;
    }

    this.pathGoals.set(unit.id, { x, y });
    if (this.pendingPathIds.has(unit.id)) return;
    this.pendingPathIds.add(unit.id);
    this.pendingPaths.push(unit.id);
  }

  /**
   * Pops the next queued waypoint into the unit's active movement order.
   *
   * The two arrays are always written together, so a length mismatch can only
   * come from a corrupted snapshot; when it happens the queue is dropped rather
   * than half-applied.
   *
   * @returns true when a waypoint was consumed and the unit is now MOVING.
   */
  advanceQueuedWaypoint(unit: UnitState): boolean {
    if (unit.queueTargetX.length !== unit.queueTargetY.length) {
      unit.queueTargetX.clear();
      unit.queueTargetY.clear();
      return false;
    }
    if (unit.queueTargetX.length === 0) return false;

    const nextX = unit.queueTargetX.shift();
    const nextY = unit.queueTargetY.shift();
    if (typeof nextX !== 'number' || typeof nextY !== 'number') {
      unit.queueTargetX.clear();
      unit.queueTargetY.clear();
      return false;
    }

    this.setWalkTarget(unit, nextX, nextY);
    unit.targetEntityId = '';
    unit.targetEntityType = '';
    unit.actionState = 'MOVING';
    return true;
  }

  /**
   * Ends the unit's current order and starts the next queued waypoint, if any.
   *
   * Called wherever an order finishes or becomes invalid (arrival, target gone,
   * resource depleted). Without it a Shift-queued path would be stranded: the
   * waypoints would sit in the snapshot and never run, because nothing else ever
   * consumes them.
   */
  resumeQueuedWaypoint(unit: UnitState) {
    unit.targetEntityId = '';
    unit.targetEntityType = '';
    unit.previousActionState = '';
    if (!this.advanceQueuedWaypoint(unit)) {
      unit.actionState = 'IDLE';
    }
  }

  /**
   * Pushes overlapping units apart so a squad reads as N figures, not one.
   *
   * Units do not block each other, so a group ordered onto a single point would
   * otherwise stand on identical coordinates and draw as one soldier. Delegates to
   * {@link UnitSeparation}, which owns the rule and its buffers.
   */
  separateUnits(dtSeconds: number) {
    this.separation.separate(
      this.state.units,
      dtSeconds,
      this.state.mapWidth,
      this.state.mapHeight,
      this.isBlockedTileTest
    );
  }

  /**
   * Drops everything this system remembers about a unit.
   *
   * Only the re-route cooldown is per-unit state here; the route itself lives on
   * the unit, so a dead id must not keep a timestamp alive for the lifetime of
   * the room.
   */
  forgetUnit(unitId: string) {
    this.lastRepathAt.delete(unitId);
    this.lastChaseRequestAt.delete(unitId);
    this.pathGoals.delete(unitId);
    this.pendingTransitions.delete(unitId);
  }

  /**
   * Invalidates a route whose next tile has become an obstacle.
   *
   * Paths are computed when an order arrives, so a building placed across a
   * unit's remaining route is not seen by anyone: the unit keeps following the
   * stale waypoints and walks through the new wall. Called once per tick per
   * moving unit, before the movement step, so the tile the unit is about to enter
   * is checked against the same blocked grid the search uses. A hit drops the
   * route and queues a fresh search; the unit walks straight for the tick or two
   * the search needs, exactly like a failed search.
   *
   * @returns true when a new route was requested.
   */
  refreshRouteIfBlocked(unit: UnitState): boolean {
    if (unit.pathX.length === 0 || unit.pathY.length === 0) return false;

    const nextX = Math.floor(unit.pathX[0]);
    const nextY = Math.floor(unit.pathY[0]);
    if (!this.isBlockedTileFor(unit, nextX, nextY)) return false;

    const now = performance.now();
    const lastRepath = this.lastRepathAt.get(unit.id);
    // Only a *previous* re-route throttles: an untracked unit must be re-routed
    // immediately, and `performance.now()` can legitimately be below the cooldown
    // in a fresh process (tests) or after a page reload.
    if (lastRepath !== undefined && now - lastRepath < REPATH_COOLDOWN_MS) return false;
    this.lastRepathAt.set(unit.id, now);

    // Re-route to the same goal the dropped route was following: a chase goal
    // must not overwrite the move destination stored on the unit.
    const goal = this.pathGoals.get(unit.id);
    this.requestPath(unit, goal?.x ?? unit.targetX, goal?.y ?? unit.targetY);
    return true;
  }

  /**
   * Whether one tile of the cached blocked grid is an obstacle for the default
   * (owner) route layer. Kept public for the wall tests; unit-aware callers use
   * {@link isBlockedTileFor}.
   */
  isBlockedTile(x: number, y: number): boolean {
    const { mapWidth, mapHeight } = this.state;
    if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) return false;
    return this.getBlockedGrid()[y * mapWidth + x] === 1;
  }

  /** Whether a tile is an obstacle for this unit's current route layer. */
  isBlockedTileFor(unit: UnitState, x: number, y: number): boolean {
    const { mapWidth, mapHeight } = this.state;
    if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) return false;
    const grid = this.gridFor(unit);
    return grid[y * mapWidth + x] === 1;
  }

  /** The blocked grid the unit is currently pathing on. */
  private gridFor(unit: UnitState): Uint8Array {
    const ownerGrid = this.getBlockedGrid();
    if (unit.onWall) return this.wallGrid as Uint8Array;
    if (this.citadelOwnerId !== null && unit.ownerId !== this.citadelOwnerId) {
      return this.blockedGridEnemy as Uint8Array;
    }
    return ownerGrid;
  }

  /**
   * Whether a straight-line step would cross a citadel boundary the unit may not
   * cross.
   *
   * Ground units may never step onto a wall top; enemy units may not step onto a
   * gate either. A unit already on the wall may only remain on wall-top tiles,
   * and the stair transition flips `onWall` before the step onto/off the wall.
   */
  blocksStep(
    unit: UnitState,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): boolean {
    this.getBlockedGrid();
    const toXf = Math.floor(toX);
    const toYf = Math.floor(toY);
    const toKey = `${toXf},${toYf}`;
    const fromKey = `${Math.floor(fromX)},${Math.floor(fromY)}`;

    // A unit that has just stepped down from the wall is still standing on the
    // wall tile for one frame; it may only leave onto the stair landing, never
    // straight over the parapet.
    if (
      !unit.onWall &&
      this.citadelWallTops.has(fromKey) &&
      !this.citadelGates.has(fromKey)
    ) {
      return !this.isStairTile(toXf, toYf);
    }

    if (unit.onWall) {
      if (this.citadelWallTops.has(toKey)) return false;
      // The only legal way off the wall layer is onto a stair landing; from
      // there the transition flips `onWall` and the ground route takes over.
      return !this.isStairTile(toXf, toYf);
    }

    // The gate is ground-level: the owner walks through it, everyone else is
    // stopped by the sealed portcullis.
    if (this.citadelGates.has(toKey)) return unit.ownerId !== this.citadelOwnerId;
    if (this.citadelWallTops.has(toKey)) return true;
    return false;
  }

  /** Whether a tile is a stair upper landing on this map. */
  private isStairTile(x: number, y: number): boolean {
    return this.citadelStairTops.has(`${x},${y}`);
  }

  /**
   * Finishes a pending stair transition once the unit reaches the landing.
   *
   * Called by the room's movement loop on arrival. Returns true when the layer
   * changed and a fresh route to the original destination was requested.
   */
  tryCompleteElevationTransition(unit: UnitState): boolean {
    const pending = this.pendingTransitions.get(unit.id);
    if (!pending) return false;

    const distance = Math.hypot(unit.x - pending.approachX, unit.y - pending.approachY);
    if (distance > 0.35) {
      // A separation shove can leave the unit beside the landing after its route
      // has emptied; route it back instead of stranding the order.
      if (unit.pathX.length === 0 && unit.pathY.length === 0) {
        this.requestPath(unit, pending.approachX, pending.approachY);
      }
      return false;
    }

    this.pendingTransitions.delete(unit.id);
    unit.onWall = !unit.onWall;
    unit.pathX.clear();
    unit.pathY.clear();
    this.requestPath(unit, pending.targetX, pending.targetY);
    return true;
  }

  /**
   * Answers a bounded number of queued path requests per tick.
   *
   * The goal is read from the unit's own target rather than from the request, so
   * a unit re-ordered while it waits for a route is routed to its current
   * destination instead of the one it asked for earlier.
   */
  processPendingPaths() {
    if (this.pendingPaths.length === 0) return;

    // Building the grids once here also refreshes them; each unit then picks the
    // ground, enemy-ground or wall-top layer it currently belongs to.
    this.getBlockedGrid();
    const deadline = performance.now() + PATH_BUDGET_MS;
    let computed = 0;

    while (this.pendingPaths.length > 0 && computed < MAX_PATHS_PER_TICK) {
      const unitId = this.pendingPaths.shift() as string;
      this.pendingPathIds.delete(unitId);

      const unit = this.state.units.get(unitId);
      if (!unit) continue;
      computed++;

      const goal = this.pathGoals.get(unitId) ?? { x: unit.targetX, y: unit.targetY };
      const route = this.pathfinder.findPath(
        { x: unit.x, y: unit.y },
        { x: goal.x, y: goal.y },
        this.gridFor(unit)
      );

      unit.pathX.clear();
      unit.pathY.clear();
      // No route (walled in, or the search hit its budget): the unit walks the
      // straight line, which is the pre-SIM-01 behaviour.
      if (!route) continue;

      for (const point of route) {
        unit.pathX.push(point.x);
        unit.pathY.push(point.y);
      }

      if (performance.now() >= deadline) break;
    }
  }

  /**
   * Current blocked-tile snapshot, rebuilt only when the world changed shape.
   *
   * Paths are only computed when an order arrives and in bounded batches, so the
   * rebuild is off the per-tick path entirely; the age check is a safety net for
   * a footprint that changes without the building count changing.
   */
  private getBlockedGrid(): Uint8Array {
    const buildingCount = this.state.buildings.size;
    const resourceCount = this.state.resourceNodes.size;
    const citadelSignature = this.citadelSignature();
    const stale =
      this.blockedGrid === null ||
      this.blockedGridBuildingCount !== buildingCount ||
      this.blockedGridResourceCount !== resourceCount ||
      this.blockedGridCitadelSignature !== citadelSignature ||
      performance.now() - this.blockedGridBuiltAt > BLOCKED_GRID_MAX_AGE_MS;

    if (!stale) return this.blockedGrid as Uint8Array;

    const { mapWidth, mapHeight } = this.state;
    const grid = this.blockedGrid ?? new Uint8Array(mapWidth * mapHeight);
    grid.fill(0);

    this.state.buildings.forEach((building: BuildingState) => {
      // The `CITADEL` entity is a virtual box: its walls are stamped below and
      // its interior slots are real buildings in their own right. Blocking its
      // footprint would seal the courtyard (gate included) and leave every unit
      // inside with no route out.
      if (isVirtualCitadelCompound(building)) return;

      const endX = Math.min(mapWidth, building.gridX + building.sizeX);
      const endY = Math.min(mapHeight, building.gridY + building.sizeY);
      for (let y = Math.max(0, building.gridY); y < endY; y++) {
        for (let x = Math.max(0, building.gridX); x < endX; x++) {
          grid[y * mapWidth + x] = 1;
        }
      }
    });

    this.state.resourceNodes.forEach((node: ResourceNodeState) => {
      if (node.remainingAmount <= 0) return;
      if (node.gridX < 0 || node.gridY < 0) return;
      if (node.gridX >= mapWidth || node.gridY >= mapHeight) return;
      grid[node.gridY * mapWidth + node.gridX] = 1;
    });

    // Citadel walls are indestructible terrain derived from the Town Center, not
    // building entities, so they are stamped in here. The wall-top and gate
    // sets are refreshed alongside the grid.
    const walls = citadelWallTileSet(this.state);
    this.citadelWallTops = citadelWallTopTileSet(this.state);
    this.citadelGates = citadelGateTileSet(this.state);
    this.citadelOwnerId = citadelOwnerIdOf(this.state);

    for (const key of walls) {
      const [x, y] = key.split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
      grid[y * mapWidth + x] = 1;
    }

    // The enemy layer is the same courtyard with the gate sealed. Copying the
    // finished grid keeps buildings, resources and walls in perfect sync.
    const enemyGrid =
      this.blockedGridEnemy ?? new Uint8Array(mapWidth * mapHeight);
    enemyGrid.set(grid);
    for (const key of this.citadelGates) {
      const [x, y] = key.split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
      enemyGrid[y * mapWidth + x] = 1;
    }
    this.blockedGridEnemy = enemyGrid;

    // The wall layer is the inverse: nothing is walkable except the wall top and
    // gate roof. A stair landing is the route's start, and the Pathfinder lets a
    // search begin on a blocked cell, so the first step onto the wall works.
    const wallGrid = this.wallGrid ?? new Uint8Array(mapWidth * mapHeight);
    wallGrid.fill(1);
    for (const key of this.citadelWallTops) {
      const [x, y] = key.split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
      wallGrid[y * mapWidth + x] = 0;
    }
    // Stair landings are valid wall-layer steps: a unit walks from the wall onto
    // the landing, flips `onWall`, and only then starts the ground route down.
    this.citadelStairTops = new Set();
    for (const stair of this.citadelStairs()) {
      const x = stair.top.gridX;
      const y = stair.top.gridY;
      if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
      wallGrid[y * mapWidth + x] = 0;
      this.citadelStairTops.add(`${x},${y}`);
    }
    this.wallGrid = wallGrid;

    this.blockedGrid = grid;
    this.blockedGridBuildingCount = buildingCount;
    this.blockedGridResourceCount = resourceCount;
    this.blockedGridCitadelSignature = citadelSignature;
    this.blockedGridBuiltAt = performance.now();

    return grid;
  }

  /** Cheap key for "the citadel moved or changed owner". */
  private citadelSignature(): string {
    let signature = '';
    this.state.buildings.forEach((building: BuildingState) => {
      if (building.type !== 'TOWN_CENTER') return;
      signature += `${building.ownerId}:${building.gridX},${building.gridY}|`;
    });
    return signature;
  }
}

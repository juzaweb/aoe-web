import { Client } from '@colyseus/core';
import type { LocalizedSpec } from '../i18n/index.js';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  AttackMovePayload,
  AttackTargetPayload,
  BuildTargetPayload,
  CancelBuildingPayload,
  CancelBuildingUpgradePayload,
  CancelTrainPayload,
  CancelUnitUpgradePayload,
  CoreLevelGap,
  HarvestResourcePayload,
  MAX_CONCURRENT_BUILDING_UPGRADES,
  MAX_QUEUED_WAYPOINTS,
  MAX_SELECTION,
  MAX_ROAD_TILES_PER_MESSAGE,
  MAX_ROADS_PER_ZONE,
  MoveUnitsPayload,
  PlaceBuildingPayload,
  PlaceRoadPayload,
  RemoveRoadPayload,
  MAP_BUILD_MARGIN_TILES,
  ROAD_COST_PER_TILE,
  roadTileKey,
  zoneKindOf,
  Resources,
  SetRallyPointPayload,
  SetStancePayload,
  StopUnitsPayload,
  TrainUnitPayload,
  UNIT_BLUEPRINTS,
  UNIT_STANCES,
  UnitType,
  UpgradeBuildingPayload,
  UpgradeUnitTypePayload,
  RejectCode,
  canTrainUnitsAt,
  getBuildingMaxLevel,
  getBuildingUnlockLevel,
  getEffectiveBuildingMaxHp,
  getBuildingUpgradeCost,
  getBuildingUpgradeTimeMs,
  getCoreLevelGaps,
  getPlayerUnitLevel,
  getUnitMaxLevel,
  getUnitUpgradeCost,
  getUnitUpgradeTimeMs,
  isBuildingUnlocked,
  buildingTypeForUnit,
  isDefaultTownCenter
} from '@chien-quoc/shared';
import { BuildingState } from '../schema/BuildingState.js';
import { RoadState } from '../schema/RoadState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { UnitState } from '../schema/UnitState.js';
import { WorldState } from '../schema/WorldState.js';
import { getBuildApproachPoint } from './construction.js';
import { footprintTouchesCitadelWall } from './citadel.js';
import { RoadGrid } from './roads.js';
import { ownerIdOf } from './identity.js';
import { UNIT_SEPARATION } from './unitSeparation.js';
import {
  clearUnitResearch,
  collectCoreLevels,
  countActiveBuildingUpgrades,
  isUpgradableUnitType
} from './upgrades.js';

/**
 * What the command layer needs from the room and its sibling systems.
 *
 * Every entry is a mutation the command may cause; nothing here reads the tick
 * loop, so a handler cannot accidentally depend on simulation ordering.
 */
export interface CommandPorts {
  /** Sends an `ERROR_NOTIFICATION` to the client. */
  rejectCommand(client: Client, message: string | LocalizedSpec, code: RejectCode): void;
  /** Replaces the unit's route with one to this point (SIM-01). */
  setWalkTarget(unit: UnitState, targetX: number, targetY: number): void;
  /** Pops the next queued waypoint into the active order (CTL-05). */
  advanceQueuedWaypoint(unit: UnitState): boolean;
  /** Drops the economy system's retarget type for a unit that got a new order. */
  clearHarvestOrder(unitId: string): void;
  /** Drops the combat cooldown of a building that no longer exists. */
  forgetBuilding(buildingId: string): void;
  /** Economy order handler; the rules themselves live in `EconomySystem`. */
  harvestOrder(client: Client, payload: HarvestResourcePayload): void;
  /** Next entity id from the room's counter. */
  allocateEntityId(): number;
  /** Recomputed whenever a unit or building is added. */
  updatePlayerPopulation(ownerId: string): void;
  /** Cached road lookup for this room; invalidated by the road handlers. */
  roadGrid(): RoadGrid;
  /** Notifies when a new road tile was placed as an unconstructed foundation. */
  onRoadPlaced?(road: RoadState): void;
  /** Notifies when a road tile was removed or cancelled. */
  onRoadRemoved?(roadId: string): void;
  /** Notifies when an existing building was removed. */
  onBuildingRemoved?(building: BuildingState): void;
  /**
   * Whether `ownerId` may issue economy/building orders on this map.
   *
   * A raider standing in someone else's kingdom may only fight: building,
   * upgrading, training and harvesting there would let them colonise the map
   * (Phase 23/R14).
   */
  canManageZone(ownerId: string): boolean;
  /**
   * Town Center level of `ownerId` (phase 25), used to gate drop-off camps and
   * to seed a new building's `maxHp` with the empire aura.
   */
  townCenterLevelOf(ownerId: string): number;
}

/**
 * Distance between formation cells, in tiles. Shared with the anti-overlap pass:
 * a squad laid out at exactly one separation arrives already legal, so the pass
 * has nothing to undo and the two rules can never drift apart.
 */
const FORMATION_SPACING = UNIT_SEPARATION;

/**
 * CMD-04b refund rule. AoE returns everything for a foundation that was only
 * just placed and less once work has gone into it. These two constants keep the
 * agreed numbers in one place instead of inline in the handler.
 */
const CANCEL_BUILDING_FULL_REFUND_BELOW = 10; // construction progress %
const CANCEL_BUILDING_PARTIAL_REFUND_RATIO = 0.5;

/**
 * How many foundations/road tiles one villager may queue behind the site it is currently
 * building.
 */
const MAX_QUEUED_BUILD_SITES = 200;

/** One integer tile coordinate, after validation. */
interface RoadTile {
  x: number;
  y: number;
}

/**
 * Normalises an untrusted road payload into unique integer tiles.
 *
 * Anything that is not a finite integer is dropped, and the list is capped so
 * one message can never expand into unbounded work. The map bounds are not
 * checked here: `isRoadTileBuildable` already rejects the margin, and a remove
 * needs the same coordinate shape for tiles that may sit anywhere.
 */
function sanitizeRoadTiles(
  raw: unknown,
  mapWidth: number,
  mapHeight: number
): RoadTile[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const tiles: RoadTile[] = [];
  for (const entry of raw) {
    if (tiles.length >= MAX_ROAD_TILES_PER_MESSAGE) break;
    if (!entry || typeof entry !== 'object') continue;
    const { x, y } = entry as { x?: unknown; y?: unknown };
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const gx = x as number;
    const gy = y as number;
    if (gx < 0 || gy < 0 || gx >= mapWidth || gy >= mapHeight) continue;
    const id = roadTileKey(gx, gy);
    if (seen.has(id)) continue;
    seen.add(id);
    tiles.push({ x: gx, y: gy });
  }
  return tiles;
}

/**
 * Lays a squad out as a centred square block around its destination.
 *
 * A previous 3-column layout turned a 60-unit army into a 3x20 column, which
 * reads as a queue rather than a formation. The block is
 * `ceil(sqrt(count))` cells wide, so the group's centre of mass lands on the
 * clicked tile regardless of squad size.
 *
 * @param count Number of units to place. `0` yields an empty list.
 * @param spacing Cell distance in tiles.
 */
function computeFormationOffsets(count: number, spacing: number): Array<{ x: number; y: number }> {
  if (count <= 0) return [];

  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const offsets: Array<{ x: number; y: number }> = [];

  for (let idx = 0; idx < count; idx++) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    offsets.push({
      x: (col - (cols - 1) / 2) * spacing,
      y: (row - (rows - 1) / 2) * spacing
    });
  }

  return offsets;
}

/**
 * The command layer: one handler per client message.
 *
 * Handlers validate against authoritative state, then mutate the unit's order
 * fields. They never run the simulation — the tick reads the fields they set —
 * so a rejected command leaves the world untouched and a malformed payload can
 * only ever fail. Everything a client sends is untrusted: unit ids, target ids
 * and grid coordinates are all resolved against `state`, never taken as truth.
 */
export class CommandSystem {
  /**
   * Foundations waiting behind a villager's current site, in placement order.
   *
   * Kept off the schema on purpose: the queue is server-side order state the
   * client neither renders nor persists, and a WeakMap frees it together with
   * the unit, so a dead or departed villager cannot leave an orphan behind.
   */
  private readonly queuedBuilds = new WeakMap<UnitState, string[]>();

  constructor(
    private readonly state: WorldState,
    private readonly ports: CommandPorts
  ) {}

  /**
   * Blocks economy/building orders from anyone who does not own this map.
   *
   * Returns false after telling the client why, so a handler can `return`
   * immediately. Military orders deliberately skip this check: a raider has to
   * be able to fight.
   */
  private ensureZoneManager(client: Client): boolean {
    const ownerId = ownerIdOf(client);
    if (this.ports.canManageZone(ownerId)) return true;
    this.ports.rejectCommand(
      client,
      'You may only issue combat orders in this kingdom.',
      RejectCode.FORBIDDEN
    );
    return false;
  }

  handlePlaceBuilding(client: Client, payload: PlaceBuildingPayload) {
    if (!this.ensureZoneManager(client)) return;
    const ownerId = ownerIdOf(client);
    const player = this.state.players.get(ownerId);
    if (!player) return;

    // Portals are server-created travel infrastructure, never a build order.
    if (payload.type === 'PORTAL') {
      this.ports.rejectCommand(client, 'Portals cannot be built', RejectCode.FORBIDDEN);
      return;
    }

    const blueprint = BUILDING_BLUEPRINTS[payload.type];
    if (!blueprint) {
      this.ports.rejectCommand(client, 'Invalid building type', RejectCode.INVALID);
      return;
    }

    // Phase 25/D5: the drop-off camps are unlocked by capital levels. The six
    // core pillars are never gated (their `requiredTownCenterLevel` is 1), so
    // the opening build menu and the Town Center's own upgrade gate stay intact.
    const townCenterLevel = this.ports.townCenterLevelOf(ownerId);
    if (!isBuildingUnlocked(payload.type, townCenterLevel)) {
      // I18N: the unlock gate is parameterised, so it travels as a spec and
      // the boundary renders the active language from the level.
      const unlockLevel = getBuildingUnlockLevel(payload.type);
      this.ports.rejectCommand(
        client,
        {
          key: 'command.requiresTownCenterLevel',
          params: { level: unlockLevel },
          fallback: `Requires Town Center level ${unlockLevel}`
        },
        RejectCode.PREREQUISITE
      );
      return;
    }

    // Check resource sufficiency
    if (
      player.wood < blueprint.cost.wood ||
      player.food < blueprint.cost.food ||
      player.gold < blueprint.cost.gold ||
      player.stone < blueprint.cost.stone
    ) {
      this.ports.rejectCommand(client, 'Insufficient resources to construct building', RejectCode.RESOURCE);
      return;
    }

    // Check bounds
    const endX = payload.gridX + blueprint.sizeX;
    const endY = payload.gridY + blueprint.sizeY;
    if (
      payload.gridX < 0 ||
      endX > this.state.mapWidth ||
      payload.gridY < 0 ||
      endY > this.state.mapHeight
    ) {
      this.ports.rejectCommand(client, 'Cannot build outside map bounds', RejectCode.PLACEMENT);
      return;
    }

    // Check tile occupancy collisions with other buildings and resource nodes
    let isColliding = false;
    this.state.buildings.forEach((b: BuildingState) => {
      const bEndX = b.gridX + b.sizeX;
      const bEndY = b.gridY + b.sizeY;
      const overlapX = payload.gridX < bEndX && endX > b.gridX;
      const overlapY = payload.gridY < bEndY && endY > b.gridY;
      if (overlapX && overlapY) {
        isColliding = true;
      }
    });

    this.state.resourceNodes.forEach((res: ResourceNodeState) => {
      if (res.gridX >= payload.gridX && res.gridX < endX && res.gridY >= payload.gridY && res.gridY < endY) {
        isColliding = true;
      }
    });

    if (isColliding) {
      this.ports.rejectCommand(client, 'Placement obstructed by existing structure or resource', RejectCode.PLACEMENT);
      return;
    }

    // A road is walkable, not an obstacle, but a building on top of it would
    // silently drop the movement bonus for that stretch. Rough terrain is
    // rejected the same way the client's ghost is painted red.
    if (this.footprintTouchesRoad(payload.gridX, payload.gridY, blueprint.sizeX, blueprint.sizeY)) {
      this.ports.rejectCommand(client, 'Cannot build on top of a road', RejectCode.PLACEMENT);
      return;
    }

    // Citadel walls are indestructible terrain, not buildings, so the collision
    // loop above cannot see them.
    if (footprintTouchesCitadelWall(this.state, payload.gridX, payload.gridY, blueprint.sizeX, blueprint.sizeY)) {
      this.ports.rejectCommand(client, 'Cannot build on the citadel wall', RejectCode.PLACEMENT);
      return;
    }

    // Deduct resources
    player.wood -= blueprint.cost.wood;
    player.food -= blueprint.cost.food;
    player.gold -= blueprint.cost.gold;
    player.stone -= blueprint.cost.stone;

    // Create building
    const buildingId = `b_${this.ports.allocateEntityId()}`;
    const building = new BuildingState();
    building.id = buildingId;
    building.ownerId = ownerId;
    building.type = payload.type;
    building.gridX = payload.gridX;
    building.gridY = payload.gridY;
    building.sizeX = blueprint.sizeX;
    building.sizeY = blueprint.sizeY;
    building.hp = 1; // CMD-05: a foundation is nearly defenceless until it is finished
    building.maxHp = getEffectiveBuildingMaxHp(payload.type, 1, townCenterLevel);
    building.level = 1;
    building.upgradeProgressMs = 0;
    building.upgradeTimeMs = 0;
    building.isConstructed = false;
    building.constructionProgress = 0;

    this.state.buildings.set(buildingId, building);
    this.ports.updatePlayerPopulation(ownerId);

    // CMD-07: the villagers that were selected when the building was picked go
    // straight to work. It has to happen in this handler: the client never
    // learns the foundation's id, so a follow-up BUILD_TARGET would need a
    // second click on a site it cannot address yet.
    this.assignBuildersToSite(
      this.collectBuilders(client, payload.unitIds),
      building,
      payload.queue === true
    );
  }

  /**
   * Paints roads on the sender's own kingdom.
   *
   * Every tile is 1x1 and priced individually, so the whole batch is validated
   * before anything is charged: a payload that is half valid still commits its
   * valid half, but only if the player can afford it. Tiles already holding a
   * road, a building or a resource node are dropped silently — the client
   * painted them red already, and failing the drag on one bad neighbour would
   * make a long stroke unusable.
   */
  handlePlaceRoad(client: Client, payload: PlaceRoadPayload) {
    if (!this.ensureZoneManager(client)) return;
    const ownerId = ownerIdOf(client);
    const player = this.state.players.get(ownerId);
    if (!player) return;

    if (zoneKindOf(this.state.zoneId) !== 'kingdom') {
      this.ports.rejectCommand(client, 'Roads can only be built in a kingdom', RejectCode.PLACEMENT);
      return;
    }

    const tiles = sanitizeRoadTiles(
      payload?.tiles,
      this.state.mapWidth,
      this.state.mapHeight
    );
    if (tiles.length === 0) {
      this.ports.rejectCommand(client, 'No buildable road tiles', RejectCode.PLACEMENT);
      return;
    }

    const roads = this.ports.roadGrid();
    const buildable = tiles.filter((tile) => this.isRoadTileBuildable(tile, roads));
    if (buildable.length === 0) {
      this.ports.rejectCommand(client, 'Those tiles are already occupied', RejectCode.PLACEMENT);
      return;
    }

    if (this.state.roads.size + buildable.length > MAX_ROADS_PER_ZONE) {
      this.ports.rejectCommand(client, 'This kingdom has reached its road limit', RejectCode.LIMIT);
      return;
    }

    const cost = buildable.length * ROAD_COST_PER_TILE;
    if (player.wood < cost) {
      this.ports.rejectCommand(client, 'Not enough wood to build that road', RejectCode.RESOURCE);
      return;
    }

    player.wood -= cost;
    const placedRoads: RoadState[] = [];
    for (const tile of buildable) {
      const road = new RoadState();
      road.id = roadTileKey(tile.x, tile.y);
      road.ownerId = ownerId;
      road.gridX = tile.x;
      road.gridY = tile.y;
      road.isConstructed = false;
      road.constructionProgress = 0;
      this.state.roads.set(road.id, road);
      this.ports.onRoadPlaced?.(road);
      placedRoads.push(road);
    }
    // A stroke can add and remove tiles within one tick, which leaves the count
    // unchanged; the cached grid must not trust the size alone.
    roads.invalidate();

    const builders = this.collectBuilders(client, payload.unitIds);
    if (builders.length > 0 && placedRoads.length > 0) {
      this.assignBuildersToRoads(builders, placedRoads);
    }
  }

  /** Removes the sender's own road tiles; refunds wood if unconstructed. */
  handleRemoveRoad(client: Client, payload: RemoveRoadPayload) {
    if (!this.ensureZoneManager(client)) return;
    const ownerId = ownerIdOf(client);
    const player = this.state.players.get(ownerId);
    if (!player) return;

    if (zoneKindOf(this.state.zoneId) !== 'kingdom') {
      this.ports.rejectCommand(client, 'Roads can only be removed in a kingdom', RejectCode.PLACEMENT);
      return;
    }

    const tiles = sanitizeRoadTiles(payload?.tiles, this.state.mapWidth, this.state.mapHeight);
    for (const tile of tiles) {
      const id = roadTileKey(tile.x, tile.y);
      const road = this.state.roads.get(id);
      // Only the owner may erase a tile: a shared room must never let one
      // player take apart another player's network.
      if (!road || road.ownerId !== ownerId) continue;
      if (!road.isConstructed) {
        player.wood += ROAD_COST_PER_TILE;
      }
      this.state.roads.delete(id);
      this.ports.onRoadRemoved?.(id);
    }
    this.ports.roadGrid().invalidate();
  }

  /** Whether one road tile may be painted: inside the margin, empty of everything else. */
  private isRoadTileBuildable(tile: { x: number; y: number }, roads: RoadGrid): boolean {
    const margin = MAP_BUILD_MARGIN_TILES;
    if (tile.x < margin || tile.y < margin) return false;
    if (tile.x >= this.state.mapWidth - margin || tile.y >= this.state.mapHeight - margin) return false;

    if (roads.isRoad(tile.x, tile.y)) return false;
    if (this.state.roads.has(roadTileKey(tile.x, tile.y))) return false;

    let occupied = false;
    this.state.buildings.forEach((building: BuildingState) => {
      if (occupied) return;
      if (
        tile.x >= building.gridX &&
        tile.x < building.gridX + building.sizeX &&
        tile.y >= building.gridY &&
        tile.y < building.gridY + building.sizeY
      ) {
        occupied = true;
      }
    });
    if (occupied) return false;

    this.state.resourceNodes.forEach((node: ResourceNodeState) => {
      if (occupied) return;
      if (node.gridX === tile.x && node.gridY === tile.y) occupied = true;
    });

    return !occupied;
  }

  /** Whether any tile of a footprint touches a road (finished or under construction). */
  private footprintTouchesRoad(gx: number, gy: number, sizeX: number, sizeY: number): boolean {
    const roads = this.ports.roadGrid();
    for (let y = gy; y < gy + sizeY; y++) {
      for (let x = gx; x < gx + sizeX; x++) {
        if (roads.isRoad(x, y)) return true;
        if (this.state.roads.has(roadTileKey(x, y))) return true;
      }
    }
    return false;
  }

  handleMoveUnits(client: Client, payload: MoveUnitsPayload) {
    if (!payload.unitIds || payload.unitIds.length === 0) return;
    if (payload.unitIds.length > MAX_SELECTION) {
      this.ports.rejectCommand(client, 'Too many units in one command', RejectCode.LIMIT);
      return;
    }
    if (!Number.isFinite(payload.targetGridX) || !Number.isFinite(payload.targetGridY)) {
      this.ports.rejectCommand(client, 'Invalid move target', RejectCode.INVALID);
      return;
    }

    // Shift+right click appends; a plain move replaces the whole order. Anything
    // that is not literally `true` is treated as a direct move, so a malformed
    // payload can never sneak extra state into a unit.
    const queueWaypoint = payload.queue === true;

    // Validate first, then spread the surviving units over one formation. Doing
    // it in a single pass would size the block off the payload length, so ids
    // that are foreign or stale would leave holes in the shape.
    const ownedUnits = this.collectOwnedUnits(client, payload.unitIds);
    const targets = this.assignFormationTargets(ownedUnits, payload.targetGridX, payload.targetGridY);

    ownedUnits.forEach((unit, idx) => {
      const { x: targetX, y: targetY } = targets[idx];

      if (queueWaypoint) {
        if (unit.queueTargetX.length >= MAX_QUEUED_WAYPOINTS) return;
        unit.queueTargetX.push(targetX);
        unit.queueTargetY.push(targetY);
        // A unit with no order in flight has nothing to finish, so the point
        // it just asked for becomes the active order immediately.
        if (unit.actionState === 'IDLE') {
          this.ports.advanceQueuedWaypoint(unit);
        }
        return;
      }

      unit.queueTargetX.clear();
      unit.queueTargetY.clear();
      this.ports.setWalkTarget(unit, targetX, targetY);
      unit.actionState = 'MOVING';
      unit.targetEntityId = '';
      unit.targetEntityType = '';
      unit.previousActionState = '';
    });
  }

  handleTrainUnit(client: Client, payload: TrainUnitPayload) {
    if (!this.ensureZoneManager(client)) return;
    const ownerId = ownerIdOf(client);
    const player = this.state.players.get(ownerId);
    const building = this.state.buildings.get(payload.buildingId);
    if (!player || !building || building.ownerId !== ownerId) return;

    const blueprint = BUILDING_BLUEPRINTS[building.type as BuildingType];
    if (!blueprint || !blueprint.trainableUnits.includes(payload.unitType)) {
      this.ports.rejectCommand(client, 'Unit cannot be trained at this structure', RejectCode.PREREQUISITE);
      return;
    }

    const unitBlueprint = UNIT_BLUEPRINTS[payload.unitType];
    if (!unitBlueprint) return;

    // Population limit check
    if (player.population >= player.populationCap) {
      this.ports.rejectCommand(client, 'Population limit reached. Build more Houses!', RejectCode.LIMIT);
      return;
    }

    // Resource check
    if (
      player.wood < unitBlueprint.cost.wood ||
      player.food < unitBlueprint.cost.food ||
      player.gold < unitBlueprint.cost.gold ||
      player.stone < unitBlueprint.cost.stone
    ) {
      this.ports.rejectCommand(client, 'Insufficient resources to train unit', RejectCode.RESOURCE);
      return;
    }

    // Deduct resources
    player.wood -= unitBlueprint.cost.wood;
    player.food -= unitBlueprint.cost.food;
    player.gold -= unitBlueprint.cost.gold;
    player.stone -= unitBlueprint.cost.stone;

    // Add to training queue
    building.trainingQueue.push(payload.unitType);
  }

  /**
   * CMD-04a: drops the unit at the head of a building's training queue.
   *
   * The queue is the source of truth for what was being trained, so the refund
   * amount never comes from the client: only the head is cancelled and only its
   * own blueprint price is returned. Cancelling refunds in full — nothing has
   * been produced yet, the player only loses the elapsed time.
   */
  handleCancelTrain(client: Client, payload: CancelTrainPayload) {
    if (!this.ensureZoneManager(client)) return;
    const player = this.state.players.get(ownerIdOf(client));
    if (!player) return;

    const building = this.requireOwnedBuilding(client, payload.buildingId);
    if (!building) return;

    if (building.trainingQueue.length === 0) {
      this.ports.rejectCommand(client, 'Nothing is being trained here', RejectCode.GONE);
      return;
    }

    // Resolve the price before touching the queue: an unreadable entry must not
    // disappear without a refund, which is what a shift-then-lookup would do.
    const unitType = building.trainingQueue[0] as UnitType;
    const blueprint = UNIT_BLUEPRINTS[unitType];
    if (!blueprint) {
      this.ports.rejectCommand(client, 'Unknown unit in training queue', RejectCode.INVALID);
      return;
    }

    building.trainingQueue.shift();
    // The elapsed time belonged to the cancelled unit. Keeping it would let the
    // player cancel and re-queue to finish the next unit for free.
    building.trainingProgressMs = 0;
    this.refundResources(player, blueprint.cost, 1);
  }

  /**
   * Removes a foundation or demolishes a completed building.
   *
   * The default Town Center and map travel Portals cannot be deleted.
   * Foundations return full or partial resources; completed buildings return 0
   * resources (AoE standard), but any queued units and in-flight upgrades are refunded.
   */
  handleCancelBuilding(client: Client, payload: CancelBuildingPayload) {
    if (!this.ensureZoneManager(client)) return;
    const player = this.state.players.get(ownerIdOf(client));
    if (!player) return;

    const building = this.state.buildings.get(payload.buildingId);
    if (!building) {
      const road = this.state.roads.get(payload.buildingId);
      if (road) {
        if (road.ownerId !== ownerIdOf(client)) {
          this.ports.rejectCommand(client, 'Not your building', RejectCode.FORBIDDEN);
          return;
        }
        if (road.isConstructed) {
          this.ports.rejectCommand(client, 'Cannot cancel a completed building', RejectCode.INVALID);
          return;
        }
        player.wood += ROAD_COST_PER_TILE;
        this.state.roads.delete(road.id);
        this.ports.onRoadRemoved?.(road.id);
        this.ports.roadGrid().invalidate();
        return;
      }
      this.ports.rejectCommand(client, 'Building no longer exists', RejectCode.GONE);
      return;
    }

    if (building.ownerId !== ownerIdOf(client)) {
      this.ports.rejectCommand(client, 'Not your building', RejectCode.FORBIDDEN);
      return;
    }

    if (building.type === 'PORTAL') {
      this.ports.rejectCommand(
        client,
        {
          key: 'command.cannotDeletePortal',
          fallback: 'Portals cannot be deleted'
        },
        RejectCode.FORBIDDEN
      );
      return;
    }

    let tcCount = 0;
    this.state.buildings.forEach((b: BuildingState) => {
      if (b.ownerId === building.ownerId && b.type === 'TOWN_CENTER') {
        tcCount++;
      }
    });

    if (
      isDefaultTownCenter(
        building,
        this.state.mapWidth,
        this.state.mapHeight,
        tcCount,
        zoneKindOf(this.state.zoneId) === 'kingdom'
      )
    ) {
      this.ports.rejectCommand(
        client,
        {
          key: 'command.cannotDeleteDefaultTownCenter',
          fallback: 'Cannot delete the default Town Center'
        },
        RejectCode.FORBIDDEN
      );
      return;
    }

    if (!building.isConstructed) {
      const blueprint = BUILDING_BLUEPRINTS[building.type as BuildingType];
      if (blueprint) {
        // A foundation that has barely been worked on returns everything; once
        // real progress went in, the player eats half the cost.
        const ratio =
          building.constructionProgress < CANCEL_BUILDING_FULL_REFUND_BELOW
            ? 1
            : CANCEL_BUILDING_PARTIAL_REFUND_RATIO;
        this.refundResources(player, blueprint.cost, ratio);
      }
    } else {
      // Completed building: 0% refund on building cost.
      // Refund any queued units in trainingQueue
      while (building.trainingQueue.length > 0) {
        const unitType = building.trainingQueue.shift() as UnitType;
        const uBp = UNIT_BLUEPRINTS[unitType];
        if (uBp) {
          this.refundResources(player, uBp.cost, 1);
        }
      }
      building.trainingProgressMs = 0;

      // Refund in-flight upgrade if upgrading
      if (building.upgradeTimeMs > 0) {
        const upgradeCost = getBuildingUpgradeCost(
          building.type as BuildingType,
          building.level
        );
        this.refundResources(player, upgradeCost, 1);
        building.upgradeProgressMs = 0;
        building.upgradeTimeMs = 0;
      }
    }

    // Units walking to or attacking the foundation resolve the missing target
    // on their next tick, so nothing has to be repointed here.
    this.state.buildings.delete(building.id);
    this.ports.forgetBuilding(building.id);
    this.ports.updatePlayerPopulation(building.ownerId);
    this.ports.onBuildingRemoved?.(building);
  }

  /**
   * Starts a building upgrade. The price and duration come from the building's
   * own level, never from the client, and the tick is the only thing that can
   * finish it.
   */
  handleUpgradeBuilding(client: Client, payload: UpgradeBuildingPayload) {
    if (!this.ensureZoneManager(client)) return;
    const player = this.state.players.get(ownerIdOf(client));
    if (!player) return;

    const building = this.requireOwnedBuilding(client, payload?.buildingId);
    if (!building) return;

    if (!building.isConstructed) {
      this.ports.rejectCommand(client, 'Building is still under construction', RejectCode.PREREQUISITE);
      return;
    }
    if (building.upgradeTimeMs > 0) {
      this.ports.rejectCommand(client, 'Building is already upgrading', RejectCode.BUSY);
      return;
    }

    const type = building.type as BuildingType;
    if (!BUILDING_BLUEPRINTS[type]) {
      this.ports.rejectCommand(client, 'Unknown building type', RejectCode.INVALID);
      return;
    }
    if (type === 'PORTAL') {
      this.ports.rejectCommand(client, 'Portals cannot be upgraded', RejectCode.FORBIDDEN);
      return;
    }
    if (building.level >= getBuildingMaxLevel(type)) {
      this.ports.rejectCommand(client, 'Building is already at max level', RejectCode.LIMIT);
      return;
    }

    // LVL2/D5: the Town Center may not pull ahead of the four core buildings.
    // The gate asks for the Town Center's own level, so every step has to be
    // earned. Checked before the slot and the price so the player learns about
    // the gate even when they have nothing to spend yet.
    if (type === 'TOWN_CENTER') {
      const unmet = getCoreLevelGaps(collectCoreLevels(this.state, player.id), building.level).filter(
        (gap) => !gap.met
      );
      if (unmet.length > 0) {
        const gaps = describeCoreGaps(unmet);
        this.ports.rejectCommand(
          client,
          {
            key: 'command.coreGaps',
            params: { gaps },
            fallback: `Town Center upgrade requires ${gaps}`
          },
          RejectCode.PREREQUISITE
        );
        return;
      }
    }

    // LVL2/D6: two upgrades at a time, so the gate above costs real time instead
    // of being skipped by starting all four pillars in parallel.
    if (countActiveBuildingUpgrades(this.state, player.id) >= MAX_CONCURRENT_BUILDING_UPGRADES) {
      this.ports.rejectCommand(
        client,
        {
          key: 'command.upgradeSlots',
          params: { max: MAX_CONCURRENT_BUILDING_UPGRADES },
          fallback: `Building upgrade limit reached (${MAX_CONCURRENT_BUILDING_UPGRADES} at a time)`
        },
        RejectCode.LIMIT
      );
      return;
    }

    const cost = getBuildingUpgradeCost(type, building.level);
    if (!this.canAfford(player, cost)) {
      this.ports.rejectCommand(client, 'Insufficient resources to upgrade building', RejectCode.RESOURCE);
      return;
    }

    this.spendResources(player, cost);
    building.upgradeProgressMs = 0;
    building.upgradeTimeMs = getBuildingUpgradeTimeMs(type, building.level);
  }

  /** Cancels a building upgrade and returns its full price. */
  handleCancelBuildingUpgrade(client: Client, payload: CancelBuildingUpgradePayload) {
    if (!this.ensureZoneManager(client)) return;
    const player = this.state.players.get(ownerIdOf(client));
    if (!player) return;

    const building = this.requireOwnedBuilding(client, payload?.buildingId);
    if (!building) return;

    if (building.type === 'PORTAL') {
      this.ports.rejectCommand(client, 'Portals cannot be upgraded', RejectCode.FORBIDDEN);
      return;
    }

    if (building.upgradeTimeMs <= 0) {
      this.ports.rejectCommand(client, 'No upgrade is in progress', RejectCode.GONE);
      return;
    }

    const cost = getBuildingUpgradeCost(building.type as BuildingType, building.level);
    building.upgradeProgressMs = 0;
    building.upgradeTimeMs = 0;
    this.refundResources(player, cost, 1);
  }

  /**
   * Starts a player-wide unit research.
   *
   * MIL-01: the research belongs to the building that trains the unit — a
   * Barracks researches spearmen, a Stable cavalry, an Archery Range archers,
   * the Town Center villagers. One finished building of that type is enough;
   * the timer lives on the player, so losing it mid-research does not silently
   * cancel the investment.
   */
  handleUpgradeUnitType(client: Client, payload: UpgradeUnitTypePayload) {
    if (!this.ensureZoneManager(client)) return;
    const ownerId = ownerIdOf(client);
    const player = this.state.players.get(ownerId);
    if (!player) return;

    const requestedType = payload?.unitType;
    if (!requestedType || !isUpgradableUnitType(requestedType)) {
      this.ports.rejectCommand(client, 'Invalid unit type', RejectCode.INVALID);
      return;
    }

    const currentLevel = getPlayerUnitLevel(player.unitLevels, requestedType);
    if (currentLevel >= getUnitMaxLevel()) {
      this.ports.rejectCommand(client, 'Unit type is already at max level', RejectCode.LIMIT);
      return;
    }
    if (player.researchUnitType) {
      this.ports.rejectCommand(client, 'Another unit research is already in progress', RejectCode.BUSY);
      return;
    }

    const trainerType = buildingTypeForUnit(requestedType);
    if (!trainerType) {
      this.ports.rejectCommand(client, 'No building trains this unit', RejectCode.INVALID);
      return;
    }
    if (!this.hasConstructedBuilding(ownerId, trainerType)) {
      const trainerName = BUILDING_BLUEPRINTS[trainerType]?.name ?? trainerType;
      const article = indefiniteArticle(trainerName);
      this.ports.rejectCommand(
        client,
        {
          key: 'command.buildFirst',
          params: { article, name: trainerName },
          fallback: `Build ${article} ${trainerName} before researching this unit`
        },
        RejectCode.PREREQUISITE
      );
      return;
    }

    const cost = getUnitUpgradeCost(requestedType, currentLevel);
    if (!this.canAfford(player, cost)) {
      this.ports.rejectCommand(client, 'Insufficient resources to research unit upgrade', RejectCode.RESOURCE);
      return;
    }

    this.spendResources(player, cost);
    player.researchUnitType = requestedType;
    player.researchProgressMs = 0;
    player.researchTimeMs = getUnitUpgradeTimeMs(requestedType, currentLevel);
  }

  /** Cancels the single in-flight unit research and returns its full price. */
  handleCancelUnitUpgrade(client: Client, payload: CancelUnitUpgradePayload) {
    if (!this.ensureZoneManager(client)) return;
    const player = this.state.players.get(ownerIdOf(client));
    if (!player) return;

    const requestedType = payload?.unitType;
    if (!player.researchUnitType || player.researchUnitType !== requestedType) {
      this.ports.rejectCommand(client, 'No matching unit research is in progress', RejectCode.GONE);
      return;
    }

    const type = player.researchUnitType as UnitType;
    const cost = getUnitUpgradeCost(type, getPlayerUnitLevel(player.unitLevels, type));
    clearUnitResearch(player);
    this.refundResources(player, cost, 1);
  }

  handleAttackTarget(client: Client, payload: AttackTargetPayload) {
    if (!payload.unitIds || payload.unitIds.length === 0) return;
    if (payload.unitIds.length > MAX_SELECTION) {
      this.ports.rejectCommand(client, 'Too many units in one command', RejectCode.LIMIT);
      return;
    }

    // The client chooses targetEntityId/targetType freely, so resolve the target
    // from authoritative state and reject anything that is missing or friendly.
    // Without this a client can order units to attack an ally or itself.
    const ownerId = ownerIdOf(client);
    const target =
      payload.targetType === 'unit'
        ? this.state.units.get(payload.targetEntityId)
        : payload.targetType === 'building'
          ? this.state.buildings.get(payload.targetEntityId)
          : undefined;

    if (!target) {
      this.ports.rejectCommand(client, 'Target no longer exists', RejectCode.GONE);
      return;
    }
    if (target.ownerId === ownerId) {
      this.ports.rejectCommand(client, 'Cannot attack your own units or buildings', RejectCode.FORBIDDEN);
      return;
    }

    // D8/D7: a portal is travel infrastructure, not a raid target. Making it
    // attackable would let an opponent strand an empire on the other map.
    if (payload.targetType === 'building') {
      const targetBlueprint = BUILDING_BLUEPRINTS[(target as BuildingState).type as BuildingType];
      if (targetBlueprint?.attackable === false) {
        this.ports.rejectCommand(client, 'That structure cannot be attacked', RejectCode.FORBIDDEN);
        return;
      }
    }

    payload.unitIds.forEach((uId) => {
      const unit = this.state.units.get(uId);
      if (unit && unit.ownerId === ownerId) {
        // A new order replaces any queued path; leaving waypoints behind would
        // make the unit resume an old route after the attack finishes.
        unit.queueTargetX.clear();
        unit.queueTargetY.clear();
        // The chase is straight-line, so a route to the old destination would
        // only pull the unit off the target if the fight ends.
        unit.pathX.clear();
        unit.pathY.clear();
        // A plain attack has nothing to return to (CMD-01).
        unit.previousActionState = '';
        unit.targetEntityId = payload.targetEntityId;
        unit.targetEntityType = payload.targetType;
        unit.actionState = 'ATTACKING';
      }
    });
  }

  /**
   * CMD-01: issues ATTACK_MOVE or PATROL to a grid point.
   *
   * Both orders reuse the formation layout of a plain move, so a squad keeps its
   * shape while walking. PATROL also keeps each unit's current position as the
   * other end of the route; the endpoints swap on every arrival (see `update`).
   *
   * The unit types are mixed freely: villagers may attack-move too, they just
   * never auto-engage (`aggroRadius = 0`), which keeps a wood-cutting crew from
   * charging a passing scout.
   */
  handleAttackMove(client: Client, payload: AttackMovePayload, mode: 'ATTACK_MOVE' | 'PATROL') {
    if (!payload?.unitIds || payload.unitIds.length === 0) return;
    if (payload.unitIds.length > MAX_SELECTION) {
      this.ports.rejectCommand(client, 'Too many units in one command', RejectCode.LIMIT);
      return;
    }
    if (!Number.isFinite(payload.targetGridX) || !Number.isFinite(payload.targetGridY)) {
      this.ports.rejectCommand(client, 'Invalid move target', RejectCode.INVALID);
      return;
    }

    // Same validate-then-spread order as `handleMoveUnits`: a foreign or repeated
    // id must not leave a hole in the block.
    const ownedUnits = this.collectOwnedUnits(client, payload.unitIds);
    const targets = this.assignFormationTargets(ownedUnits, payload.targetGridX, payload.targetGridY);

    ownedUnits.forEach((unit, idx) => {
      const { x: targetX, y: targetY } = targets[idx];

      unit.queueTargetX.clear();
      unit.queueTargetY.clear();
      unit.targetEntityId = '';
      unit.targetEntityType = '';
      unit.previousActionState = '';
      this.ports.setWalkTarget(unit, targetX, targetY);

      if (mode === 'PATROL') {
        // The route starts where the unit stands, so it walks back here once it
        // reaches the clicked point.
        unit.patrolX = unit.x;
        unit.patrolY = unit.y;
      }

      unit.actionState = mode;
    });
  }

  /**
   * CMD-05: sends villagers to work on one of the player's own foundations.
   *
   * The client only says "these units, that building"; the server resolves both
   * against authoritative state, so a foreign foundation is rejected instead of
   * being built for its owner, and non-builders are dropped from the crew rather
   * than being dragged to the site.
   *
   * Each builder is sent to its own point on the ring just outside the footprint
   * (see `getBuildApproachPoint`), which is what stops a three-villager crew from
   * stacking on one tile.
   *
   * CMD-07 drives the same two helpers as placement-with-crew, so a foundation
   * dropped with villagers selected and a right-click on an existing one can
   * never disagree about who builds or where they stand.
   */
  handleBuildTarget(client: Client, payload: BuildTargetPayload) {
    if (!this.ensureZoneManager(client)) return;
    if (!payload?.unitIds || payload.unitIds.length === 0) return;
    if (payload.unitIds.length > MAX_SELECTION) {
      this.ports.rejectCommand(client, 'Too many units in one command', RejectCode.LIMIT);
      return;
    }

    const building = this.state.buildings.get(payload.buildingId);
    if (!building) {
      const road = this.state.roads.get(payload.buildingId);
      if (road) {
        if (road.ownerId !== ownerIdOf(client)) {
          this.ports.rejectCommand(client, 'Not your building', RejectCode.FORBIDDEN);
          return;
        }
        if (road.isConstructed) {
          this.ports.rejectCommand(client, 'Building is already finished', RejectCode.INVALID);
          return;
        }
        const builders = this.collectBuilders(client, payload.unitIds);
        if (builders.length === 0) {
          this.ports.rejectCommand(client, 'Only villagers can build', RejectCode.PREREQUISITE);
          return;
        }
        builders.forEach((builder, idx) => {
          this.queuedBuilds.delete(builder);
          this.sendBuilderToRoad(builder, road, idx, builders.length);
        });
        return;
      }
      this.ports.rejectCommand(client, 'Building no longer exists', RejectCode.GONE);
      return;
    }

    if (building.ownerId !== ownerIdOf(client)) {
      this.ports.rejectCommand(client, 'Not your building', RejectCode.FORBIDDEN);
      return;
    }
    if (building.isConstructed) {
      this.ports.rejectCommand(client, 'Building is already finished', RejectCode.INVALID);
      return;
    }
    if (!BUILDING_BLUEPRINTS[building.type as BuildingType]) {
      this.ports.rejectCommand(client, 'Unknown building type', RejectCode.INVALID);
      return;
    }

    const builders = this.collectBuilders(client, payload.unitIds);
    if (builders.length === 0) {
      this.ports.rejectCommand(client, 'Only villagers can build', RejectCode.PREREQUISITE);
      return;
    }

    this.assignBuildersToSite(builders, building);
  }

  handleHarvestResource(client: Client, payload: HarvestResourcePayload) {
    if (!this.ensureZoneManager(client)) return;
    this.ports.harvestOrder(client, payload);
  }

  /**
   * Halts the given units where they stand.
   *
   * Stop cancels the unit's order (move / attack / harvest) and leaves it at its
   * exact position. `targetX/targetY` are reset to the current position so the
   * movement branch in `update()` has nothing left to walk towards.
   *
   * Per-unit timers are deliberately NOT cleared: they hold unit state, not
   * order state. Dropping the attack cooldown would reset the weapon timer,
   * letting a client spam stop + attack to land a hit every tick instead of
   * every cooldown. Leaving the gather timer alone keeps partial progress.
   *
   * Queued waypoints ARE cleared: they are the remaining part of the cancelled
   * order, so resuming them later would undo the stop.
   */
  handleStopUnits(client: Client, payload: StopUnitsPayload) {
    if (!payload?.unitIds || payload.unitIds.length === 0) return;
    if (payload.unitIds.length > MAX_SELECTION) {
      this.ports.rejectCommand(client, 'Too many units in one command', RejectCode.LIMIT);
      return;
    }

    payload.unitIds.forEach((uId) => {
      const unit = this.state.units.get(uId);
      if (!unit || unit.ownerId !== ownerIdOf(client)) return;

      unit.actionState = 'IDLE';
      unit.targetEntityId = '';
      unit.targetEntityType = '';
      unit.previousActionState = '';
      unit.targetX = unit.x;
      unit.targetY = unit.y;
      unit.pathX.clear();
      unit.pathY.clear();
      // SIM-02: the load stays in hand (it was already taken from the world),
      // but the trip to a drop-off is cancelled with everything else.
      unit.dropOffId = '';
      unit.queueTargetX.clear();
      unit.queueTargetY.clear();
      this.ports.clearHarvestOrder(unit.id);
    });
  }

  /**
   * CMB-01: sets the combat stance of every owned unit in the payload.
   *
   * The stance is checked against the shared cycle list before anything is
   * written: the combat system only recognises those four values, so storing a
   * typo would silently behave like aggressive. Units the client does not own
   * are skipped rather than failing the whole command, like every other unit
   * order here.
   */
  handleSetStance(client: Client, payload: SetStancePayload) {
    if (!payload?.unitIds || payload.unitIds.length === 0) return;
    if (payload.unitIds.length > MAX_SELECTION) {
      this.ports.rejectCommand(client, 'Too many units in one command', RejectCode.LIMIT);
      return;
    }
    if (!UNIT_STANCES.includes(payload.stance)) {
      this.ports.rejectCommand(client, 'Unknown unit stance', RejectCode.INVALID);
      return;
    }

    this.collectOwnedUnits(client, payload.unitIds).forEach((unit) => {
      unit.stance = payload.stance;
    });
  }

  /**
   * Sets where this building's newly trained units should walk to.
   *
   * Only the owner may set it: a foreign building id is refused outright rather
   * than silently ignored, so a client bug surfaces as an error toast instead of
   * a rally point that appears to work. Coordinates are validated against the
   * map bounds because the client sends grid positions straight from the pointer
   * and a stray click outside the terrain would otherwise create an unreachable
   * target that traps every future unit in MOVING forever. Buildings that train
   * nothing are refused too: a rally flag on a House is a promise the simulation
   * can never keep.
   */
  handleSetRallyPoint(client: Client, payload: SetRallyPointPayload) {
    if (!this.ensureZoneManager(client)) return;
    const building = this.requireOwnedBuilding(client, payload?.buildingId);
    if (!building) return;

    if (!canTrainUnitsAt(building.type as BuildingType)) {
      this.ports.rejectCommand(client, 'This building cannot train units', RejectCode.PREREQUISITE);
      return;
    }

    const gridX = Number(payload.gridX);
    const gridY = Number(payload.gridY);
    if (
      !Number.isFinite(gridX) ||
      !Number.isFinite(gridY) ||
      gridX < 0 ||
      gridY < 0 ||
      gridX >= this.state.mapWidth ||
      gridY >= this.state.mapHeight
    ) {
      this.ports.rejectCommand(client, 'Invalid rally point', RejectCode.INVALID);
      return;
    }

    building.rallyX = gridX;
    building.rallyY = gridY;
  }

  /**
   * Keeps only the units this client actually owns, at most one entry per id.
   *
   * A repeated id would otherwise receive two orders and two formation cells,
   * so the same unit would be counted twice in the block.
   */
  private collectOwnedUnits(client: Client, unitIds: string[]): UnitState[] {
    const owned: UnitState[] = [];
    const seen = new Set<string>();
    const ownerId = ownerIdOf(client);

    unitIds.forEach((uId) => {
      if (seen.has(uId)) return;
      seen.add(uId);

      const unit = this.state.units.get(uId);
      if (unit && unit.ownerId === ownerId) owned.push(unit);
    });

    return owned;
  }

  /**
   * Resolves the units in `unitIds` this client may put to work on a foundation.
   *
   * Both crew orders share the rule: only the player's own units, at most one
   * entry per id, and only units with build power. Foreign ids and military
   * units are dropped instead of failing the order, the same way every other
   * group order here treats a stale id.
   *
   * The list is capped here rather than rejected (the callers that reject do it
   * themselves) because `unitIds` is optional in the placement payload: refusing
   * a whole placement because the selection that sent it was oversized would be
   * worse than building with the first MAX_SELECTION of it.
   */
  private collectBuilders(client: Client, unitIds: string[] | undefined): UnitState[] {
    if (!Array.isArray(unitIds) || unitIds.length === 0) return [];

    return this.collectOwnedUnits(client, unitIds.slice(0, MAX_SELECTION)).filter(
      (unit) => (UNIT_BLUEPRINTS[unit.type as UnitType]?.buildPower ?? 0) > 0
    );
  }

  /**
   * Signs a crew up to a foundation, or queues that foundation behind the site
   * each unit is already building.
   *
   * `queue` is the shift-placement flag. Without it the order replaces whatever
   * the unit was doing, which is the single-drop behaviour. With it, a builder
   * that is already on a foundation keeps working there and walks to the new
   * site when that one finishes; the queue lives in {@link queuedBuilds}.
   */
  private assignBuildersToSite(builders: UnitState[], building: BuildingState, queue = false) {
    builders.forEach((unit, idx) => {
      if (queue && this.currentBuildSite(unit)) {
        this.enqueueBuild(unit, building.id);
        return;
      }

      // A fresh order always drops a stale queue: whatever the unit was going
      // to build next is no longer what the player asked for.
      this.queuedBuilds.delete(unit);
      this.sendBuilderToSite(unit, building, idx, builders.length);
    });
  }

  /** The unconstructed, own foundation this unit is currently working on. */
  private currentBuildSite(unit: UnitState): BuildingState | null {
    if (unit.actionState !== 'BUILDING' || !unit.targetEntityId) return null;
    const site = this.state.buildings.get(unit.targetEntityId);
    if (!site || site.isConstructed || site.ownerId !== unit.ownerId) return null;
    return site;
  }

  /** Appends `buildingId` to a unit's build queue, up to the per-unit cap. */
  private enqueueBuild(unit: UnitState, buildingId: string) {
    const queue = this.queuedBuilds.get(unit) ?? [];
    if (queue.length >= MAX_QUEUED_BUILD_SITES) return;
    if (queue[queue.length - 1] === buildingId) return;
    queue.push(buildingId);
    this.queuedBuilds.set(unit, queue);
  }

  /**
   * Moves an idle-after-completion builder onto the next queued foundation or road.
   *
   * Called by the tick when the unit's current site is finished or gone. Entries
   * that no longer resolve to an unconstructed foundation/road of the same owner are
   * dropped here rather than needing a removal path for every cancel, destroy
   * and refund order.
   *
   * @returns true when a site was found and the unit is now walking to it.
   */
  advanceBuildQueue(unit: UnitState): boolean {
    const queue = this.queuedBuilds.get(unit);
    if (queue) {
      while (queue.length > 0) {
        const nextId = queue.shift() as string;
        const building = this.state.buildings.get(nextId);
        if (building && !building.isConstructed && building.ownerId === unit.ownerId) {
          const heading = this.countUnitsHeadingTo(building.id);
          this.sendBuilderToSite(unit, building, heading, heading + 1);
          if (queue.length === 0) this.queuedBuilds.delete(unit);
          return true;
        }

        const road = this.state.roads.get(nextId);
        if (road && !road.isConstructed && road.ownerId === unit.ownerId) {
          this.sendBuilderToRoad(unit, road);
          if (queue.length === 0) this.queuedBuilds.delete(unit);
          return true;
        }
      }

      this.queuedBuilds.delete(unit);
    }

    if (unit.targetEntityType === 'road') {
      const nextRoad = this.findNearestUnconstructedRoad(unit);
      if (nextRoad) {
        this.sendBuilderToRoad(unit, nextRoad);
        return true;
      }
    }

    return false;
  }

  /** Signs a crew up to build newly placed road tiles in a nearest-neighbor chain. */
  private assignBuildersToRoads(builders: UnitState[], roads: RoadState[]) {
    if (roads.length === 0) return;
    builders.forEach((unit, idx) => {
      let firstRoad = roads[0];
      let minDist = Math.hypot(unit.x - (firstRoad.gridX + 0.5), unit.y - (firstRoad.gridY + 0.5));
      for (let i = 1; i < roads.length; i++) {
        const d = Math.hypot(unit.x - (roads[i].gridX + 0.5), unit.y - (roads[i].gridY + 0.5));
        if (d < minDist) {
          minDist = d;
          firstRoad = roads[i];
        }
      }

      this.queuedBuilds.delete(unit);
      this.sendBuilderToRoad(unit, firstRoad, idx, builders.length);

      const remaining = roads.filter((r) => r.id !== firstRoad.id);
      let curr = firstRoad;
      while (remaining.length > 0) {
        let bestIdx = 0;
        let bestDist = Math.hypot(curr.gridX - remaining[0].gridX, curr.gridY - remaining[0].gridY);
        for (let j = 1; j < remaining.length; j++) {
          const d = Math.hypot(curr.gridX - remaining[j].gridX, curr.gridY - remaining[j].gridY);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = j;
          }
        }
        const next = remaining.splice(bestIdx, 1)[0];
        this.enqueueBuild(unit, next.id);
        curr = next;
      }
    });
  }

  /**
   * Points one unit at one unconstructed road tile.
   */
  private sendBuilderToRoad(
    unit: UnitState,
    road: RoadState,
    index = 0,
    count = 1
  ) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    const offsetX = Math.cos(angle) * 0.2;
    const offsetY = Math.sin(angle) * 0.2;

    const targetX = Math.max(0, Math.min(this.state.mapWidth - 1, road.gridX + 0.5 + offsetX));
    const targetY = Math.max(0, Math.min(this.state.mapHeight - 1, road.gridY + 0.5 + offsetY));

    unit.queueTargetX.clear();
    unit.queueTargetY.clear();
    unit.targetEntityId = road.id;
    unit.targetEntityType = 'road';
    unit.previousActionState = '';
    this.ports.setWalkTarget(unit, targetX, targetY);
    unit.actionState = 'BUILDING';
    this.ports.clearHarvestOrder(unit.id);
  }

  /** Finds the closest unconstructed road tile of this owner within maxDist. */
  private findNearestUnconstructedRoad(unit: UnitState, maxDist = 15): RoadState | null {
    let nearest: RoadState | null = null;
    let minDist = maxDist;

    this.state.roads.forEach((road: RoadState) => {
      if (road.isConstructed || road.ownerId !== unit.ownerId) return;
      const dist = Math.hypot(unit.x - (road.gridX + 0.5), unit.y - (road.gridY + 0.5));
      if (dist < minDist) {
        minDist = dist;
        nearest = road;
      }
    });

    return nearest;
  }

  /** Units already ordered to this site, used only to fan out approach points. */
  private countUnitsHeadingTo(buildingId: string): number {
    let count = 0;
    this.state.units.forEach((unit) => {
      if (unit.actionState === 'BUILDING' && unit.targetEntityId === buildingId) count++;
    });
    return count;
  }

  /**
   * Points one unit at one foundation: approach ring, build order, and the
   * previous order cancelled. Shared by placement, queued continuation and the
   * right-click `BUILD_TARGET` path so they cannot disagree.
   */
  private sendBuilderToSite(
    unit: UnitState,
    building: BuildingState,
    index: number,
    count: number
  ) {
    const approach = getBuildApproachPoint(
      unit,
      building,
      index,
      count,
      this.state.mapWidth,
      this.state.mapHeight
    );

    unit.queueTargetX.clear();
    unit.queueTargetY.clear();
    unit.targetEntityId = building.id;
    unit.targetEntityType = 'building';
    unit.previousActionState = '';
    this.ports.setWalkTarget(unit, approach.x, approach.y);
    unit.actionState = 'BUILDING';
    // Leaving a woodline for a build site must not leave a stale retarget type
    // behind, or a later depleted node would pull the villager back to it.
    this.ports.clearHarvestOrder(unit.id);
  }

  /**
   * Lays `units` out as a centred block around one grid destination (CMD-02) and
   * clamps every cell to the map. Shared by every group order so a squad keeps
   * its shape whether it walks or attack-moves.
   *
   * @returns One destination per input unit, in the same order.
   */
  private assignFormationTargets(
    units: UnitState[],
    destX: number,
    destY: number
  ): Array<{ x: number; y: number }> {
    const offsets = computeFormationOffsets(units.length, FORMATION_SPACING);
    return units.map((_, idx) => ({
      x: Math.max(0, Math.min(this.state.mapWidth - 1, destX + offsets[idx].x)),
      y: Math.max(0, Math.min(this.state.mapHeight - 1, destY + offsets[idx].y))
    }));
  }

  /**
   * Credits a fraction of a blueprint cost back to a player.
   *
   * Each resource is floored separately so a partial refund can never round up
   * into free material. `ratio` is clamped at 1: a refund must never mint
   * resources, whatever a future caller passes.
   */
  private refundResources(player: PlayerState, cost: Resources, ratio: number) {
    if (!(ratio > 0)) return;

    const share = Math.min(1, ratio);
    player.wood += Math.floor(cost.wood * share);
    player.food += Math.floor(cost.food * share);
    player.gold += Math.floor(cost.gold * share);
    player.stone += Math.floor(cost.stone * share);
  }

  /** True when every resource in `cost` is available. */
  private canAfford(player: PlayerState, cost: Resources): boolean {
    return (
      player.wood >= cost.wood &&
      player.food >= cost.food &&
      player.gold >= cost.gold &&
      player.stone >= cost.stone
    );
  }

  /** Deducts every resource in `cost`; callers check `canAfford` first. */
  private spendResources(player: PlayerState, cost: Resources): void {
    player.wood -= cost.wood;
    player.food -= cost.food;
    player.gold -= cost.gold;
    player.stone -= cost.stone;
  }

  /** Whether the player still owns at least one finished building of this type. */
  private hasConstructedBuilding(ownerId: string, type: BuildingType): boolean {
    let found = false;
    this.state.buildings.forEach((building: BuildingState) => {
      if (
        !found &&
        building.ownerId === ownerId &&
        building.type === type &&
        building.isConstructed
      ) {
        found = true;
      }
    });
    return found;
  }

  /**
   * Resolves a building the client is allowed to command, or rejects the command.
   *
   * Cancelling training, cancelling a foundation and setting a rally point all
   * open with the same existence + ownership checks. Keeping them in one place
   * means a new command cannot forget one and quietly accept a foreign id.
   */
  private requireOwnedBuilding(client: Client, buildingId: string): BuildingState | null {
    if (!buildingId) return null;

    const building = this.state.buildings.get(buildingId);
    if (!building) {
      this.ports.rejectCommand(client, 'Building no longer exists', RejectCode.GONE);
      return null;
    }
    if (building.ownerId !== ownerIdOf(client)) {
      this.ports.rejectCommand(client, 'Not your building', RejectCode.FORBIDDEN);
      return null;
    }
    return building;
  }
}

/**
 * Renders the unmet Town Center gate as one line the error toast can show, for
 * example `House level 10 (have 4), Farm level 10 (have 0)`.
 *
 * The building names come from the blueprints so the message cannot drift from
 * what the client labels the same structure.
 */
function describeCoreGaps(gaps: CoreLevelGap[]): string {
  return gaps
    .map((gap) => {
      const name = BUILDING_BLUEPRINTS[gap.type]?.name ?? gap.type;
      return `${name} level ${gap.required} (have ${gap.current})`;
    })
    .join(', ');
}

/**
 * `a` or `an`, for the building names that go into a rejection message.
 *
 * MIL-01 put "Archery Range" into the unit-research prerequisite, and "Build a
 * Archery Range" reads like a typo in a toast the player sees every time they
 * pick a research too early. Vowel-letter test only: every name in the roster is
 * either consonant-initial or a plain vowel-initial word, so the exceptions of
 * English ("an hour", "a university") cannot occur here.
 */
function indefiniteArticle(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export type ResourceType = 'wood' | 'food' | 'gold' | 'stone';

export interface Resources {
  wood: number;
  food: number;
  gold: number;
  stone: number;
}

/**
 * Which map a room simulates. A kingdom is private to one account; the
 * battlefield is the single shared PvP map every kingdom's portal leads to.
 */
export type MapZoneKind = 'kingdom' | 'battlefield';

/** Room names registered on the Colyseus server, one per zone kind. */
export type WorldRoomName = 'kingdom_room' | 'battlefield_room';

export type BuildingType =
  | 'TOWN_CENTER'
  | 'BARRACKS'
  | 'HOUSE'
  | 'FARM'
  | 'TOWER'
  /** ECO: wood drop-off, placed next to a forest. */
  | 'LUMBER_CAMP'
  /** ECO: food drop-off, placed next to berries or a cluster of farms. */
  | 'MILL'
  /** ECO: gold and stone drop-off, placed between two mines. */
  | 'MINING_CAMP'
  /**
   * Travel gateway between a kingdom and the battlefield. Server-created, never
   * buildable and never attackable (see `BuildingBlueprint.attackable`).
   */
  | 'PORTAL';

export type UnitType = 'VILLAGER' | 'SPEARMAN' | 'ARCHER' | 'CAVALRY';

export type ResourceNodeType = 'TREE' | 'GOLD_MINE' | 'STONE_MINE' | 'BERRY_BUSH';

/**
 * CMB-01: how a unit reacts to enemies it was not explicitly ordered to fight.
 *
 * `AGGRESSIVE` picks a fight with anything inside its aggro radius and chases it
 * to the ends of the map. `DEFENSIVE` does the same but gives up once the chase
 * carries it too far from where the fight started. `STAND_GROUND` never leaves
 * its tile and only strikes what walks into its weapon range. `NO_ATTACK` never
 * engages on its own, though an explicit attack order still works — the player
 * asked for it.
 */
export type UnitStance = 'AGGRESSIVE' | 'DEFENSIVE' | 'STAND_GROUND' | 'NO_ATTACK';

export type UnitActionState =
  | 'IDLE'
  | 'MOVING'
  | 'ATTACKING'
  | 'HARVESTING'
  /** SIM-02: carrying a full load to the nearest drop-off. */
  | 'RETURNING'
  /** CMD-01: walk to a point, engaging every enemy met on the way. */
  | 'ATTACK_MOVE'
  /** CMD-01: walk back and forth between two points, engaging on the way. */
  | 'PATROL'
  /** CMD-05: standing next to a foundation and putting work into it. */
  | 'BUILDING';

export interface BuildingBlueprint {
  type: BuildingType;
  name: string;
  sizeX: number;
  sizeY: number;
  cost: Resources;
  buildTimeMs: number;
  maxHp: number;
  populationProvided: number;
  trainableUnits: UnitType[];
  /**
   * SIM-03: defensive buildings shoot. `attackRange` of 0 means the building
   * never attacks, which is every building except the tower. Range is measured
   * from the building's footprint edge, in tiles.
   */
  attackPower: number;
  attackRange: number;
  attackCooldownMs: number;
  /**
   * SIM-02: resource types this building accepts. Empty means it is not a
   * drop-off at all, so a villager carrying wood walks past it.
   */
  dropOffs: ResourceType[];
  /**
   * ECO-01: resource a villager can gather straight from this building (a farm
   * grows food, everything else just holds it). Unset means the building is not
   * a gatherable target, so a right-click on it is not a harvest order.
   */
  gatheredResource?: ResourceType;
  /**
   * ECO-01: units of `gatheredResource` the building holds at level 1. Each
   * level above adds 10% (see `getBuildingLevelStats().gatherCapacity`).
   * Re-planting a depleted farm costs the building's own `cost` again.
   */
  gatherCapacity?: number;
  /**
   * Whether units may order an attack against this building. Unset means true.
   * Portals are travel infrastructure owned by their player, so making them
   * untargetable keeps a misclick from stranding an empire.
   */
  attackable?: boolean;
  description: string;
}

export interface UnitBlueprint {
  type: UnitType;
  name: string;
  cost: Resources;
  trainTimeMs: number;
  maxHp: number;
  speed: number;
  attackPower: number;
  attackRange: number;
  attackCooldownMs: number;
  canHarvest: boolean;
  /**
   * CMD-01: distance in tiles at which the unit auto-engages an enemy while
   * attack-moving or patrolling. `0` disables auto-engagement (villagers keep
   * working instead of charging at the first soldier that walks past).
   */
  aggroRadius: number;
  /**
   * CMD-05: how much work this unit contributes to a foundation, in villagers.
   * `0` cannot build at all. A building's `buildTimeMs` is the time one unit of
   * build power needs, so two villagers on one foundation halve it.
   */
  buildPower: number;
  /**
   * SIM-02: how many units of a resource a villager carries before walking it
   * back to a drop-off. `0` for units that cannot gather.
   */
  carryCapacity: number;
  description: string;
}

export interface PlaceBuildingPayload {
  type: BuildingType;
  gridX: number;
  gridY: number;
  /**
   * CMD-07: units that should start working on the new foundation right away.
   *
   * The whole point of sending them with the placement is that the client never
   * learns the new foundation's id: the server creates it and signs the crew up
   * in the same handler, so dropping a building is one click instead of a
   * placement followed by a right-click on the fresh site. Optional and
   * untrusted — the server resolves these ids against authoritative state,
   * drops everything that is not the player's own builder and caps the list.
   */
  unitIds?: string[];
  /**
   * Shift-placement: append the new foundation to each builder's build queue
   * instead of taking the crew off whatever site it is working on. A plain drop
   * (no Shift) is a fresh order and replaces the current one.
   *
   * Optional and untrusted, like `unitIds`: a queue entry only ever points at a
   * foundation the same player just created.
   */
  queue?: boolean;
}

export interface MoveUnitsPayload {
  unitIds: string[];
  targetGridX: number;
  targetGridY: number;
  /**
   * When true the waypoint is appended to the unit's queue instead of replacing
   * its current order, so it walks through every point in order (Shift+right
   * click). A non-queued move always clears whatever was queued.
   */
  queue?: boolean;
}

export interface TrainUnitPayload {
  buildingId: string;
  unitType: UnitType;
}

export interface AttackTargetPayload {
  unitIds: string[];
  targetEntityId: string;
  targetType: 'unit' | 'building';
}

/**
 * CMD-06 / ECO-01: send villagers to a source of resources. A world node is
 * addressed by `resourceNodeId`; a gatherable building (a farm) by
 * `buildingId`. Exactly one of the two is set, and the server resolves it from
 * authoritative state, so a client cannot address somebody else's farm.
 */
export interface HarvestResourcePayload {
  unitIds: string[];
  resourceNodeId?: string;
  /** ECO-01: a farm of the player's own that still holds food. */
  buildingId?: string;
}

/**
 * CMD-01: shared payload for ATTACK_MOVE and PATROL. Both walk to the clicked
 * grid cell while engaging enemies met on the way; PATROL keeps the unit's
 * position at order time as the other end of the route.
 */
export interface AttackMovePayload {
  unitIds: string[];
  targetGridX: number;
  targetGridY: number;
}

/**
 * CMD-05: sends villagers to work on one of the player's own foundations. The
 * server resolves the building and the valid builders from authoritative state,
 * so a foreign id is rejected instead of being built for somebody else.
 */
export interface BuildTargetPayload {
  unitIds: string[];
  buildingId: string;
}

/**
 * Cancels whatever a unit is doing and leaves it standing where it is.
 * Unlike MOVE_UNITS this never makes the unit walk anywhere, so it is the only
 * way to halt mid-map (e.g. a villager halfway through a forest).
 */
export interface StopUnitsPayload {
  unitIds: string[];
}

/**
 * Sets the rally point of a building: freshly trained units walk there instead
 * of standing at the door. Grid coordinates are validated server-side against
 * the map bounds.
 */
export interface SetRallyPointPayload {
  buildingId: string;
  gridX: number;
  gridY: number;
}

/**
 * CMD-04a: drops the unit at the head of a building's training queue and
 * refunds its full cost. Only the building id is needed — the server reads the
 * cancelled unit from the queue itself, so the client cannot choose what to
 * refund.
 */
export interface CancelTrainPayload {
  buildingId: string;
}

/**
 * CMD-04b: tears down a foundation that was placed but not finished, refunding
 * part of its cost. Completed buildings are rejected by the server.
 */
export interface CancelBuildingPayload {
  buildingId: string;
}

/** Starts upgrading one owned, finished building to its next level. */
export interface UpgradeBuildingPayload {
  buildingId: string;
}

/** Cancels an in-flight building upgrade and refunds its full cost. */
export interface CancelBuildingUpgradePayload {
  buildingId: string;
}

/**
 * Starts a player-wide research that raises every existing and future unit of
 * `unitType` by one level. Requires a finished Barracks; only one research may
 * run per player.
 */
export interface UpgradeUnitTypePayload {
  unitType: UnitType;
}

/** Cancels the single in-flight unit research and refunds its full cost. */
export interface CancelUnitUpgradePayload {
  unitType: UnitType;
}

/**
 * CMB-01: sets the stance of every unit in the selection. The client sends the
 * stance it wants rather than "cycle this one", so two players pressing the key
 * at the same time cannot disagree about the result.
 */
export interface SetStancePayload {
  unitIds: string[];
  stance: UnitStance;
}

/**
 * Travel order: the selected units step through the player's own portal and are
 * moved to the other map. `unitIds` may be empty, which moves the player alone.
 * The destination is derived server-side from the room's current zone, so a
 * client cannot choose an arbitrary map.
 */
export interface TravelPayload {
  portalId: string;
  unitIds: string[];
}

/**
 * Sent after the server has committed the transfer to SQLite. The client only
 * leaves the current room once this arrives, because leaving earlier would drop
 * the units from a snapshot that has not been saved yet.
 */
export interface TravelReadyPayload {
  transferId: string;
  destination: MapZoneKind;
  roomName: WorldRoomName;
}

// ---------------------------------------------------------------------------
// Raids (Phase 23)
// ---------------------------------------------------------------------------

/** How a raid ended. `ACTIVE` is only ever a database status, never a result. */
export type RaidOutcome = 'ATTACKER_WON' | 'DEFENDER_WON' | 'RETREATED';

/**
 * One empire on the world map, already filtered to the caller's ±5 Town Center
 * levels. `canAttack` is computed server-side: the client renders the button
 * from it and never decides eligibility itself.
 */
export interface WorldMapEntry {
  userId: string;
  name: string;
  color: string;
  townCenterLevel: number;
  /** Epoch ms until which nobody may raid this empire; 0 when unshielded. */
  shieldUntil: number;
  /** Epoch ms until which *this caller* may not raid it again; 0 when unlocked. */
  lockedUntil: number;
  canAttack: boolean;
  /** Localized reason `canAttack` is false. */
  blockReason?: string;
}

export interface WorldMapPayload {
  self: { userId: string; townCenterLevel: number };
  neighbors: WorldMapEntry[];
}

/** Ack for a committed raid; the client joins `roomName` with `{ ownerId, raidId }`. */
export interface RaidStartResponse {
  raidId: string;
  defenderId: string;
  roomName: 'kingdom_room';
}

/** Sent to both sides when a raid closes; the attacker leaves the defender's room. */
export interface RaidEndedPayload {
  outcome: RaidOutcome;
  loot: Resources;
  returnRoom: 'kingdom_room';
}

/**
 * One tile of a player-painted road. Roads are 1x1 and addressed by position,
 * so a payload carries bare coordinates instead of entity ids.
 */
export interface RoadTilePayload {
  x: number;
  y: number;
}

/**
 * Paints roads on the sender's own kingdom. Every tile costs
 * `ROAD_COST_PER_TILE` wood; tiles that already hold a road, a building or a
 * resource node are ignored rather than failing the whole drag.
 */
export interface PlaceRoadPayload {
  tiles: RoadTilePayload[];
}

/** Removes the sender's own road tiles. Never refunds the wood. */
export interface RemoveRoadPayload {
  tiles: RoadTilePayload[];
}

export enum NetworkMessage {
  PLACE_BUILDING = 'PLACE_BUILDING',
  PLACE_ROAD = 'PLACE_ROAD',
  REMOVE_ROAD = 'REMOVE_ROAD',
  MOVE_UNITS = 'MOVE_UNITS',
  TRAIN_UNIT = 'TRAIN_UNIT',
  CANCEL_TRAIN = 'CANCEL_TRAIN',
  CANCEL_BUILDING = 'CANCEL_BUILDING',
  UPGRADE_BUILDING = 'UPGRADE_BUILDING',
  CANCEL_BUILDING_UPGRADE = 'CANCEL_BUILDING_UPGRADE',
  UPGRADE_UNIT_TYPE = 'UPGRADE_UNIT_TYPE',
  CANCEL_UNIT_UPGRADE = 'CANCEL_UNIT_UPGRADE',
  ATTACK_TARGET = 'ATTACK_TARGET',
  ATTACK_MOVE = 'ATTACK_MOVE',
  PATROL = 'PATROL',
  BUILD_TARGET = 'BUILD_TARGET',
  HARVEST_RESOURCE = 'HARVEST_RESOURCE',
  STOP_UNITS = 'STOP_UNITS',
  SET_RALLY_POINT = 'SET_RALLY_POINT',
  SET_STANCE = 'SET_STANCE',
  TRAVEL = 'TRAVEL',
  TRAVEL_READY = 'TRAVEL_READY',
  /** The attacker walks out through their retreat gate; the raid is settled. */
  RAID_RETREAT = 'RAID_RETREAT',
  /** Server → both sides: the raid is closed, with its outcome and loot. */
  RAID_ENDED = 'RAID_ENDED',
  ERROR_NOTIFICATION = 'ERROR_NOTIFICATION',
  SYSTEM_ANNOUNCEMENT = 'SYSTEM_ANNOUNCEMENT'
}


export enum RejectCode {
  RESOURCE = 'RESOURCE',
  PLACEMENT = 'PLACEMENT',
  PREREQUISITE = 'PREREQUISITE',
  BUSY = 'BUSY',
  GONE = 'GONE',
  INVALID = 'INVALID',
  FORBIDDEN = 'FORBIDDEN',
  LIMIT = 'LIMIT'
}

export interface ErrorNotificationPayload {
  message: string;
  code: RejectCode;
}

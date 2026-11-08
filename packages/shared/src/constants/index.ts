import {
  BuildingBlueprint,
  BuildingType,
  MapZoneKind,
  ResourceType,
  Resources,
  UnitBlueprint,
  UnitStance,
  UnitType,
  WorldRoomName
} from '../types/index.js';

export const TILE_WIDTH = 128;
export const TILE_HEIGHT = 64;

/** Side lengths of one map, in grid tiles. */
export interface MapSize {
  width: number;
  height: number;
}

/**
 * A private kingdom is a single settlement, not a campaign map: 110x110 keeps
 * the whole base a short walk from the Town Center instead of scattering it
 * across an empty 220x220 field, while still leaving room for a full build order.
 */
export const KINGDOM_MAP_SIZE: MapSize = { width: 110, height: 110 };

/** The shared PvP map keeps its original size and terrain. */
export const BATTLEFIELD_MAP_SIZE: MapSize = { width: 220, height: 220 };

/**
 * Legacy aliases. They describe the battlefield only; anything that runs on
 * either map must use `mapSizeForZone` / `terrainForZone` instead.
 */
export const MAP_GRID_WIDTH = BATTLEFIELD_MAP_SIZE.width;
export const MAP_GRID_HEIGHT = BATTLEFIELD_MAP_SIZE.height;

export const SERVER_TICK_RATE = 20; // 20 ticks per second (50ms per tick)

// ---------------------------------------------------------------------------
// Maps and travel
// ---------------------------------------------------------------------------

export const KINGDOM_ROOM_NAME: WorldRoomName = 'kingdom_room';
export const BATTLEFIELD_ROOM_NAME: WorldRoomName = 'battlefield_room';

export const BATTLEFIELD_ZONE = 'battlefield';
export const KINGDOM_ZONE_PREFIX = 'kingdom:';

/** Persistent zone id of one account's private kingdom. */
export function zoneForOwner(ownerId: string): string {
  return `${KINGDOM_ZONE_PREFIX}${ownerId}`;
}

/**
 * Which kind of map a zone id describes.
 *
 * Prefix-based: only `kingdom:<ownerId>` is a private kingdom. Everything else —
 * including the legacy `world` zone — is battlefield-sized, so old snapshots and
 * the unit-test harness keep the map they were written against.
 */
export function zoneKindOf(zone: string): MapZoneKind {
  return zone.startsWith(KINGDOM_ZONE_PREFIX) ? 'kingdom' : 'battlefield';
}

/** Size of the map `zone` lives on. */
export function mapSizeForZone(zone: string): MapSize {
  return zoneKindOf(zone) === 'kingdom' ? KINGDOM_MAP_SIZE : BATTLEFIELD_MAP_SIZE;
}

/** The other map a player can travel to from `zone`. */
export function otherZone(zone: string, ownerId: string): string {
  return zoneKindOf(zone) === 'kingdom' ? BATTLEFIELD_ZONE : zoneForOwner(ownerId);
}

/** Room a player joins after leaving `zone`. */
export function roomNameForZone(zone: string): WorldRoomName {
  return zoneKindOf(zone) === 'kingdom' ? KINGDOM_ROOM_NAME : BATTLEFIELD_ROOM_NAME;
}

/** Upper bound on units one travel order may move; matches `MAX_SELECTION`. */
export const MAX_TRAVEL_UNITS = 120;

/** Server-side cooldown between two travel orders from the same account. */
export const TRAVEL_COOLDOWN_MS = 2000;

// ---------------------------------------------------------------------------
// Raids and the world map (Phase 23)
// ---------------------------------------------------------------------------

/**
 * Units one raid order may carry. Reuses the travel bound so a raid is never a
 * bigger transfer than the map switch used to be.
 */
export const RAID_MAX_UNITS = MAX_TRAVEL_UNITS;
export const RAID_MIN_UNITS = 1;

/**
 * How many Town Center levels apart two empires may be and still see each other
 * on the world map. The ladder caps at 10, so ±5 is effectively "everyone" —
 * kept as a named constant so a later rebalance is a one-line change.
 */
export const RAID_LEVEL_RANGE = 5;

/**
 * Peace granted to the defender after any raid, so being attacked twice in a
 * row is impossible while the owner is away. Three days matches the loss lock.
 */
export const RAID_SHIELD_MS = 72 * 60 * 60 * 1000;

/**
 * How long an attacker who lost must wait before raiding the same empire again.
 * Without it a player with a bigger army could farm one neighbour forever.
 */
export const RAID_LOSS_LOCK_MS = 72 * 60 * 60 * 1000;

/** Time over which damaged citadel buildings passively regenerate to full HP (72 hours). */
export const CITADEL_AUTO_REPAIR_DURATION_MS = 72 * 60 * 60 * 1000;

/** Share of each resource the winner takes from the defender. */
export const RAID_LOOT_PERCENT = 0.2;

/** Absolute ceiling per resource, so one raid cannot empty a developed base. */
export const RAID_LOOT_CAP_PER_RESOURCE = 2000;

/**
 * The defender's Town Center is not destructible: damage stops at this share of
 * its maximum HP. Defeat occurs when the citadel loses 100% of its HP (reaches 0).
 */
export const RAID_TOWN_CENTER_HP_THRESHOLD = 0;

/**
 * Maximum duration for a raid (10 minutes).
 * If the attacker does not win within 10 minutes, they must retreat.
 */
export const RAID_MAX_DURATION_MS = 10 * 60 * 1000;

/**
 * A raid running past the max raid duration is closed as a retreat.
 */
export const RAID_RETREAT_TIMEOUT_MS = RAID_MAX_DURATION_MS;

/**
 * How long a depleted resource node stays empty before it refills to
 * `maxAmount`.
 *
 * Split per resource so the map's economy has a shape: wood comes back fastest
 * (a settlement always needs it), gold slowest (it gates research and cavalry).
 */
export const RESOURCE_REGROW_MS: Record<ResourceType, number> = {
  wood: 60_000,
  food: 90_000,
  stone: 150_000,
  gold: 240_000
};

/**
 * Units one villager takes off a source per second of standing there.
 *
 * Split per resource, and far slower than the flat 10/s the first pass used:
 * at 10 a villager filled its 10-slot load in one second, so gathering itself
 * cost nothing and only the walk to a drop-off was ever felt. Rates here make
 * standing at the node the visible half of a trip, and give each resource a
 * different weight — food comes off a field fast, gold is a slow grind.
 *
 * Harvest is paid in whole units, one every `1000 / rate` milliseconds, so a
 * fractional rate never leaves a fraction in the replicated amount.
 */
export const GATHER_UNITS_PER_SECOND: Record<ResourceType, number> = {
  wood: 2,
  food: 2.5,
  stone: 1.5,
  gold: 1.25
};

/**
 * Milliseconds of standing at a source to take one unit of `resourceType`.
 *
 * `multiplier` folds an owner's drop-off bonus into the rate (phase 26); the
 * default of 1 keeps every pre-phase call site on the original cadence.
 */
export function gatherIntervalMs(resourceType: string, multiplier = 1): number {
  const rate = GATHER_UNITS_PER_SECOND[resourceType as ResourceType] ?? GATHER_UNITS_PER_SECOND.wood;
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return 1000 / (rate * safeMultiplier);
}

/**
 * Upper bound on how many unit ids a single client command may reference.
 * Guards the authoritative handlers against a client sending thousands of ids
 * in one message to force unbounded per-tick work.
 */
export const MAX_SELECTION = 120;

// ---------------------------------------------------------------------------
// Player-built roads
// ---------------------------------------------------------------------------

/**
 * Margin, in tiles, that every player-built structure keeps from the map edge.
 *
 * Shared because three places must agree: the server's footprint check, the
 * server's road tile check, and the client's ghost. Drifting apart here means a
 * ghost that looks placeable and a server that rejects it (or the reverse).
 */
export const MAP_BUILD_MARGIN_TILES = 6;

/**
 * Wood one road tile costs. A painted road has no blueprint, so its price lives
 * here instead of in `BUILDING_BLUEPRINTS`.
 */
export const ROAD_COST_PER_TILE = 2;

/**
 * Time in milliseconds for one villager (buildPower = 1) to construct one road tile.
 */
export const ROAD_BUILD_TIME_MS = 2500;

/**
 * Movement multiplier while a unit stands on a road tile. Kept modest: a road
 * is a convenience for base logistics, not a teleport.
 */
export const ROAD_SPEED_MULTIPLIER = 1.3;

/**
 * Upper bound on tiles one PLACE_ROAD/REMOVE_ROAD message may carry. A long
 * drag is split into batches client-side; the cap keeps a single hostile
 * message from forcing unbounded per-tick work.
 */
export const MAX_ROAD_TILES_PER_MESSAGE = 200;

/**
 * Upper bound on road tiles one zone may hold. Roads are replicated state and
 * persisted rows, so an unbounded map is both a bandwidth and a disk problem.
 */
export const MAX_ROADS_PER_ZONE = 4000;

// ---------------------------------------------------------------------------
// Player-built walls
// ---------------------------------------------------------------------------

/**
 * Upper bound on wall tiles one PLACE_WALL/REMOVE_WALL message may carry.
 * A wall is a building (one row per tile), so the cap keeps a hostile message
 * from forcing unbounded per-tick work and one drag is still useful.
 */
export const MAX_WALL_TILES_PER_MESSAGE = 200;

/**
 * Upper bound on wall segments one kingdom may hold. Each tile is a persisted
 * building row, so a wall brush needs the same hard cap a road network has.
 */
export const MAX_WALLS_PER_ZONE = 3000;

/**
 * Stable id of the road tile at `gx, gy`.
 *
 * Roads are 1x1 and addressed by position, so the coordinate pair *is* the id:
 * it makes the primary key deterministic, keeps two placements of the same tile
 * from duplicating, and lets the client address a tile it has not seen yet.
 */
export function roadTileKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

/**
 * Upper bound on how many future waypoints one unit may hold. Shift+right click
 * appends without bound otherwise, and every waypoint is replicated state that
 * is persisted for the unit's lifetime.
 */
export const MAX_QUEUED_WAYPOINTS = 12;

/**
 * Join rejected: the account already has a live session (SESS-01/D1).
 *
 * Lives in the private-use 4000-4999 range and does not collide with
 * Colyseus's own close codes (4000-4003 and 4010).
 */
export const SESSION_ALREADY_ACTIVE = 4009;

/**
 * Join rejected: another join for the same account is still being processed.
 * Kept distinct from {@link SESSION_ALREADY_ACTIVE} so the client can retry
 * quietly instead of showing the "account in use" screen.
 */
export const SESSION_BUSY = 4011;

/**
 * Server closed this socket because another session took the account over
 * (SESS-01/D2). The client shows the "session replaced" screen instead of the
 * generic connection-lost banner.
 */
export const SESSION_REPLACED_CLOSE = 4004;

/**
 * True when the building type produces units, i.e. when a rally point has any
 * meaning. Shared so the client (skip the order) and the authoritative room
 * (reject it) agree on which buildings accept `SET_RALLY_POINT` instead of each
 * carrying its own copy of the rule.
 */
export function canTrainUnitsAt(type: BuildingType): boolean {
  return (BUILDING_BLUEPRINTS[type]?.trainableUnits.length ?? 0) > 0;
}

export const INITIAL_PLAYER_RESOURCES: Resources = {
  wood: 300,
  food: 300,
  gold: 150,
  stone: 100
};

export const INITIAL_POPULATION_CAP = 10;
export const POPULATION_PER_HOUSE = 5;
export const MAX_POPULATION_LIMIT = 200;

/**
 * CMB-01: cycle order for the stance hotkey, from most to least aggressive.
 *
 * Shared so the client's cycling and the server's validation agree on what a
 * legal stance is: a stance not in this list is rejected instead of being
 * silently stored and then ignored by the combat system.
 */
export const UNIT_STANCES: readonly UnitStance[] = [
  'AGGRESSIVE',
  'DEFENSIVE',
  'STAND_GROUND',
  'NO_ATTACK'
];

/**
 * Next stance in the cycle. An unknown current value (a snapshot from an older
 * server, an empty field) restarts the cycle at `AGGRESSIVE` rather than
 * returning `undefined`.
 */
export function nextUnitStance(current: string): UnitStance {
  const index = UNIT_STANCES.indexOf(current as UnitStance);
  if (index === -1) return UNIT_STANCES[0];
  return UNIT_STANCES[(index + 1) % UNIT_STANCES.length];
}

export const BUILDING_BLUEPRINTS: Record<BuildingType, BuildingBlueprint> = {
  TOWN_CENTER: {
    type: 'TOWN_CENTER',
    name: 'Town Center',
    sizeX: 4,
    // The Town Center is the landmark of a kingdom, so it is taller than it is
    // wide; the extra rows give its roof room to read above the citadel walls.
    sizeY: 6,
    cost: { wood: 275, food: 0, gold: 0, stone: 100 },
    buildTimeMs: 15000,
    maxHp: 2400,
    populationProvided: 15,
    trainableUnits: ['VILLAGER'],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: ['wood', 'food', 'gold', 'stone'],
    description: 'The heart of your settlement. Trains villagers and provides core population.'
  },
  CITADEL: {
    type: 'CITADEL',
    name: 'Citadel',
    sizeX: 26,
    sizeY: 26,
    cost: { wood: 0, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 20000,
    maxHp: 7050,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    attackable: true,
    description: 'The fortified walls and gate of the kingdom citadel.'
  },
  BARRACKS: {
    type: 'BARRACKS',
    name: 'Barracks',
    sizeX: 3,
    sizeY: 3,
    cost: { wood: 175, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 10000,
    maxHp: 1200,
    populationProvided: 0,
    trainableUnits: ['SPEARMAN'],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    description: 'Infantry barracks. Recruits spearmen, the backbone of a melee army.'
  },
  // MIL-01: the old Barracks trained all three military lines at once, so the
  // unit roster was a single build order rather than a choice. Splitting the
  // roster into one building per line makes each branch a real investment, and
  // the art/price differences below are what make the branches feel distinct.
  STABLE: {
    type: 'STABLE',
    name: 'Stable',
    sizeX: 3,
    sizeY: 3,
    cost: { wood: 200, food: 0, gold: 0, stone: 50 },
    buildTimeMs: 10000,
    maxHp: 1200,
    populationProvided: 0,
    trainableUnits: ['CAVALRY'],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    description: 'Cavalry stable. Breeds and trains mounted warriors for fast raids.'
  },
  ARCHERY_RANGE: {
    type: 'ARCHERY_RANGE',
    name: 'Archery Range',
    sizeX: 3,
    sizeY: 3,
    cost: { wood: 150, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 10000,
    maxHp: 1200,
    populationProvided: 0,
    trainableUnits: ['ARCHER'],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    description: 'Archery range. Trains archers who fight from behind the front line.'
  },
  // Siege workshop: the building half of the catapult branch. It is placeable
  // and upgradable now; `trainableUnits` stays empty until the Catapult unit
  // lands, so it never advertises a roster the server cannot produce.
  SIEGE_WORKSHOP: {
    type: 'SIEGE_WORKSHOP',
    name: 'Siege Workshop',
    sizeX: 3,
    sizeY: 3,
    cost: { wood: 250, food: 0, gold: 50, stone: 100 },
    buildTimeMs: 15000,
    maxHp: 1400,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    requiredTownCenterLevel: 3,
    description:
      'Siege workshop. A fortified yard prepared for siege-engine production.'
  },
  HOUSE: {
    type: 'HOUSE',
    name: 'House',
    sizeX: 2,
    sizeY: 2,
    cost: { wood: 50, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 5000,
    maxHp: 450,
    // ECO-03: the house is the one building whose capacity is a shared constant,
    // so the number the HUD promises and the number the blueprint grants cannot
    // drift apart.
    populationProvided: POPULATION_PER_HOUSE,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    description: 'Provides housing to support up to 5 additional population.'
  },
  FARM: {
    type: 'FARM',
    name: 'Farm',
    sizeX: 3,
    sizeY: 3,
    cost: { wood: 60, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 6000,
    maxHp: 400,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    // ECO-01: a farm is a source, not a drop-off. Villagers harvest it in place,
    // and a villager who empties it re-plants it for the farm's own cost.
    gatheredResource: 'food',
    // ECO-02: sized so one field is a real shift rather than a few seconds of
    // work. At the food gather rate (2.5/s) one villager needs four minutes to
    // strip it, so a single field supports a whole crew of harvesters.
    gatherCapacity: 600,
    description: 'Renewable source of food. Villagers harvest it in place and re-sow it when it runs dry.'
  },
  TOWER: {
    type: 'TOWER',
    name: 'Watch Tower',
    sizeX: 1,
    sizeY: 1,
    cost: { wood: 50, food: 0, gold: 0, stone: 125 },
    buildTimeMs: 12000,
    maxHp: 1020,
    populationProvided: 0,
    trainableUnits: [],
    // SIM-03: 10 damage per 2s shot. Ten seconds to drop an unarmoured
    // villager, which is enough to matter without making a lone tower a wall.
    attackPower: 10,
    attackRange: 8,
    attackCooldownMs: 2000,
    dropOffs: [],
    description: 'Defensive structure that fires arrows at approaching enemy forces.'
  },
  // WALL: a player-painted line of stone segments. Each tile is its own 1x1
  // building, so it blocks movement and can be destroyed one segment at a time.
  // It has no levels and no population; its job is to buy time and shape the
  // fight. The art reuses the citadel wall so a player wall reads as the same
  // masonry as the capital.
  WALL: {
    type: 'WALL',
    name: 'Stone Wall',
    sizeX: 1,
    sizeY: 1,
    cost: { wood: 4, food: 0, gold: 0, stone: 6 },
    buildTimeMs: 2500,
    maxHp: 500,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    description:
      'A stone wall segment. Blocks movement and can be destroyed to open a breach.'
  },
  // ECO: the three drop-off buildings. All three cost the same 100 wood and take
  // the same 6s / 600 HP, so the choice between them is purely positional — where
  // the villager walks, not which building is "better". Only `dropOffs` differs,
  // and it is what tells the economy system which loads each one accepts.
  LUMBER_CAMP: {
    type: 'LUMBER_CAMP',
    name: 'Lumber Camp',
    sizeX: 2,
    sizeY: 2,
    cost: { wood: 100, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 6000,
    maxHp: 600,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: ['wood'],
    requiredTownCenterLevel: 1,
    description: 'Wood drop-off. Villagers haul logs here instead of walking back to the Town Center.'
  },
  MILL: {
    type: 'MILL',
    name: 'Mill',
    sizeX: 2,
    sizeY: 2,
    cost: { wood: 100, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 6000,
    maxHp: 600,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: ['food'],
    requiredTownCenterLevel: 2,
    description: 'Food drop-off. Berries and farm harvests are delivered here.'
  },
  MINING_CAMP: {
    type: 'MINING_CAMP',
    name: 'Mining Camp',
    sizeX: 2,
    sizeY: 2,
    cost: { wood: 100, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 6000,
    maxHp: 600,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    // One camp serves both mine types: a gold mine and a stone mine close
    // enough to share a drop-off is a common map layout, and charging twice for
    // it would just make the player pick the worse of the two spots.
    dropOffs: ['gold', 'stone'],
    requiredTownCenterLevel: 3,
    description: 'Gold and stone drop-off. Serves both mine types from one spot.'
  },
  // Server-created gateway. It has no cost because players never place it, and
  // it is not attackable so a raid cannot strand an empire on the other map.
  PORTAL: {
    type: 'PORTAL',
    name: 'Portal',
    sizeX: 2,
    sizeY: 2,
    cost: { wood: 0, food: 0, gold: 0, stone: 0 },
    buildTimeMs: 0,
    maxHp: 99999,
    populationProvided: 0,
    trainableUnits: [],
    attackPower: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    dropOffs: [],
    attackable: false,
    description: 'Gateway between your kingdom and the shared battlefield.'
  }
};

/**
 * The building that trains `unitType` (phase 26).
 *
 * Derived from the blueprints' `trainableUnits` so the roster still has one
 * source of truth: adding a unit to a trainer automatically gives it that
 * building's level effects. Returns `null` for a type nobody trains.
 */
export function getUnitTrainerBuilding(unitType: string): BuildingType | null {
  for (const type of Object.keys(BUILDING_BLUEPRINTS) as BuildingType[]) {
    if (BUILDING_BLUEPRINTS[type].trainableUnits.includes(unitType as UnitType)) return type;
  }
  return null;
}

/**
 * The drop-off that accepts `resourceType` (phase 26).
 *
 * The Town Center accepts every resource but deliberately has no gather bonus;
 * only the three specialised camps do, which is what makes placing one worth
 * the wood.
 */
export function getGatherBuildingType(resourceType: string): BuildingType | null {
  switch (resourceType) {
    case 'wood':
      return 'LUMBER_CAMP';
    case 'food':
      return 'MILL';
    case 'gold':
    case 'stone':
      return 'MINING_CAMP';
    default:
      return null;
  }
}

export const UNIT_BLUEPRINTS: Record<UnitType, UnitBlueprint> = {
  VILLAGER: {
    type: 'VILLAGER',
    name: 'Villager',
    cost: { wood: 0, food: 50, gold: 0, stone: 0 },
    trainTimeMs: 5000,
    maxHp: 50,
    speed: 2.2, // tiles per second
    attackPower: 3,
    attackRange: 1.2,
    attackCooldownMs: 1500,
    canHarvest: true,
    aggroRadius: 0,
    buildPower: 1,
    carryCapacity: 10,
    description: 'Gathers resources and constructs buildings for your empire.'
  },
  SPEARMAN: {
    type: 'SPEARMAN',
    name: 'Spearman',
    cost: { wood: 25, food: 50, gold: 0, stone: 0 },
    trainTimeMs: 7000,
    maxHp: 90,
    speed: 2.5,
    attackPower: 8,
    attackRange: 1.5,
    attackCooldownMs: 1200,
    canHarvest: false,
    aggroRadius: 6,
    buildPower: 0,
    carryCapacity: 0,
    description: 'Infantry unit equipped with spears, excellent against cavalry.'
  },
  ARCHER: {
    type: 'ARCHER',
    name: 'Archer',
    cost: { wood: 45, food: 0, gold: 40, stone: 0 },
    trainTimeMs: 8000,
    maxHp: 65,
    speed: 2.3,
    attackPower: 7,
    attackRange: 5.0,
    attackCooldownMs: 1400,
    canHarvest: false,
    aggroRadius: 6,
    buildPower: 0,
    carryCapacity: 0,
    description: 'Ranged unit capable of firing arrows from distance.'
  },
  CAVALRY: {
    type: 'CAVALRY',
    name: 'Cavalry',
    cost: { wood: 0, food: 80, gold: 70, stone: 0 },
    trainTimeMs: 10000,
    maxHp: 140,
    speed: 4.0,
    attackPower: 14,
    attackRange: 1.5,
    attackCooldownMs: 1000,
    canHarvest: false,
    aggroRadius: 6,
    buildPower: 0,
    carryCapacity: 0,
    description: 'Fast and powerful mounted warrior suited for hit-and-run tactics.'
  }
};

/**
 * The building that trains `unitType`, or `null` when nothing does (MIL-01).
 *
 * Derived by scanning the blueprints rather than kept in a second table, so a
 * roster change cannot leave a trainer pointer aimed at a building that no
 * longer trains the unit. Scanned per call instead of cached: this runs once per
 * research command, and a module-level cache would add mutable state to a
 * constants file for no measurable gain.
 *
 * Unit research uses it: researching a unit requires the building that trains
 * it, which is what keeps Barracks/Stable/Archery Range from becoming three
 * copies of the same panel.
 */
/**
 * WALL: extra attack range a ranged unit gets while standing on the citadel
 * wall top. Melee (attackRange below `RANGED_MIN_RANGE`) never crosses
 * elevations, so it gets no equivalent.
 */
export const WALL_RANGE_BONUS = 1.5;
export const RANGED_MIN_RANGE = 2;

export function buildingTypeForUnit(unitType: string): BuildingType | null {
  for (const blueprint of Object.values(BUILDING_BLUEPRINTS) as BuildingBlueprint[]) {
    if (blueprint.trainableUnits.includes(unitType as UnitType)) return blueprint.type;
  }
  return null;
}


import { Room, Client, ServerError, ErrorCode, CloseCode } from '@colyseus/core';
import { DatabaseService } from '../services/DatabaseService.js';
import { AuthService } from '../services/AuthService.js';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  INITIAL_POPULATION_CAP,
  MAX_POPULATION_LIMIT,
  MAX_UNIT_LEVEL,
  MAP_GRID_HEIGHT,
  MAP_GRID_WIDTH,
  MAX_TRAVEL_UNITS,
  NetworkMessage,
  RESOURCE_RESPAWN_MS,
  TRAVEL_COOLDOWN_MS,
  TravelPayload,
  TravelReadyPayload,
  PlaceBuildingPayload,
  MoveUnitsPayload,
  TrainUnitPayload,
  AttackTargetPayload,
  AttackMovePayload,
  BuildTargetPayload,
  HarvestResourcePayload,
  StopUnitsPayload,
  SetRallyPointPayload,
  SetStancePayload,
  CancelTrainPayload,
  CancelBuildingPayload,
  CancelBuildingUpgradePayload,
  CancelUnitUpgradePayload,
  UpgradeBuildingPayload,
  UpgradeUnitTypePayload,
  SERVER_TICK_RATE,
  UNIT_BLUEPRINTS,
  UnitType,
  SESSION_ALREADY_ACTIVE,
  SESSION_BUSY,
  SESSION_REPLACED_CLOSE,
  getBuildingLevelStats,
  getBuildingMaxLevel,
  getUnitLevelStats,
  getPlayerUnitLevel,
  isDirtRoadTile
} from '@chien-quoc/shared';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { isWithinBuildRange, syncBuilders } from './construction.js';
import { seedGatheredBuilding } from './gatherables.js';
import { EconomySystem } from './EconomySystem.js';
import { CombatSystem } from './CombatSystem.js';
import { CommandSystem } from './CommandSystem.js';
import { MovementSystem } from './MovementSystem.js';
import { ownerIdOf, RoomAuth } from './identity.js';
import { accountSaves, accountSessions } from './AccountSessions.js';
import { zonePersistence } from './ZonePersistence.js';
import { arrivalPoint, ensurePortalFor, findOwnPortal } from './portals.js';
import { entityIds } from '../services/EntityIdAllocator.js';
import type { TravelUnitSnapshot } from '../services/DatabaseService.js';
import {
  loadPlayerLevels,
  applyBuildingUpgrade,
  applyUnitResearch
} from './upgrades.js';
import { otherZone, roomNameForZone, zoneKindOf } from '@chien-quoc/shared';
import { randomUUID } from 'crypto';

const PLAYER_COLORS = [
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#84cc16'  // Lime
];

/** Clamps a level read from SQLite; persisted rows may predate a cap change. */
function clampStoredLevel(raw: number | null | undefined, maxLevel: number): number {
  const value = raw ?? 1;
  if (!Number.isFinite(value)) return 1;
  return Math.min(maxLevel, Math.max(1, Math.floor(value)));
}

export class WorldRoom extends Room<{ state: WorldState }> {
  /**
   * Persistent map id this room simulates. The base room is generic; the
   * kingdom/battlefield subclasses override it in `onCreate`.
   */
  protected zoneId: string = 'world';
  /** Account that owns this kingdom room; null on the shared battlefield. */
  protected ownerScope: string | null = null;
  /** See `ZonePersistence`; a stale room must never flush over its successor. */
  private persistenceToken = 0;
  private zoneReady = false;
  /** Accounts with a travel transaction in flight; autosave waits for them. */
  private readonly travelingOwners = new Set<string>();
  /** Where an account is travelling to while its leave save runs. */
  private readonly departureZoneByOwner = new Map<string, string>();
  private readonly travelCooldowns = new Map<string, number>();
  /**
   * Depleted resource nodes and when they refill. In-memory only: a restart
   * refills them immediately, which is the same outcome a fresh room has.
   */
  private readonly resourceRespawnAt = new Map<string, number>();
  private lastRespawnScanAt = 0;
  /**
   * Combat rules (damage, cooldowns, target resolution) and their transient
   * maps. Built on first use for the same reason as {@link economySystem}.
   */
  private combatSystem: CombatSystem | null = null;
  /** Built on first use; see {@link combatSystem}. */
  private get combat(): CombatSystem {
    this.combatSystem ??= new CombatSystem(this.state, {
      resumeQueuedWaypoint: (unit) => this.movement.resumeQueuedWaypoint(unit),
      forgetEconomyState: (unitId) => this.economy.forgetUnit(unitId),
      forgetMovementState: (unitId) => this.movement.forgetUnit(unitId),
      updatePlayerPopulation: (ownerId) => this.updatePlayerPopulation(ownerId)
    });
    return this.combatSystem;
  }
  /**
   * Command handlers (one per client message) and the validation they share.
   * Built on first use for the same reason as {@link economySystem}.
   */
  private commandSystem: CommandSystem | null = null;
  /** Built on first use; see {@link commandSystem}. */
  private get commands(): CommandSystem {
    this.commandSystem ??= new CommandSystem(this.state, {
      rejectCommand: (client, message) => this.rejectCommand(client, message),
      setWalkTarget: (unit, x, y) => this.movement.setWalkTarget(unit, x, y),
      advanceQueuedWaypoint: (unit) => this.movement.advanceQueuedWaypoint(unit),
      clearHarvestOrder: (unitId) => this.economy.clearHarvestOrder(unitId),
      forgetBuilding: (buildingId) => this.combat.forgetBuilding(buildingId),
      harvestOrder: (client, payload) => this.economy.handleHarvestOrder(client, payload),
      allocateEntityId: () => entityIds.nextId(),
      updatePlayerPopulation: (ownerId) => this.updatePlayerPopulation(ownerId)
    });
    return this.commandSystem;
  }
  /**
   * Routing, waypoint queues and the blocked-tile cache (SIM-01, CTL-05). Needs
   * no ports: it only mutates the units it is handed. Built on first use for the
   * same reason as {@link economySystem}.
   */
  private movementSystem: MovementSystem | null = null;
  /** Built on first use; see {@link movementSystem}. */
  private get movement(): MovementSystem {
    this.movementSystem ??= new MovementSystem(this.state);
    return this.movementSystem;
  }
  /**
   * Economy rules (gathering, carrying, drop-off) and their transient maps.
   *
   * Built on first use rather than in a field initialiser: `this.state` only
   * exists after `onCreate()` — or after `setState()` in tests — so constructing
   * it early would capture `undefined`.
   */
  private economySystem: EconomySystem | null = null;
  /** Built on first use; see {@link economySystem}. */
  private get economy(): EconomySystem {
    this.economySystem ??= new EconomySystem(this.state, {
      setWalkTarget: (unit, x, y) => this.movement.setWalkTarget(unit, x, y),
      resumeQueuedWaypoint: (unit) => this.movement.resumeQueuedWaypoint(unit),
      rejectCommand: (client, message) => this.rejectCommand(client, message),
      onNodeDepleted: (node) => this.scheduleResourceRespawn(node)
    });
    return this.economySystem;
  }

  private readyPromise: Promise<void> | null = null;
  private worldRestoreError: Error | null = null;

  /**
   * SESS-03: which session drives each account, plus the join currently
   * reserving it. One account owns one empire, so a second session is refused
   * instead of silently sharing it.
   */
  private readonly sessions = accountSessions;
  /**
   * SESS-05: the in-flight leave of each account. A join waits for it before
   * reading state, so a refresh never claims while the old leave is saving and
   * a half-written empire cannot be observed.
   */
  private readonly leaveByUser = new Map<string, Promise<void>>();

  // ---------------------------------------------------------------------------
  // Zone hooks. The base room keeps the pre-split behaviour (`world`, no
  // owner restriction) so the existing unit tests can drive it directly; the
  // kingdom and battlefield subclasses override these.
  // ---------------------------------------------------------------------------

  /** Account allowed to join this room, or null when any account may. */
  protected resolveOwnerScope(_options: any): string | null {
    return null;
  }

  protected resolveZoneId(_options: any): string {
    return 'world';
  }

  /** Whether `ownerId` may join this room at all. */
  protected canJoinOwner(_ownerId: string): boolean {
    return true;
  }

  /** What a fresh empire gets when it joins this map with no entities. */
  protected async spawnZoneContent(ownerId: string): Promise<void> {
    this.spawnInitialBase(ownerId);
  }

  onCreate(options: any) {
    this.ownerScope = this.resolveOwnerScope(options);
    this.zoneId = this.resolveZoneId(options);
    this.persistenceToken = zonePersistence.claim(this.zoneId);

    this.setState(new WorldState());
    this.state.zoneId = this.zoneId;

    // Keep a reference so onJoin can wait until the persisted world is restored.
    // Without this, a client could join while state.buildings is still empty and
    // spawn a duplicate randomly-positioned base.
    this.readyPromise = this.initializeWorldPersistence();

    // Setup network message listeners
    this.onMessage(NetworkMessage.PLACE_BUILDING, (client, message: PlaceBuildingPayload) => {
      this.commands.handlePlaceBuilding(client, message);
    });

    this.onMessage(NetworkMessage.MOVE_UNITS, (client, message: MoveUnitsPayload) => {
      this.commands.handleMoveUnits(client, message);
    });

    this.onMessage(NetworkMessage.TRAIN_UNIT, (client, message: TrainUnitPayload) => {
      this.commands.handleTrainUnit(client, message);
    });

    this.onMessage(NetworkMessage.ATTACK_TARGET, (client, message: AttackTargetPayload) => {
      this.commands.handleAttackTarget(client, message);
    });

    this.onMessage(NetworkMessage.ATTACK_MOVE, (client, message: AttackMovePayload) => {
      this.commands.handleAttackMove(client, message, 'ATTACK_MOVE');
    });

    this.onMessage(NetworkMessage.PATROL, (client, message: AttackMovePayload) => {
      this.commands.handleAttackMove(client, message, 'PATROL');
    });

    this.onMessage(NetworkMessage.BUILD_TARGET, (client, message: BuildTargetPayload) => {
      this.commands.handleBuildTarget(client, message);
    });

    this.onMessage(NetworkMessage.HARVEST_RESOURCE, (client, message: HarvestResourcePayload) => {
      this.commands.handleHarvestResource(client, message);
    });

    this.onMessage(NetworkMessage.STOP_UNITS, (client, message: StopUnitsPayload) => {
      this.commands.handleStopUnits(client, message);
    });

    this.onMessage(NetworkMessage.SET_RALLY_POINT, (client, message: SetRallyPointPayload) => {
      this.commands.handleSetRallyPoint(client, message);
    });

    this.onMessage(NetworkMessage.SET_STANCE, (client, message: SetStancePayload) => {
      this.commands.handleSetStance(client, message);
    });

    this.onMessage(NetworkMessage.CANCEL_TRAIN, (client, message: CancelTrainPayload) => {
      this.commands.handleCancelTrain(client, message);
    });

    this.onMessage(NetworkMessage.CANCEL_BUILDING, (client, message: CancelBuildingPayload) => {
      this.commands.handleCancelBuilding(client, message);
    });

    this.onMessage(NetworkMessage.UPGRADE_BUILDING, (client, message: UpgradeBuildingPayload) => {
      this.commands.handleUpgradeBuilding(client, message);
    });

    this.onMessage(
      NetworkMessage.CANCEL_BUILDING_UPGRADE,
      (client, message: CancelBuildingUpgradePayload) => {
        this.commands.handleCancelBuildingUpgrade(client, message);
      }
    );

    this.onMessage(NetworkMessage.UPGRADE_UNIT_TYPE, (client, message: UpgradeUnitTypePayload) => {
      this.commands.handleUpgradeUnitType(client, message);
    });

    this.onMessage(
      NetworkMessage.CANCEL_UNIT_UPGRADE,
      (client, message: CancelUnitUpgradePayload) => {
        this.commands.handleCancelUnitUpgrade(client, message);
      }
    );

    this.onMessage(NetworkMessage.TRAVEL, (client, message: TravelPayload) => {
      void this.handleTravel(client, message);
    });

    // Run authoritative tick loop
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / SERVER_TICK_RATE);

    // Auto-save this map's slice to SQLite every 30 seconds. The zone queue
    // drops an autosave that arrives while another write is still in flight.
    this.clock.setInterval(() => {
      void this.autosave();
    }, 30000);

    console.log('[WorldRoom] Room created with SQLite persistence.');
  }

  private async initializeWorldPersistence() {
    try {
      // 1. Load this map's resource nodes from SQLite.
      const savedResources = await DatabaseService.loadResources(this.zoneId);

      if (savedResources.length > 0) {
        for (const res of savedResources) {
          const node = new ResourceNodeState();
          node.id = res.id;
          node.type = res.type;
          node.resourceType = res.resourceType;
          node.gridX = res.gridX;
          node.gridY = res.gridY;
          // A depleted node is kept as an empty slot so the client can hide it
          // and the respawn scan can refill it. A restart refills immediately.
          node.remainingAmount = res.remainingAmount > 0 ? res.remainingAmount : res.maxAmount;
          node.maxAmount = res.maxAmount;
          this.state.resourceNodes.set(res.id, node);
        }
        console.log(
          `📦 [WorldRoom] Restored ${savedResources.length} resource nodes for ${this.zoneId}.`
        );
      } else {
        console.log(`🗺️ [WorldRoom] Generating fresh resource clusters for ${this.zoneId}...`);
        await DatabaseService.clearAllResources(this.zoneId);
        this.generateWorldResources();
        const resArray: ResourceNodeState[] = [];
        this.state.resourceNodes.forEach((node: ResourceNodeState) => resArray.push(node));
        await DatabaseService.saveAllResources(resArray, this.zoneId);
        console.log(`✨ [WorldRoom] Saved ${resArray.length} fresh resource clusters.`);
      }

      // 2. Restore this map's empires. A kingdom loads only its owner; the
      // battlefield loads every participant, including offline ones whose
      // forward base must stay attackable.
      const savedPlayers = await DatabaseService.loadZoneEntities(
        this.zoneId,
        this.ownerScope ?? undefined
      );
      for (const p of savedPlayers) {
        for (const b of p.buildings) {
          const building = new BuildingState();
          building.id = b.id;
          building.ownerId = p.id;
          building.type = b.type;
          building.gridX = b.gridX;
          building.gridY = b.gridY;
          building.sizeX = b.sizeX;
          building.sizeY = b.sizeY;
          building.level = clampStoredLevel(b.level, getBuildingMaxLevel(b.type as BuildingType));
          building.upgradeProgressMs = b.upgradeProgressMs ?? 0;
          building.upgradeTimeMs = b.upgradeTimeMs ?? 0;
          const levelStats = getBuildingLevelStats(b.type as BuildingType, building.level);
          building.maxHp = levelStats.maxHp;
          building.hp = Math.min(b.hp, levelStats.maxHp);
          building.isConstructed = b.isConstructed;
          building.constructionProgress = b.constructionProgress;

          // ECO-01: restored as a finished building, so a field comes back full
          // instead of permanently barren (see `seedGatheredBuilding`).
          if (b.isConstructed) seedGatheredBuilding(building);

          this.state.buildings.set(b.id, building);
        }

        for (const u of p.units) {
          const unit = new UnitState();
          unit.id = u.id;
          unit.ownerId = p.id;
          unit.type = u.type;
          unit.x = u.x;
          unit.y = u.y;
          unit.targetX = u.x;
          unit.targetY = u.y;
          unit.speed = u.speed;
          unit.level = clampStoredLevel(u.level, MAX_UNIT_LEVEL);
          const levelStats = getUnitLevelStats(u.type as UnitType, unit.level);
          unit.maxHp = levelStats.maxHp;
          unit.hp = Math.min(u.hp, levelStats.maxHp);
          unit.actionState = u.actionState;
          this.state.units.set(u.id, unit);
        }
      }
      if (savedPlayers.length > 0) {
        console.log(`🏰 [WorldRoom] Restored bases for ${savedPlayers.length} empires from database.`);
      }

      // Keep generated entity ids unique across restarts (avoid overwriting persisted rows)
      this.state.resourceNodes.forEach((n) => this.bumpEntityId(n.id));
      this.state.buildings.forEach((b) => this.bumpEntityId(b.id));
      this.state.units.forEach((u) => this.bumpEntityId(u.id));

      this.zoneReady = true;
      console.log(`✅ [WorldRoom] Zone ${this.zoneId} is ready.`);
    } catch (err) {
      // Record instead of rethrowing: a rejected readyPromise would surface as an
      // unhandled rejection. onJoin aborts the join when this is set.
      console.error('❌ [WorldRoom] Failed to initialize persistence:', err);
      this.worldRestoreError = err instanceof Error ? err : new Error(String(err));
    }
  }

  /** Advances the process-wide id sequence past a persisted id. */
  private bumpEntityId(id: string) {
    entityIds.observe(id);
  }

  /**
   * Every building and unit owned by `ownerId`.
   *
   * Ownership is a single id now, so this is a plain filter — it is used to
   * count an empire on join and to build the snapshot saved on leave.
   */
  private ownedBy(ownerId: string): { buildings: BuildingState[]; units: UnitState[] } {
    const buildings: BuildingState[] = [];
    this.state.buildings.forEach((b: BuildingState) => {
      if (b.ownerId === ownerId) buildings.push(b);
    });

    const units: UnitState[] = [];
    this.state.units.forEach((u: UnitState) => {
      if (u.ownerId === ownerId) units.push(u);
    });

    return { buildings, units };
  }

  /**
   * Deterministic 32-bit hash so the same player name always yields the same spawn area.
   */
  private hashPlayerName(name: string): number {
    let hash = 2166136261;
    for (let i = 0; i < name.length; i++) {
      hash ^= name.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Checks whether a footprint fits inside the playable area and does not overlap
   * dirt roads or existing buildings. Resource nodes are handled separately so a
   * returning player can still claim their deterministic spot.
   */
  private isFootprintFree(gx: number, gy: number, sizeX: number, sizeY: number): boolean {
    const margin = 6;
    if (gx < margin || gy < margin) return false;
    if (gx + sizeX > MAP_GRID_WIDTH - margin || gy + sizeY > MAP_GRID_HEIGHT - margin) return false;

    for (let x = gx; x < gx + sizeX; x++) {
      for (let y = gy; y < gy + sizeY; y++) {
        if (isDirtRoadTile(x, y)) return false;
      }
    }

    let clear = true;
    this.state.buildings.forEach((b: BuildingState) => {
      if (!clear) return;
      const overlapX = gx < b.gridX + b.sizeX && gx + sizeX > b.gridX;
      const overlapY = gy < b.gridY + b.sizeY && gy + sizeY > b.gridY;
      if (overlapX && overlapY) clear = false;
    });

    return clear;
  }

  /**
   * Counts resource nodes sitting inside the footprint (they would be buried
   * underneath the Town Center).
   */
  private countResourcesInFootprint(gx: number, gy: number, sizeX: number, sizeY: number): number {
    let count = 0;
    this.state.resourceNodes.forEach((res: ResourceNodeState) => {
      if (
        res.gridX >= gx &&
        res.gridX < gx + sizeX &&
        res.gridY >= gy &&
        res.gridY < gy + sizeY
      ) {
        count++;
      }
    });
    return count;
  }

  private isSpawnAreaClear(gx: number, gy: number, sizeX: number, sizeY: number): boolean {
    return this.isFootprintFree(gx, gy, sizeX, sizeY) && this.countResourcesInFootprint(gx, gy, sizeX, sizeY) === 0;
  }

  /**
   * Prevents stacking duplicate resource nodes when a base is respawned on the
   * exact same deterministic spot.
   */
  private hasResourceAt(gx: number, gy: number): boolean {
    let found = false;
    this.state.resourceNodes.forEach((res: ResourceNodeState) => {
      if (!found && res.gridX === gx && res.gridY === gy) {
        found = true;
      }
    });
    return found;
  }

  /**
   * Deterministic fallback spawn: spiral outward from the map center until a clear
   * footprint is found. Never random, so retries are stable.
   */
  private findSpawnNearCenter(sizeX: number, sizeY: number): { x: number; y: number } {
    const centerX = Math.floor(MAP_GRID_WIDTH / 2);
    const centerY = Math.floor(MAP_GRID_HEIGHT / 2);

    for (let radius = 8; radius < Math.max(MAP_GRID_WIDTH, MAP_GRID_HEIGHT); radius += 4) {
      for (let i = 0; i < radius * 8; i++) {
        const angle = (i / (radius * 8)) * Math.PI * 2;
        const gx = Math.round(centerX + Math.cos(angle) * radius) - Math.floor(sizeX / 2);
        const gy = Math.round(centerY + Math.sin(angle) * radius) - Math.floor(sizeY / 2);

        if (this.isSpawnAreaClear(gx, gy, sizeX, sizeY)) {
          return { x: gx, y: gy };
        }
      }
    }

    // Ultimate fallback: keep the previous behaviour so the player is never base-less
    return {
      x: Math.floor(MAP_GRID_WIDTH / 2) - Math.floor(sizeX / 2),
      y: Math.floor(MAP_GRID_HEIGHT / 2) - Math.floor(sizeY / 2)
    };
  }

  private generateWorldResources() {
    // Generate expansive natural AoE-style resource clusters for 220x220 Large Map
    const occupiedTiles = new Set<string>();

    const spawnNode = (type: string, res: 'wood' | 'food' | 'gold' | 'stone', gx: number, gy: number, amount: number) => {
      if (gx < 5 || gx >= MAP_GRID_WIDTH - 5 || gy < 5 || gy >= MAP_GRID_HEIGHT - 5) return;
      const key = `${gx},${gy}`;
      if (occupiedTiles.has(key)) return;

      occupiedTiles.add(key);
      const id = `res_${entityIds.nextId()}`;
      const node = new ResourceNodeState();
      node.id = id;
      node.type = type;
      node.resourceType = res;
      node.gridX = gx;
      node.gridY = gy;
      node.remainingAmount = amount;
      node.maxAmount = amount;
      this.state.resourceNodes.set(id, node);
    };

    // 1. Forest Groves (85 dense forest clusters, 12-16 trees each)
    for (let c = 0; c < 85; c++) {
      const cx = Math.floor(8 + Math.random() * (MAP_GRID_WIDTH - 16));
      const cy = Math.floor(8 + Math.random() * (MAP_GRID_HEIGHT - 16));
      const treeCount = 12 + Math.floor(Math.random() * 5);
      for (let t = 0; t < treeCount; t++) {
        const dx = Math.floor(Math.random() * 5) - 2;
        const dy = Math.floor(Math.random() * 5) - 2;
        spawnNode('TREE', 'wood', cx + dx, cy + dy, 200);
      }
    }

    // 2. Gold Veins (40 clusters, 3-5 gold nodes each)
    for (let c = 0; c < 40; c++) {
      const cx = Math.floor(10 + Math.random() * (MAP_GRID_WIDTH - 20));
      const cy = Math.floor(10 + Math.random() * (MAP_GRID_HEIGHT - 20));
      const nodeCount = 3 + Math.floor(Math.random() * 3);
      for (let n = 0; n < nodeCount; n++) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        spawnNode('GOLD_MINE', 'gold', cx + dx, cy + dy, 800);
      }
    }

    // 3. Stone Quarries (32 clusters, 3-4 stone nodes each)
    for (let c = 0; c < 32; c++) {
      const cx = Math.floor(10 + Math.random() * (MAP_GRID_WIDTH - 20));
      const cy = Math.floor(10 + Math.random() * (MAP_GRID_HEIGHT - 20));
      const nodeCount = 3 + Math.floor(Math.random() * 2);
      for (let n = 0; n < nodeCount; n++) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        spawnNode('STONE_MINE', 'stone', cx + dx, cy + dy, 600);
      }
    }

    // 4. Berry Groves (40 patches, 4-6 bushes each)
    for (let c = 0; c < 40; c++) {
      const cx = Math.floor(10 + Math.random() * (MAP_GRID_WIDTH - 20));
      const cy = Math.floor(10 + Math.random() * (MAP_GRID_HEIGHT - 20));
      const bushCount = 4 + Math.floor(Math.random() * 3);
      for (let b = 0; b < bushCount; b++) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        spawnNode('BERRY_BUSH', 'food', cx + dx, cy + dy, 150);
      }
    }
  }

  /**
   * Rejects anonymous connections before a seat is reserved.
   *
   * This must be `static`: `matchMaker` only calls the static hook during
   * matchmaking (see `callOnAuth` in `@colyseus/core`). An instance method is
   * skipped there, which would let an unauthenticated caller reserve seats via
   * `POST /matchmake/joinOrCreate/world_room`. The returned object becomes
   * `client.auth`, so `onJoin` can trust the identity it receives.
   *
   * @param token Bearer token forwarded from the matchmaking request headers.
   */
  static async onAuth(token: string | undefined): Promise<RoomAuth> {
    const payload = AuthService.verifyToken(token);
    if (!payload) {
      // AUTH_FAILED (525) is the canonical matchmaking code; the client checks
      // the code, not the message, to decide whether to clear the stored token.
      throw new ServerError(ErrorCode.AUTH_FAILED, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }

    // The signature only proves we issued the token; the account it names may be
    // gone (database reset, deleted account). Joining as a deleted id would spawn
    // a ghost empire that can never be saved, so re-read the account and take the
    // identity from the database rather than from the claims.
    const user = await AuthService.findById(payload.id);
    if (!user) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName
    };
  }

  async onJoin(client: Client, options: any) {
    // `onAuth` runs before every join and rejects anything without a verified
    // token, so the account id is the only ownership key. There is deliberately
    // no fallback to `options.playerName`: a client-supplied name would let a
    // player join as somebody else's empire.
    const authUser = client.auth as Partial<RoomAuth> | undefined;
    if (!authUser?.userId || !authUser.displayName) {
      throw new Error('Cannot join without an authenticated account.');
    }
    const ownerId = authUser.userId;
    const playerName = authUser.displayName;

    // A kingdom room is private. `filterBy` and `onAuth` already reject a
    // mismatched `ownerId`, but the room itself is the last line of defence: a
    // mis-registered room must never let a stranger read the owner's empire.
    if (!this.canJoinOwner(ownerId)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'Bạn không thể vào vương quốc này.');
    }

    // MAPS: a travel hand-off has already committed the authoritative account
    // row in `commitTravel`, and the old room only flushes entities (its own
    // zone) from here on. Waiting for that leave here was adding seconds to the
    // switch, so only a normal refresh waits for a half-written empire.
    const isHandoff = this.sessions.hasHandoff(ownerId, this.zoneId);
    if (!isHandoff) {
      // SESS-05: a refresh closes the old socket before the new page joins, and
      // the in-flight leave is what saves the empire. Wait for it so this join
      // never reads a half-written account.
      await this.leaveByUser.get(ownerId)?.catch(() => undefined);
      await accountSaves.awaitPending(ownerId);
    }

    const takeover = (options as { force?: unknown } | undefined)?.force === true;

    // SESS-03/D1: the account keeps its first live session; a second tab is told
    // so instead of silently sharing the empire.
    const claim = this.sessions.claim(ownerId, client.sessionId, {
      takeover,
      zone: this.zoneId,
      isAlive: (sessionId) => this.clients.get(sessionId) !== undefined
    });
    if (claim === 'occupied') {
      const live = this.sessions.activeSession(ownerId);
      console.warn(
        `[WorldRoom] Rejected session ${client.sessionId} for ${playerName}: account is held by session ${live}.`
      );
      throw new ServerError(SESSION_ALREADY_ACTIVE, 'Tài khoản đang được đăng nhập ở nơi khác.');
    }
    if (claim === 'busy') {
      console.warn(
        `[WorldRoom] Rejected session ${client.sessionId} for ${playerName}: another join is in flight.`
      );
      throw new ServerError(SESSION_BUSY, 'Phiên đăng nhập khác đang được xử lý, vui lòng thử lại.');
    }

    try {
      // Wait for the world snapshot to be fully restored before touching state.
      // Otherwise state.buildings is empty and we would spawn a duplicate base.
      if (this.readyPromise) {
        await this.readyPromise;
      }
      if (this.worldRestoreError) {
        // Abort instead of falling through to "no empire found" and spawning a
        // duplicate starter base on top of the (still persisted) saved empire.
        throw new ServerError(
          ErrorCode.APPLICATION_ERROR,
          `World restore failed: ${this.worldRestoreError.message}`
        );
      }

      const live = this.state.players.get(ownerId);
      if (live) {
        // D3: a session already owns this account (takeover or a refresh that
        // beat the old socket's close event). In-memory state is newer than the
        // last autosave, so it is the authority; re-reading the DB here rolled
        // resources back.
        live.isOnline = true;
        live.name = playerName;
        await this.refreshForeignBaseline(live);
        await this.materializeTravel(ownerId);
        this.updatePlayerPopulation(ownerId);
        console.log(`🏰 [WorldRoom] Session ${client.sessionId} resumed the live empire of ${playerName}.`);
      } else {
        // Check if this account already has a saved profile in the database
        const savedProfile = await DatabaseService.loadPlayerProfile(ownerId);
        // Entities restored on boot are already owned by `ownerId`, so a rejoin
        // finds its empire in memory and must not spawn a second base next to it.
        const owned = this.ownedBy(ownerId);

        const player = new PlayerState();
        player.id = ownerId;
        player.name = playerName;

        if (savedProfile) {
          player.color = savedProfile.color;
          player.wood = savedProfile.wood;
          player.food = savedProfile.food;
          player.gold = savedProfile.gold;
          player.stone = savedProfile.stone;
          player.population = savedProfile.population;
          player.populationCap = savedProfile.populationCap;
          loadPlayerLevels(player, savedProfile.unitLevels);
          player.researchUnitType = savedProfile.researchUnitType ?? '';
          player.researchProgressMs = savedProfile.researchProgressMs ?? 0;
          player.researchTimeMs = savedProfile.researchTimeMs ?? 0;
        } else {
          // A kingdom room only ever holds one player, so `players.size` would
          // always pick the same colour. Hash the stable owner id instead.
          player.color = PLAYER_COLORS[this.hashPlayerName(ownerId) % PLAYER_COLORS.length];
        }
        player.isOnline = true;

        // One entry per account: this branch only runs when the previous
        // session's leave already dropped the old entry, never for a second tab.
        this.state.players.set(ownerId, player);

        // MAPS: the other map is not simulated here, so its unit count and
        // building capacity are loaded from SQLite and added to this room's.
        await this.refreshForeignBaseline(player);

        if (owned.buildings.length === 0 && owned.units.length === 0) {
          if (savedProfile) {
            console.log(`[WorldRoom] Player ${playerName} has no remaining units/buildings. Spawning starter base.`);
          }
          await this.spawnZoneContent(ownerId);
        }

        // Transferred units land next to the destination portal, which is
        // created on demand for a player who has never been on this map.
        await this.materializeTravel(ownerId);

        this.updatePlayerPopulation(ownerId);

        if (!savedProfile) {
          console.log(`⚔️ [WorldRoom] New Emperor ${playerName} (${ownerId}) joined ${this.zoneId}.`);
          // Persist new empire immediately to DB
          const newEmpire = this.ownedBy(ownerId);
          await DatabaseService.savePlayerEmpire(
            player,
            newEmpire.buildings,
            newEmpire.units,
            this.zoneId
          );
        } else {
          console.log(`🏰 [WorldRoom] Welcome back Emperor ${playerName}! Empire restored from SQLite.`);
        }
      }

      // SESS-03/D2: hand the account to this session first, then close the
      // superseded socket. The old onLeave therefore sees `isActive === false`
      // and never saves its stale snapshot over the live empire. The close
      // callback is stored process-wide, so it also reaches a session sitting
      // in the other map's room.
      this.sessions.activate(
        ownerId,
        client.sessionId,
        this.zoneId,
        () => {
          this.clients
            .get(client.sessionId)
            ?.leave(SESSION_REPLACED_CLOSE, 'Session replaced by a newer login');
        },
        () => this.clients.get(client.sessionId) !== undefined
      );
    } catch (err) {
      // A half-joined client must not hold a reservation, and must not stay in
      // the room as a player-less ghost: release, then let Colyseus tear it down.
      this.sessions.release(ownerId, client.sessionId);
      console.error(`❌ [WorldRoom] Error joining player ${playerName}:`, err);
      throw err;
    }
  }

  private spawnInitialBase(ownerId: string) {
    const player = this.state.players.get(ownerId);
    if (!player) return;

    const tcBlueprint = BUILDING_BLUEPRINTS.TOWN_CENTER;

    // Deterministic spawn: same player name always resolves to the same area,
    // so re-joining never shuffles the empire around the map.
    const baseHash = this.hashPlayerName(player.name);
    const candidateCount = 512;
    let spawnX = -1;
    let spawnY = -1;

    for (let attempt = 0; attempt < candidateCount; attempt++) {
      // Golden-ratio stride keeps consecutive players far apart
      const seedX = (baseHash + Math.imul(attempt, 0x9e3779b1)) >>> 0;
      const seedY = ((baseHash >>> 16) + Math.imul(attempt, 0x85ebca6b)) >>> 0;

      const usableX = MAP_GRID_WIDTH - 40;
      const usableY = MAP_GRID_HEIGHT - 40;
      const candidateX = 20 + (seedX % usableX);
      const candidateY = 20 + (seedY % usableY);

      if (this.isSpawnAreaClear(candidateX, candidateY, tcBlueprint.sizeX, tcBlueprint.sizeY)) {
        spawnX = candidateX;
        spawnY = candidateY;
        break;
      }
    }

    // Fallback: spiral scan from map center if every hashed candidate was blocked
    if (spawnX < 0) {
      const centered = this.findSpawnNearCenter(tcBlueprint.sizeX, tcBlueprint.sizeY);
      spawnX = centered.x;
      spawnY = centered.y;
    }

    // Create Town Center
    const tcId = `b_${entityIds.nextId()}`;
    const townCenter = new BuildingState();
    townCenter.id = tcId;
    townCenter.ownerId = ownerId;
    townCenter.type = 'TOWN_CENTER';
    townCenter.gridX = spawnX;
    townCenter.gridY = spawnY;
    townCenter.sizeX = tcBlueprint.sizeX;
    townCenter.sizeY = tcBlueprint.sizeY;
    townCenter.hp = tcBlueprint.maxHp;
    townCenter.maxHp = getBuildingLevelStats('TOWN_CENTER', 1).maxHp;
    townCenter.level = 1;
    townCenter.isConstructed = true;
    townCenter.constructionProgress = 100;

    this.state.buildings.set(tcId, townCenter);

    // Spawn starter trees near Town Center (AoE starter woodline)
    const starterTreeOffsets = [
      { dx: -2, dy: -1 },
      { dx: -2, dy: 0 },
      { dx: -1, dy: -2 },
      { dx: 0, dy: -2 }
    ];
    starterTreeOffsets.forEach((off) => {
      const gridX = spawnX + off.dx;
      const gridY = spawnY + off.dy;
      if (this.hasResourceAt(gridX, gridY)) return;

      const id = `res_${entityIds.nextId()}`;
      const node = new ResourceNodeState();
      node.id = id;
      node.type = 'TREE';
      node.resourceType = 'wood';
      node.gridX = gridX;
      node.gridY = gridY;
      node.remainingAmount = 200;
      node.maxAmount = 200;
      this.state.resourceNodes.set(id, node);
    });

    // Spawn starter berry bushes near Town Center (AoE starter forage food)
    const starterBerryOffsets = [
      { dx: 5, dy: 1 },
      { dx: 6, dy: 1 },
      { dx: 5, dy: 2 }
    ];
    starterBerryOffsets.forEach((off) => {
      const gridX = spawnX + off.dx;
      const gridY = spawnY + off.dy;
      if (this.hasResourceAt(gridX, gridY)) return;

      const id = `res_${entityIds.nextId()}`;
      const node = new ResourceNodeState();
      node.id = id;
      node.type = 'BERRY_BUSH';
      node.resourceType = 'food';
      node.gridX = gridX;
      node.gridY = gridY;
      node.remainingAmount = 150;
      node.maxAmount = 150;
      this.state.resourceNodes.set(id, node);
    });

    // Spawn 3 starter villagers outside 4x4 Town Center. A returning player
    // whose empire was wiped keeps the villager research they already paid for.
    const villagerLevel = getPlayerUnitLevel(player.unitLevels, 'VILLAGER');
    const villagerStats = getUnitLevelStats('VILLAGER', villagerLevel);
    const villagerOffsets = [
      { dx: 4, dy: 1 },
      { dx: 1, dy: 4 },
      { dx: 4, dy: 2 }
    ];

    villagerOffsets.forEach((off, idx) => {
      const vId = `u_${entityIds.nextId()}`;
      const villager = new UnitState();
      villager.id = vId;
      villager.ownerId = ownerId;
      villager.type = 'VILLAGER';
      villager.x = spawnX + off.dx;
      villager.y = spawnY + off.dy;
      villager.targetX = villager.x;
      villager.targetY = villager.y;
      villager.speed = UNIT_BLUEPRINTS.VILLAGER.speed;
      villager.level = villagerLevel;
      villager.hp = villagerStats.maxHp;
      villager.maxHp = villagerStats.maxHp;
      villager.actionState = 'IDLE';

      this.state.units.set(vId, villager);
    });

    // Every kingdom needs its exit. The battlefield portal is created on join
    // by `materializeTravel`; `ensurePortalFor` is idempotent for both.
    ensurePortalFor(this.state, ownerId);

    this.updatePlayerPopulation(ownerId);
  }

  /**
   * Loads the population/capacity this account holds on the other map.
   *
   * Only one map is simulated at a time, so this baseline is the only way the
   * shared population cap stays meaningful. It is refreshed on join and before
   * each autosave; a forward base destroyed while its owner is home therefore
   * reflects within one autosave interval.
   */
  private async refreshForeignBaseline(player: PlayerState): Promise<void> {
    try {
      const baseline = await DatabaseService.loadForeignBaseline(player.id, this.zoneId);
      player.populationElsewhere = baseline.unitCount;

      let foreignCap = 0;
      for (const building of baseline.buildings) {
        foreignCap += getBuildingLevelStats(
          building.type as BuildingType,
          building.level
        ).populationProvided;
      }
      player.populationCapElsewhere = foreignCap;
      this.updatePlayerPopulation(player.id);
    } catch (err) {
      console.error(`❌ [WorldRoom] Failed to load the other map's population for ${player.id}:`, err);
    }
  }

  /**
   * Moves any units waiting in `travel_transfers` for this account onto this
   * map. The destination portal is created first so arrivals have a fixed
   * anchor even when the account has never visited this map.
   */
  private async materializeTravel(ownerId: string): Promise<void> {
    const portal = ensurePortalFor(this.state, ownerId);
    if (!portal) return;

    const arrived = await DatabaseService.consumeTravelTransfers(
      ownerId,
      this.zoneId,
      (_unit, index) => arrivalPoint(portal, index)
    );
    if (arrived.length === 0) return;

    arrived.forEach((snapshot, index) => {
      this.addArrivedUnit(ownerId, snapshot, portal, index);
    });

    this.updatePlayerPopulation(ownerId);
    console.log(
      `🚪 [WorldRoom] ${arrived.length} unit(s) arrived in ${this.zoneId} for ${ownerId}.`
    );
  }

  private addArrivedUnit(
    ownerId: string,
    snapshot: TravelUnitSnapshot,
    portal: BuildingState,
    index: number
  ): void {
    const position = arrivalPoint(portal, index);
    const unit = new UnitState();
    unit.id = snapshot.id;
    unit.ownerId = ownerId;
    unit.type = snapshot.type;
    unit.x = position.x;
    unit.y = position.y;
    unit.targetX = position.x;
    unit.targetY = position.y;
    unit.speed = snapshot.speed;
    unit.level = snapshot.level;
    unit.hp = snapshot.hp;
    unit.maxHp = snapshot.maxHp;
    unit.actionState = 'IDLE';

    entityIds.observe(snapshot.id);
    this.state.units.set(unit.id, unit);
  }

  /**
   * The 30s save. It first refreshes the other-map baseline so a death in the
   * shared battlefield is reflected in the kingdom's population view, then
   * writes this zone. `skipIfBusy` keeps a slow save from queueing behind itself.
   */
  private async autosave(): Promise<void> {
    // A travel transaction deletes unit rows from this zone; saving a snapshot
    // taken around that moment could re-create them from stale state.
    if (!this.zoneReady || this.travelingOwners.size > 0) return;

    // Snapshot the players: the loop awaits SQLite, and a leave/join in the
    // meantime mutates the MapSchema being iterated.
    for (const player of Array.from(this.state.players.values())) {
      await this.refreshForeignBaseline(player);
    }

    await DatabaseService.saveFullWorldState(this.state, this.zoneId, { skipIfBusy: true });
  }

  /**
   * Moves the selected units through the player's portal.
   *
   * The order of operations is the whole protocol: validate everything, commit
   * the transfer to SQLite (unit rows leave this zone and a transfer row holds
   * their snapshot), only then drop them from memory, then acknowledge. The
   * client leaves the room after the ack, so a crash at any point either moves
   * nothing or leaves the units waiting safely in `travel_transfers`.
   */
  private async handleTravel(client: Client, payload: TravelPayload): Promise<void> {
    const ownerId = ownerIdOf(client);
    const player = this.state.players.get(ownerId);
    if (!player || !this.zoneReady) return;

    const portal = payload?.portalId ? this.state.buildings.get(payload.portalId) : undefined;
    if (!portal || portal.type !== 'PORTAL' || portal.ownerId !== ownerId) {
      this.rejectCommand(client, 'Cổng dịch chuyển không hợp lệ.');
      return;
    }

    if (this.travelingOwners.has(ownerId)) {
      this.rejectCommand(client, 'Bạn đang chuyển bản đồ.');
      return;
    }
    if (Date.now() < (this.travelCooldowns.get(ownerId) ?? 0)) {
      this.rejectCommand(client, 'Vui lòng đợi một chút rồi thử lại.');
      return;
    }

    const requested = Array.isArray(payload.unitIds) ? [...new Set(payload.unitIds)] : [];
    if (requested.length > MAX_TRAVEL_UNITS) {
      this.rejectCommand(client, 'Quá nhiều đơn vị trong một lần chuyển.');
      return;
    }

    // Foreign or stale ids are dropped silently, the same way every other group
    // order treats them; the player still travels with whoever is left.
    const units: UnitState[] = [];
    for (const unitId of requested) {
      const unit = this.state.units.get(unitId);
      if (!unit || unit.ownerId !== ownerId || unit.hp <= 0) continue;
      units.push(unit);
    }

    // A previous transfer that has not been consumed yet is not a reason to
    // refuse: the destination consumes every pending transfer for this account
    // when it joins, so travelling again simply carries the new selection too.
    // Rejecting here would trap a player whose destination join failed, because
    // a reload returns them to the source map with no way to reach the other.
    const toZone = otherZone(this.zoneId, ownerId);
    const transferId = randomUUID();
    const snapshots: TravelUnitSnapshot[] = units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      level: unit.level,
      hp: unit.hp,
      maxHp: unit.maxHp,
      speed: unit.speed
    }));

    this.travelingOwners.add(ownerId);
    try {
      await DatabaseService.commitTravel({
        player,
        ownerId,
        fromZone: this.zoneId,
        toZone,
        transferId,
        sourceSessionId: client.sessionId,
        units: snapshots
      });
    } catch (err) {
      console.error(`❌ [WorldRoom] Travel commit failed for ${ownerId}:`, err);
      this.rejectCommand(client, 'Không thể chuyển bản đồ. Vui lòng thử lại.');
      return;
    } finally {
      this.travelingOwners.delete(ownerId);
    }

    // The transaction is durable; drop the units from memory so the upcoming
    // leave/autosave cannot put them back into this zone.
    for (const unit of units) {
      this.state.units.delete(unit.id);
      this.combat.forgetUnit(unit.id);
      this.economy.forgetUnit(unit.id);
      this.movement.forgetUnit(unit.id);
    }

    this.travelCooldowns.set(ownerId, Date.now() + TRAVEL_COOLDOWN_MS);
    this.departureZoneByOwner.set(ownerId, toZone);
    this.updatePlayerPopulation(ownerId);

    accountSessions.beginHandoff(ownerId, toZone);

    const ready: TravelReadyPayload = {
      transferId,
      destination: zoneKindOf(toZone),
      roomName: roomNameForZone(toZone)
    };
    client.send(NetworkMessage.TRAVEL_READY, ready);
  }

  /**
   * Keeps a villager's `BUILDING` order in sync with the site each tick.
   *
   * Walking to the ring is handled by the movement pass; this only checks for a
   * site that is gone or finished and, once the villager is close enough, signs it
   * up to the crew.
   */
  private processUnitBuilding(unit: UnitState) {
    const building = this.state.buildings.get(unit.targetEntityId);

    // Cancelled, destroyed or finished: there is nothing left to build, so fall
    // back to a queued waypoint (the site may have been a detour) or go idle.
    if (!building || building.isConstructed || building.ownerId !== unit.ownerId) {
      this.movement.resumeQueuedWaypoint(unit);
      return;
    }

    if (!isWithinBuildRange(unit, building)) return;

    if (!building.builderUnitIds.includes(unit.id)) {
      building.builderUnitIds.push(unit.id);
    }
  }

  /** Notify a client that a command was refused, so the UI can explain why. */
  rejectCommand(client: Client, message: string) {
    client.send(NetworkMessage.ERROR_NOTIFICATION, { message });
  }

  private scheduleResourceRespawn(node: ResourceNodeState): void {
    if (this.resourceRespawnAt.has(node.id)) return;
    this.resourceRespawnAt.set(node.id, Date.now() + RESOURCE_RESPAWN_MS);
  }

  /** Refills depleted nodes whose respawn delay has elapsed. */
  private scanResourceRespawns(now: number): void {
    if (now - this.lastRespawnScanAt < 5000) return;
    this.lastRespawnScanAt = now;

    for (const [nodeId, respawnAt] of this.resourceRespawnAt) {
      if (now < respawnAt) continue;

      const node = this.state.resourceNodes.get(nodeId);
      if (!node) {
        this.resourceRespawnAt.delete(nodeId);
        continue;
      }

      node.remainingAmount = node.maxAmount;
      this.resourceRespawnAt.delete(nodeId);
    }
  }

  private update(deltaTime: number) {
    const dtSeconds = deltaTime / 1000;

    this.scanResourceRespawns(Date.now());

    // SIM-01: hand out a few routes before anyone moves. Units whose request is
    // still queued keep walking straight, which is exactly the pre-SIM-01
    // behaviour, so a delayed route is never worse than no pathfinding.
    this.movement.processPendingPaths();

    // 1. Update construction and training queues for buildings
    this.state.buildings.forEach((building: BuildingState) => {
      if (!building.isConstructed) {
        // CMD-05: work only happens while villagers stand at the site, and the
        // blueprint's buildTimeMs is the time one villager needs.
        const buildPower = syncBuilders(building, this.state.units);
        const buildTimeMs = BUILDING_BLUEPRINTS[building.type as BuildingType]?.buildTimeMs ?? 0;
        if (buildPower > 0 && buildTimeMs > 0) {
          building.constructionProgress += (deltaTime * 100 * buildPower) / buildTimeMs;
        }

        if (building.constructionProgress >= 100) {
          building.constructionProgress = 100;
          building.isConstructed = true;
          building.hp = building.maxHp;
          // ECO-01: a finished field starts full. A foundation holds nothing, so
          // this is also what makes "farm still under construction" true on the
          // server side of a harvest order.
          seedGatheredBuilding(building);
          // The crew is done; every builder drops back to idle on its next tick
          // (see `processUnitBuilding`), and the roster must not outlive the site.
          building.builderUnitIds.clear();
          this.updatePlayerPopulation(building.ownerId);
        }
      }

      // LVL: a finished building can be upgrading itself. The timer runs even
      // while the site is under attack; only the building's owner can start it.
      if (building.isConstructed && building.upgradeTimeMs > 0) {
        building.upgradeProgressMs += deltaTime;
        if (building.upgradeProgressMs >= building.upgradeTimeMs) {
          applyBuildingUpgrade(building);
          // Town Centers and Houses change the population ceiling.
          this.updatePlayerPopulation(building.ownerId);
        }
      }

      // SIM-03: a finished defensive building shoots at whatever enemy comes
      // inside its range. Foundations are defenceless until they are done.
      if (building.isConstructed) {
        const attackBlueprint = BUILDING_BLUEPRINTS[building.type as BuildingType];
        if (attackBlueprint && attackBlueprint.attackRange > 0) {
          this.combat.updateTowerCombat(building, deltaTime, attackBlueprint);
        }
      }

      // Process training queue. Like research, the timer belongs to an online
      // player: offlining removes the PlayerState, and continuing here would
      // spawn units at the level-1 fallback after the player had researched.
      if (
        building.isConstructed &&
        building.trainingQueue.length > 0 &&
        this.state.players.has(building.ownerId)
      ) {
        building.trainingProgressMs += deltaTime;
        const currentUnitType = building.trainingQueue[0] as UnitType;
        const blueprint = UNIT_BLUEPRINTS[currentUnitType];
        if (blueprint && building.trainingProgressMs >= blueprint.trainTimeMs) {
          building.trainingQueue.shift();
          building.trainingProgressMs = 0;
          this.spawnTrainedUnit(building, currentUnitType);
        }
      }
    });

    // LVL: one player-wide unit research at a time. Offline players have no
    // PlayerState in the room, so their research pauses until they rejoin.
    this.state.players.forEach((player: PlayerState) => {
      if (!player.researchUnitType) return;

      if (player.researchProgressMs < player.researchTimeMs) {
        player.researchProgressMs += deltaTime;
      }
      if (player.researchProgressMs >= player.researchTimeMs) {
        applyUnitResearch(this.state, player, player.researchUnitType as UnitType);
      }
    });

    // 2. Update units (movement, combat, harvesting)
    this.state.units.forEach((unit: UnitState) => {
      const blueprint = UNIT_BLUEPRINTS[unit.type as UnitType];
      if (!blueprint) return;

      // CMD-01: before taking a step, an attack-moving or patrolling unit checks
      // for the closest enemy inside its aggro radius.
      this.combat.acquireAggroTarget(unit, blueprint.aggroRadius);

      // A fight whose target was destroyed, killed by someone else or simply
      // removed from the snapshot resumes the stored order instead of leaving the
      // unit standing with a dangling target id. ATTACKING with no target at all
      // is the same dead end, so it takes the same exit.
      if (unit.actionState === 'ATTACKING' && !this.combat.isTargetAlive(unit)) {
        this.combat.endAttackOrder(unit);
      }

      // SIM-01 follow-up: a route computed before a building appeared runs
      // straight through it, so a blocked next tile drops the route and asks for
      // a new one before the unit takes the step.
      this.movement.refreshRouteIfBlocked(unit);

      // Movement handling
      if (
        unit.actionState === 'MOVING' ||
        unit.actionState === 'HARVESTING' ||
        unit.actionState === 'ATTACKING' ||
        unit.actionState === 'ATTACK_MOVE' ||
        unit.actionState === 'PATROL' ||
        unit.actionState === 'BUILDING' ||
        unit.actionState === 'RETURNING'
      ) {
        let destinationX = unit.targetX;
        let destinationY = unit.targetY;

        // If pursuing attack target, update destination towards target position
        if (unit.actionState === 'ATTACKING' && unit.targetEntityId) {
          let targetX = unit.x;
          let targetY = unit.y;

          if (unit.targetEntityType === 'unit') {
            const targetUnit = this.state.units.get(unit.targetEntityId);
            if (targetUnit) {
              targetX = targetUnit.x;
              targetY = targetUnit.y;
            }
          } else if (unit.targetEntityType === 'building') {
            const targetBuilding = this.state.buildings.get(unit.targetEntityId);
            if (targetBuilding) {
              targetX = targetBuilding.gridX + targetBuilding.sizeX / 2;
              targetY = targetBuilding.gridY + targetBuilding.sizeY / 2;
            }
          }
          destinationX = targetX;
          destinationY = targetY;

          // CMB-01: a stand-ground unit, or a defensive one that has been dragged
          // past its leash, does not take the step. Zeroing the destination keeps
          // the movement branch below untouched: dist is 0, so nothing moves,
          // while `updateUnitCombat` still lands hits on anything already in range.
          if (!this.combat.canChaseTarget(unit)) {
            destinationX = unit.x;
            destinationY = unit.y;
          }
        }

        // SIM-01: follow the computed route while it lasts. A route ends on the
        // goal tile, whose centre can sit up to half a tile from the click
        // point, so the last stretch is walked straight to `targetX/targetY`.
        if (unit.actionState !== 'ATTACKING' && unit.pathX.length > 0) {
          destinationX = unit.pathX[0];
          destinationY = unit.pathY[0];
        }

        const dx = destinationX - unit.x;
        const dy = destinationY - unit.y;
        const dist = Math.hypot(dx, dy);

        const attackRange = blueprint.attackRange;

        const stopDist = unit.actionState === 'ATTACKING' ? attackRange : 0.15;

        if (dist > stopDist) {
          const moveStep = Math.min(dist, unit.speed * dtSeconds);
          unit.x += (dx / dist) * moveStep;
          unit.y += (dy / dist) * moveStep;
        } else if (unit.actionState !== 'ATTACKING' && unit.pathX.length > 0) {
          // Reached an intermediate tile: drop it and head for the next one on
          // the following tick. The order only completes when the path is spent.
          unit.pathX.shift();
          unit.pathY.shift();
        } else {
          if (unit.actionState === 'MOVING' || unit.actionState === 'ATTACK_MOVE') {
            // Arrived: walk on to the next queued waypoint if there is one. An
            // attack-move ends here (IDLE), like in AoE.
            this.movement.resumeQueuedWaypoint(unit);
          } else if (unit.actionState === 'PATROL') {
            // Reached one end of the route: swap the endpoints and head back. A
            // route whose ends collapse onto the same tile would otherwise ping
            // pong every tick, so it ends instead.
            const nextX = unit.patrolX;
            const nextY = unit.patrolY;
            if (Math.hypot(nextX - unit.x, nextY - unit.y) <= 0.15) {
              this.movement.resumeQueuedWaypoint(unit);
            } else {
              unit.patrolX = unit.targetX;
              unit.patrolY = unit.targetY;
              this.movement.setWalkTarget(unit, nextX, nextY);
            }
          }
        }
      }

      // Attack combat handling
      if (unit.actionState === 'ATTACKING' && unit.targetEntityId) {
        this.combat.updateUnitCombat(unit, deltaTime);
      }

      // Harvesting and carrying (CMD-06 / SIM-02)
      if (unit.actionState === 'HARVESTING' && unit.targetEntityId) {
        this.economy.updateUnit(unit, deltaTime);
      }

      // CMD-05: signing a villager up to the crew once it reaches the site, and
      // dropping the order when the foundation is finished or gone.
      if (unit.actionState === 'BUILDING') {
        this.processUnitBuilding(unit);
      }

      // SIM-02: banking the load once the walk back to the drop-off is done.
      if (unit.actionState === 'RETURNING') {
        this.economy.updateUnit(unit, deltaTime);
      }
    });
  }

  /**
   * Creates a finished unit at the building's front door and, if the building
   * has a rally point, sends it walking there immediately (CTL-06).
   *
   * The spawn tile itself stays IDLE rather than MOVING-to-itself: the movement
   * pass would zero the distance and drop it back to IDLE one tick later anyway,
   * and the flag/waypoint UI would flicker in between.
   */
  private spawnTrainedUnit(building: BuildingState, unitType: UnitType) {
    const ownerId = building.ownerId;
    const x = building.gridX;
    const y = building.gridY + building.sizeY;
    const blueprint = UNIT_BLUEPRINTS[unitType];
    const player = this.state.players.get(ownerId);
    const level = player ? getPlayerUnitLevel(player.unitLevels, unitType) : 1;
    const levelStats = getUnitLevelStats(unitType, level);
    const uId = `u_${entityIds.nextId()}`;
    const unit = new UnitState();
    unit.id = uId;
    unit.ownerId = ownerId;
    unit.type = unitType;
    unit.x = Math.max(0, Math.min(MAP_GRID_WIDTH - 1, x));
    unit.y = Math.max(0, Math.min(MAP_GRID_HEIGHT - 1, y));
    unit.targetX = unit.x;
    unit.targetY = unit.y;
    unit.speed = blueprint.speed;
    unit.level = level;
    unit.hp = levelStats.maxHp;
    unit.maxHp = levelStats.maxHp;
    unit.actionState = 'IDLE';

    if (building.rallyX >= 0 && building.rallyY >= 0) {
      const rallyX = Math.max(0, Math.min(MAP_GRID_WIDTH - 1, building.rallyX));
      const rallyY = Math.max(0, Math.min(MAP_GRID_HEIGHT - 1, building.rallyY));
      // A rally point on the spawn tile needs no order; anything else does.
      if (rallyX !== unit.x || rallyY !== unit.y) {
        this.movement.setWalkTarget(unit, rallyX, rallyY);
        unit.actionState = 'MOVING';
      }
    }

    this.state.units.set(uId, unit);
    this.updatePlayerPopulation(ownerId);
  }

  private updatePlayerPopulation(ownerId: string) {
    const player = this.state.players.get(ownerId);
    if (!player) return;

    let unitCount = 0;
    this.state.units.forEach((u: UnitState) => {
      if (u.ownerId === ownerId) unitCount++;
    });

    let totalCap = INITIAL_POPULATION_CAP;
    this.state.buildings.forEach((b: BuildingState) => {
      if (b.ownerId === ownerId && b.isConstructed) {
        const bp = BUILDING_BLUEPRINTS[b.type as BuildingType];
        if (bp) {
          totalCap += getBuildingLevelStats(b.type as BuildingType, b.level).populationProvided;
        }
      }
    });

    // MAPS: the counter is account-wide even though only this map is simulated.
    player.population = unitCount + player.populationElsewhere;
    player.populationCap = Math.min(
      MAX_POPULATION_LIMIT,
      totalCap + player.populationCapElsewhere
    );
  }

  async onLeave(client: Client, code?: number) {
    const ownerId = ownerIdOf(client);

    // SESS-05/D1: a rejected join and a superseded socket both leave without
    // owning the account, so neither may delete the player or save the empire.
    if (!this.sessions.isActive(ownerId, client.sessionId)) {
      console.log(
        `[WorldRoom] Session ${client.sessionId} is not the live session; keeping the empire.`
      );
      return;
    }

    const reason =
      code === SESSION_REPLACED_CLOSE
        ? 'session replaced'
        : code === CloseCode.CONSENTED
          ? 'player signed out'
          : 'connection lost';
    console.log(`[WorldRoom] Session ${client.sessionId} left (${reason}).`);

    const leaving = this.saveAndRelease(ownerId, client);
    this.leaveByUser.set(ownerId, leaving);
    accountSaves.track(ownerId, leaving);
    try {
      await leaving;
    } finally {
      if (this.leaveByUser.get(ownerId) === leaving) this.leaveByUser.delete(ownerId);
    }
  }

  /**
   * SESS-05: drops the player entry and persists the empire. Only called for the
   * session that currently owns the account; a superseded or rejected session
   * must never reach this method.
   */
  private async saveAndRelease(ownerId: string, client: Client): Promise<void> {
    this.sessions.release(ownerId, client.sessionId);

    const player = this.state.players.get(ownerId);
    if (!player) return;

    player.isOnline = false;
    console.log(`[WorldRoom] Player ${player.name} left. Saving ${this.zoneId}...`);

    // The empire is owned by the account id, which is what this leave is about:
    // the snapshot below is the whole current empire on this map, never an empty
    // list that the sweep would turn into a delete of every row.
    const owned = this.ownedBy(ownerId);
    const departedTo = this.departureZoneByOwner.get(ownerId);

    try {
      if (departedTo) {
        // The travel transaction is the authority on resources and the new
        // `last_zone`; this room only has to flush the entities it still owns.
        await DatabaseService.saveZonePlayerEntities(
          this.zoneId,
          ownerId,
          owned.buildings,
          owned.units
        );
      } else {
        await DatabaseService.savePlayerEmpire(
          player,
          owned.buildings,
          owned.units,
          this.zoneId
        );
      }
    } finally {
      this.departureZoneByOwner.delete(ownerId);
      this.state.players.delete(ownerId);
    }
  }

  async onDispose() {
    // A room that has already been replaced for this zone must not flush its
    // stale snapshot over the successor's state.
    if (this.zoneReady && zonePersistence.isCurrent(this.zoneId, this.persistenceToken)) {
      console.log(`🛑 [WorldRoom] ${this.zoneId} disposing. Final SQLite flush...`);
      await DatabaseService.saveFullWorldState(this.state, this.zoneId, {
        // A hand-off leave may have returned early (the destination already
        // owned the session), leaving the player entry in this state. Flush the
        // entities but not the stale account row.
        skipAccountFor: new Set(this.departureZoneByOwner.keys())
      });
    } else {
      console.log(`🛑 [WorldRoom] ${this.zoneId} disposing; newer room owns the zone.`);
    }
    zonePersistence.release(this.zoneId, this.persistenceToken);
  }
}

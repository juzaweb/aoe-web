import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { WorldState } from '../schema/WorldState.js';
import { PlayerState } from '../schema/PlayerState.js';
import { BuildingState } from '../schema/BuildingState.js';
import { UnitState } from '../schema/UnitState.js';
import { ResourceNodeState } from '../schema/ResourceNodeState.js';
import { DATABASE_INDEX_STATEMENTS, DATABASE_TABLE_STATEMENTS } from './databaseSchema.js';
import { serializeUnitLevels } from './playerLevels.js';
import { entityIds } from './EntityIdAllocator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves to `apps/server/database` from both `src/services` (tsx) and
 * `dist/services` (compiled). The directory is created on boot when missing.
 */
export const DATABASE_DIR = path.resolve(__dirname, '../../database');
export const DATABASE_FILE = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(DATABASE_DIR, 'dev.db');

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${DATABASE_FILE}`
    }
  }
});

/** One unit crossing a map boundary, stored inside `travel_transfers.units`. */
export interface TravelUnitSnapshot {
  id: string;
  type: string;
  level: number;
  hp: number;
  maxHp: number;
  speed: number;
}

export interface CommitTravelInput {
  player: PlayerState;
  ownerId: string;
  fromZone: string;
  toZone: string;
  transferId: string;
  sourceSessionId: string;
  units: TravelUnitSnapshot[];
}

/** Counts an account has on the other map, used to keep population global. */
export interface ForeignBaseline {
  unitCount: number;
  buildings: Array<{ type: string; level: number }>;
}

export class DatabaseService {
  private static initPromise: Promise<void> | null = null;

  /**
   * One FIFO chain per zone. Two rooms can write different zones at the same
   * time, but two writes to the same zone must never interleave: the second
   * sweep could otherwise be computed from a snapshot the first write has
   * already superseded.
   */
  private static readonly zoneChains = new Map<string, Promise<unknown>>();
  private static readonly zoneWrites = new Map<string, number>();

  /**
   * Creates the schema and enables WAL. Concurrent callers share one in-flight
   * promise, and failures are rethrown so the server refuses to start on a
   * broken database.
   */
  public static async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.bootstrap().catch((err) => {
        // Allow a later retry instead of caching a rejected promise forever.
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private static async bootstrap(): Promise<void> {
    // Create the directory + empty file first so Prisma opens a brand-new DB
    // instead of failing with "unable to open database file".
    this.ensureDatabaseFile();

    // Create the schema on a brand-new database file (idempotent DDL).
    await this.ensureSchema();

    // LVL: the boot DDL cannot alter an existing database. Add the upgrade
    // columns in place so a dev database keeps its accounts and empires.
    await this.ensureUpgradeColumns();

    // MAPS: the same additive treatment for zones and travel transfers.
    await this.ensureZoneColumns();

    // RAIDS: shield + cached Town Center level on an existing database.
    await this.ensureRaidColumns();

    // ROADS: a globally unique tile id collides across kingdoms.
    await this.ensureRoadPrimaryKey();

    // MAPS-V2: kingdoms shrank from 220x220 to 110x110. Old coordinates cannot be
    // remapped without overlaps, so the layout is reset once (see the method).
    await this.resetLegacyKingdoms();

    // Drop empires whose account is gone before anything reads or writes them.
    await this.pruneOrphanedPlayers();

    // Entity ids are primary keys across every zone, so the sequence must know
    // about everything already stored before the first room mints a new id.
    await this.seedEntityIds();

    // Enable WAL mode in SQLite for concurrent reads and writes
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    console.log('📦 [DatabaseService] SQLite database connected with WAL mode enabled.');
  }

  /**
   * Creates the database directory and an empty SQLite file when they are missing,
   * so a fresh clone (or a deleted `database/` folder) starts without extra setup.
   */
  private static ensureDatabaseFile(): void {
    fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });

    if (fs.existsSync(DATABASE_FILE)) {
      return;
    }

    // Touch the file so Prisma opens a brand-new database instead of failing.
    fs.closeSync(fs.openSync(DATABASE_FILE, 'a'));
    console.log(`🗄️  [DatabaseService] Created new SQLite database at ${DATABASE_FILE}`);
  }

  /**
   * Creates all tables/indexes when they are missing. Safe to run on every boot.
   *
   * Table names are snake_case plurals and columns are snake_case too (each
   * model's `@@map` / `@map`), so this DDL and `prisma/schema.prisma` describe
   * the same database.
   */
  private static async ensureSchema() {
    for (const statement of DATABASE_TABLE_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }

    for (const statement of DATABASE_INDEX_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  /**
   * Road identity migration: `world_roads` originally keyed on `id` alone, so
   * two kingdoms could not both own the tile at (20,20). The table is rebuilt
   * with (zone, id) as the primary key; the rows themselves are kept, because a
   * player's painted network is not regenerable.
   *
   * `CREATE TABLE IF NOT EXISTS` cannot change a primary key, so this inspects
   * the existing table and only rebuilds when it is the old shape.
   */
  private static async ensureRoadPrimaryKey() {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'world_roads'`
    );
    if (tables.length === 0) return;

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string; pk: bigint | number }>>(
      `PRAGMA table_info("world_roads")`
    );
    // SQLite reports `pk` as the 1-based position inside the primary key (and
    // Prisma hands the value back as a BigInt), so a composite key shows pk 1
    // and 2 on two different columns.
    const keyed = columns
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk));
    const alreadyComposite = keyed.length === 2 && keyed[0].name === 'zone';
    if (alreadyComposite) return;

    await prisma.$executeRawUnsafe(`ALTER TABLE "world_roads" RENAME TO "world_roads_legacy"`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "world_roads" (
        "id" TEXT NOT NULL,
        "zone" TEXT NOT NULL DEFAULT 'world',
        "owner_id" TEXT NOT NULL,
        "grid_x" INTEGER NOT NULL,
        "grid_y" INTEGER NOT NULL,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("zone", "id")
      )`
    );
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "world_roads" ("id", "zone", "owner_id", "grid_x", "grid_y", "created_at")
       SELECT "id", "zone", "owner_id", "grid_x", "grid_y", "created_at" FROM "world_roads_legacy"`
    );
    await prisma.$executeRawUnsafe(`DROP TABLE "world_roads_legacy"`);
    // The old table's index went with it, and `ensureSchema` already ran this
    // boot, so the replacement has to be created here.
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "world_roads_zone_idx" ON "world_roads"("zone")`
    );
    console.log('🗄️  [DatabaseService] Rebuilt world_roads with a (zone, id) primary key.');
  }

  /**
   * LVL: additive migration for databases created before upgrade levels
   * existed. `ensureSchema` only runs `CREATE TABLE IF NOT EXISTS`, so an
   * existing `dev.db` would otherwise be missing every new column.
   *
   * `prisma db push` is deliberately not used here: the boot DDL and the Prisma
   * schema differ in ways that make Prisma propose dropping non-empty tables.
   * These columns are constant strings and never come from user input.
   */
  private static async ensureUpgradeColumns() {
    const columns: Array<[table: string, column: string, definition: string]> = [
      ['players', 'unit_levels', "TEXT NOT NULL DEFAULT '1,1,1,1'"],
      ['players', 'research_unit_type', "TEXT NOT NULL DEFAULT ''"],
      ['players', 'research_progress_ms', 'REAL NOT NULL DEFAULT 0'],
      ['players', 'research_time_ms', 'REAL NOT NULL DEFAULT 0'],
      ['buildings', 'level', 'INTEGER NOT NULL DEFAULT 1'],
      ['buildings', 'upgrade_progress_ms', 'REAL NOT NULL DEFAULT 0'],
      ['buildings', 'upgrade_time_ms', 'REAL NOT NULL DEFAULT 0'],
      ['units', 'level', 'INTEGER NOT NULL DEFAULT 1'],
      // Regrow: a depleted node keeps its refill timestamp so an empty map is
      // not refilled by a restart (see `WorldRoom.scanResourceRespawns`).
      ['world_resource_nodes', 'respawn_at', 'REAL NULL']
    ];

    for (const [table, column, definition] of columns) {
      const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`
      );
      if (existing.some((row) => row.name === column)) continue;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
      );
      console.log(`🗄️  [DatabaseService] Added ${table}.${column} to an existing database.`);
    }
  }

  /**
   * RAIDS: columns a pre-Phase-23 database lacks.
   *
   * `town_center_level` starts at 1 and is corrected by the first autosave of
   * each empire (`syncTownCenterLevel`), so no backfill pass is needed.
   */
  private static async ensureRaidColumns() {
    const columns: Array<[table: string, column: string, definition: string]> = [
      ['players', 'shield_until', 'REAL NOT NULL DEFAULT 0'],
      ['players', 'town_center_level', 'INTEGER NOT NULL DEFAULT 1']
    ];

    for (const [table, column, definition] of columns) {
      const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`
      );
      if (existing.some((row) => row.name === column)) continue;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
      );
      console.log(`🗄️  [DatabaseService] Added ${table}.${column} to an existing database.`);
    }
  }

  /**
   * MAPS: adds the zone columns to an existing database and moves every empire
   * that predates the split into its owner's private kingdom.
   *
   * The UPDATE statements are idempotent: they only touch legacy `world` rows,
   * which no room creates any more. The old shared resource nodes are dropped
   * and regenerated per zone on the next join.
   */
  private static async ensureZoneColumns() {
    const columns: Array<[table: string, column: string, definition: string]> = [
      ['players', 'last_zone', "TEXT NOT NULL DEFAULT 'kingdom'"],
      ['buildings', 'zone', "TEXT NOT NULL DEFAULT 'world'"],
      ['units', 'zone', "TEXT NOT NULL DEFAULT 'world'"],
      ['world_resource_nodes', 'zone', "TEXT NOT NULL DEFAULT 'world'"]
    ];

    for (const [table, column, definition] of columns) {
      const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`
      );
      if (existing.some((row) => row.name === column)) continue;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
      );
      console.log(`🗄️  [DatabaseService] Added ${table}.${column} for map zones.`);
    }

    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "buildings_zone_owner_id_idx" ON "buildings"("zone", "owner_id");'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "units_zone_owner_id_idx" ON "units"("zone", "owner_id");'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "world_resource_nodes_zone_idx" ON "world_resource_nodes"("zone");'
    );

    await prisma.$executeRawUnsafe(
      "UPDATE buildings SET zone = 'kingdom:' || owner_id WHERE zone = 'world';"
    );
    await prisma.$executeRawUnsafe(
      "UPDATE units SET zone = 'kingdom:' || owner_id WHERE zone = 'world';"
    );
    await prisma.$executeRawUnsafe(
      "DELETE FROM world_resource_nodes WHERE zone = 'world';"
    );
  }

  /**
   * One-time data migration for the smaller kingdom map.
   *
   * Kingdoms used to be laid out on the same 220x220 map as the battlefield and
   * the Town Center was placed by a hash. The layout is now 110x110 with the Town
   * Center dead centre; old coordinates cannot be remapped without buildings
   * overlapping each other, so every kingdom's buildings, units and resource
   * nodes are dropped once and regenerated on the next join.
   *
   * The `players` row survives on purpose: resources, levels and research are
   * account progress, not map layout. `travel_transfers` is left alone as well,
   * so units already walking home still arrive next to the new portal.
   *
   * Bump the key in both statements whenever the kingdom layout changes again;
   * a layout change is exactly what this migration is for.
   */
  private static async resetLegacyKingdoms(): Promise<void> {
    const done = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
      `SELECT "key" FROM "schema_meta" WHERE "key" = 'kingdom_map_110_v1'`
    );
    if (done.length > 0) return;

    await prisma.$executeRawUnsafe(`DELETE FROM "buildings" WHERE "zone" LIKE 'kingdom:%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "units" WHERE "zone" LIKE 'kingdom:%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "world_resource_nodes" WHERE "zone" LIKE 'kingdom:%'`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "schema_meta" ("key", "value") VALUES ('kingdom_map_110_v1', 'done')`
    );

    console.log('🗺️  [DatabaseService] Reset legacy kingdoms onto the 110x110 map.');
  }

  /**
   * Deletes empires whose account no longer exists.
   *
   * `Player.id` is `User.id`, so a player row without a matching account is
   * unreachable — nobody can sign in as it. It still holds a `players.name`,
   * which makes the next save for that display name fail with P2002 (typical
   * after a database reset while a client keeps its old token).
   */
  private static async pruneOrphanedPlayers(): Promise<void> {
    const orphans = await prisma.$queryRawUnsafe<{ id: string }[]>(
      'SELECT "id" FROM "players" WHERE "id" NOT IN (SELECT "id" FROM "users")'
    );
    if (orphans.length === 0) {
      return;
    }

    const ids = orphans.map((row) => row.id);
    // Explicit child deletes: the boot DDL declares ON DELETE CASCADE, but this
    // must also clean up correctly when SQLite has FK enforcement disabled.
    await prisma.$transaction([
      prisma.building.deleteMany({ where: { ownerId: { in: ids } } }),
      prisma.unit.deleteMany({ where: { ownerId: { in: ids } } }),
      prisma.travelTransfer.deleteMany({ where: { ownerId: { in: ids } } }),
      prisma.player.deleteMany({ where: { id: { in: ids } } })
    ]);

    console.log(
      `🧹 [DatabaseService] Removed ${ids.length} orphaned empire(s) with no matching account.`
    );
  }

  /** Seeds the process-wide id sequence from every persisted entity id. */
  private static async seedEntityIds(): Promise<void> {
    const [buildings, units, resources] = await Promise.all([
      prisma.building.findMany({ select: { id: true } }),
      prisma.unit.findMany({ select: { id: true } }),
      prisma.worldResourceNode.findMany({ select: { id: true } })
    ]);

    for (const row of buildings) entityIds.observe(row.id);
    for (const row of units) entityIds.observe(row.id);
    for (const row of resources) entityIds.observe(row.id);
  }

  /**
   * Closes the Prisma connection so the process can exit cleanly.
   */
  public static async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }

  // ---------------------------------------------------------------------------
  // Zone write queue
  // ---------------------------------------------------------------------------

  /**
   * Serializes writes for one zone. `skipIfBusy` is what the 30s autosave uses:
   * a slow write is allowed to finish instead of piling up behind itself, while
   * a leave/travel write passes `false` and is always queued.
   */
  private static async withZoneQueue<T>(
    zone: string,
    task: () => Promise<T>,
    skipIfBusy = false
  ): Promise<T | undefined> {
    if (skipIfBusy && (this.zoneWrites.get(zone) ?? 0) > 0) return undefined;

    this.zoneWrites.set(zone, (this.zoneWrites.get(zone) ?? 0) + 1);
    const previous = this.zoneChains.get(zone) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.zoneChains.set(zone, run.catch(() => undefined));

    try {
      return await run;
    } finally {
      const remaining = (this.zoneWrites.get(zone) ?? 1) - 1;
      if (remaining <= 0) this.zoneWrites.delete(zone);
      else this.zoneWrites.set(zone, remaining);
    }
  }

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------

  /** Loads the resource nodes of one map. */
  public static async loadResources(zone = 'world') {
    await this.initialize();
    return await prisma.worldResourceNode.findMany({ where: { zone } });
  }

  /** Clears the resource nodes of one map, or every map when `zone` is omitted. */
  public static async clearAllResources(zone?: string) {
    await this.initialize();
    await prisma.worldResourceNode.deleteMany({ where: zone ? { zone } : undefined });
  }

  /** Inserts a freshly generated batch of resource nodes in one statement. */
  public static async saveAllResources(nodes: ResourceNodeState[], zone = 'world') {
    await this.initialize();
    if (nodes.length === 0) return;

    await prisma.worldResourceNode.createMany({
      data: nodes.map((node) => ({
        id: node.id,
        zone,
        type: node.type,
        resourceType: node.resourceType,
        gridX: node.gridX,
        gridY: node.gridY,
        remainingAmount: node.remainingAmount,
        maxAmount: node.maxAmount,
        respawnAt: null
      }))
    });
  }

  /**
   * Upserts and sweeps the resource nodes of exactly one zone.
   *
   * A zone holds well over a thousand nodes, and almost none of them change
   * between two autosaves. Upserting every row per save used to block the zone's
   * write queue for seconds (a player's leave waits behind it), so the current
   * rows are read once and only new/changed nodes are written.
   */
  private static async saveZoneResources(
    zone: string,
    nodes: ResourceNodeState[],
    options: {
      stmts?: { n: number };
      /** Refill deadline per depleted node id; `null`/absent means "has stock". */
      respawnAtOf?: ReadonlyMap<string, number>;
    } = {}
  ) {
    const { stmts, respawnAtOf } = options;

    if (nodes.length > 0) {
      const existing = await prisma.worldResourceNode.findMany({
        where: { zone },
        select: { id: true, remainingAmount: true, respawnAt: true }
      });
      if (stmts) stmts.n++;
      const known = new Map(existing.map((row) => [row.id, row] as const));

      const created: Array<{ node: ResourceNodeState; respawnAt: number | null }> = [];
      const changed: Array<{ node: ResourceNodeState; respawnAt: number | null }> = [];
      for (const node of nodes) {
        const respawnAt = respawnAtOf?.get(node.id) ?? null;
        const saved = known.get(node.id);
        if (saved === undefined) {
          created.push({ node, respawnAt });
        } else if (
          saved.remainingAmount !== node.remainingAmount ||
          (saved.respawnAt ?? null) !== respawnAt
        ) {
          changed.push({ node, respawnAt });
        }
      }

      if (created.length > 0) {
        if (stmts) stmts.n++;
        await prisma.worldResourceNode.createMany({
          data: created.map(({ node, respawnAt }) => ({
            id: node.id,
            zone,
            type: node.type,
            resourceType: node.resourceType,
            gridX: node.gridX,
            gridY: node.gridY,
            remainingAmount: node.remainingAmount,
            maxAmount: node.maxAmount,
            respawnAt
          }))
        });
      }

      if (changed.length > 0) {
        if (stmts) stmts.n += changed.length;
        await prisma.$transaction(
          changed.map(({ node, respawnAt }) =>
            prisma.worldResourceNode.update({
              where: { id: node.id },
              data: { remainingAmount: node.remainingAmount, respawnAt }
            })
          )
        );
      }
    }

    if (stmts) stmts.n++;
    await prisma.worldResourceNode.deleteMany({
      where: { zone, id: { notIn: nodes.map((node) => node.id) } }
    });
  }

  // ---------------------------------------------------------------------------
  // Roads
  // ---------------------------------------------------------------------------

  /** Loads the player-painted road tiles of one map. */
  public static async loadRoads(zone: string) {
    await this.initialize();
    return await prisma.worldRoad.findMany({ where: { zone } });
  }

  /**
   * Upserts and sweeps the road tiles of exactly one zone.
   *
   * Roads change one small stroke at a time, so the same diff strategy as the
   * resource nodes applies: read the known ids once, insert the new ones in one
   * statement, delete everything the room no longer holds. Rows never change
   * after creation (a tile is either there or gone), so there is no update pass.
   */
  private static async saveZoneRoads(
    zone: string,
    roads: Array<{ id: string; ownerId: string; gridX: number; gridY: number }>,
    stmts?: { n: number }
  ) {
    // Read the (zone, id) composite: `id` alone is only unique inside a zone,
    // so a bare `where: { id: { in } }` would sweep another kingdom's rows.
    const existing = await prisma.worldRoad.findMany({ where: { zone }, select: { id: true } });
    if (stmts) stmts.n++;
    const known = new Set(existing.map((row) => row.id));

    const created = roads.filter((road) => !known.has(road.id));
    if (created.length > 0) {
      if (stmts) stmts.n++;
      await prisma.worldRoad.createMany({
        data: created.map((road) => ({
          id: road.id,
          zone,
          ownerId: road.ownerId,
          gridX: road.gridX,
          gridY: road.gridY
        }))
      });
    }

    if (stmts) stmts.n++;
    // `zone` is part of the predicate on purpose: `id` is only unique inside a
    // zone, so an unscoped `notIn` would delete every other kingdom's roads that
    // happen to share a tile coordinate.
    await prisma.worldRoad.deleteMany({
      where: { zone, id: { notIn: roads.map((road) => road.id) } }
    });
  }

  // ---------------------------------------------------------------------------
  // Players and entities
  // ---------------------------------------------------------------------------

  /**
   * Loads an existing player and their empire (buildings & units) by account id.
   *
   * The account id, not the display name: a rename must not orphan an empire.
   * The result intentionally includes every zone; callers filter when they need
   * one map's slice.
   */
  public static async loadPlayerProfile(playerId: string) {
    await this.initialize();
    return await prisma.player.findUnique({
      where: { id: playerId },
      include: {
        buildings: true,
        units: true
      }
    });
  }

  /**
   * Loads players whose empire may live on `zone`, optionally narrowed to one
   * account. Battlefield rooms load every participant (including offline ones,
   * whose forward base must still be attackable); kingdom rooms load only the
   * owner.
   */
  public static async loadAllWorldEntities(zone?: string, ownerId?: string) {
    await this.initialize();
    return await prisma.player.findMany({
      where: ownerId ? { id: ownerId } : undefined,
      include: {
        buildings: zone ? { where: { zone } } : true,
        units: zone ? { where: { zone } } : true
      }
    });
  }

  /** Zone-scoped alias used by the room restore path. */
  public static async loadZoneEntities(zone: string, ownerId?: string) {
    return this.loadAllWorldEntities(zone, ownerId);
  }

  /**
   * Saves a single player's entire empire state (resources, buildings, units).
   *
   * `player.id` is the account id and the only ownership key: it is the primary
   * key of `Player` and the `ownerId` foreign key of every row synced below.
   * `player.name` is display text, so a rename just updates the column.
   *
   * `zone` is required for correctness: the sweep only deletes rows of this
   * account on this map, never the same account's units standing on the other.
   */
  public static async savePlayerEmpire(
    player: PlayerState,
    buildings: BuildingState[],
    units: UnitState[],
    zone = 'world'
  ) {
    await this.withZoneQueue(zone, async () => {
      await this.initialize();
      await this.savePlayerAccountInternal(player, zone);
      await this.saveZoneEntitiesInternal(zone, player.id, buildings, units);
    });
  }

  /**
   * Persists one account's buildings/units on a zone without touching the
   * account row. Used when a room is left because of travel: the travel
   * transaction already wrote the authoritative resources and destination, and
   * re-writing them from the source room would roll the player back.
   */
  public static async saveZonePlayerEntities(
    zone: string,
    ownerId: string,
    buildings: BuildingState[],
    units: UnitState[]
  ) {
    await this.withZoneQueue(zone, async () => {
      await this.initialize();
      await this.saveZoneEntitiesInternal(zone, ownerId, buildings, units);
    });
  }

  private static async savePlayerAccountInternal(player: PlayerState, zone: string, stmts?: { n: number }) {
    const ownerId = player.id;
    if (stmts) stmts.n++;
    await prisma.player.upsert({
      where: { id: ownerId },
      create: {
        id: ownerId,
        name: player.name,
        color: player.color,
        wood: player.wood,
        food: player.food,
        gold: player.gold,
        stone: player.stone,
        population: player.population,
        populationCap: player.populationCap,
        unitLevels: serializeUnitLevels(player.unitLevels),
        researchUnitType: player.researchUnitType,
        researchProgressMs: player.researchProgressMs,
        researchTimeMs: player.researchTimeMs,
        isOnline: player.isOnline,
        lastZone: zone
      },
      update: {
        name: player.name,
        color: player.color,
        wood: player.wood,
        food: player.food,
        gold: player.gold,
        stone: player.stone,
        population: player.population,
        populationCap: player.populationCap,
        unitLevels: serializeUnitLevels(player.unitLevels),
        researchUnitType: player.researchUnitType,
        researchProgressMs: player.researchProgressMs,
        researchTimeMs: player.researchTimeMs,
        isOnline: player.isOnline,
        lastZone: zone
      }
    });
  }

  /**
   * Upserts one account's buildings and units for `zone`, deleting whatever it
   * no longer has there. This is the only entity sweep: every caller passes a
   * zone, so a save on one map can never delete another map's rows.
   */
  private static async saveZoneEntitiesInternal(
    zone: string,
    ownerId: string,
    buildings: BuildingState[],
    units: UnitState[],
    stmts?: { n: number }
  ) {
    await prisma.$transaction(async (tx) => {
      const currentBuildingIds = buildings.map((b) => b.id);
      if (stmts) stmts.n++;
      await tx.building.deleteMany({
        where: {
          ownerId,
          zone,
          id: { notIn: currentBuildingIds }
        }
      });

      for (const b of buildings) {
        if (stmts) stmts.n++;
        await tx.building.upsert({
          where: { id: b.id },
          create: {
            id: b.id,
            ownerId,
            zone,
            type: b.type,
            gridX: b.gridX,
            gridY: b.gridY,
            sizeX: b.sizeX,
            sizeY: b.sizeY,
            hp: b.hp,
            maxHp: b.maxHp,
            level: b.level,
            upgradeProgressMs: b.upgradeProgressMs,
            upgradeTimeMs: b.upgradeTimeMs,
            isConstructed: b.isConstructed,
            constructionProgress: b.constructionProgress
          },
          update: {
            zone,
            // Positions are stable for player-built structures, but the
            // server-owned kingdom portal is re-positioned to the map edge on
            // join after a layout change, so the move must persist.
            gridX: b.gridX,
            gridY: b.gridY,
            sizeX: b.sizeX,
            sizeY: b.sizeY,
            hp: b.hp,
            maxHp: b.maxHp,
            level: b.level,
            upgradeProgressMs: b.upgradeProgressMs,
            upgradeTimeMs: b.upgradeTimeMs,
            isConstructed: b.isConstructed,
            constructionProgress: b.constructionProgress
          }
        });
      }

      const currentUnitIds = units.map((u) => u.id);
      if (stmts) stmts.n++;
      await tx.unit.deleteMany({
        where: {
          ownerId,
          zone,
          id: { notIn: currentUnitIds }
        }
      });

      for (const u of units) {
        if (stmts) stmts.n++;
        await tx.unit.upsert({
          where: { id: u.id },
          create: {
            id: u.id,
            ownerId,
            zone,
            type: u.type,
            x: u.x,
            y: u.y,
            speed: u.speed,
            level: u.level,
            hp: u.hp,
            maxHp: u.maxHp,
            actionState: u.actionState
          },
          update: {
            // Phase 23: `zone` is deliberately not written here. A unit the
            // home room still holds in memory may already have been moved to
            // another zone by a raid commit (a raid or a return home), and
            // re-stamping this zone would drag it back — duplicating an army or
            // resurrecting a casualty. Zone changes belong to the raid/travel
            // transactions only.
            x: u.x,
            y: u.y,
            level: u.level,
            hp: u.hp,
            maxHp: u.maxHp,
            actionState: u.actionState
          }
        });
      }
    });
  }

  /**
   * Persists an entire zone snapshot: every building/unit the room holds,
   * including entities whose owner is offline (a battlefield forward base must
   * not be erased just because its owner is not in `state.players`), plus the
   * account rows of everyone currently connected.
   */
  public static async saveFullWorldState(
    state: WorldState,
    zone = state.zoneId || 'world',
    options: {
      skipIfBusy?: boolean;
      skipAccountFor?: Set<string>;
      resourceRespawnAt?: ReadonlyMap<string, number>;
    } = {}
  ) {
    await this.withZoneQueue(
      zone,
      async () => {
        const started = performance.now();
        await this.initialize();
        const stmts = { n: 0 };

        const entitiesByOwner = new Map<
          string,
          { buildings: BuildingState[]; units: UnitState[] }
        >();
        const groupFor = (ownerId: string) => {
          let group = entitiesByOwner.get(ownerId);
          if (!group) {
            group = { buildings: [], units: [] };
            entitiesByOwner.set(ownerId, group);
          }
          return group;
        };

        state.buildings.forEach((building: BuildingState) => {
          groupFor(building.ownerId).buildings.push(building);
        });
        state.units.forEach((unit: UnitState) => {
          groupFor(unit.ownerId).units.push(unit);
        });

        // Online players are always swept, even with no entities left, so their
        // account row is saved and stale rows are removed. Snapshot first: this
        // method awaits SQLite and a leave/join would mutate the MapSchema.
        for (const playerState of Array.from(state.players.values())) {
          if (!entitiesByOwner.has(playerState.id)) {
            entitiesByOwner.set(playerState.id, { buildings: [], units: [] });
          }
        }

        for (const [ownerId, group] of entitiesByOwner) {
          const player = state.players.get(ownerId);
          // A player who travelled away must not have the source room's stale
          // resources written back over the travel commit / destination room.
          if (player && !options.skipAccountFor?.has(ownerId)) {
            await this.savePlayerAccountInternal(player, zone, stmts);
          }
          await this.saveZoneEntitiesInternal(zone, ownerId, group.buildings, group.units, stmts);
        }

        const nodes: ResourceNodeState[] = [];
        state.resourceNodes.forEach((node: ResourceNodeState) => nodes.push(node));
        await this.saveZoneResources(zone, nodes, {
          stmts,
          respawnAtOf: options.resourceRespawnAt
        });

        const roads: Array<{ id: string; ownerId: string; gridX: number; gridY: number }> = [];
        state.roads.forEach((road) => {
          roads.push({ id: road.id, ownerId: road.ownerId, gridX: road.gridX, gridY: road.gridY });
        });
        await this.saveZoneRoads(zone, roads, stmts);

        const elapsedMs = Math.round(performance.now() - started);
        console.log(
          `💾 [DatabaseService] ${zone} auto-saved (Players: ${state.players.size}, Buildings: ${state.buildings.size}, Units: ${state.units.size}, ${elapsedMs} ms, ${stmts.n} stmts)`
        );
      },
      options.skipIfBusy === true
    );
  }

  // ---------------------------------------------------------------------------
  // Travel
  // ---------------------------------------------------------------------------

  /**
   * Commits a travel order atomically: the account row gets the new last zone,
   * the selected unit rows leave the source zone, and a transfer row holds the
   * snapshot the destination will materialise. If this throws, nothing moved.
   */
  public static async commitTravel(input: CommitTravelInput): Promise<void> {
    await this.withZoneQueue(input.fromZone, async () => {
      await this.initialize();
      const ids = input.units.map((unit) => unit.id);

      await prisma.$transaction(async (tx) => {
        await tx.player.upsert({
          where: { id: input.ownerId },
          create: {
            id: input.ownerId,
            name: input.player.name,
            color: input.player.color,
            wood: input.player.wood,
            food: input.player.food,
            gold: input.player.gold,
            stone: input.player.stone,
            population: input.player.population,
            populationCap: input.player.populationCap,
            unitLevels: serializeUnitLevels(input.player.unitLevels),
            researchUnitType: input.player.researchUnitType,
            researchProgressMs: input.player.researchProgressMs,
            researchTimeMs: input.player.researchTimeMs,
            isOnline: input.player.isOnline,
            lastZone: input.toZone
          },
          update: {
            wood: input.player.wood,
            food: input.player.food,
            gold: input.player.gold,
            stone: input.player.stone,
            population: input.player.population,
            populationCap: input.player.populationCap,
            unitLevels: serializeUnitLevels(input.player.unitLevels),
            researchUnitType: input.player.researchUnitType,
            researchProgressMs: input.player.researchProgressMs,
            researchTimeMs: input.player.researchTimeMs,
            lastZone: input.toZone
          }
        });

        if (ids.length > 0) {
          await tx.unit.deleteMany({
            where: { ownerId: input.ownerId, zone: input.fromZone, id: { in: ids } }
          });
        }

        await tx.travelTransfer.create({
          data: {
            id: input.transferId,
            ownerId: input.ownerId,
            fromZone: input.fromZone,
            toZone: input.toZone,
            sourceSessionId: input.sourceSessionId,
            units: JSON.stringify(input.units)
          }
        });
      });
    });
  }

  /**
   * Materialises every pending transfer for this account on `zone` and deletes
   * the transfer rows in the same transaction. Positions come from `place`,
   * which the room derives from the destination portal.
   *
   * Idempotent: a second call finds no rows and returns an empty list.
   */
  public static async consumeTravelTransfers(
    ownerId: string,
    zone: string,
    place: (unit: TravelUnitSnapshot, index: number) => { x: number; y: number }
  ): Promise<TravelUnitSnapshot[]> {
    const result = await this.withZoneQueue(zone, async () => {
      await this.initialize();
      const transfers = await prisma.travelTransfer.findMany({
        where: { ownerId, toZone: zone },
        orderBy: { createdAt: 'asc' }
      });
      if (transfers.length === 0) return [] as TravelUnitSnapshot[];

      const consumed: TravelUnitSnapshot[] = [];

      await prisma.$transaction(async (tx) => {
        for (const transfer of transfers) {
          let units: TravelUnitSnapshot[];
          try {
            units = JSON.parse(transfer.units) as TravelUnitSnapshot[];
          } catch {
            units = [];
          }

          for (let index = 0; index < units.length; index++) {
            const unit = units[index];
            const position = place(unit, index);

            await tx.unit.upsert({
              where: { id: unit.id },
              create: {
                id: unit.id,
                ownerId,
                zone,
                type: unit.type,
                x: position.x,
                y: position.y,
                speed: unit.speed,
                level: unit.level,
                hp: unit.hp,
                maxHp: unit.maxHp,
                actionState: 'IDLE'
              },
              update: {
                zone,
                x: position.x,
                y: position.y,
                level: unit.level,
                hp: unit.hp,
                maxHp: unit.maxHp,
                actionState: 'IDLE'
              }
            });

            consumed.push(unit);
          }

          await tx.travelTransfer.delete({ where: { id: transfer.id } });
        }
      });

      return consumed;
    });

    return result ?? [];
  }

  /**
   * Population and capacity this account holds on maps other than `zone`, plus
   * units currently in a transfer heading somewhere else. Used to keep the
   * population counter global while only one map is simulated at a time.
   */
  public static async loadForeignBaseline(ownerId: string, zone: string): Promise<ForeignBaseline> {
    await this.initialize();

    const [unitCount, buildings, transfers] = await Promise.all([
      prisma.unit.count({ where: { ownerId, zone: { not: zone } } }),
      prisma.building.findMany({
        where: { ownerId, zone: { not: zone }, isConstructed: true },
        select: { type: true, level: true }
      }),
      prisma.travelTransfer.findMany({
        where: { ownerId, toZone: { not: zone } },
        select: { units: true }
      })
    ]);

    let transferredUnits = 0;
    for (const transfer of transfers) {
      try {
        const units = JSON.parse(transfer.units) as TravelUnitSnapshot[];
        transferredUnits += units.length;
      } catch {
        // A malformed snapshot is ignored; the row is cleaned up by the
        // destination's consume pass or by a full reset.
      }
    }

    return {
      unitCount: unitCount + transferredUnits,
      buildings
    };
  }
}

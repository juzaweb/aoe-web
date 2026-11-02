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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves to `apps/server/database` from both `src/services` (tsx) and
 * `dist/services` (compiled). The directory is created on boot when missing.
 */
export const DATABASE_DIR = path.resolve(__dirname, '../../database');
export const DATABASE_FILE = path.join(DATABASE_DIR, 'dev.db');

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${DATABASE_FILE}`
    }
  }
});

export class DatabaseService {
  private static initPromise: Promise<void> | null = null;
  private static isSaving = false;

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

    // Drop empires whose account is gone before anything reads or writes them.
    await this.pruneOrphanedPlayers();

    // Enable WAL mode in SQLite for concurrent reads and writes
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    console.log('📦 [DatabaseService] SQLite database connected with WAL mode enabled.');
  }

  /**
   * Creates the database directory and an empty SQLite file when they are missing,
   * so a fresh clone (or a deleted `database/` folder) starts without extra setup.
   */
  private static ensureDatabaseFile(): void {
    fs.mkdirSync(DATABASE_DIR, { recursive: true });

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
      ['units', 'level', 'INTEGER NOT NULL DEFAULT 1']
    ];

    for (const [table, column, definition] of columns) {
      const existing = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`
      );
      if (existing.some((row) => row.name === column)) continue;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
      );
      console.log(`🗄️  [DatabaseService] Added ${table}.${column} for upgrade levels.`);
    }
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
      prisma.player.deleteMany({ where: { id: { in: ids } } })
    ]);

    console.log(
      `🧹 [DatabaseService] Removed ${ids.length} orphaned empire(s) with no matching account.`
    );
  }

  /**
   * Closes the Prisma connection so the process can exit cleanly.
   */
  public static async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }

  /**
   * Loads all saved resources from database. Returns empty array if none exist.
   */
  public static async loadResources() {
    await this.initialize();
    return await prisma.worldResourceNode.findMany();
  }

  /**
   * Clears all saved resource nodes (e.g. when regenerating for a larger map).
   */
  public static async clearAllResources() {
    await this.initialize();
    await prisma.worldResourceNode.deleteMany({});
  }

  /**
   * Persists all initial or updated resource nodes.
   */
  public static async saveAllResources(nodes: ResourceNodeState[]) {
    await this.initialize();
    if (nodes.length === 0) return;

    await prisma.$transaction(
      nodes.map((node) =>
        prisma.worldResourceNode.upsert({
          where: { id: node.id },
          create: {
            id: node.id,
            type: node.type,
            resourceType: node.resourceType,
            gridX: node.gridX,
            gridY: node.gridY,
            remainingAmount: node.remainingAmount,
            maxAmount: node.maxAmount
          },
          update: {
            remainingAmount: node.remainingAmount
          }
        })
      )
    );
  }

  /**
   * Loads an existing player and their empire (buildings & units) by account id.
   *
   * The account id, not the display name: a rename must not orphan an empire.
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
   * Loads all players, buildings, and units from the database on room bootstrap.
   */
  public static async loadAllWorldEntities() {
    await this.initialize();
    const players = await prisma.player.findMany({
      include: {
        buildings: true,
        units: true
      }
    });

    return players;
  }

  /**
   * Saves a single player's entire empire state (resources, buildings, units).
   *
   * `player.id` is the account id and the only ownership key: it is the primary
   * key of `Player` and the `ownerId` foreign key of every row synced below.
   * `player.name` is display text, so a rename just updates the column.
   */
  public static async savePlayerEmpire(
    player: PlayerState,
    buildings: BuildingState[],
    units: UnitState[]
  ) {
    await this.initialize();
    const ownerId = player.id;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Upsert player record
        await tx.player.upsert({
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
            isOnline: player.isOnline
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
            isOnline: player.isOnline
          }
        });

        // 2. Sync buildings: delete removed ones, upsert active ones
        const currentBuildingIds = buildings.map((b) => b.id);
        await tx.building.deleteMany({
          where: {
            ownerId,
            id: { notIn: currentBuildingIds }
          }
        });

        for (const b of buildings) {
          await tx.building.upsert({
            where: { id: b.id },
            create: {
              id: b.id,
              ownerId,
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

        // 3. Sync units: delete killed ones, upsert active ones
        const currentUnitIds = units.map((u) => u.id);
        await tx.unit.deleteMany({
          where: {
            ownerId,
            id: { notIn: currentUnitIds }
          }
        });

        for (const u of units) {
          await tx.unit.upsert({
            where: { id: u.id },
            create: {
              id: u.id,
              ownerId,
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
    } catch (err) {
      console.error(`❌ [DatabaseService] Failed to save empire for ${player.name} (${ownerId}):`, err);
    }
  }

  /**
   * Persists entire WorldState to SQLite (Auto-save snapshot).
   */
  public static async saveFullWorldState(state: WorldState) {
    if (this.isSaving) return;
    this.isSaving = true;

    try {
      await this.initialize();

      // One player entry per account, keyed by account id; entities are matched
      // against the same id, so no name lookup is needed here.
      for (const playerState of state.players.values()) {
        const ownedBuildings: BuildingState[] = [];
        state.buildings.forEach((b: BuildingState) => {
          if (b.ownerId === playerState.id) {
            ownedBuildings.push(b);
          }
        });

        const ownedUnits: UnitState[] = [];
        state.units.forEach((u: UnitState) => {
          if (u.ownerId === playerState.id) {
            ownedUnits.push(u);
          }
        });

        await this.savePlayerEmpire(playerState, ownedBuildings, ownedUnits);
      }

      // Sync active resources
      const activeResIds: string[] = [];
      const resList: ResourceNodeState[] = [];
      state.resourceNodes.forEach((res: ResourceNodeState) => {
        activeResIds.push(res.id);
        resList.push(res);
      });

      // Delete depleted resource nodes from DB
      await prisma.worldResourceNode.deleteMany({
        where: { id: { notIn: activeResIds } }
      });

      // Update remaining amounts
      for (const res of resList) {
        await prisma.worldResourceNode.updateMany({
          where: { id: res.id },
          data: { remainingAmount: res.remainingAmount }
        });
      }

      console.log(
        `💾 [DatabaseService] World state auto-saved at ${new Date().toLocaleTimeString()} (Players: ${state.players.size}, Buildings: ${state.buildings.size}, Units: ${state.units.size})`
      );
    } catch (err) {
      console.error('❌ [DatabaseService] World save failed:', err);
    } finally {
      this.isSaving = false;
    }
  }
}

/**
 * SQLite DDL mirroring `prisma/schema.prisma`.
 *
 * The server creates the database file and its tables on boot when they are
 * missing, so a fresh clone (or a deleted `database/` folder) works without
 * requiring the Prisma CLI. Every statement is idempotent.
 *
 * Table and column names are snake_case, matching each model's `@@map` and each
 * field's `@map` in `prisma/schema.prisma`. Index names follow Prisma's
 * generated convention over the mapped names (`<table>_<column>_key` for a
 * unique constraint, `<table>_<columns>_idx` for `@@index`), so `prisma db push`
 * and this boot DDL describe the same database.
 */
export const DATABASE_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "display_name_key" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE TABLE IF NOT EXISTS "players" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "wood" REAL NOT NULL DEFAULT 300,
    "food" REAL NOT NULL DEFAULT 300,
    "gold" REAL NOT NULL DEFAULT 150,
    "stone" REAL NOT NULL DEFAULT 100,
    "population" INTEGER NOT NULL DEFAULT 0,
    "population_cap" INTEGER NOT NULL DEFAULT 10,
    "unit_levels" TEXT NOT NULL DEFAULT '1,1,1,1',
    "research_unit_type" TEXT NOT NULL DEFAULT '',
    "research_progress_ms" REAL NOT NULL DEFAULT 0,
    "research_time_ms" REAL NOT NULL DEFAULT 0,
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "shield_until" REAL NOT NULL DEFAULT 0,
    "town_center_level" INTEGER NOT NULL DEFAULT 1,
    "last_zone" TEXT NOT NULL DEFAULT 'kingdom',
    "last_saved_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  `CREATE TABLE IF NOT EXISTS "buildings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'world',
    "type" TEXT NOT NULL,
    "grid_x" INTEGER NOT NULL,
    "grid_y" INTEGER NOT NULL,
    "size_x" INTEGER NOT NULL,
    "size_y" INTEGER NOT NULL,
    "hp" REAL NOT NULL,
    "max_hp" REAL NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "upgrade_progress_ms" REAL NOT NULL DEFAULT 0,
    "upgrade_time_ms" REAL NOT NULL DEFAULT 0,
    "is_constructed" BOOLEAN NOT NULL DEFAULT true,
    "construction_progress" REAL NOT NULL DEFAULT 100,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "buildings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "players" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`,

  `CREATE TABLE IF NOT EXISTS "units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'world',
    "type" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "speed" REAL NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "hp" REAL NOT NULL,
    "max_hp" REAL NOT NULL,
    "action_state" TEXT NOT NULL DEFAULT 'IDLE',
    "on_wall" BOOLEAN NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "units_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "players" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`,

  // The identity is (zone, id): every kingdom has its own road tile at (20,20),
  // so a globally unique "gx,gy" would collide across zones.
  `CREATE TABLE IF NOT EXISTS "world_roads" (
    "id" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'world',
    "owner_id" TEXT NOT NULL,
    "grid_x" INTEGER NOT NULL,
    "grid_y" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("zone", "id")
  );`,

  `CREATE TABLE IF NOT EXISTS "world_resource_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zone" TEXT NOT NULL DEFAULT 'world',
    "type" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "grid_x" INTEGER NOT NULL,
    "grid_y" INTEGER NOT NULL,
    "remaining_amount" REAL NOT NULL,
    "max_amount" REAL NOT NULL,
    "respawn_at" REAL NULL,
    "updated_at" DATETIME NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS "travel_transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "from_zone" TEXT NOT NULL,
    "to_zone" TEXT NOT NULL,
    "source_session_id" TEXT NOT NULL,
    "units" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,

  // One row per destructive data migration that must run exactly once. Boot DDL
  // cannot tell "never migrated" from "already migrated", so the migration
  // itself records completion here.
  `CREATE TABLE IF NOT EXISTS "schema_meta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
  );`,

  // Phase 23: raids. The partial unique index below is what stops two empires
  // from raiding the same defender at the same time.
  `CREATE TABLE IF NOT EXISTS "raids" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attacker_id" TEXT NOT NULL,
    "defender_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "units" TEXT NOT NULL,
    "loot" TEXT NOT NULL DEFAULT '{}',
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" DATETIME NULL
  );`,

  `CREATE TABLE IF NOT EXISTS "raid_locks" (
    "attacker_id" TEXT NOT NULL,
    "defender_id" TEXT NOT NULL,
    "unlock_at" REAL NOT NULL,
    PRIMARY KEY ("attacker_id", "defender_id")
  );`
];

export const DATABASE_INDEX_STATEMENTS: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_display_name_key_key" ON "users"("display_name_key");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "players_name_key" ON "players"("name");`,
  `CREATE INDEX IF NOT EXISTS "buildings_owner_id_idx" ON "buildings"("owner_id");`,
  `CREATE INDEX IF NOT EXISTS "units_owner_id_idx" ON "units"("owner_id");`,
  `CREATE INDEX IF NOT EXISTS "world_resource_nodes_grid_x_grid_y_idx" ON "world_resource_nodes"("grid_x", "grid_y");`,
  `CREATE INDEX IF NOT EXISTS "world_roads_zone_idx" ON "world_roads"("zone");`,
  `CREATE INDEX IF NOT EXISTS "travel_transfers_owner_id_to_zone_idx" ON "travel_transfers"("owner_id", "to_zone");`,
  // Phase 23: one live raid per defender. A partial index is the only reliable
  // guard: two concurrent `/raid/start` calls must not both insert.
  `CREATE UNIQUE INDEX IF NOT EXISTS "raids_one_active_per_defender" ON "raids"("defender_id") WHERE "status" = 'ACTIVE';`,
  `CREATE INDEX IF NOT EXISTS "raids_pair_idx" ON "raids"("attacker_id", "defender_id", "status");`
];

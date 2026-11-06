import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * `world_roads` originally keyed on `id` alone. Two kingdoms both own a tile at
 * (20,20), so that shape cannot hold both and every save from the second kingdom
 * failed with a unique constraint. The boot migration rebuilds the table with
 * (zone, id) as the primary key; these tests pin both the rebuild and the data
 * that must survive it.
 */
const dbFile = path.join(os.tmpdir(), `cq-roadmig-${process.pid}-${Date.now()}.db`);
let prisma: any;
let DatabaseService: any;

beforeAll(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbFile + suffix, { force: true });
  }
  // Pre-create the *old* shape with one row, the way a deployed database looks.
  execFileSync('sqlite3', [
    dbFile,
    `CREATE TABLE "world_roads" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "zone" TEXT NOT NULL DEFAULT 'world',
       "owner_id" TEXT NOT NULL,
       "grid_x" INTEGER NOT NULL,
       "grid_y" INTEGER NOT NULL,
       "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );
     CREATE INDEX "world_roads_zone_idx" ON "world_roads"("zone");
     INSERT INTO "world_roads" VALUES ('20,20','kingdom:a','a',20,20,CURRENT_TIMESTAMP);`
  ]);

  process.env.DATABASE_FILE = dbFile;
  const mod = await import('./DatabaseService.js');
  DatabaseService = mod.DatabaseService;
  prisma = mod.prisma;
  await DatabaseService.initialize();
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + suffix, { force: true });
    } catch {
      /* temp cleanup only */
    }
  }
  delete process.env.DATABASE_FILE;
});

describe('world_roads migration', () => {
  it('M1 keeps the rows painted under the old primary key', async () => {
    const rows = await prisma.worldRoad.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: '20,20', zone: 'kingdom:a', ownerId: 'a' });
  });

  it('M2 lets two kingdoms own the same tile coordinate', async () => {
    await expect(
      prisma.worldRoad.create({
        data: { id: '20,20', zone: 'kingdom:b', ownerId: 'b', gridX: 20, gridY: 20 }
      })
    ).resolves.toBeTruthy();
    expect(await prisma.worldRoad.count()).toBe(2);
  });

  it('M3 restores the zone index that the rebuild dropped', async () => {
    const indexes = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'world_roads'`
    );
    expect((indexes as Array<{ name: string }>).map((row) => row.name)).toContain(
      'world_roads_zone_idx'
    );
  });

  it('M4 is idempotent on an already-migrated database', async () => {
    await expect(DatabaseService.initialize()).resolves.toBeUndefined();
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("world_roads")`);
    // `PRAGMA table_info` lists columns in declaration order, so the key
    // positions have to be sorted before they can be compared.
    const keyed = (columns as Array<{ name: string; pk: number | bigint }>)
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((column) => column.name);
    expect(keyed).toEqual(['zone', 'id']);
    expect(await prisma.worldRoad.count()).toBe(2);
  });
});

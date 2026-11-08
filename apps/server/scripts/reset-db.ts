/**
 * Drops every table so `DatabaseService.initialize()` recreates the schema from
 * scratch on the next boot. Used instead of deleting `dev.db`, which another
 * process on this machine keeps open.
 *
 * The table list is read from `sqlite_master` rather than hardcoded: the schema
 * gains tables over time (raids, roads, travel transfers) and a stale list would
 * silently leave orphaned rows behind after a "reset".
 */
import { prisma } from '../src/services/DatabaseService.js';

const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
  `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name <> '_prisma_migrations'
     ORDER BY name;`
);

for (const { name } of tables) {
  // Identifiers come from the database itself, not user input; double quotes are
  // still escaped so an oddly named table cannot break out of the statement.
  const identifier = `"${name.replace(/"/g, '""')}"`;
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${identifier};`);
  console.log(`dropped ${name}`);
}

await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
const left = await prisma.$queryRawUnsafe(
  `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
);
console.log('remaining tables:', left);
await prisma.$disconnect();

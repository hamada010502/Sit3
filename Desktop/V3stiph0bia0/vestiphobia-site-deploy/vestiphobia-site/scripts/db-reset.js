/**
 * Destroy the local SQLite database and rebuild it from migrations + seed.
 *
 *   npm run db:reset
 *
 * This refuses to run against Postgres. Dropping a production database because
 * someone typed a local development command is not a mistake worth leaving
 * available.
 */

import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { migrate, seed } from '../server/db/migrate.js';
import { closeDb } from '../server/db/index.js';

if (process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is set, which means this would target a real Postgres database.\n' +
      'db:reset only ever operates on the local SQLite file. Nothing was touched.'
  );
  process.exit(1);
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const file =
  process.env.SQLITE_PATH || join(HERE, '..', 'data', 'vestiphobia.db');

for (const path of [file, `${file}-wal`, `${file}-shm`]) {
  if (existsSync(path)) {
    rmSync(path);
    console.log(`  removed ${path}`);
  }
}

await migrate();
await seed();
await closeDb();
console.log('[db] reset complete');

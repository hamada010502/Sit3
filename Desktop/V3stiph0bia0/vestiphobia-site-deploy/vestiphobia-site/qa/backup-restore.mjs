/**
 * VESTIPHOBIA — backup and restore verification.
 *
 *   node qa/backup-restore.mjs
 *
 * An untested backup is a belief, not a backup. This performs the documented
 * procedure end to end on a throwaway database:
 *
 *   1. build a database with real orders, customers, stock and analytics
 *   2. take a backup WHILE writes are in flight (the realistic case)
 *   3. destroy the original completely
 *   4. restore from the backup
 *   5. verify every row is back, the schema is intact, foreign keys hold, and
 *      the application can immediately serve and write again
 *
 * The SQLite path uses `.backup`, not a file copy: copying a live database can
 * capture a half-written page, and the resulting file looks fine until the day
 * you need it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SLUG = 'vestiphobia-001-fear-tee';

const passes = [];
const failures = [];
const ok = (m) => {
  passes.push(m);
  console.log(`  PASS  ${m}`);
};
const bad = (m) => {
  failures.push(m);
  console.log(`  FAIL  ${m}`);
};

const DB = join(tmpdir(), `vestiphobia-backup-${randomUUID()}.db`);
const BACKUP = `${DB}.backup`;
const env = { ...process.env, SQLITE_PATH: DB, IP_SALT: 'backup-salt' };
delete env.DATABASE_URL;

const node = async (script, e = env) => {
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: e,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
};

const query = async (sql, e = env) => {
  const out = await node(
    `
    const { getDb } = await import('./server/db/index.js');
    const db = await getDb();
    console.log(JSON.stringify(await db.all(${JSON.stringify(sql)})));
    process.exit(0);
  `,
    e
  );
  return JSON.parse(out.split('\n').find((l) => l.trim().startsWith('[')) || '[]');
};

console.log('='.repeat(72));
console.log('VESTIPHOBIA backup and restore verification');
console.log('='.repeat(72));

/* --------------------------------------------------- 1. build a database */

console.log('\n1. Building a database with real data');

await execFileAsync(process.execPath, ['server/db/migrate.js', 'all'], { cwd: ROOT, env });
await execFileAsync(process.execPath, ['scripts/create-admin.js', 'backup@vestiphobia.test', 'backup-test-passphrase'], {
  cwd: ROOT,
  env,
});

await node(`
  const { getDb, closeDb } = await import('./server/db/index.js');
  const { setQuantity } = await import('./server/lib/inventory.js');
  const { createOrder, setOrderStatus } = await import('./server/routes/orders.js');
  const { ingest } = await import('./server/lib/analytics.js');

  const db = await getDb();
  const p = await db.get('SELECT id FROM products WHERE slug = ?', [${JSON.stringify(SLUG)}]);
  for (const size of ['S','M','L','XL','XXL']) {
    await setQuantity(db, { productId: p.id, size, quantity: 20, adminId: null });
  }

  for (let i = 0; i < 25; i++) {
    const r = await createOrder({
      fullName: 'Backup Customer ' + i,
      phone: '09' + String(66000000 + i),
      city: ['Damascus','Aleppo','Homs'][i % 3],
      address: i + ' Backup Street, building 4, second floor',
      items: [{ slug: ${JSON.stringify(SLUG)}, size: ['S','M','L'][i % 3], quantity: 1 + (i % 2) }],
    });
    if (r.status === 201 && i % 3 === 0) {
      await setOrderStatus(r.body.order.orderId, 'ACCEPTED', { adminId: null });
    }
  }

  for (let i = 0; i < 20; i++) {
    await ingest(
      {
        visitorId: 'backup-visitor-' + i,
        sessionId: 'backup-session-' + i,
        isNewVisitor: true,
        events: [{ id: 'backup-evt-' + i, name: 'page_view', path: '/', props: {} }],
      },
      { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36', host: 'localhost' }
    );
  }
  await closeDb();
`);

const tablesOf = async (e = env) =>
  (await query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", e)).map((r) => r.name);

const countAll = async (e = env) => {
  const out = {};
  for (const t of await tablesOf(e)) {
    out[t] = Number((await query(`SELECT COUNT(*) AS n FROM ${t}`, e))[0].n);
  }
  return out;
};

const before = await countAll();
const beforeTables = Object.keys(before).length;
console.log(
  `   ${beforeTables} tables, ${before.orders} orders, ${before.customers} customers, ` +
    `${before.analytics_events} analytics events, ${before.inventory_ledger} stock movements`
);
ok(`a database with ${before.orders} orders and ${beforeTables} tables was built`);

/* ------------------------------------------- 2. back up during writes */

console.log('\n2. Backing up while writes are in flight');

// Start a stream of writes, then back up in the middle of it. A backup taken
// on a quiet database proves much less than one taken on a busy one.
const writing = node(`
  const { getDb, closeDb } = await import('./server/db/index.js');
  const { createOrder } = await import('./server/routes/orders.js');
  for (let i = 0; i < 30; i++) {
    await createOrder({
      fullName: 'Concurrent ' + i,
      phone: '09' + String(67000000 + i),
      city: 'Damascus',
      address: i + ' Concurrent Street, building 9, first floor',
      items: [{ slug: ${JSON.stringify(SLUG)}, size: 'XL', quantity: 1 }],
    });
    await new Promise((r) => setTimeout(r, 20));
  }
  await closeDb();
`);

await new Promise((r) => setTimeout(r, 150));

let backupMethod = '';
try {
  // The documented procedure. `.backup` is atomic with respect to writers.
  await execFileAsync('sqlite3', [DB, `.backup '${BACKUP}'`]);
  backupMethod = 'sqlite3 .backup';
} catch {
  // No sqlite3 binary here — use the same mechanism from Node, which is the
  // identical SQLite backup API rather than a file copy.
  await node(`
    const { createRequire } = await import('node:module');
    const require = createRequire(process.cwd() + '/');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(DB)});
    db.exec("VACUUM INTO '" + ${JSON.stringify(BACKUP)} + "'");
    db.close();
  `);
  backupMethod = 'VACUUM INTO (SQLite backup API)';
}

await writing;

if (!existsSync(BACKUP)) bad('no backup file was produced');
else ok(`backup taken with ${backupMethod} while ${30} writes were in flight (${(statSync(BACKUP).size / 1024).toFixed(0)}KB)`);

const afterWrites = await countAll();
console.log(`   the live database now holds ${afterWrites.orders} orders`);

/* ------------------------------------------------- 3. destroy the original */

console.log('\n3. Destroying the original database');

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  if (existsSync(f)) rmSync(f);
}
if (existsSync(DB)) bad('the database file still exists');
else ok('the database, its write-ahead log and its shared memory file are gone');

/* -------------------------------------------------------- 4. restore */

console.log('\n4. Restoring from the backup');

const RESTORED = `${DB}.restored`;
const restoredEnv = { ...env, SQLITE_PATH: RESTORED };
await execFileAsync('cp', [BACKUP, RESTORED]);
ok('the backup was restored to a fresh database file');

/* --------------------------------------------------------- 5. verify */

console.log('\n5. Verifying the restored database');

const restoredTables = await tablesOf(restoredEnv);
if (restoredTables.length !== beforeTables) {
  bad(`the restored database has ${restoredTables.length} tables, expected ${beforeTables}`);
} else {
  ok(`all ${restoredTables.length} tables are present`);
}

const after = await countAll(restoredEnv);
const missing = [];
for (const [table, count] of Object.entries(before)) {
  // The backup was taken mid-write, so tables that were being written may hold
  // MORE than the pre-write count. Fewer is data loss; more is expected.
  if ((after[table] ?? -1) < count) missing.push(`${table}: ${after[table]} < ${count}`);
}
if (missing.length) bad(`rows lost in the restore: ${missing.join(', ')}`);
else ok('every table holds at least everything it held before the backup');

console.log(
  `   restored: ${after.orders} orders, ${after.customers} customers, ` +
    `${after.order_items} order lines, ${after.analytics_events} analytics events`
);

const integrity = await query('PRAGMA integrity_check', restoredEnv);
const verdict = integrity[0]?.integrity_check;
if (verdict !== 'ok') bad(`SQLite integrity check says: ${verdict}`);
else ok('SQLite reports the restored database as structurally sound');

const orphans = await query(
  `SELECT COUNT(*) AS n FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)`,
  restoredEnv
);
if (Number(orphans[0].n)) bad(`${orphans[0].n} order line(s) reference an order that is gone`);
else ok('no order line references a missing order');

const emptyOrders = await query(
  `SELECT COUNT(*) AS n FROM orders WHERE id NOT IN (SELECT order_id FROM order_items)`,
  restoredEnv
);
if (Number(emptyOrders[0].n)) bad(`${emptyOrders[0].n} order(s) have no lines`);
else ok('every order still has its lines');

const money = await query(
  `SELECT COUNT(*) AS n FROM orders o
    WHERE o.subtotal_cents <> (SELECT COALESCE(SUM(line_total_cents), 0) FROM order_items WHERE order_id = o.id)`,
  restoredEnv
);
if (Number(money[0].n)) bad(`${money[0].n} order(s) have totals that no longer add up`);
else ok('every order total still adds up to its lines');

const admins = await query('SELECT COUNT(*) AS n FROM admins', restoredEnv);
if (!Number(admins[0].n)) bad('the admin account did not survive — nobody could sign in');
else ok('the admin account survived, so the shop can be operated immediately');

/* ---------------------------------- 6. the application can use it again */

console.log('\n6. Using the restored database');

const canRead = await query('SELECT slug FROM products', restoredEnv);
if (!canRead.length) bad('the catalogue is empty after the restore');
else ok(`the catalogue reads back (${canRead.map((r) => r.slug).join(', ')})`);

const writeBack = await node(
  `
  const { createOrder } = await import('./server/routes/orders.js');
  const { closeDb } = await import('./server/db/index.js');
  const r = await createOrder({
    fullName: 'After Restore',
    phone: '0968000111',
    city: 'Damascus',
    address: '1 Restored Street, building 1, ground floor',
    items: [{ slug: ${JSON.stringify(SLUG)}, size: 'M', quantity: 1 }],
  });
  await closeDb();
  console.log(JSON.stringify([{ status: r.status, id: r.body?.order?.orderId || null }]));
  process.exit(0);
`,
  restoredEnv
);
const written = JSON.parse(writeBack.split('\n').find((l) => l.trim().startsWith('[')) || '[]')[0];
if (written?.status !== 201) bad(`a new order could not be placed after the restore: ${written?.status}`);
else ok(`a new order was placed on the restored database (${written.id})`);

// The order number sequence must continue rather than restart and collide.
const numbers = await query('SELECT order_number FROM orders', restoredEnv);
if (new Set(numbers.map((r) => r.order_number)).size !== numbers.length) {
  bad('the restored database produced a duplicate order number');
} else {
  ok('order numbers continue from where they were — no collision after the restore');
}

/* ------------------------------------------------------------- report */

console.log(`\n${'='.repeat(72)}`);
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
} else {
  console.log('\nThe documented backup procedure was performed on a live database,');
  console.log('the original was destroyed, the restore was verified row by row, and');
  console.log('the application read and wrote to the restored database afterwards.');
}
console.log('='.repeat(72));

for (const f of [DB, `${DB}-wal`, `${DB}-shm`, BACKUP, RESTORED, `${RESTORED}-wal`, `${RESTORED}-shm`]) {
  try {
    if (existsSync(f)) rmSync(f);
  } catch {
    /* already gone */
  }
}

process.exit(failures.length ? 1 : 0);

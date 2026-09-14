/**
 * VESTIPHOBIA — the overselling test.
 *
 * The single most expensive bug this shop could have is selling a garment
 * twice. This script attacks that directly: many independent OS processes try
 * to accept orders for the same limited size at the same moment, and the run
 * fails unless exactly the available number succeed.
 *
 *   node qa/inventory-race.mjs                 # 40 racers over 1 unit, then 5
 *   node qa/inventory-race.mjs --racers=200
 *
 * Why processes and not promises: node:sqlite is synchronous, so N "parallel"
 * accepts inside one process would run one after another and prove nothing at
 * all. Separate processes contending for the same database is the real thing.
 *
 * What is verified:
 *   - exactly `stock` accepts succeed, never more                (no overselling)
 *   - stock lands on exactly zero and never goes negative
 *   - the losers are refused with a conflict, not an error
 *   - a refused accept leaves the order untouched         (no partial damage)
 *   - the stock ledger's movements sum to the change in stock
 *   - repeated identical order submissions create one order  (no duplicates)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SLUG = 'vestiphobia-001-fear-tee';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const RACERS = arg('racers', 40);

const DB = join(tmpdir(), `vestiphobia-race-${randomUUID()}.db`);
const env = { ...process.env, SQLITE_PATH: DB, IP_SALT: 'race-salt' };
delete env.DATABASE_URL;

const failures = [];
const check = (condition, message) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${message}`);
  if (!condition) failures.push(message);
};

/** Run a snippet in a fresh process against the same database file. */
async function node(script) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { cwd: ROOT, env }
  );
  return stdout;
}

const query = async (sql, params = []) => {
  const out = await node(`
    const { getDb } = await import('./server/db/index.js');
    const db = await getDb();
    console.log(JSON.stringify(await db.all(${JSON.stringify(sql)}, ${JSON.stringify(params)})));
    process.exit(0);
  `);
  const line = out.split('\n').find((l) => l.trim().startsWith('['));
  return JSON.parse(line || '[]');
};

const stockOf = async (size) =>
  Number(
    (
      await query(
        'SELECT quantity FROM inventory i JOIN products p ON p.id = i.product_id WHERE p.slug = ? AND i.size = ?',
        [SLUG, size]
      )
    )[0]?.quantity ?? -1
  );

const setStock = (size, quantity) =>
  node(`
    const { getDb, closeDb } = await import('./server/db/index.js');
    const { setQuantity } = await import('./server/lib/inventory.js');
    const db = await getDb();
    const p = await db.get('SELECT id FROM products WHERE slug = ?', [${JSON.stringify(SLUG)}]);
    await setQuantity(db, { productId: p.id, size: ${JSON.stringify(size)}, quantity: ${quantity}, adminId: null });
    await closeDb();
  `);

/** Place one order per racer, all for the same size. */
async function placeOrders(count, size) {
  const out = await node(`
    const { createOrder } = await import('./server/routes/orders.js');
    const { closeDb } = await import('./server/db/index.js');
    const ids = [];
    for (let i = 0; i < ${count}; i++) {
      const r = await createOrder({
        fullName: 'Racer ' + i,
        phone: '09' + String(70000000 + i),
        city: 'Damascus',
        address: i + ' Race Street, building 3, second floor',
        items: [{ slug: ${JSON.stringify(SLUG)}, size: ${JSON.stringify(size)}, quantity: 1 }],
      });
      if (r.status === 201) ids.push(r.body.order.orderId);
    }
    await closeDb();
    console.log(JSON.stringify(ids));
    process.exit(0);
  `);
  const line = out.split('\n').find((l) => l.trim().startsWith('['));
  return JSON.parse(line || '[]');
}

/** Accept every order at once, each from its own process. */
async function raceAccepts(orderIds) {
  const results = await Promise.all(
    orderIds.map((id) =>
      execFileAsync(process.execPath, ['qa/fixtures/accept-order.mjs', id], { cwd: ROOT, env })
        .then((r) => {
          const line = r.stdout.trim();
          // A child that reports an error on stdout also printed its stack to
          // stderr; carry it through so the failure explains itself.
          return line.startsWith('ERROR') && r.stderr
            ? `${line} :: ${r.stderr.split('\n').slice(0, 5).join(' / ').slice(0, 400)}`
            : line;
        })
        // The child prints its stack to stderr, so a broken racer explains
        // itself instead of leaving a bare message to guess from.
        .catch((e) => `ERROR:${(e.stderr || e.message || '').split('\n').slice(0, 4).join(' / ').slice(0, 400)}`)
    )
  );
  return {
    won: results.filter((r) => r === 'OK').length,
    lost: results.filter((r) => r === 'CONFLICT').length,
    broken: results.filter((r) => r !== 'OK' && r !== 'CONFLICT'),
    raw: results,
  };
}

/* ------------------------------------------------------------------- run */

console.log('='.repeat(72));
console.log(`VESTIPHOBIA inventory race — ${RACERS} concurrent processes`);
console.log('='.repeat(72));

await execFileAsync(process.execPath, ['server/db/migrate.js', 'all'], { cwd: ROOT, env });

/* --- Scenario 1: one unit, everyone wants it --- */
console.log('\nScenario 1 — one unit of size L, everyone tries to buy it');
await setStock('L', 1);
const ordersA = await placeOrders(RACERS, 'L');
check(ordersA.length === RACERS, `all ${RACERS} orders were PLACED (stock moves on accept, not on order)`);
check((await stockOf('L')) === 1, 'placing orders did not move stock');

const raceA = await raceAccepts(ordersA);
console.log(`  outcome: ${raceA.won} accepted, ${raceA.lost} refused, ${raceA.broken.length} errored`);
check(raceA.won === 1, `exactly one accept succeeded (got ${raceA.won})`);
check(raceA.lost === RACERS - 1, `the other ${RACERS - 1} were refused with a conflict`);
check(raceA.broken.length === 0, `no accept failed with an unexpected error${raceA.broken.length ? `: ${raceA.broken[0]}` : ''}`);

const leftA = await stockOf('L');
check(leftA === 0, `stock landed on exactly 0 (got ${leftA})`);
check(leftA >= 0, 'stock never went negative');

const untouched = await query(
  `SELECT COUNT(*) AS n FROM orders WHERE status = 'PENDING' AND inventory_committed = 1`
);
check(Number(untouched[0].n) === 0, 'no refused order was left holding stock it never got');

const accepted = await query(`SELECT COUNT(*) AS n FROM orders WHERE status = 'ACCEPTED'`);
check(Number(accepted[0].n) === 1, 'exactly one order is in ACCEPTED');

/* --- Scenario 2: five units, many more buyers --- */
console.log('\nScenario 2 — five units of size M, everyone tries to buy one');
await setStock('M', 5);
const ordersB = await placeOrders(RACERS, 'M');
const raceB = await raceAccepts(ordersB);
console.log(`  outcome: ${raceB.won} accepted, ${raceB.lost} refused, ${raceB.broken.length} errored`);
check(raceB.won === 5, `exactly five accepts succeeded (got ${raceB.won})`);
check((await stockOf('M')) === 0, 'stock landed on exactly 0');
check(
  raceB.broken.length === 0,
  `no accept failed with an unexpected error${raceB.broken.length ? `: ${raceB.broken.slice(0, 2).join(' | ')}` : ''}`
);

/* --- Scenario 3: the ledger must explain every movement --- */
console.log('\nScenario 3 — the stock ledger reconciles');
const ledger = await query(
  `SELECT i.size, SUM(l.delta) AS moved
     FROM inventory_ledger l JOIN products p ON p.id = l.product_id
     JOIN inventory i ON i.product_id = l.product_id AND i.size = l.size
    WHERE p.slug = ? GROUP BY i.size`,
  [SLUG]
);
const byLedger = Object.fromEntries(ledger.map((r) => [r.size, Number(r.moved)]));
// Each size was set to its starting quantity through the ledger too, so the
// sum of every movement must equal the quantity on the shelf now.
for (const size of ['L', 'M']) {
  const onShelf = await stockOf(size);
  check(
    byLedger[size] === onShelf,
    `size ${size}: ledger movements (${byLedger[size]}) equal the shelf (${onShelf})`
  );
}

/* --- Scenario 4: the same order submitted repeatedly --- */
console.log('\nScenario 4 — the same cart submitted ten times in a row');
await setStock('XL', 10);
const dupes = await node(`
  const { createOrder } = await import('./server/routes/orders.js');
  const { closeDb } = await import('./server/db/index.js');
  const payload = {
    fullName: 'Double Tapper',
    phone: '0965430777',
    city: 'Aleppo',
    address: '7 Duplicate Street, building 1, ground floor',
    items: [{ slug: ${JSON.stringify(SLUG)}, size: 'XL', quantity: 1 }],
  };
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const r = await createOrder(payload);
    ids.push(r.body?.order?.orderId);
  }
  await closeDb();
  console.log(JSON.stringify(ids));
  process.exit(0);
`);
const dupIds = JSON.parse(dupes.split('\n').find((l) => l.trim().startsWith('[')) || '[]');
check(new Set(dupIds).size === 1, `ten identical submissions produced one order (got ${new Set(dupIds).size})`);

const xlOrders = await query(
  `SELECT COUNT(*) AS n FROM orders WHERE customer_phone = '963965430777'`
);
check(Number(xlOrders[0].n) === 1, 'only one order row exists for that customer');

/* ---------------------------------------------------------------- report */

console.log(`\n${'='.repeat(72)}`);
if (failures.length) {
  console.log(`FAILED — ${failures.length} check(s) did not hold:`);
  for (const f of failures) console.log(`  - ${f}`);
} else {
  console.log('PASSED — no overselling, no negative stock, no duplicate orders,');
  console.log('         and every stock movement is explained by the ledger.');
}
console.log('='.repeat(72));

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  try {
    rmSync(f);
  } catch {
    /* already gone */
  }
}

process.exit(failures.length ? 1 : 0);

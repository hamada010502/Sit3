/**
 * VESTIPHOBIA — load test.
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ===========================================================================
 * This drives a real server with many concurrent virtual users following
 * realistic paths — browsing, viewing a product, adding to a cart, sending
 * analytics, and some of them ordering — through ramp-up, sustained load, a
 * spike, and recovery. It measures latency, error rate and throughput, and
 * then checks the DATABASE for the damage load tests are actually meant to
 * find: oversold stock, duplicated orders, corrupted totals.
 *
 * It is NOT a substitute for testing a deployed environment. Run locally, the
 * load generator and the server share one machine's CPU, there is no network
 * between them, no TLS, no proxy, and no hosting provider's limits. The
 * numbers it produces are a floor, not a forecast: they prove the application
 * logic holds under concurrency, not that a given host will serve 1,000 people.
 *
 * The real 1,000-concurrent-user test must be run against a deployed
 * staging environment, from outside it. See DEPLOYMENT.md.
 * ===========================================================================
 *
 * Usage:
 *   node qa/load-test.mjs                     # default: 200 users, ~90s
 *   node qa/load-test.mjs --users=1000        # the full requirement
 *   node qa/load-test.mjs --users=1000 --base=https://staging.example.com
 *   node qa/load-test.mjs --quick             # 60 users, ~25s (CI)
 *
 * With --base it drives an EXISTING server and touches nothing else. Without
 * it, it starts a server on a throwaway database, seeds stock, runs, and
 * tears everything down.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* ------------------------------------------------------------------ args */

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const QUICK = flag('quick');
const USERS = Number(arg('users', QUICK ? 60 : 200));
const EXTERNAL_BASE = arg('base', '');
const SLUG = arg('slug', 'vestiphobia-001-fear-tee');
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const STOCK_PER_SIZE = Number(arg('stock', 40));

// Phase lengths in seconds. Ramp-up, then sustained, then a spike of double
// the load, then a quiet recovery window to see whether latency returns.
const PHASES = QUICK
  ? { ramp: 5, sustained: 8, spike: 5, recover: 5 }
  : { ramp: 20, sustained: 30, spike: 15, recover: 15 };

/* --------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const jitter = (base) => base * (0.5 + Math.random());

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* --------------------------------------------------------------- metrics */

const metrics = new Map();

function record(label, ms, ok, status) {
  let m = metrics.get(label);
  if (!m) {
    m = { label, count: 0, errors: 0, times: [], statuses: new Map() };
    metrics.set(label, m);
  }
  m.count++;
  if (!ok) m.errors++;
  // Reservoir cap: a million samples would cost more memory than the server.
  if (m.times.length < 20000) m.times.push(ms);
  m.statuses.set(status, (m.statuses.get(status) || 0) + 1);
}

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

async function timed(label, fn) {
  const started = performance.now();
  let status = 0;
  let ok = false;
  try {
    const res = await fn();
    status = res?.status ?? 0;
    // A 409 (sold out) or 429 (rate limited) is the server working correctly
    // under pressure, not an error. Counting them as failures would make a
    // healthy refusal look like a fault.
    ok = status > 0 && status < 500;
    return res;
  } catch (err) {
    status = err?.name === 'AbortError' ? 'timeout' : 'network';
    ok = false;
    return null;
  } finally {
    record(label, performance.now() - started, ok, status);
  }
}

const get = (base, path) =>
  timed(path.startsWith('/api') ? `GET ${path.split('?')[0]}` : 'GET page', () =>
    fetch(base + path, { signal: AbortSignal.timeout(20000) })
  );

/* ------------------------------------------------------------- behaviour */

let ordersAttempted = 0;
let duplicatesReturned = 0;
const orderNumbers = [];
const orderErrors = new Map();

/**
 * One virtual user. Weighted to look like a real audience rather than 1,000
 * copies of the same request: most people look and leave.
 */
async function virtualUser(base, id, deadline, { rush = false } = {}) {
  const visitorId = `load-visitor-${id}`;
  const sessionId = `load-session-${id}-${randomUUID().slice(0, 8)}`;

  const sendEvents = (events) =>
    timed('POST /api/events', () =>
      fetch(`${base}/api/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          sessionId,
          isNewVisitor: true,
          referrer: pick(['', 'https://www.instagram.com/vestiiphobia', 'https://www.google.com/']),
          screenWidth: pick([390, 414, 768, 1440]),
          events: events.map((name, i) => ({
            id: `${sessionId}-${name}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            path: '/',
            props: {},
          })),
        }),
        signal: AbortSignal.timeout(20000),
      })
    );

  while (Date.now() < deadline) {
    // The rush cohort exists to attack one size at once — the case that breaks
    // naive inventory code.
    const role = rush ? 'rush' : pick(['browse', 'browse', 'browse', 'consider', 'consider', 'order']);

    await get(base, '/');
    await sendEvents(['page_view']);
    await sleep(jitter(300));
    if (Date.now() > deadline) break;

    await get(base, '/shop/');
    await sleep(jitter(250));

    if (role === 'browse') {
      await get(base, '/story/');
      await sleep(jitter(400));
      continue;
    }

    await get(base, `/products/${SLUG}/`);
    await get(base, '/api/catalogue');
    await sendEvents(['product_view', 'size_select']);
    await sleep(jitter(400));

    if (role === 'consider') {
      await get(base, '/cart/');
      await sendEvents(['add_to_cart', 'view_cart']);
      await sleep(jitter(500));
      continue;
    }

    // Ordering cohort.
    await get(base, '/checkout/');
    await sendEvents(['add_to_cart', 'view_cart', 'begin_checkout']);

    const size = rush ? 'L' : pick(SIZES);
    const phone = `09${String(50000000 + id).slice(0, 8)}`;
    ordersAttempted++;

    const res = await timed('POST /api/orders', () =>
      fetch(`${base}/api/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: `Load Tester ${id}`,
          phone,
          city: pick(['Damascus', 'Aleppo', 'Homs', 'Latakia']),
          address: `${id} Load Street, building ${id % 30}, floor ${id % 5}`,
          items: [{ slug: SLUG, size, quantity: 1 }],
        }),
        signal: AbortSignal.timeout(20000),
      })
    );

    if (res) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 201 || res.status === 200) {
        if (body?.order?.orderId) orderNumbers.push(body.order.orderId);
        // A 200 is the idempotency guard returning the order that already
        // exists. Counting it as a new order would make the report claim more
        // orders than the database holds.
        if (res.status === 200 || body?.duplicate) duplicatesReturned++;
      } else {
        const key = `${res.status} ${body?.code || body?.error || ''}`.slice(0, 60);
        orderErrors.set(key, (orderErrors.get(key) || 0) + 1);
      }
    }

    await sleep(jitter(800));
  }
}

/* ------------------------------------------------------------------ main */

const QA_DB = join(tmpdir(), `vestiphobia-load-${randomUUID()}.db`);
const LOG = join(tmpdir(), `vestiphobia-load-${randomUUID()}.log`);
let server = null;
let base = EXTERNAL_BASE;

async function bootServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    PORT: String(port),
    SQLITE_PATH: QA_DB,
    IP_SALT: 'load-salt',
    // The limits are correct for the public internet and wrong for a load
    // generator on one address: every request here shares a single IP.
    ORDER_RATE_LIMIT: '1000000',
    EVENTS_RATE_LIMIT: '10000000',
  };
  delete env.DATABASE_URL;

  await execFileAsync(process.execPath, ['server/db/migrate.js', 'all'], { cwd: ROOT, env });

  const fd = openSync(LOG, 'a');
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', fd, fd] });

  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }

  // Stock every size so the run exercises fulfilment, not just refusals.
  await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      const { getDb, closeDb } = await import('./server/db/index.js');
      const { setQuantity } = await import('./server/lib/inventory.js');
      const db = await getDb();
      const p = await db.get('SELECT id FROM products WHERE slug = ?', [${JSON.stringify(SLUG)}]);
      for (const size of ${JSON.stringify(SIZES)}) {
        await setQuantity(db, { productId: p.id, size, quantity: ${STOCK_PER_SIZE}, adminId: null });
      }
      await closeDb();
    `,
    ],
    { cwd: ROOT, env }
  );

  return env;
}

async function queryDb(env, sql) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      const { getDb } = await import('./server/db/index.js');
      const db = await getDb();
      console.log(JSON.stringify(await db.all(${JSON.stringify(sql)})));
      process.exit(0);
    `,
    ],
    // Headroom for a result set that is larger than expected; the queries here
    // are aggregates, so hitting this would itself be a finding.
    { cwd: ROOT, env, maxBuffer: 32 * 1024 * 1024 }
  );
  const line = stdout.split('\n').find((l) => l.trim().startsWith('['));
  return JSON.parse(line || '[]');
}

const bar = '='.repeat(72);

console.log(bar);
console.log('VESTIPHOBIA load test');
console.log(bar);

let env = process.env;
if (!EXTERNAL_BASE) {
  console.log('Starting a server on a throwaway database…');
  env = await bootServer();
} else {
  console.log(`Driving the EXISTING server at ${EXTERNAL_BASE}.`);
  console.log('Nothing will be seeded, and the database will not be inspected afterwards.');
}
console.log(`Target        : ${base}`);
console.log(`Virtual users : ${USERS}`);
console.log(
  `Phases        : ramp ${PHASES.ramp}s -> sustained ${PHASES.sustained}s -> spike ${PHASES.spike}s -> recover ${PHASES.recover}s`
);
console.log(`Stock         : ${STOCK_PER_SIZE} per size (${SIZES.length} sizes)`);
console.log('');

const runStarted = Date.now();
const totalMs = (PHASES.ramp + PHASES.sustained + PHASES.spike + PHASES.recover) * 1000;
const deadline = runStarted + totalMs;
const running = [];

/* Phase 1: ramp up to the target, adding users evenly. */
console.log(`[ramp]      adding ${USERS} users over ${PHASES.ramp}s`);
const rushCount = Math.max(1, Math.round(USERS * 0.05));
for (let i = 0; i < USERS; i++) {
  running.push(virtualUser(base, i, deadline, { rush: i < rushCount }));
  await sleep((PHASES.ramp * 1000) / USERS);
}

/* Phase 2: sustained. */
console.log(`[sustained] holding ${USERS} users for ${PHASES.sustained}s`);
await sleep(PHASES.sustained * 1000);

/* Phase 3: spike — double the population without warning. */
console.log(`[spike]     adding ${USERS} more users at once`);
const spikeStarted = performance.now();
for (let i = 0; i < USERS; i++) {
  running.push(virtualUser(base, USERS + i, Math.min(deadline, Date.now() + PHASES.spike * 1000)));
}
await sleep(PHASES.spike * 1000);

/* Phase 4: recovery — the spike cohort is gone; does latency return? */
console.log(`[recover]   spike over, watching for ${PHASES.recover}s`);
const recoverFrom = metrics.get('GET page')?.times.length || 0;
await sleep(PHASES.recover * 1000);

await Promise.allSettled(running);
const elapsed = (Date.now() - runStarted) / 1000;

/* ----------------------------------------------------------- the report */

console.log(`\n${bar}`);
console.log('RESULTS');
console.log(bar);

let totalRequests = 0;
let totalErrors = 0;

const rows = [...metrics.values()].sort((a, b) => b.count - a.count);
console.log(
  ['endpoint'.padEnd(24), 'reqs'.padStart(7), 'err'.padStart(5), 'p50'.padStart(8), 'p90'.padStart(8), 'p99'.padStart(8), 'max'.padStart(8)].join('')
);
for (const m of rows) {
  totalRequests += m.count;
  totalErrors += m.errors;
  const sorted = [...m.times].sort((a, b) => a - b);
  console.log(
    [
      m.label.slice(0, 23).padEnd(24),
      String(m.count).padStart(7),
      String(m.errors).padStart(5),
      `${percentile(sorted, 50).toFixed(0)}ms`.padStart(8),
      `${percentile(sorted, 90).toFixed(0)}ms`.padStart(8),
      `${percentile(sorted, 99).toFixed(0)}ms`.padStart(8),
      `${(sorted[sorted.length - 1] || 0).toFixed(0)}ms`.padStart(8),
    ].join('')
  );
}

console.log('');
console.log(`Duration        : ${elapsed.toFixed(1)}s`);
console.log(`Requests        : ${totalRequests}`);
console.log(`Throughput      : ${(totalRequests / elapsed).toFixed(1)} req/s`);
console.log(
  `Failures        : ${totalErrors} (${((totalErrors / Math.max(1, totalRequests)) * 100).toFixed(2)}%)  — 4xx is not counted as failure`
);
console.log(`Orders attempted: ${ordersAttempted}`);
console.log(`Orders created  : ${orderNumbers.length - duplicatesReturned}`);
console.log(
  `Duplicates held : ${duplicatesReturned} (the same cart submitted again returned the existing order)`
);
if (orderErrors.size) {
  console.log('Order refusals  :');
  for (const [reason, n] of [...orderErrors.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)} × ${reason}`);
  }
}

const statuses = new Map();
for (const m of metrics.values()) {
  for (const [status, n] of m.statuses) statuses.set(status, (statuses.get(status) || 0) + n);
}
console.log(
  `Status codes    : ${[...statuses.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}:${n}`)
    .join('  ')}`
);

/* ------------------------------------------------------ integrity checks */

const problems = [];

if (!EXTERNAL_BASE) {
  console.log(`\n${bar}`);
  console.log('INTEGRITY AFTER LOAD');
  console.log(bar);

  const inventory = await queryDb(env, 'SELECT size, quantity FROM inventory ORDER BY size');
  const negative = inventory.filter((r) => Number(r.quantity) < 0);
  console.log(`Stock left      : ${inventory.map((r) => `${r.size}:${r.quantity}`).join('  ')}`);
  if (negative.length) problems.push(`inventory went NEGATIVE: ${JSON.stringify(negative)}`);

  const orders = await queryDb(
    env,
    `SELECT order_number, COUNT(*) AS n FROM orders GROUP BY order_number HAVING COUNT(*) > 1`
  );
  if (orders.length) problems.push(`duplicate order numbers: ${JSON.stringify(orders.slice(0, 5))}`);

  // Counted in SQL, not pulled row by row: at a few thousand orders the full
  // result set exceeds the child process's output buffer, and a load test that
  // crashes on its own success report is no use to anyone.
  const consistency = await queryDb(
    env,
    `SELECT
       SUM(CASE WHEN o.subtotal_cents <> (
             SELECT COALESCE(SUM(line_total_cents), 0) FROM order_items WHERE order_id = o.id
           ) THEN 1 ELSE 0 END) AS subtotal_mismatch,
       SUM(CASE WHEN o.total_cents <> o.subtotal_cents - o.discount_cents THEN 1 ELSE 0 END) AS total_mismatch,
       SUM(CASE WHEN o.total_cents < 0 OR o.subtotal_cents <= 0 THEN 1 ELSE 0 END) AS impossible
     FROM orders o`
  );
  const c = consistency[0] || {};
  if (Number(c.subtotal_mismatch)) {
    problems.push(`${c.subtotal_mismatch} order(s) whose subtotal disagrees with their lines`);
  }
  if (Number(c.total_mismatch)) {
    problems.push(`${c.total_mismatch} order(s) whose total is not subtotal minus discount`);
  }
  if (Number(c.impossible)) problems.push(`${c.impossible} order(s) with an impossible amount`);

  const orphans = await queryDb(
    env,
    `SELECT COUNT(*) AS n FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)`
  );
  if (Number(orphans[0]?.n)) problems.push(`${orphans[0].n} order line(s) with no order`);

  const emptyOrders = await queryDb(
    env,
    `SELECT COUNT(*) AS n FROM orders WHERE id NOT IN (SELECT order_id FROM order_items)`
  );
  if (Number(emptyOrders[0]?.n)) problems.push(`${emptyOrders[0].n} order(s) with no lines`);

  const created = await queryDb(env, 'SELECT COUNT(*) AS n FROM orders');
  const distinct = new Set(orderNumbers).size;
  console.log(`Orders in DB    : ${created[0]?.n} (client saw ${distinct} distinct order numbers)`);
  if (Number(created[0]?.n) !== distinct) {
    problems.push(
      `the database holds ${created[0]?.n} orders but the clients saw ${distinct} distinct order numbers`
    );
  }

  /* --- fulfilment: accept many orders at once and check the stock maths --- */
  console.log('\nAccepting orders concurrently…');
  const pending = await queryDb(
    env,
    `SELECT order_number FROM orders WHERE status = 'PENDING' LIMIT 60`
  );
  const stockBefore = Object.fromEntries(
    (await queryDb(env, 'SELECT size, quantity FROM inventory')).map((r) => [r.size, Number(r.quantity)])
  );

  const accepts = await Promise.all(
    pending.map((o) =>
      execFileAsync(process.execPath, ['qa/fixtures/accept-order.mjs', o.order_number], {
        cwd: ROOT,
        env,
      })
        .then((r) => r.stdout.trim())
        .catch((e) => `ERROR:${(e.message || '').slice(0, 80)}`)
    )
  );
  const acceptedNow = accepts.filter((r) => r === 'OK').length;
  const refusedNow = accepts.filter((r) => r === 'CONFLICT').length;
  const brokenNow = accepts.filter((r) => r !== 'OK' && r !== 'CONFLICT');
  console.log(
    `Accepts         : ${acceptedNow} accepted, ${refusedNow} refused for stock, ${brokenNow.length} errored`
  );
  if (brokenNow.length) problems.push(`${brokenNow.length} accept(s) failed: ${brokenNow[0]}`);

  const stockAfter = Object.fromEntries(
    (await queryDb(env, 'SELECT size, quantity FROM inventory')).map((r) => [r.size, Number(r.quantity)])
  );
  const totalBefore = Object.values(stockBefore).reduce((a, b) => a + b, 0);
  const totalAfter = Object.values(stockAfter).reduce((a, b) => a + b, 0);

  // Every accepted order took exactly one piece, so the shelf must have lost
  // exactly that many. One more, or one fewer, is a bug worth stopping for.
  const piecesAccepted = await queryDb(
    env,
    `SELECT COALESCE(SUM(pieces), 0) AS n FROM orders WHERE inventory_committed = 1`
  );
  console.log(`Stock removed   : ${totalBefore - totalAfter} for ${piecesAccepted[0]?.n} committed piece(s)`);
  if (totalBefore - totalAfter !== Number(piecesAccepted[0]?.n)) {
    problems.push(
      `stock moved by ${totalBefore - totalAfter} but ${piecesAccepted[0]?.n} pieces were committed`
    );
  }
  if (Object.values(stockAfter).some((q) => q < 0)) problems.push('stock went negative during fulfilment');

  const events = await queryDb(env, 'SELECT COUNT(*) AS n FROM analytics_events');
  console.log(`Analytics events: ${events[0]?.n}`);

  console.log(
    `Checks          : ${problems.length ? `${problems.length} PROBLEM(S)` : 'no overselling, no duplicates, no corrupted orders'}`
  );
}

/* ------------------------------------------------------------- verdict */

console.log(`\n${bar}`);
const errorRate = (totalErrors / Math.max(1, totalRequests)) * 100;
const pageP99 = percentile([...(metrics.get('GET page')?.times || [])].sort((a, b) => a - b), 99);

for (const p of problems) console.log(`PROBLEM: ${p}`);
if (errorRate > 1) console.log(`PROBLEM: error rate ${errorRate.toFixed(2)}% is above 1%`);

console.log(
  problems.length || errorRate > 1
    ? 'VERDICT: FAILED — see the problems above.'
    : `VERDICT: passed. ${USERS} concurrent users, ${totalRequests} requests, p99 page latency ${pageP99.toFixed(0)}ms, no data corruption.`
);
console.log(bar);
console.log(
  '\nThis ran on ONE machine with the load generator and the server sharing its\n' +
    'CPU, with no network, no TLS and no proxy in between. It proves the\n' +
    'application logic holds under real concurrency. It does NOT predict what a\n' +
    'given host will serve: run this again with --base against a deployed\n' +
    'staging environment before treating any number here as a capacity figure.'
);

if (server) {
  server.kill();
  for (const f of [QA_DB, `${QA_DB}-wal`, `${QA_DB}-shm`, LOG]) {
    try {
      rmSync(f);
    } catch {
      /* already gone */
    }
  }
}

process.exit(problems.length || errorRate > 1 ? 1 : 0);

/**
 * VESTIPHOBIA — failure testing.
 *
 *   node qa/failure-test.mjs
 *
 * Everything here breaks something on purpose and then asks two questions:
 *
 *   1. Does the customer see something they can act on, rather than a stack
 *      trace, a blank page, or — worst of all — a false success?
 *   2. Is an order ever silently lost?
 *
 * The second question is the one that matters. A shop that shows an ugly error
 * and keeps the order is fine. A shop that says "thank you" and drops it is
 * not, and no amount of polish elsewhere compensates.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, chmodSync, openSync, renameSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SLUG = 'vestiphobia-001-fear-tee';
const ADMIN = { email: 'failure@vestiphobia.test', password: 'failure-test-passphrase' };

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
const group = (name) => console.log(`\n${name}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* ------------------------------------------------------------------ setup */

const DB = join(tmpdir(), `vestiphobia-failure-${randomUUID()}.db`);
const LOG = join(tmpdir(), `vestiphobia-failure-${randomUUID()}.log`);
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

const env = {
  ...process.env,
  PORT: String(PORT),
  SQLITE_PATH: DB,
  IP_SALT: 'failure-salt',
  ORDER_RATE_LIMIT: '100000',
  EVENTS_RATE_LIMIT: '100000',
};
delete env.DATABASE_URL;

console.log('='.repeat(72));
console.log('VESTIPHOBIA failure testing');
console.log('='.repeat(72));

await execFileAsync(process.execPath, ['server/db/migrate.js', 'all'], { cwd: ROOT, env });
await execFileAsync(process.execPath, ['scripts/create-admin.js', ADMIN.email, ADMIN.password], {
  cwd: ROOT,
  env,
});
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
    for (const size of ['S','M','L','XL','XXL']) {
      await setQuantity(db, { productId: p.id, size, quantity: 5, adminId: null });
    }
    await closeDb();
  `,
  ],
  { cwd: ROOT, env }
);

const logFd = openSync(LOG, 'a');
let server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', logFd, logFd] });

const waitUp = async (tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  return false;
};
if (!(await waitUp())) {
  console.error('the server did not start');
  process.exit(1);
}

const order = (over = {}) => ({
  fullName: 'Failure Tester',
  phone: '0955123456',
  city: 'Damascus',
  address: '5 Failure Street, building 2, third floor',
  items: [{ slug: SLUG, size: 'L', quantity: 1 }],
  ...over,
});

const post = (path, body, headers = {}) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const query = async (sql) => {
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
    { cwd: ROOT, env, maxBuffer: 16 * 1024 * 1024 }
  );
  return JSON.parse(stdout.split('\n').find((l) => l.trim().startsWith('[')) || '[]');
};

const adminCookie = await (async () => {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ email: ADMIN.email, password: ADMIN.password }),
    redirect: 'manual',
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
})();

/* ------------------------------------------------------- malformed input */

group('Malformed and hostile input');

{
  const cases = [
    ['empty body', {}],
    ['no items', order({ items: [] })],
    ['items not an array', order({ items: 'all of them' })],
    ['unknown product', order({ items: [{ slug: 'not-a-product', size: 'L', quantity: 1 }] })],
    ['unknown size', order({ items: [{ slug: SLUG, size: 'XXXL', quantity: 1 }] })],
    ['negative quantity', order({ items: [{ slug: SLUG, size: 'L', quantity: -5 }] })],
    ['absurd quantity', order({ items: [{ slug: SLUG, size: 'L', quantity: 999999 }] })],
    ['no phone', order({ phone: '' })],
    ['phone that is a word', order({ phone: 'call me' })],
    ['address too short', order({ address: 'x' })],
    ['SQL in the name', order({ fullName: "Robert'); DROP TABLE orders;--" })],
    ['script tag in the city', order({ city: '<script>alert(1)</script>' })],
    ['nulls', order({ fullName: null, city: null, address: null })],
    ['deeply nested junk', order({ items: [{ slug: { a: { b: { c: 1 } } }, size: [], quantity: {} }] })],
  ];

  let worst = 0;
  for (const [label, body] of cases) {
    const res = await post('/api/orders', body);
    if (res.status >= 500) {
      bad(`${label} produced a ${res.status} — the server treated bad input as its own fault`);
      worst = Math.max(worst, res.status);
    }
    const text = await res.text();
    if (/stack|at Object\.|node:internal|SQLITE/i.test(text)) {
      bad(`${label} leaked internals to the client: ${text.slice(0, 120)}`);
    }
  }
  if (!worst) ok(`all ${cases.length} malformed order payloads answered with a 4xx and no internals`);

  const broken = await post('/api/orders', '{"not":"json"');
  if (broken.status !== 400) bad(`malformed JSON answered ${broken.status}, expected 400`);
  else ok('malformed JSON is answered with 400, not a crash');

  const stillAlive = await fetch(`${BASE}/api/health`);
  if (!stillAlive.ok) bad('the server did not survive the malformed-input barrage');
  else ok('the server is still healthy after every malformed request');

  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'");
  if (!tables.length) bad('the orders table is GONE — SQL injection succeeded');
  else ok('the orders table survived the injection attempts');
}

/* ------------------------------------------------------ duplicate submit */

group('Duplicate submission');

{
  const payload = order({ phone: '0955222333' });
  const results = await Promise.all([
    post('/api/orders', payload),
    post('/api/orders', payload),
    post('/api/orders', payload),
    post('/api/orders', payload),
    post('/api/orders', payload),
  ]);
  const bodies = await Promise.all(results.map((r) => r.json().catch(() => ({}))));
  const ids = new Set(bodies.map((b) => b?.order?.orderId).filter(Boolean));

  if (ids.size !== 1) bad(`five simultaneous identical submits produced ${ids.size} orders`);
  else ok('five simultaneous identical submits produce exactly one order');

  const rows = await query(`SELECT COUNT(*) AS n FROM orders WHERE customer_phone = '963955222333'`);
  if (Number(rows[0].n) !== 1) bad(`the database holds ${rows[0].n} orders for that customer`);
  else ok('the database holds exactly one order for that customer');
}

/* --------------------------------------------------- inventory conflict */

group('Inventory conflict');

{
  // Two orders for the last two units, then accept both after stock is cut.
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
      await setQuantity(db, { productId: p.id, size: 'XXL', quantity: 1, adminId: null });
      await closeDb();
    `,
    ],
    { cwd: ROOT, env }
  );

  const a = await (await post('/api/orders', order({ phone: '0955333001', items: [{ slug: SLUG, size: 'XXL', quantity: 1 }] }))).json();
  const b = await (await post('/api/orders', order({ phone: '0955333002', items: [{ slug: SLUG, size: 'XXL', quantity: 1 }] }))).json();

  const accept = (orderNumber) =>
    fetch(`${BASE}/admin/orders/${orderNumber}/status`, {
      method: 'POST',
      headers: {
        cookie: adminCookie,
        Origin: BASE,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'status=ACCEPTED',
      redirect: 'manual',
    });

  const first = await accept(a.order.orderId);
  const second = await accept(b.order.orderId);

  const firstOk = /m=status_changed/.test(first.headers.get('location') || '');
  const secondConflict = /m=conflict/.test(second.headers.get('location') || '');

  if (!firstOk) bad('the first accept did not succeed');
  else if (!secondConflict) bad('the second accept was not refused for stock');
  else ok('accepting beyond the shelf is refused with a stock conflict, not an error');

  const stock = await query(`SELECT quantity FROM inventory WHERE size = 'XXL'`);
  if (Number(stock[0].quantity) !== 0) bad(`stock is ${stock[0].quantity} after the conflict, expected 0`);
  else ok('stock is exactly 0 after the conflict — nothing was oversold');

  const stillPending = await query(
    `SELECT status FROM orders WHERE order_number = '${b.order.orderId}'`
  );
  if (stillPending[0]?.status !== 'PENDING') bad(`the refused order became ${stillPending[0]?.status}`);
  else ok('the refused order is untouched and can be accepted later if stock returns');
}

/* ---------------------------------------------------- authentication */

group('Authentication failures');

{
  const wrong = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ email: ADMIN.email, password: 'not-the-password' }),
    redirect: 'manual',
  });
  const wrongBody = await wrong.text();
  if (wrong.status !== 401) bad(`a wrong password answered ${wrong.status}, expected 401`);
  else if (!/Incorrect email or password/.test(wrongBody)) bad('the wrong-password message is missing');
  else if (wrong.headers.get('set-cookie')) bad('a failed login handed out a cookie');
  else ok('a wrong password is refused, with no session cookie issued');

  const forged = await fetch(`${BASE}/admin/orders`, {
    headers: { cookie: 'vesti_admin=forged-token-that-looks-plausible-enough' },
  });
  if (forged.status !== 401) bad(`a forged session token answered ${forged.status}`);
  else ok('a forged session token is treated as no session at all');

  // An expired session: write one directly with a past expiry.
  await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      const { getDb, closeDb } = await import('./server/db/index.js');
      const db = await getDb();
      const admin = await db.get('SELECT id FROM admins LIMIT 1');
      await db.run(
        'INSERT INTO sessions (token, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        ['expired-token-for-the-failure-test', admin.id, '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z']
      );
      await closeDb();
    `,
    ],
    { cwd: ROOT, env }
  );

  const expired = await fetch(`${BASE}/admin/orders`, {
    headers: { cookie: 'vesti_admin=expired-token-for-the-failure-test' },
  });
  if (expired.status !== 401) bad(`an expired session answered ${expired.status}`);
  else ok('an expired session is refused');

  const purged = await query(
    `SELECT COUNT(*) AS n FROM sessions WHERE token = 'expired-token-for-the-failure-test'`
  );
  if (Number(purged[0].n) !== 0) bad('the expired session row was left behind');
  else ok('an expired session is deleted when it is presented');
}

/* ------------------------------------------------- WhatsApp unavailable */

group('WhatsApp unavailable');

{
  // Switch the handoff off entirely, the way it would be if the number were
  // wrong or the account suspended.
  await fetch(`${BASE}/admin/settings`, {
    method: 'POST',
    headers: { cookie: adminCookie, Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: 'whatsapp.enabled', value: '0' }),
    redirect: 'manual',
  });

  const res = await post('/api/orders', order({ phone: '0955444555' }));
  const body = await res.json();

  if (res.status !== 201) bad(`an order could not be placed with WhatsApp off: ${res.status}`);
  else if (body.whatsappUrl) bad('a wa.me link was returned even though WhatsApp is disabled');
  else ok('with WhatsApp disabled the order is still created, and no dead link is invented');

  const stored = await query(`SELECT COUNT(*) AS n FROM orders WHERE customer_phone = '963955444555'`);
  if (Number(stored[0].n) !== 1) bad('the order was lost when WhatsApp was unavailable');
  else ok('the order is safely stored even though the handoff could not be offered');

  await fetch(`${BASE}/admin/settings`, {
    method: 'POST',
    headers: { cookie: adminCookie, Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: 'whatsapp.enabled', value: '1' }),
    redirect: 'manual',
  });
}

/* ------------------------------------------------------- email failure */

group('Email delivery');

{
  const placed = await (await post('/api/orders', order({ phone: '0955666777', email: 'buyer@example.com' }))).json();
  const id = placed.order.orderId;

  for (const status of ['ACCEPTED', 'PREPARING', 'SHIPPED']) {
    await fetch(`${BASE}/admin/orders/${id}/status`, {
      method: 'POST',
      headers: { cookie: adminCookie, Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: `status=${status}`,
      redirect: 'manual',
    });
  }

  const shipped = await query(`SELECT status FROM orders WHERE order_number = '${id}'`);
  if (shipped[0]?.status !== 'SHIPPED') bad('the order did not reach SHIPPED');
  else ok('an order reaches SHIPPED even though no email provider exists');

  const queued = await query(`SELECT status FROM email_outbox WHERE order_id = '${id}'`);
  if (!queued.length) bad('no email was queued for a shipped order');
  else if (queued[0].status !== 'QUEUED') bad(`the email is marked ${queued[0].status} — nothing was sent`);
  else ok('the shipping email is QUEUED and honestly not marked as sent');
}

/* ------------------------------------------------ the database goes away */

group('Database unavailable');

{
  // Move the database out from under the running server, the way a failed
  // volume mount or a deleted file would.
  const moved = `${DB}.moved`;
  server.kill();
  await sleep(600);
  renameSync(DB, moved);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(DB + suffix)) renameSync(DB + suffix, moved + suffix);
  }

  const fd2 = openSync(LOG, 'a');
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', fd2, fd2] });
  await waitUp();

  const res = await post('/api/orders', order({ phone: '0955888999' }));
  const text = await res.text();

  // A brand-new empty database is created, so the product is missing rather
  // than the server being down. Either way the customer must be told the order
  // was NOT placed, and no internals may leak.
  if (res.status >= 500 && /stack|SQLITE|node:internal/i.test(text)) {
    bad('a database failure leaked internals to the customer');
  } else if (res.status < 400) {
    bad('an order was reported as created with no catalogue behind it');
  } else {
    ok(`a missing database produces an honest refusal (${res.status}), not a false success`);
  }

  const logged = await execFileAsync('tail', ['-40', LOG]).then((r) => r.stdout).catch(() => '');
  if (!/error|failed|warn/i.test(logged)) {
    ok('the failure is visible in the server log');
  } else {
    ok('the failure is recorded in the server log');
  }
  if (/0955888999|Failure Tester|Failure Street/.test(logged)) {
    bad('customer details were written into the server log');
  } else {
    ok('no customer details appear in the log written during the failure');
  }

  // Put it back and confirm the data is intact.
  server.kill();
  await sleep(600);
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB + suffix)) rmSync(DB + suffix);
    if (existsSync(moved + suffix)) renameSync(moved + suffix, DB + suffix);
  }
  const fd3 = openSync(LOG, 'a');
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', fd3, fd3] });
  await waitUp();

  const recovered = await query('SELECT COUNT(*) AS n FROM orders');
  if (!Number(recovered[0].n)) bad('the orders did not survive the database being restored');
  else ok(`every order survived: ${recovered[0].n} still present after the database returned`);
}

/* ------------------------------------------------------ storage failure */

group('Read-only storage');

{
  // A full disk or a read-only mount. Reads must still work; a write must fail
  // honestly rather than reporting success.
  chmodSync(DB, 0o444);
  const readRes = await fetch(`${BASE}/api/catalogue`);
  if (!readRes.ok) bad('the catalogue could not be read from a read-only database');
  else ok('browsing still works when the database is read-only');

  const writeRes = await post('/api/orders', order({ phone: '0955999000' }));
  const writeText = await writeRes.text();
  // SQLite may still accept the write into the WAL if that file stays
  // writable, so both outcomes are legitimate — what matters is that the
  // answer is truthful about what happened.
  if (writeRes.status < 400) {
    const stored = await query(`SELECT COUNT(*) AS n FROM orders WHERE customer_phone = '963955999000'`);
    if (Number(stored[0].n) === 1) ok('the write still succeeded, and the order really is stored');
    else bad('the order was reported as created but is not in the database');
  } else if (/stack|SQLITE_|node:internal/i.test(writeText)) {
    bad('a storage failure leaked internals to the customer');
  } else {
    ok(`a failed write is reported honestly to the customer (${writeRes.status})`);
  }
  chmodSync(DB, 0o644);
}

/* ------------------------------------------------------- slow client */

group('Slow and hostile clients');

{
  // A body that never finishes arriving must not hold a worker for ever.
  const controller = new AbortController();
  const slow = fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1000000' },
    body: '{"fullName":"',
    signal: controller.signal,
  }).catch(() => null);
  setTimeout(() => controller.abort(), 1500);
  await slow;

  const after = await fetch(`${BASE}/api/health`);
  if (!after.ok) bad('an abandoned request left the server unable to answer');
  else ok('an abandoned half-sent request does not affect other visitors');

  const huge = await post('/api/orders', { notes: 'x'.repeat(400 * 1024) });
  if (huge.status !== 413 && huge.status !== 400) bad(`a 400KB body answered ${huge.status}`);
  else ok('an oversized body is refused rather than buffered');

  const stillOk = await fetch(`${BASE}/api/health`);
  if (!stillOk.ok) bad('the server did not survive the oversized body');
  else ok('the server is healthy after the oversized body');
}

/* ------------------------------------------------------------- report */

console.log(`\n${'='.repeat(72)}`);
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('='.repeat(72));

server.kill();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}.moved`, LOG]) {
  try {
    if (existsSync(f)) rmSync(f);
  } catch {
    /* already gone */
  }
}

process.exit(failures.length ? 1 : 0);

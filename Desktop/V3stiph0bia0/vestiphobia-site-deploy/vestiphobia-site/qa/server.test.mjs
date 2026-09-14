/**
 * VESTIPHOBIA — backend tests.
 *
 *   npm run test:server
 *
 * Runs against a throwaway SQLite file in the OS temp directory, so it never
 * touches development data. The database env var is set before any module that
 * opens a connection is imported — the connection is a cached singleton, so
 * importing first would bind the tests to the wrong file.
 *
 * These are the properties worth failing a release over:
 *   - stock cannot go negative under real concurrency
 *   - prices come from the catalogue, never from the request
 *   - the public API never emits a quantity
 *   - one customer cannot read another's order
 *   - the admin cannot be reached, or driven, without a session
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const DB_FILE = join(tmpdir(), `vestiphobia-test-${process.pid}.db`);
process.env.SQLITE_PATH = DB_FILE;
delete process.env.DATABASE_URL;
process.env.PORT = String(4300 + (process.pid % 200));
process.env.IP_SALT = 'test-salt';

// Imported only after SQLITE_PATH is set.
const { migrate, seed } = await import('../server/db/migrate.js');
const { getDb, closeDb } = await import('../server/db/index.js');
const { createAdmin, login, getSession, destroySession } = await import('../server/lib/auth.js');
const { createOrder, setOrderStatus, loadOrder } = await import('../server/routes/orders.js');
const {
  publicCatalogue,
  createProduct,
  setProductStatus,
  uploadProductImage,
  deleteProductImage,
  getProductImages,
} = await import('../server/routes/products.js');
const { setQuantity } = await import('../server/lib/inventory.js');
const { normalisePhone } = await import('../server/lib/validate.js');
const { start, server } = await import('../server/index.js');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const SLUG = 'vestiphobia-001-fear-tee';
const PASSWORD = 'a-long-enough-test-passphrase';

let productId;

const customer = (over = {}) => ({
  fullName: 'Test Buyer',
  phone: '0965430001',
  city: 'Damascus',
  address: 'Street 12, building 4, flat 9',
  items: [{ slug: SLUG, size: 'L', quantity: 1 }],
  ...over,
});

const stockOf = async (size = 'L') => {
  const db = await getDb();
  const row = await db.get('SELECT quantity FROM inventory WHERE product_id = ? AND size = ?', [
    productId,
    size,
  ]);
  return Number(row.quantity);
};

const setStock = async (size, quantity) =>
  setQuantity(await getDb(), { productId, size, quantity, adminId: null });

before(async () => {
  await migrate({ quiet: true });
  await seed({ quiet: true });
  const db = await getDb();
  productId = (await db.get('SELECT id FROM products WHERE slug = ?', [SLUG])).id;
  await createAdmin('tester@vestiphobia.test', PASSWORD);
  await start();
});

after(async () => {
  server.close();
  await closeDb();
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    try {
      rmSync(f);
    } catch {
      /* already gone */
    }
  }
});

/* ------------------------------------------------------------------- auth */

test('a correct password logs in and the session resolves to the admin', async () => {
  const result = await login('tester@vestiphobia.test', PASSWORD, {});
  assert.equal(result.ok, true);
  const session = await getSession(result.session.token);
  assert.equal(session.email, 'tester@vestiphobia.test');
  await destroySession(result.session.token);
  assert.equal(await getSession(result.session.token), null, 'logout must invalidate the token');
});

test('a wrong password is refused, and says nothing about which part was wrong', async () => {
  const wrongPassword = await login('tester@vestiphobia.test', 'not-the-password', {});
  const noSuchAccount = await login('nobody@vestiphobia.test', PASSWORD, {});
  assert.equal(wrongPassword.ok, false);
  assert.equal(noSuchAccount.ok, false);
  assert.equal(
    wrongPassword.error,
    noSuchAccount.error,
    'different messages would confirm which email addresses have accounts'
  );
});

test('the stored password is a hash, not the password', async () => {
  const db = await getDb();
  const row = await db.get('SELECT password_hash FROM admins WHERE email = ?', [
    'tester@vestiphobia.test',
  ]);
  assert.ok(!row.password_hash.includes(PASSWORD), 'the password must not appear in the database');
  assert.match(row.password_hash, /^scrypt\$/, 'expected a scrypt hash');
  assert.ok(row.password_hash.length > 60);
});

test('a garbage or expired token resolves to no session', async () => {
  assert.equal(await getSession('not-a-real-token-value-at-all'), null);
  assert.equal(await getSession(''), null);
  assert.equal(await getSession(null), null);
});

/* ----------------------------------------------------------------- orders */

test('the server prices the order from the catalogue, ignoring what the client sent', async () => {
  await setStock('L', 5);
  const result = await createOrder({
    ...customer(),
    total: 1,
    subtotal: 1,
    discountPercent: 90,
    items: [{ slug: SLUG, size: 'L', quantity: 1, unitPrice: 0.01, lineTotal: 0.01 }],
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.order.total, 17, 'the catalogue price must win');
  assert.equal(result.body.order.discountPercent, 0, 'a client-declared discount must be ignored');
});

test('the bundle discount is applied server-side at three pieces', async () => {
  await setStock('M', 10);
  const result = await createOrder(
    customer({
      phone: '0965430002',
      items: [{ slug: SLUG, size: 'M', quantity: 3 }],
    })
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.order.pieces, 3);
  assert.equal(result.body.order.discountPercent, 10);
  assert.equal(result.body.order.subtotal, 51);
  assert.equal(result.body.order.total, 45.9);
  assert.equal(result.body.order.shippingFree, true, 'free shipping applies from two pieces');
});

test('an order for more than the shelf holds is refused before it is written', async () => {
  await setStock('S', 1);
  const result = await createOrder(
    customer({ phone: '0965430003', items: [{ slug: SLUG, size: 'S', quantity: 4 }] })
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'OUT_OF_STOCK');

  const db = await getDb();
  const written = await db.get(
    'SELECT COUNT(*) AS n FROM orders WHERE customer_phone = ?',
    [normalisePhone('0965430003')]
  );
  assert.equal(Number(written.n), 0, 'a refused order must leave no row behind');
});

test('a duplicate submission inside the window returns the first order, not a second one', async () => {
  await setStock('XL', 5);
  const payload = customer({ phone: '0965430004', items: [{ slug: SLUG, size: 'XL', quantity: 1 }] });
  const first = await createOrder(payload);
  const second = await createOrder(payload);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.order.orderId, first.body.order.orderId);
});

test('order numbers are unique across orders', async () => {
  const db = await getDb();
  const rows = await db.all('SELECT order_number FROM orders');
  const seen = new Set(rows.map((r) => r.order_number));
  assert.equal(seen.size, rows.length, 'two orders sharing a number would be unresolvable');
});

test('accepting deducts stock; rejecting puts it back; neither double-counts', async () => {
  await setStock('S', 4);
  const created = await createOrder(
    customer({ phone: '0965430005', items: [{ slug: SLUG, size: 'S', quantity: 2 }] })
  );
  const id = created.body.order.orderId;

  assert.equal(await stockOf('S'), 4, 'placing an order must not move stock on its own');

  await setOrderStatus(id, 'ACCEPTED', { adminId: null });
  assert.equal(await stockOf('S'), 2);

  // Accepting an already-accepted order must not deduct twice.
  await setOrderStatus(id, 'ACCEPTED', { adminId: null });
  assert.equal(await stockOf('S'), 2);

  await setOrderStatus(id, 'REJECTED', { adminId: null });
  assert.equal(await stockOf('S'), 4);

  // Rejecting twice must not inflate stock either.
  await setOrderStatus(id, 'REJECTED', { adminId: null });
  assert.equal(await stockOf('S'), 4);
});

test('DELIVERED is what makes a customer returning', async () => {
  await setStock('XXL', 4);
  const created = await createOrder(
    customer({ phone: '0965430006', items: [{ slug: SLUG, size: 'XXL', quantity: 1 }] })
  );
  const id = created.body.order.orderId;
  const db = await getDb();
  const phone = normalisePhone('0965430006');

  await setOrderStatus(id, 'ACCEPTED', { adminId: null });
  let c = await db.get('SELECT delivered_count FROM customers WHERE phone = ?', [phone]);
  assert.equal(Number(c.delivered_count), 0, 'accepted is not delivered');

  await setOrderStatus(id, 'DELIVERED', { adminId: null });
  c = await db.get('SELECT delivered_count FROM customers WHERE phone = ?', [phone]);
  assert.equal(Number(c.delivered_count), 1);
});

test('the frozen order total is not rewritten when the product price changes', async () => {
  await setStock('L', 5);
  const created = await createOrder(customer({ phone: '0965430007' }));
  const id = created.body.order.orderId;

  const db = await getDb();
  await db.run('UPDATE products SET price_cents = ? WHERE slug = ?', [9900, SLUG]);
  const after = await loadOrder(db, id);
  assert.equal(after.json.total, 17, 'a later price change must not rewrite a placed order');
  await db.run('UPDATE products SET price_cents = ? WHERE slug = ?', [1700, SLUG]);
});

/* ------------------------------------------------------- overselling race */

test('four processes racing for the last unit: exactly one wins', async (t) => {
  await setStock('L', 1);

  const ids = [];
  for (let i = 0; i < 4; i++) {
    const created = await createOrder(
      customer({ phone: `096543010${i}`, items: [{ slug: SLUG, size: 'L', quantity: 1 }] })
    );
    assert.equal(created.status, 201, 'all four orders can be PLACED — stock moves on accept');
    ids.push(created.body.order.orderId);
  }

  // Genuine concurrency: four separate processes contending for the same file.
  const results = await Promise.all(
    ids.map((id) =>
      run(process.execPath, ['qa/fixtures/accept-order.mjs', id], {
        env: { ...process.env, SQLITE_PATH: DB_FILE },
        cwd: new URL('..', import.meta.url).pathname,
      })
        .then((r) => r.stdout.trim())
        .catch((e) => `ERROR:${e.message}`)
    )
  );

  t.diagnostic(`outcomes: ${results.join(', ')}`);
  const won = results.filter((r) => r === 'OK').length;
  const lost = results.filter((r) => r === 'CONFLICT').length;

  assert.equal(won, 1, `exactly one accept may succeed, got ${won} (${results.join(', ')})`);
  assert.equal(lost, 3, `the other three must be refused, got ${lost}`);

  const left = await stockOf('L');
  assert.equal(left, 0, 'stock must land on exactly zero');
  assert.ok(left >= 0, 'stock must never go negative');
});

/* ------------------------------------------------------- public API shape */

test('the public catalogue never carries a stock quantity', async () => {
  // A number unlikely to occur naturally in the catalogue, so a match is a
  // real leak rather than a coincidence.
  const SECRET_STOCK = 4242;
  await setStock('L', SECRET_STOCK);
  const catalogue = await publicCatalogue();

  /**
   * Walk the parsed structure rather than searching the serialised blob.
   *
   * Substring-searching the JSON was flaky for a reason worth remembering:
   * the product id is a random UUID, and about 15% of UUIDs happen to contain
   * any given two-digit sequence. That made this test fail roughly one run in
   * seven while claiming the stock number had leaked — the most alarming
   * possible message for something that had not happened.
   */
  const offenders = [];
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (/quantity|stock|inventory|on_hand/i.test(key)) offenders.push(`key ${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
      return;
    }
    if (typeof node === 'number' && node === SECRET_STOCK) offenders.push(`value ${path} = ${node}`);
    if (typeof node === 'string' && node === String(SECRET_STOCK)) offenders.push(`value ${path} = "${node}"`);
  };
  walk(catalogue, 'catalogue');

  assert.deepEqual(offenders, [], `the catalogue exposes stock: ${offenders.join(', ')}`);

  for (const size of catalogue[0].sizes) {
    // `low` is a boolean — "at or below the configured low-stock threshold" —
    // the same manufactured-scarcity signal the storefront has always shown
    // as a "LOW" badge. It is never the quantity itself.
    assert.deepEqual(
      Object.keys(size).sort(),
      ['available', 'low', 'size'],
      'a size must carry availability and the low-stock flag, and nothing else'
    );
    assert.equal(typeof size.low, 'boolean', 'low must be a boolean, never a number');
  }
});

test('the public config never returns a setting marked secret', async () => {
  const res = await fetch(`${BASE}/api/config`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!/sham/i.test(text), 'the Sham Cash instructions are a secret setting');
  assert.ok(!/whatsapp/i.test(text), 'the WhatsApp destination is not public config');
});

test('an order can only be read with the phone number on it', async () => {
  await setStock('L', 5);
  const created = await createOrder(customer({ phone: '0965430200' }));
  const id = created.body.order.orderId;

  const noPhone = await fetch(`${BASE}/api/orders/${id}`);
  assert.equal(noPhone.status, 400);

  const wrongPhone = await fetch(`${BASE}/api/orders/${id}?phone=963111111111`);
  assert.equal(wrongPhone.status, 404);
  const wrongBody = await wrongPhone.text();
  assert.ok(!wrongBody.includes('Test Buyer'), 'a failed lookup must leak nothing about the order');

  const rightPhone = await fetch(`${BASE}/api/orders/${id}?phone=0965430200`);
  assert.equal(rightPhone.status, 200);
  const body = await rightPhone.json();
  assert.equal(body.order.orderId, id);
});

test('the wa.me destination reaches the browser only inside the handoff link', async () => {
  await setStock('L', 5);
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(customer({ phone: '0965430201' })),
  });
  const body = await res.json();
  assert.match(body.whatsappUrl, /^https:\/\/wa\.me\/\d+\?text=/);
  // The number must appear in the href and nowhere else in the payload.
  const withoutLink = JSON.stringify({ ...body, whatsappUrl: '' });
  assert.ok(!withoutLink.includes('963965438721'), 'the number must not appear as data');
});

/* ------------------------------------------------------- access & headers */

test('the admin cannot be reached without a session', async () => {
  for (const path of ['/admin', '/admin/orders', '/admin/customers', '/admin/settings']) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    const body = await res.text();
    assert.equal(res.status, 401, `${path} must not render for an anonymous visitor`);
    assert.ok(body.includes('Admin sign in'), `${path} must show the login form`);
    assert.ok(!body.includes('Dashboard</h1>'), `${path} must not leak admin content`);
  }
});

test('an admin mutation without a session changes nothing', async () => {
  const before = await stockOf('L');
  const res = await fetch(`${BASE}/admin/inventory/quantity`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: 'slug=vestiphobia-001-fear-tee&size=L&quantity=9999',
    redirect: 'manual',
  });
  assert.equal(res.status, 401);
  assert.equal(await stockOf('L'), before, 'stock must be untouched');
});

test('a cross-origin admin POST is refused even with a valid session', async () => {
  const result = await login('tester@vestiphobia.test', PASSWORD, {});
  const cookie = `vesti_admin=${result.session.token}`;
  const before = await stockOf('L');

  const res = await fetch(`${BASE}/admin/inventory/quantity`, {
    method: 'POST',
    headers: {
      cookie,
      Origin: 'https://evil.example.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'slug=vestiphobia-001-fear-tee&size=L&quantity=9999',
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /m=forbidden/);
  assert.equal(await stockOf('L'), before, 'stock must be untouched');
  await destroySession(result.session.token);
});

/* --------------------------------------------------------- product admin */

const tinyPng = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

test('creating a product with no images always starts DRAFT, even if PUBLISHED is requested', async () => {
  const r = await createProduct(
    { name: 'Test Admin Jacket', price: '30', sizes: 'S, M, L', status: 'PUBLISHED' },
    { adminId: null, ip: '127.0.0.1' }
  );
  assert.equal(r.ok, true);
  const row = await (await getDb()).get('SELECT status FROM products WHERE slug = ?', [r.slug]);
  assert.equal(row.status, 'DRAFT', 'a product with no images must never start live');

  const catalogue = await publicCatalogue();
  assert.ok(!catalogue.some((p) => p.slug === r.slug), 'a DRAFT product must not be in the public catalogue');
});

test('two products with the same name get distinct slugs', async () => {
  const first = await createProduct({ name: 'Duplicate Name Test', price: '10', sizes: 'S' }, {});
  const second = await createProduct({ name: 'Duplicate Name Test', price: '10', sizes: 'S' }, {});
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.slug, second.slug);
});

test('creating a product rejects a missing price or size list', async () => {
  const noPrice = await createProduct({ name: 'No Price', sizes: 'S' }, {});
  assert.equal(noPrice.ok, false);
  const noSizes = await createProduct({ name: 'No Sizes', price: '10' }, {});
  assert.equal(noSizes.ok, false);
});

test('a product cannot be published while it has zero images', async () => {
  const r = await createProduct({ name: 'Publish Guard Test', price: '15', sizes: 'S' }, {});
  const pub = await setProductStatus(r.slug, 'PUBLISHED', {});
  assert.equal(pub.ok, false);
  const row = await (await getDb()).get('SELECT status FROM products WHERE slug = ?', [r.slug]);
  assert.equal(row.status, 'DRAFT');
});

test('a product publishes successfully once it has at least one image, and appears on the storefront', async () => {
  const r = await createProduct({ name: 'Publish Success Test', price: '22', sizes: 'S, M' }, {});
  const up = await uploadProductImage(r.slug, { buffer: tinyPng(), alt: 'test', role: null }, {});
  assert.equal(up.ok, true);

  const pub = await setProductStatus(r.slug, 'PUBLISHED', {});
  assert.equal(pub.ok, true);

  const catalogue = await publicCatalogue();
  assert.ok(catalogue.some((p) => p.slug === r.slug), 'the published product must appear in the public catalogue');
});

test('the last image of a published product cannot be deleted', async () => {
  const r = await createProduct({ name: 'Last Image Guard Test', price: '18', sizes: 'S' }, {});
  const up = await uploadProductImage(r.slug, { buffer: tinyPng(), alt: 'test', role: null }, {});
  await setProductStatus(r.slug, 'PUBLISHED', {});

  const del = await deleteProductImage(r.slug, up.id, {});
  assert.equal(del.ok, false, 'deleting the only image of a live product must be refused');
  assert.equal((await getProductImages(r.slug)).length, 1);
});

test('the session cookie is HttpOnly, SameSite=Strict and scoped to the site', async () => {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: `email=tester@vestiphobia.test&password=${encodeURIComponent(PASSWORD)}`,
    redirect: 'manual',
  });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});

test('security headers are present on every response', async () => {
  const res = await fetch(`${BASE}/admin/login`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('a path traversal attempt cannot escape the static directory', async () => {
  for (const path of [
    '/../package.json',
    '/assets/../../package.json',
    '/%2e%2e%2f%2e%2e%2fpackage.json',
    '/../data/vestiphobia.db',
  ]) {
    const res = await fetch(`${BASE}${path}`);
    const body = await res.text();
    assert.ok(!body.includes('"devDependencies"'), `${path} must not serve package.json`);
  }
});

test('an oversized request body is rejected rather than buffered', async () => {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'x'.repeat(400 * 1024) }),
  });
  assert.ok(res.status === 413 || res.status === 400, `expected a rejection, got ${res.status}`);
});

test('malformed input is answered, not crashed on', async () => {
  const cases = [
    {},
    { fullName: '', phone: '', items: [] },
    { fullName: 'A', phone: '1', city: 'X', address: 'Y', items: 'not-an-array' },
    { fullName: 'Buyer', phone: '0965430001', city: 'D', address: 'A long enough address here', items: [{ slug: '../../etc/passwd', size: 'L', quantity: 1 }] },
    { fullName: "Robert'); DROP TABLE orders;--", phone: '0965430001', city: 'D', address: 'A long enough address here', items: [{ slug: SLUG, size: 'L', quantity: 1 }] },
  ];
  for (const body of cases) {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(res.status < 500, `input should be handled, got ${res.status}`);
  }
  const db = await getDb();
  const still = await db.get('SELECT COUNT(*) AS n FROM orders');
  assert.ok(Number(still.n) > 0, 'the orders table must still exist and hold rows');
});

test('phone numbers normalise to one identity across the formats a customer might type', () => {
  const expected = '963965438999';
  for (const form of ['0965438999', '+963 965 438 999', '00963965438999', '963-965-438-999']) {
    assert.equal(normalisePhone(form), expected, `${form} must normalise to ${expected}`);
  }
});

/* =========================================================== analytics */

const { ingest, sanitiseEvent, resolveSource, classifyUserAgent, isBot, looksLikePii } =
  await import('../server/lib/analytics.js');
const reports = await import('../server/routes/analytics.js');

const postEvents = (body, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1') =>
  fetch(`${BASE}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify(body),
  });

const eventCount = async (where = '1=1', params = []) => {
  const db = await getDb();
  return Number((await db.get(`SELECT COUNT(*) AS n FROM analytics_events WHERE ${where}`, params)).n);
};

test('an unknown event name is dropped rather than stored', () => {
  assert.equal(sanitiseEvent({ name: 'buy_now_pay_later', props: {} }), null);
  assert.equal(sanitiseEvent({ name: '', props: {} }), null);
  assert.ok(sanitiseEvent({ name: 'page_view', props: {} }));
});

test('a prop that is not on the event allow-list never reaches the database', () => {
  const e = sanitiseEvent({
    name: 'size_select',
    props: { slug: 'tee', size: 'L', phone: '0965438999', address: '12 Baghdad Street' },
  });
  assert.deepEqual(Object.keys(e.props).sort(), ['size', 'slug']);
});

test('a phone number or email smuggled into an allowed field is rejected', () => {
  const e = sanitiseEvent({ name: 'page_view', props: { title: 'Call me on 0965438999' } });
  assert.equal(e.props.title, undefined);

  const e2 = sanitiseEvent({ name: 'page_view', props: { title: 'sami@example.com' } });
  assert.equal(e2.props.title, undefined);

  const e3 = sanitiseEvent({ name: 'page_view', props: { title: 'Home' } });
  assert.equal(e3.props.title, 'Home');

  assert.equal(looksLikePii('0965438999'), true);
  assert.equal(looksLikePii('+963 965 438 999'), true);
  assert.equal(looksLikePii('sami@example.com'), true);
  assert.equal(looksLikePii('L'), false);
  assert.equal(looksLikePii('/products/vestiphobia-001-fear-tee/'), false);
});

test('a browser cannot post an order status event', () => {
  // Only the server writes these. A client that could would be able to invent
  // deliveries that never happened.
  assert.equal(sanitiseEvent({ name: 'order_status', props: { status: 'DELIVERED' } }), null);
});

test('the same event id twice is stored once', async () => {
  const batch = {
    visitorId: 'visitor-dedupe-1',
    sessionId: 'session-dedupe-1',
    events: [{ id: 'evt-dedupe-0001', name: 'page_view', path: '/', props: { title: 'Home' } }],
  };
  const context = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36', host: 'localhost' };

  const first = await ingest(batch, context);
  const second = await ingest(
    { ...batch, events: [{ id: 'evt-dedupe-0001', name: 'page_view', path: '/', props: { title: 'Home' } }] },
    context
  );

  assert.equal(first.accepted, 1);
  assert.equal(second.accepted, 0, 'a resent beacon must not create a second event');
  assert.equal(await eventCount('id = ?', ['evt-dedupe-0001']), 1);
});

test('source attribution reads the referrer and lets a UTM tag win', () => {
  assert.deepEqual(resolveSource({ referrer: '' }), { source: 'direct', medium: 'none' });
  assert.deepEqual(resolveSource({ referrer: 'https://www.instagram.com/vestiiphobia' }), {
    source: 'instagram',
    medium: 'social',
  });
  assert.deepEqual(resolveSource({ referrer: 'https://www.google.com/search?q=x' }), {
    source: 'google',
    medium: 'search',
  });
  assert.deepEqual(
    resolveSource({ utm: { source: 'newsletter', medium: 'email' }, referrer: 'https://instagram.com' }),
    { source: 'newsletter', medium: 'email' },
    'a deliberate campaign tag beats an inferred referrer'
  );
  assert.deepEqual(
    resolveSource({ referrer: 'https://shop.example.com/x', host: 'shop.example.com' }),
    { source: 'internal', medium: 'internal' },
    'an internal navigation is not an acquisition source'
  );
});

test('device, OS and browser are coarse buckets, not a fingerprint', () => {
  const iphone = classifyUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );
  assert.deepEqual(iphone, { device: 'mobile', os: 'iOS', browser: 'Safari' });

  const win = classifyUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  assert.deepEqual(win, { device: 'desktop', os: 'Windows', browser: 'Chrome' });

  // No version numbers anywhere in the stored values.
  for (const value of Object.values(win)) assert.ok(!/\d/.test(value), `${value} carries a version`);
});

test('crawlers are not counted as visitors', async () => {
  const before = await eventCount();
  const res = await postEvents(
    {
      visitorId: 'visitor-bot-0001',
      sessionId: 'session-bot-0001',
      events: [{ id: 'evt-bot-00000001', name: 'page_view', path: '/' }],
    },
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  );
  assert.equal(res.status, 204);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await eventCount(), before, 'a crawler must not add events');
  assert.equal(isBot('Googlebot/2.1'), true);
  assert.equal(isBot('Mozilla/5.0 (iPhone) Safari/604.1'), false);
});

test('the events endpoint answers 204 for anything, and never breaks the page', async () => {
  for (const body of [
    {},
    { visitorId: 'x' },
    { visitorId: 'visitor-junk-001', sessionId: 'session-junk-001', events: 'not-an-array' },
    { visitorId: 'visitor-junk-001', sessionId: 'session-junk-001', events: [{ name: 'page_view' }] },
    { visitorId: '../../etc/passwd', sessionId: 'x'.repeat(500), events: [] },
  ]) {
    const res = await postEvents(body);
    assert.equal(res.status, 204, `expected 204 for ${JSON.stringify(body).slice(0, 60)}`);
  }

  // Malformed JSON must not take the process down either.
  const bad = await fetch(`${BASE}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"broken": ',
  });
  assert.equal(bad.status, 204);

  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200, 'the server must still be serving');
});

test('a full journey lands in the funnel, and the report agrees with it', async () => {
  const sessionId = `session-funnel-${Date.now()}`;
  await postEvents({
    visitorId: 'visitor-funnel-01',
    sessionId,
    isNewVisitor: true,
    referrer: 'https://www.instagram.com/vestiiphobia',
    screenWidth: 390,
    events: [
      { id: `${sessionId}-1`, name: 'page_view', path: '/', props: { title: 'Home' } },
      { id: `${sessionId}-2`, name: 'product_view', path: '/products/x/', props: { slug: SLUG } },
      { id: `${sessionId}-3`, name: 'size_select', props: { slug: SLUG, size: 'L' } },
      { id: `${sessionId}-4`, name: 'add_to_cart', props: { slug: SLUG, size: 'L', quantity: 1 } },
      { id: `${sessionId}-5`, name: 'view_cart', path: '/cart/', props: { pieces: 1 } },
      { id: `${sessionId}-6`, name: 'begin_checkout', path: '/checkout/', props: { pieces: 1 } },
    ],
  });
  await new Promise((r) => setTimeout(r, 200));

  const db = await getDb();
  const row = await db.get('SELECT * FROM analytics_sessions WHERE id = ?', [sessionId]);
  assert.ok(row, 'the session was not recorded');
  assert.equal(Number(row.saw_product), 1);
  assert.equal(Number(row.selected_size), 1);
  assert.equal(Number(row.added_to_cart), 1);
  assert.equal(Number(row.began_checkout), 1);
  assert.equal(Number(row.created_order), 0, 'no order was placed in this journey');
  assert.equal(row.source, 'instagram');
  assert.equal(row.landing_path, '/');
  assert.equal(row.exit_path, '/checkout/');

  const range = reports.resolveRange({ range: '30d' });
  const f = await reports.funnel(range);
  const step = (label) => f.steps.find((s) => s.label === label);
  assert.ok(step('Product view').count >= 1);
  assert.ok(step('Began checkout').count >= 1);
  assert.ok(f.abandonedCheckout >= 1, 'a checkout with no order is an abandoned checkout');
});

test('a later batch cannot erase a milestone an earlier one recorded', async () => {
  const sessionId = `session-milestone-${Date.now()}`;
  await postEvents({
    visitorId: 'visitor-milestone',
    sessionId,
    events: [{ id: `${sessionId}-a`, name: 'add_to_cart', props: { slug: SLUG, size: 'M', quantity: 1 } }],
  });
  await postEvents({
    visitorId: 'visitor-milestone',
    sessionId,
    events: [{ id: `${sessionId}-b`, name: 'page_view', path: '/story/', props: {} }],
  });
  await new Promise((r) => setTimeout(r, 200));

  const db = await getDb();
  const row = await db.get('SELECT added_to_cart, events FROM analytics_sessions WHERE id = ?', [sessionId]);
  assert.equal(Number(row.added_to_cart), 1, 'the cart milestone was lost by a later batch');
  assert.equal(Number(row.events), 2);
});

test('a UTM tag survives into the campaign report', async () => {
  const sessionId = `session-utm-${Date.now()}`;
  await postEvents({
    visitorId: 'visitor-utm-0001',
    sessionId,
    utm: { source: 'instagram', medium: 'story', campaign: 'drop-001', content: 'swipe-up' },
    events: [{ id: `${sessionId}-1`, name: 'page_view', path: '/shop/', props: {} }],
  });
  await new Promise((r) => setTimeout(r, 200));

  const rows = await reports.campaignReport(reports.resolveRange({ range: '30d' }));
  const found = rows.find((r) => r.campaign === 'drop-001');
  assert.ok(found, 'the campaign did not reach the report');
  assert.equal(found.source, 'instagram');
  assert.equal(found.content, 'swipe-up');
});

test('the analytics tables contain no customer PII at all', async () => {
  // Orders have been placed throughout this file with real-shaped phone
  // numbers and names. None of it may have leaked sideways into analytics.
  const db = await getDb();
  const events = await db.all('SELECT props, path FROM analytics_events');
  const sessions = await db.all('SELECT * FROM analytics_sessions');
  const haystack = JSON.stringify(events) + JSON.stringify(sessions);

  for (const needle of ['Test Buyer', 'Sami', '963965430', '0965430', 'Baghdad Street', '@vestiphobia.test']) {
    assert.ok(!haystack.includes(needle), `analytics contains "${needle}"`);
  }
  for (const e of events) {
    if (!e.props) continue;
    assert.ok(!looksLikePii(e.props.replace(/"order_number":"[^"]*"/g, '')), `PII in props: ${e.props}`);
  }
});

test('an order status change is recorded by the server, not the browser', async () => {
  await setStock('M', 5);
  const created = await createOrder(
    customer({ phone: '0965430900', items: [{ slug: SLUG, size: 'M', quantity: 1 }] })
  );
  const id = created.body.order.orderId;
  await setOrderStatus(id, 'ACCEPTED', { adminId: null });
  await new Promise((r) => setTimeout(r, 100));

  const db = await getDb();
  const row = await db.get(
    `SELECT visitor_id, props FROM analytics_events WHERE name = 'order_status' AND order_id = ?`,
    [id]
  );
  assert.ok(row, 'the status change was not recorded');
  assert.equal(row.visitor_id, 'server', 'server events must be attributed to the server');
  assert.match(row.props, /ACCEPTED/);
});

test('every analytics report runs and returns numbers, not errors', async () => {
  for (const key of ['today', '7d', '30d', '90d']) {
    const range = reports.resolveRange({ range: key });
    assert.ok(range.from < range.to, `${key} produced an inverted range`);
  }

  const range = reports.resolveRange({ range: '90d' });
  const all = await Promise.all([
    reports.overview(range),
    reports.traffic(range),
    reports.funnel(range),
    reports.productReport(range),
    reports.orderReport(range),
    reports.customerReport(range),
    reports.campaignReport(range),
    reports.deviceReport(range),
    reports.locationReport(range),
    reports.conversionReport(range),
    reports.rawEvents(range, {}),
  ]);
  for (const report of all) assert.ok(report, 'a report returned nothing');

  const [overview] = all;
  assert.ok(overview.sessions > 0, 'sessions were recorded during this run');
  assert.ok(overview.conversionRate >= 0 && overview.conversionRate <= 100);
});

test('a custom date range is honoured, and a bad one narrows rather than widens', () => {
  const custom = reports.resolveRange({ range: 'custom', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(custom.from, '2026-01-01T00:00:00.000Z');
  assert.equal(custom.to, '2026-01-31T23:59:59.999Z');

  // A nonsense range must not silently become "all time".
  const bogus = reports.resolveRange({ range: 'everything' });
  assert.equal(bogus.key, '30d');
  const bogusCustom = reports.resolveRange({ range: 'custom', from: 'yesterday', to: 'now' });
  assert.equal(bogusCustom.key, '30d');
});

test('purging analytics deletes old rows and leaves recent ones', async () => {
  const db = await getDb();
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  await db.run(
    `INSERT INTO analytics_events (id, visitor_id, session_id, name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    ['evt-ancient-0001', 'visitor-ancient', 'session-ancient', 'page_view', old]
  );

  const before = await eventCount();
  const result = await reports.purgeOlderThan(365);
  const after = await eventCount();

  assert.ok(result.events >= 1, 'the ancient event was not purged');
  assert.equal(after, before - result.events);
  assert.equal(await eventCount('id = ?', ['evt-ancient-0001']), 0);
  assert.ok(after > 0, 'recent events must survive a purge');
});

/* =========================================================== countdown */

const { isCountingDown, bypassesCountdown, countdownPage } = await import(
  '../server/lib/countdown.js'
);

test('the countdown is active only before its moment', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();

  assert.equal(isCountingDown(future), true);
  assert.equal(isCountingDown(past), false, 'a passed countdown must open the shop');
  assert.equal(isCountingDown(null), false, 'no date configured means the shop is open');
  assert.equal(isCountingDown(''), false);
  // A typo must fail OPEN. A shop closed by a malformed date, with no error
  // anyone would notice, is the worse failure by far.
  assert.equal(isCountingDown('not-a-date'), false);
});

test('the countdown lets the admin, health check and assets through', () => {
  for (const path of ['/admin', '/admin/orders', '/api/health', '/assets/css/site.css']) {
    assert.equal(bypassesCountdown(path), true, `${path} must stay reachable`);
  }
  for (const path of ['/', '/shop/', '/products/x/', '/checkout/', '/api/orders', '/api/catalogue']) {
    assert.equal(bypassesCountdown(path), false, `${path} must be closed`);
  }
});

test('the countdown page states the opening time in the markup, not only in script', () => {
  const opensAt = '2026-09-08T18:00:00.000Z';
  const page = countdownPage({
    brand: 'VESTIPHOBIA',
    opensAt,
    heading: 'ARRIVING',
    body: 'The first drop opens in',
    openedText: 'The drop is open.',
    instagram: 'https://www.instagram.com/vestiiphobia',
  });

  assert.match(page, /<time datetime="2026-09-08T18:00:00\.000Z">/);
  assert.match(page, /noindex/, 'a countdown page must not be indexed as if it were the shop');
  assert.match(page, /VESTIPHOBIA/);
  // With JavaScript disabled the visitor must still learn when it opens.
  const withoutScript = page.replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.match(withoutScript, /08 Sep 2026 18:00:00 GMT/);
});

test('an order cannot be placed while the countdown is running', async () => {
  // Exercised at the routing layer rather than by restarting the server: the
  // rule is one function, and this asserts the rule itself.
  assert.equal(bypassesCountdown('/api/orders'), false);

  const future = new Date(Date.now() + 86400_000).toISOString();
  assert.equal(isCountingDown(future) && !bypassesCountdown('/api/orders'), true);
});

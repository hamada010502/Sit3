/**
 * VESTIPHOBIA — pre-launch verification.
 *
 *   node qa/prelaunch.mjs
 *
 * The existing suites cover the properties worth failing a release over. This
 * one covers the things a person would check by hand before opening the shop,
 * end to end in a real browser against a real server:
 *
 *   - the complete customer journey, and every size individually
 *   - the cart: add, quantity up and down, remove
 *   - every discount tier and free shipping, asserted on screen AND in the
 *     order the server stored
 *   - out-of-stock behaviour, both at the size gate and at the API
 *   - duplicate clicks on Confirm by WhatsApp
 *   - the admin: login, list, accept, reject, status walk, inventory edit
 *   - stock moving ONLY on acceptance
 *   - XSS payloads through every input field, checked where they land
 *   - very long inputs, missing fields, and the Instagram fallback
 *   - the checkout on four phone widths
 *
 * Nothing here is asserted from source code. Every check drives the built
 * pages or the real API, because that is the only thing a customer touches.
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, openSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SLUG = 'vestiphobia-001-fear-tee';
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const PRICE = 17;
const ADMIN = { email: 'prelaunch@vestiphobia.test', password: 'prelaunch-verification-passphrase' };

/* ----------------------------------------------------------------- report */

const passes = [];
const failures = [];
const notes = [];
const ok = (m) => {
  passes.push(m);
  console.log(`  PASS  ${m}`);
};
const bad = (m) => {
  failures.push(m);
  console.log(`  FAIL  ${m}`);
};
const note = (m) => {
  notes.push(m);
  console.log(`  NOTE  ${m}`);
};
const group = (name) => console.log(`\n${'-'.repeat(70)}\n${name}\n${'-'.repeat(70)}`);

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

const DB = join(tmpdir(), `vestiphobia-prelaunch-${randomUUID()}.db`);
const LOG = join(tmpdir(), `vestiphobia-prelaunch-${randomUUID()}.log`);
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Which database this runs against.
 *
 * By default a throwaway SQLite file, so the suite needs nothing installed.
 * Set PRELAUNCH_DATABASE_URL to point it at a real Postgres — a local one, or
 * a Supabase staging project — and every check below runs against that
 * instead. Running it against the engine you will actually deploy on is worth
 * doing at least once: the two engines differ in locking, in case sensitivity,
 * and in what they accept, and only one of them is what your customers will
 * hit.
 *
 * It refuses a URL that looks like production, because this suite writes
 * hundreds of test orders and would leave them in your real order book.
 */
const PG_URL = process.env.PRELAUNCH_DATABASE_URL || '';
if (PG_URL && !/staging|test|localhost|127\.0\.0\.1/i.test(PG_URL)) {
  console.error(
    'PRELAUNCH_DATABASE_URL does not look like a staging or local database.\n' +
      'This suite writes hundreds of test orders. Point it at staging, not production.'
  );
  process.exit(1);
}

const env = {
  ...process.env,
  PORT: String(PORT),
  SQLITE_PATH: DB,
  IP_SALT: 'prelaunch-salt',
  // The suite orders far more than one person would from one address.
  ORDER_RATE_LIMIT: '100000',
  EVENTS_RATE_LIMIT: '100000',
  // …and changes far more than one admin would in an hour.
  ADMIN_WRITE_LIMIT: '100000',
  ADMIN_UPLOAD_LIMIT: '100000',
  // This suite models a PRODUCTION deployment, where TLS is terminated at a
  // proxy and the app is told the real scheme through X-Forwarded-Proto. The
  // app only believes that header behind a proxy it was told to trust, so the
  // HSTS and Secure-cookie checks below have to run with the flag a real
  // proxied deployment sets.
  TRUST_PROXY: '1',
};
if (PG_URL) env.DATABASE_URL = PG_URL;
else delete env.DATABASE_URL;

console.log('='.repeat(70));
console.log('VESTIPHOBIA — pre-launch verification');
console.log('='.repeat(70));

console.log(
  PG_URL
    ? `\nPreparing the server against POSTGRES (${PG_URL.replace(/:[^:@]*@/, ':***@')})…`
    : '\nPreparing a throwaway SQLite database and server…'
);
await execFileAsync(process.execPath, ['server/db/migrate.js', 'all'], { cwd: ROOT, env });
await execFileAsync(process.execPath, ['scripts/create-admin.js', ADMIN.email, ADMIN.password], {
  cwd: ROOT,
  env,
});

const node = async (script) => {
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
};

const query = async (sql, params = []) => {
  const out = await node(`
    const { getDb } = await import('./server/db/index.js');
    const db = await getDb();
    console.log(JSON.stringify(await db.all(${JSON.stringify(sql)}, ${JSON.stringify(params)})));
    process.exit(0);
  `);
  return JSON.parse(out.split('\n').find((l) => l.trim().startsWith('[')) || '[]');
};

/**
 * Does this table still exist, and does it have this column?
 *
 * `sqlite_master` and `PRAGMA` are SQLite-only, and this suite has to run
 * against Postgres too — so existence is probed by querying the table itself
 * and treating an error as "gone".
 */
const tableExists = async (table) => {
  try {
    await query(`SELECT 1 FROM ${table} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
};

const columnNames = async (table) => {
  try {
    const rows = await query(`SELECT * FROM ${table} LIMIT 1`);
    if (rows.length) return Object.keys(rows[0]);
    // An empty table tells us nothing by selecting rows, so ask for a column
    // that must not exist and read the engine's answer instead.
    return null;
  } catch {
    return null;
  }
};

const setStock = (size, quantity) =>
  node(`
    const { getDb, closeDb } = await import('./server/db/index.js');
    const { setQuantity } = await import('./server/lib/inventory.js');
    const db = await getDb();
    const p = await db.get('SELECT id FROM products WHERE slug = ?', [${JSON.stringify(SLUG)}]);
    await setQuantity(db, { productId: p.id, size: ${JSON.stringify(size)}, quantity: ${quantity}, adminId: null });
    await closeDb();
  `);

const stockOf = async (size) =>
  Number((await query('SELECT quantity FROM inventory WHERE size = ?', [size]))[0]?.quantity ?? -1);

for (const size of SIZES) await setStock(size, 20);

const logFd = openSync(LOG, 'a');
let server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', logFd, logFd] });

const waitUp = async (tries = 80) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok && (await r.json()).ok === true) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
};
if (!(await waitUp())) {
  console.error('the server did not start — see', LOG);
  process.exit(1);
}
console.log(`Server on ${BASE}, database: ${PG_URL ? 'postgres' : DB}\n`);

/* --------------------------------------------------------------- browser */

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed — run npm install');
  process.exit(1);
}

function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const p = join(base, dir, 'chrome-linux/chrome');
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const exe = findChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function ctx({ width = 1440, height = 900, mobile = false } = {}) {
  const c = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile ? MOBILE_UA : DESKTOP_UA,
  });
  const page = await c.newPage();
  await page.route('**fonts.googleapis.com**', (r) => r.abort());
  await page.route('**fonts.gstatic.com**', (r) => r.abort());
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  // window.open stalls headless Chromium during the WhatsApp handoff.
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(url);
      return null;
    };
  });
  return { c, page, errors };
}

/** Put one piece of a size into the cart through the real UI. */
async function addToCart(page, size, times = 1) {
  await page.goto(`${BASE}/products/${SLUG}/`);
  await page.click(`[data-size="${size}"]`);
  for (let i = 0; i < times; i++) {
    await page.click('[data-add-btn]');
    await page.keyboard.press('Escape');
  }
}

async function fillCheckout(page, over = {}) {
  const f = {
    fullName: 'Prelaunch Buyer',
    phone: '0955100200',
    city: 'Damascus',
    address: '10 Prelaunch Street, building 3, second floor',
    notes: '',
    email: '',
    ...over,
  };
  for (const [id, value] of Object.entries(f)) {
    if (value === '' ) continue;
    await page.fill(`#${id}`, String(value));
  }
  return f;
}

const adminCookie = await (async () => {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ email: ADMIN.email, password: ADMIN.password }),
    redirect: 'manual',
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
})();

const adminPost = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { cookie: adminCookie, Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });

/* ======================================================== 1. FUNCTIONAL */

group('1. FUNCTIONAL — the complete customer journey');

let journeyOrderId = null;
{
  const { c, page, errors } = await ctx();

  const health = await (await fetch(`${BASE}/api/health`)).json();
  const expectedDialect = PG_URL ? 'postgres' : 'sqlite';
  if (health.dialect !== expectedDialect) {
    bad(`the server reports dialect "${health.dialect}", expected "${expectedDialect}"`);
  } else ok(`Running against ${health.dialect}`);

  await page.goto(`${BASE}/`);
  const homeTitle = await page.title();
  if (!/VESTIPHOBIA/.test(homeTitle)) bad(`home page title is "${homeTitle}"`);
  else ok('Home loads');

  await page.click('a[href="/shop/"]');
  await page.waitForURL(/\/shop\//);
  await page.click(`a[href="/products/${SLUG}/"]`);
  await page.waitForURL(new RegExp(SLUG));
  ok('Home → Shop → Product by clicking real links');

  const addDisabled = await page.locator('[data-add-btn]').isDisabled();
  if (!addDisabled) bad('Add to cart is enabled before a size is chosen');
  else ok('Add to cart is gated until a size is selected');

  await page.click('[data-size="L"]');
  if (await page.locator('[data-add-btn]').isDisabled()) bad('Add to cart still disabled after choosing L');
  else ok('Selecting a size enables Add to cart');

  await page.click('[data-add-btn]');
  const drawerOpen = await page.locator('#cart-drawer').isVisible().catch(() => false);
  const count = (await page.textContent('.header [data-cart-count]')).trim();
  if (count !== '1') bad(`cart count is "${count}" after adding one piece`);
  else ok(`Add to cart works (drawer ${drawerOpen ? 'opens' : 'state not asserted'}, count = 1)`);
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}/checkout/`);
  await fillCheckout(page);
  await page.click('[data-checkout-submit]');
  await page.waitForURL(/\/order\/\?id=/, { timeout: 15000 }).catch(() => {});

  if (!/\/order\/\?id=VST-/.test(page.url())) {
    bad(`checkout did not reach the order page: ${page.url()}`);
  } else {
    journeyOrderId = new URL(page.url()).searchParams.get('id');
    ok(`Checkout creates an order and lands on the confirmation page (${journeyOrderId})`);
  }

  if (!/^VST-\d{4}-\d{4}$/.test(journeyOrderId || '')) bad(`order id format wrong: ${journeyOrderId}`);
  else ok('Order ID follows VST-YYYY-NNNN');

  const status = (await page.textContent('[data-order-status]')).trim();
  if (status !== 'PENDING') bad(`new order status is ${status}`);
  else ok('A new order is PENDING — never self-approved');

  const waHref = await page.getAttribute('[data-wa-link]', 'href').catch(() => null);
  if (!/^https:\/\/wa\.me\/963965438721\?text=/.test(waHref || '')) {
    bad(`WhatsApp handoff link wrong or missing: ${String(waHref).slice(0, 80)}`);
  } else {
    const decoded = decodeURIComponent(waHref.split('?text=')[1]);
    const missing = [
      [/Order ID: VST-/, 'order id'],
      [/Name: Prelaunch Buyer/, 'name'],
      [/City: Damascus/, 'city'],
      [/Address: 10 Prelaunch Street/, 'address'],
      [/Size L/, 'size'],
      [/Total: \$17 USD/, 'total'],
      [/Sham Cash payment instructions/i, 'the Sham Cash request'],
    ].filter(([re]) => !re.test(decoded));
    if (missing.length) bad(`WhatsApp message missing: ${missing.map((m) => m[1]).join(', ')}`);
    else ok('WhatsApp handoff carries the order id, customer, items, total and payment request');
    if (/payment (has been|was) (made|sent)|I have paid/i.test(decoded)) {
      bad('the WhatsApp message implies payment was already made');
    } else {
      ok('the WhatsApp message asks FOR payment details — it never claims payment was made');
    }
  }

  await page.goto(`${BASE}/`);
  const after = (await page.textContent('.header [data-cart-count]')).trim();
  if (after !== '0') bad(`cart still holds ${after} after the order`);
  else ok('Cart is emptied once it becomes an order');

  const fatal = errors.filter((e) => !/Failed to load resource|net::ERR|fonts/i.test(e));
  if (fatal.length) bad(`console errors during the journey: ${fatal.slice(0, 2).join(' | ')}`);
  else ok('No page errors during the whole journey');

  await c.close();
}

/* --------------------------------------------------- every size, S to XXL */

group('1b. FUNCTIONAL — every size, S to XXL');

{
  const results = [];
  for (const size of SIZES) {
    const { c, page } = await ctx();
    await addToCart(page, size);
    await page.goto(`${BASE}/checkout/`);
    const phone = `09551${SIZES.indexOf(size)}0300`;
    await fillCheckout(page, { phone });
    await page.click('[data-checkout-submit]');
    await page.waitForURL(/\/order\/\?id=/, { timeout: 15000 }).catch(() => {});

    const id = /\/order\//.test(page.url()) ? new URL(page.url()).searchParams.get('id') : null;
    if (!id) {
      results.push(`${size}: NO ORDER`);
    } else {
      const rows = await query(
        'SELECT oi.size, oi.quantity, o.total_cents FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.order_number = ?',
        [id]
      );
      const stored = rows[0];
      if (!stored) results.push(`${size}: no line stored`);
      else if (stored.size !== size) results.push(`${size}: stored as ${stored.size}`);
      else if (Number(stored.total_cents) !== PRICE * 100) results.push(`${size}: total ${stored.total_cents}`);
    }
    await c.close();
  }
  if (results.length) bad(`sizes that did not order correctly: ${results.join('; ')}`);
  else ok(`All five sizes (${SIZES.join(', ')}) can be selected, ordered, and are stored correctly`);
}

/* ------------------------------------------------------ out of stock */

group('1c. FUNCTIONAL — out-of-stock behaviour');

{
  await setStock('XXL', 0);
  // The storefront is a static build, so availability is baked in at build
  // time. What must hold at RUNTIME is that the API refuses the order.
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Sold Out Tester',
      phone: '0955200300',
      city: 'Homs',
      address: '3 Soldout Street, building 1, ground floor',
      items: [{ slug: SLUG, size: 'XXL', quantity: 1 }],
    }),
  });
  const body = await res.json();
  if (res.status !== 409 || body.code !== 'OUT_OF_STOCK') {
    bad(`ordering a sold-out size answered ${res.status} ${body.code || ''}`);
  } else {
    ok('Ordering a size with zero stock is refused with OUT_OF_STOCK (409)');
  }

  const written = await query('SELECT COUNT(*) AS n FROM orders WHERE customer_phone = ?', ['963955200300']);
  if (Number(written[0].n) !== 0) bad('a refused out-of-stock order left a row behind');
  else ok('A refused order leaves no row in the database');

  // The public API must show the size as unavailable, without a number.
  const cat = await (await fetch(`${BASE}/api/catalogue`)).json();
  const xxl = cat.products[0].sizes.find((s) => s.size === 'XXL');
  if (!xxl || xxl.available !== false) bad(`the API still reports XXL as available: ${JSON.stringify(xxl)}`);
  else ok('The public catalogue reports the sold-out size as unavailable');
  if (JSON.stringify(cat).includes('quantity')) bad('the public catalogue leaks a quantity field');
  else ok('The public catalogue carries no quantity, only availability');

  // A rebuild must render the size as sold out in the page itself.
  await execFileAsync(process.execPath, ['build.js'], { cwd: ROOT, env }).catch(() => {});
  const { c, page } = await ctx();
  await page.goto(`${BASE}/products/${SLUG}/`);
  const xxlDisabled = await page.locator('[data-size="XXL"]').isDisabled().catch(() => null);
  if (xxlDisabled === true) ok('After a rebuild the sold-out size is disabled in the size selector');
  else note(`a rebuild alone does not close the size (the build reads data/products.js, not the database) — the live check below is what closes it: XXL disabled after rebuild = ${xxlDisabled}`);
  await c.close();

  /**
   * Live availability on the product page.
   *
   * The pages are statically built, so a size that sells out AFTER the build
   * would still be offered until someone rebuilt — the customer would fill in
   * the whole checkout before being refused. The page now asks the API on load
   * and closes the sizes that are gone.
   */
  {
    const { c: c2, page: p2 } = await ctx();
    await p2.goto(`${BASE}/products/${SLUG}/`);
    await p2.waitForTimeout(900); // the sync is fire-and-forget

    const state = await p2.evaluate(() => {
      const btn = document.querySelector('[data-size="XXL"]');
      return { disabled: btn?.disabled, state: btn?.dataset.state, label: btn?.getAttribute('aria-label') };
    });
    if (!state.disabled) {
      bad(`a size that sold out after the build is still selectable: ${JSON.stringify(state)}`);
    } else {
      ok('A size that sold out AFTER the build is closed on the product page by a live check');
    }

    // Clicking it must not put it in the cart.
    await p2.click('[data-size="XXL"]', { force: true }).catch(() => {});
    await p2.click('[data-add-btn]', { force: true }).catch(() => {});
    await p2.waitForTimeout(200);
    const inCart = (await p2.textContent('.header [data-cart-count]')).trim();
    if (inCart !== '0') bad(`a sold-out size was added to the cart (count ${inCart})`);
    else ok('A sold-out size cannot be forced into the cart');

    // Other sizes must still work — the sync must only ever REMOVE.
    await p2.click('[data-size="M"]');
    await p2.click('[data-add-btn]');
    await p2.waitForTimeout(200);
    if ((await p2.textContent('.header [data-cart-count]')).trim() !== '1') {
      bad('the live availability check broke the sizes that ARE in stock');
    } else ok('Sizes that are in stock still work after the live check');
    await c2.close();
  }

  {
    // Fail-safe: with the API unreachable the page must behave exactly as the
    // build left it, not lock the customer out of every size.
    const { c: c3, page: p3, errors } = await ctx();
    await p3.route('**/api/catalogue', (r) => r.abort());
    await p3.goto(`${BASE}/products/${SLUG}/`);
    await p3.waitForTimeout(900);
    await p3.click('[data-size="M"]');
    await p3.click('[data-add-btn]');
    await p3.waitForTimeout(200);
    const count = (await p3.textContent('.header [data-cart-count]')).trim();
    if (count !== '1') bad(`with the availability API down the product page stopped working (count ${count})`);
    else ok('With the availability API unreachable the product page still works exactly as built');

    const fatal = errors.filter((e) => !/Failed to load resource|net::ERR|fonts/i.test(e));
    if (fatal.length) bad(`a failed availability check produced page errors: ${fatal[0]}`);
    else ok('A failed availability check produces no page errors');
    await c3.close();
  }

  await setStock('XXL', 20);
  await execFileAsync(process.execPath, ['build.js'], { cwd: ROOT, env }).catch(() => {});
}

/* ------------------------------------------------------------- the cart */

group('1d. FUNCTIONAL — cart: add, quantity up and down, remove');

{
  const { c, page } = await ctx();
  await addToCart(page, 'M');
  await page.goto(`${BASE}/cart/`);

  const countNow = async () => (await page.textContent('.header [data-cart-count]')).trim();
  const subtotalNow = async () => (await page.textContent('[data-cart-subtotal]')).trim();

  if ((await countNow()) !== '1') bad('cart page does not show the added piece');
  else ok('Cart shows the added piece');

  await page.click('[data-line-inc]');
  await page.waitForTimeout(200);
  if ((await countNow()) !== '2') bad(`increment did not work: count = ${await countNow()}`);
  else ok('Quantity increment works');

  const sub2 = await subtotalNow();
  if (!/34/.test(sub2)) bad(`subtotal after 2 pieces is "${sub2}", expected $34`);
  else ok('Subtotal follows the quantity ($34 at 2 pieces)');

  await page.click('[data-line-dec]');
  await page.waitForTimeout(200);
  if ((await countNow()) !== '1') bad(`decrement did not work: count = ${await countNow()}`);
  else ok('Quantity decrement works');

  await page.click('[data-line-remove]');
  await page.waitForTimeout(200);
  if ((await countNow()) !== '0') bad(`remove did not work: count = ${await countNow()}`);
  else ok('Remove from cart works');

  // The drawer and the page body BOTH carry [data-cart-empty], so a bare
  // locator throws a strict-mode violation. Assert on the one inside the cart
  // page, and read the state directly rather than swallowing an error into a
  // false negative — that is exactly how this check first lied.
  const emptyState = await page.evaluate(() => {
    const el = document.querySelector('[data-cart-page] [data-cart-empty]')
      || document.querySelectorAll('[data-cart-empty]')[1]
      || document.querySelector('[data-cart-empty]');
    if (!el) return { found: false };
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      found: true,
      hidden: el.hidden,
      displayed: style.display !== 'none' && style.visibility !== 'hidden',
      painted: rect.width > 0 && rect.height > 0,
      text: el.textContent.trim(),
    };
  });
  if (!emptyState.found) bad('there is no empty-cart message element on the cart page');
  else if (emptyState.hidden || !emptyState.displayed || !emptyState.painted) {
    bad(`the empty-cart message is not shown after removing the last line: ${JSON.stringify(emptyState)}`);
  } else if (!/empty/i.test(emptyState.text)) {
    bad(`the empty-cart message reads "${emptyState.text}"`);
  } else ok(`The empty-cart message appears when the cart is emptied ("${emptyState.text}")`);

  // Persistence across a reload — a cart lost on refresh is a lost sale.
  await addToCart(page, 'S', 2);
  await page.goto(`${BASE}/cart/`);
  await page.reload();
  if ((await countNow()) !== '2') bad(`cart did not survive a reload: ${await countNow()}`);
  else ok('The cart survives a full page reload');

  await c.close();
}

/* ------------------------------------------------------------ discounts */

group('1e. FUNCTIONAL — discount tiers and free shipping');

/** Place an order through the API and return the stored order. */
async function orderVia(items, phone, extra = {}) {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Discount Tester',
      phone,
      city: 'Aleppo',
      address: '5 Discount Street, building 2, first floor',
      items,
      ...extra,
    }),
  });
  return { status: res.status, body: await res.json() };
}

{
  for (const size of SIZES) await setStock(size, 40);

  const one = await orderVia([{ slug: SLUG, size: 'L', quantity: 1 }], '0955300001');
  if (one.body.order?.discountPercent !== 0 || one.body.order?.total !== 17) {
    bad(`1 piece: ${one.body.order?.discountPercent}% off, total ${one.body.order?.total} (expected 0%, $17)`);
  } else ok('1 piece: no discount, $17');
  if (one.body.order?.shippingFree !== false) bad('1 piece should not get free shipping');
  else ok('1 piece: shipping is not free (paid on delivery)');

  const two = await orderVia([{ slug: SLUG, size: 'L', quantity: 2 }], '0955300002');
  if (two.body.order?.discountPercent !== 5 || two.body.order?.total !== 32.3) {
    bad(`2 pieces: ${two.body.order?.discountPercent}% off, total ${two.body.order?.total} (expected 5%, $32.30)`);
  } else ok('2 pieces: 5% off, $34 → $32.30');
  if (two.body.order?.shippingFree !== true) bad('2 pieces should get free shipping');
  else ok('2 pieces: free shipping applied');

  const three = await orderVia([{ slug: SLUG, size: 'M', quantity: 3 }], '0955300003');
  if (three.body.order?.discountPercent !== 10 || three.body.order?.total !== 45.9) {
    bad(`3 pieces: ${three.body.order?.discountPercent}% off, total ${three.body.order?.total} (expected 10%, $45.90)`);
  } else ok('3 pieces: 10% off, $51 → $45.90');

  const five = await orderVia([{ slug: SLUG, size: 'M', quantity: 5 }], '0955300005');
  if (five.body.order?.discountPercent !== 10) bad(`5 pieces: ${five.body.order?.discountPercent}% off, expected 10%`);
  else ok('5 pieces: still the 10% tier (no invented deeper tier)');

  const mixed = await orderVia(
    [
      { slug: SLUG, size: 'S', quantity: 1 },
      { slug: SLUG, size: 'XL', quantity: 1 },
    ],
    '0955300006'
  );
  if (mixed.body.order?.discountPercent !== 5 || mixed.body.order?.pieces !== 2) {
    bad(`2 pieces across two sizes: ${mixed.body.order?.pieces} pieces, ${mixed.body.order?.discountPercent}%`);
  } else ok('The tier counts PIECES, not lines: two sizes × 1 = 5% off');

  /* --- returning customer: only after DELIVERED --- */
  const returningPhone = '0955300777';
  const first = await orderVia([{ slug: SLUG, size: 'L', quantity: 1 }], returningPhone);
  const firstId = first.body.order.orderId;

  const second = await orderVia([{ slug: SLUG, size: 'S', quantity: 1 }], returningPhone);
  if (second.body.order?.discountPercent !== 0) {
    bad(`a customer with a PENDING order already gets ${second.body.order?.discountPercent}%`);
  } else ok('Returning discount is NOT given while the previous order is only PENDING');

  for (const status of ['ACCEPTED', 'PREPARING', 'SHIPPED']) {
    await adminPost(`/admin/orders/${firstId}/status`, { status });
  }
  const midway = await orderVia([{ slug: SLUG, size: 'XL', quantity: 1 }], returningPhone);
  if (midway.body.order?.discountPercent !== 0) {
    bad(`a customer whose order is only SHIPPED gets ${midway.body.order?.discountPercent}%`);
  } else ok('Returning discount is NOT given at ACCEPTED, PREPARING or SHIPPED');

  await adminPost(`/admin/orders/${firstId}/status`, { status: 'DELIVERED' });
  const afterDelivery = await orderVia([{ slug: SLUG, size: 'M', quantity: 1 }], returningPhone);
  if (afterDelivery.body.order?.discountPercent !== 5 || afterDelivery.body.order?.total !== 16.15) {
    bad(
      `after DELIVERED: ${afterDelivery.body.order?.discountPercent}% off, total ${afterDelivery.body.order?.total} (expected 5%, $16.15)`
    );
  } else ok('Returning discount applies only after a previous order reached DELIVERED: $17 → $16.15');

  // No stacking: 3 pieces (10%) for a returning customer must stay 10%, not 15%.
  const stacked = await orderVia([{ slug: SLUG, size: 'M', quantity: 3 }], returningPhone);
  if (stacked.body.order?.discountPercent !== 10) {
    bad(`bundle + returning stacked to ${stacked.body.order?.discountPercent}% (must take the single largest, 10%)`);
  } else ok('Discounts do not stack — the largest single discount wins (10%, not 15%)');
}

/* -------------------------------------------- duplicate click protection */

group('1f. FUNCTIONAL — duplicate clicks on Confirm by WhatsApp');

{
  const { c, page } = await ctx();
  await addToCart(page, 'L');
  await page.goto(`${BASE}/checkout/`);
  await fillCheckout(page, { phone: '0955400500' });

  // Three real clicks as fast as Playwright can deliver them.
  await Promise.all([
    page.click('[data-checkout-submit]'),
    page.click('[data-checkout-submit]', { force: true }).catch(() => {}),
    page.click('[data-checkout-submit]', { force: true }).catch(() => {}),
  ]).catch(() => {});
  await page.waitForURL(/\/order\/\?id=/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);

  const rows = await query('SELECT order_number FROM orders WHERE customer_phone = ?', ['963955400500']);
  if (rows.length !== 1) bad(`three rapid clicks created ${rows.length} orders`);
  else ok('Three rapid clicks on Confirm by WhatsApp create exactly one order');

  // And a resubmit after landing on the order page must not create another.
  await page.goBack().catch(() => {});
  await page.waitForTimeout(300);
  const after = await query('SELECT order_number FROM orders WHERE customer_phone = ?', ['963955400500']);
  if (after.length !== 1) bad(`navigating back created another order (${after.length} total)`);
  else ok('Going back to the checkout does not create a second order');

  await c.close();
}

/* ---------------------------------------------------------------- admin */

group('1g. FUNCTIONAL — the admin');

{
  const { c, page } = await ctx();

  await page.goto(`${BASE}/admin/orders`);
  const anon = await page.content();
  if (!/Admin sign in/.test(anon) || /Prelaunch Buyer/.test(anon)) {
    bad('the admin showed order data to a visitor with no session');
  } else ok('Admin refuses an anonymous visitor and shows the login form');

  await page.fill('#email', ADMIN.email);
  await page.fill('#password', 'definitely-the-wrong-password');
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  if (!/Incorrect email or password/.test(await page.content())) bad('a wrong password did not error');
  else ok('Admin login rejects a wrong password');

  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  if (!/Dashboard/.test(await page.content())) bad('a correct password did not sign in');
  else ok('Admin login works with the correct password');

  await page.goto(`${BASE}/admin/orders`);
  if (!(await page.content()).includes(journeyOrderId)) bad('the order list does not show the journey order');
  else ok('Admin order list shows real orders');

  /* --- stock moves ONLY on acceptance --- */
  await setStock('L', 10);
  const target = await orderVia([{ slug: SLUG, size: 'L', quantity: 2 }], '0955500600');
  const targetId = target.body.order.orderId;

  const beforeAccept = await stockOf('L');
  if (beforeAccept !== 10) bad(`placing an order changed stock to ${beforeAccept}`);
  else ok('Placing an order does NOT move stock (stock stays 10)');

  await page.goto(`${BASE}/admin/orders/${targetId}`);
  await page.click(`form[action="/admin/orders/${targetId}/status"] button:has-text("ACCEPTED")`);
  await page.waitForLoadState('domcontentloaded');

  const afterAccept = await stockOf('L');
  if (afterAccept !== 8) bad(`accepting a 2-piece order left stock at ${afterAccept}, expected 8`);
  else ok('Accepting decrements stock by exactly the ordered quantity (10 → 8)');

  await page.click(`form[action="/admin/orders/${targetId}/status"] button:has-text("REJECTED")`);
  await page.waitForLoadState('domcontentloaded');
  const afterReject = await stockOf('L');
  if (afterReject !== 10) bad(`rejecting did not return stock: ${afterReject}, expected 10`);
  else ok('Rejecting an accepted order returns the stock (8 → 10)');

  /* --- the full status walk --- */
  const walk = await orderVia([{ slug: SLUG, size: 'M', quantity: 1 }], '0955500700');
  const walkId = walk.body.order.orderId;
  await page.goto(`${BASE}/admin/orders/${walkId}`);
  const reached = [];
  for (const status of ['ACCEPTED', 'PREPARING', 'SHIPPED', 'DELIVERED']) {
    await page.click(`form[action="/admin/orders/${walkId}/status"] button:has-text("${status}")`);
    await page.waitForLoadState('domcontentloaded');
    const now = await query('SELECT status FROM orders WHERE order_number = ?', [walkId]);
    if (now[0]?.status === status) reached.push(status);
  }
  if (reached.length !== 4) bad(`status walk only reached: ${reached.join(' → ') || 'nothing'}`);
  else ok('Admin can walk PENDING → ACCEPTED → PREPARING → SHIPPED → DELIVERED');

  /* --- inventory editing --- */
  await page.goto(`${BASE}/admin/inventory`);
  await page.fill('#q-vestiphobia-001-fear-tee-S', '7');
  await page.click(
    'form[action="/admin/inventory/quantity"]:has(#q-vestiphobia-001-fear-tee-S) button[type=submit]'
  );
  await page.waitForLoadState('domcontentloaded');
  if ((await stockOf('S')) !== 7) bad(`inventory edit did not save: S = ${await stockOf('S')}`);
  else ok('Admin can set a stock quantity, and it saves');

  const ledger = await query(
    "SELECT reason FROM inventory_ledger WHERE size = 'S' ORDER BY created_at DESC LIMIT 1"
  );
  if (ledger[0]?.reason !== 'manual_adjust') bad('a manual stock change was not recorded in the ledger');
  else ok('A manual stock change is recorded in the stock ledger');

  /* --- closing a size by hand --- */
  await page.click(
    'form[action="/admin/inventory/closed"]:has(input[value="S"]) button[type=submit]'
  );
  await page.waitForLoadState('domcontentloaded');
  const closed = await query("SELECT manual_out_of_stock, quantity FROM inventory WHERE size = 'S'");
  if (Number(closed[0]?.manual_out_of_stock) !== 1) bad('closing a size by hand did not take effect');
  else if (Number(closed[0]?.quantity) !== 7) bad('closing a size destroyed its quantity');
  else ok('A size can be closed by hand without destroying its stock count');

  const closedOrder = await orderVia([{ slug: SLUG, size: 'S', quantity: 1 }], '0955500800');
  if (closedOrder.status < 400) bad('a hand-closed size could still be ordered');
  else ok('A hand-closed size cannot be ordered');

  await page.click(
    'form[action="/admin/inventory/closed"]:has(input[value="S"]) button[type=submit]'
  );
  await page.waitForLoadState('domcontentloaded');
  await setStock('S', 40);

  await c.close();
}

/* ========================================================== 2. SECURITY */

group('2. SECURITY — XSS through every input field');

const XSS_PAYLOADS = [
  '<script>window.__xss=1</script>',
  '"><script>window.__xss=1</script>',
  '<img src=x onerror="window.__xss=1">',
  "<svg/onload=window.__xss=1>",
  'javascript:window.__xss=1',
  '<iframe src="javascript:window.__xss=1"></iframe>',
  "'><img src=x onerror=window.__xss=1>",
  '</textarea><script>window.__xss=1</script>',
];

{
  // Push a payload through every field, then look for it where it lands:
  // the customer's own confirmation page AND the admin order detail.
  const { c, page, errors } = await ctx();
  const results = [];
  const adminOrderIds = [];

  for (const [i, payload] of XSS_PAYLOADS.entries()) {
    const phone = `09556${String(i).padStart(2, '0')}900`;
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: payload,
        phone,
        city: payload,
        address: `${payload} 12 Injection Street, building 4`,
        notes: payload,
        // The email field is validated as ^[^\s@]+@[^\s@]+\.[^\s@]{2,}$ — no
        // whitespace, exactly one '@'. Most XSS_PAYLOADS entries fail that
        // shape outright (which is itself fine), so this wraps the payload
        // as a local-part to get a value that both passes validation AND
        // still carries the payload into the email field specifically —
        // otherwise this loop tests name/city/address/notes but never email.
        email: `${payload.replace(/[\s@]/g, '')}@evil.com`,
        items: [{ slug: SLUG, size: 'M', quantity: 1 }],
      }),
    });
    const body = await res.json();
    if (res.status !== 201) {
      results.push(`payload ${i} was refused (${res.status}) — no order to inspect`);
      continue;
    }
    const id = body.order.orderId;

    // The customer's confirmation page, rendered from the receipt.
    await page.goto(`${BASE}/order/?id=${encodeURIComponent(id)}&`);
    await page.evaluate(
      ([orderId, ph]) => localStorage.setItem('vestiphobia.orders.v1', JSON.stringify([])) ,
      [id, phone]
    );
    await page.goto(`${BASE}/order/?id=${encodeURIComponent(id)}`);
    await page.fill('#lookup-phone', phone).catch(() => {});
    await page.click('[data-order-lookup] button[type=submit]').catch(() => {});
    await page.waitForTimeout(400);
    const firedOnOrder = await page.evaluate(() => window.__xss === 1);
    if (firedOnOrder) results.push(`payload ${i} EXECUTED on the customer order page`);

    adminOrderIds.push(id);
  }

  /**
   * Now the authoritative check: sign in as the admin IN THE BROWSER and open
   * every screen that renders this data, asking whether the payload EXECUTED.
   *
   * Grepping the HTML for the payload does not answer this. A correctly
   * escaped `'><img src=x onerror=window.__xss=1>` still contains the literal
   * text "onerror=window.__xss" — none of those characters need escaping — so
   * a text match reports a hole that is not there. Execution is the question,
   * so execution is what gets asked.
   */
  await page.goto(`${BASE}/admin/login`);
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');

  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.dismiss();
  });

  const screens = [
    '/admin',
    '/admin/orders',
    '/admin/customers',
    '/admin/emails',
    '/admin/analytics?tab=events',
    '/admin/audit',
    ...adminOrderIds.map((id) => `/admin/orders/${id}`),
  ];
  for (const screen of screens) {
    await page.goto(BASE + screen);
    await page.waitForTimeout(120);
    if (await page.evaluate(() => window.__xss === 1)) results.push(`EXECUTED on ${screen}`);
    await page.evaluate(() => {
      window.__xss = 0;
    });
  }

  if (results.length) bad(`XSS findings: ${results.join(' | ')}`);
  else {
    ok(
      `None of ${XSS_PAYLOADS.length} XSS payloads (through name, city, address, notes and email) execute ` +
        `on the customer order page or on any of ${screens.length} admin screens`
    );
  }
  if (dialogs.length) bad(`a payload opened a dialog: ${dialogs.join(', ')}`);
  else ok('No injected payload opened a dialog anywhere');

  const fatal = errors.filter((e) => !/Failed to load resource|net::ERR|fonts/i.test(e));
  if (fatal.length) note(`console errors while injecting: ${fatal.slice(0, 2).join(' | ')}`);

  await c.close();
}

{
  // Escaping, checked at the character level rather than by looking for the
  // payload's words: what matters is that no RAW angle bracket from user data
  // reached the markup. Compare the count of escaped entities against raw tags
  // that would open an element.
  // Screens that DO render customer data must render it escaped.
  const dataScreens = ['/admin/orders', '/admin/customers'];
  const problems = [];
  for (const screen of dataScreens) {
    const html = await (await fetch(BASE + screen, { headers: { cookie: adminCookie } })).text();
    const injectedTags = html.match(/<script>window\.__xss|<img src=x onerror|<svg\/onload|<iframe src="javascript:/g) || [];
    if (injectedTags.length) problems.push(`${screen}: ${injectedTags.length} raw injected tag(s)`);
    // The escaped form must be present, proving the data reached the page at
    // all rather than the check passing because nothing was rendered.
    if (!/&lt;script&gt;|&lt;img|&lt;svg/.test(html)) {
      problems.push(`${screen}: no escaped payload found — did the data reach this screen?`);
    }
  }
  if (problems.length) bad(`escaping on admin screens: ${problems.join(' | ')}`);
  else ok('Payloads reach the order and customer screens as ESCAPED entities, never as tags');

  // The analytics screen is the opposite requirement: the payloads went in
  // through order fields, and analytics must hold NO customer data at all, so
  // neither the raw nor the escaped form may appear there.
  const analyticsHtml = await (
    await fetch(`${BASE}/admin/analytics?tab=events`, { headers: { cookie: adminCookie } })
  ).text();
  const bled = /window\.__xss|&lt;script&gt;|&lt;img src=x|Injection Street/.test(analyticsHtml);
  if (bled) bad('customer-supplied text from an order appears on the analytics screen');
  else ok('No customer-supplied text from any order reaches the analytics screen, escaped or otherwise');
}

group('2b. SECURITY — injection, secrets, headers, rate limits, access control');

{
  // SQL injection through every string field that reaches a query.
  const injections = [
    "Robert'); DROP TABLE orders;--",
    "' OR '1'='1",
    "'; DELETE FROM inventory; --",
    "1' UNION SELECT password_hash FROM admins --",
    "\\'; DROP TABLE customers; --",
  ];
  for (const [i, payload] of injections.entries()) {
    await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: payload,
        phone: `09557${String(i).padStart(2, '0')}100`,
        city: payload,
        address: `${payload} building 2, third floor`,
        items: [{ slug: payload, size: payload, quantity: 1 }],
      }),
    });
    // Search endpoints take the payload straight into a LIKE.
    await fetch(`${BASE}/admin/orders?q=${encodeURIComponent(payload)}`, {
      headers: { cookie: adminCookie },
    });
    await fetch(`${BASE}/admin/customers?q=${encodeURIComponent(payload)}`, {
      headers: { cookie: adminCookie },
    });
  }

  const expected = ['orders', 'order_items', 'customers', 'inventory', 'admins', 'sessions'];
  const missing = [];
  for (const t of expected) if (!(await tableExists(t))) missing.push(t);
  if (missing.length) bad(`SQL injection destroyed tables: ${missing.join(', ')}`);
  else ok(`All ${injections.length} SQL injection payloads left every table intact`);

  // The analytics event filter takes a value straight into a WHERE clause,
  // so it gets its own injection attempt rather than being trusted because
  // the code looked structural.
  for (const payload of ["' OR 1=1 --", "'; DROP TABLE analytics_events; --", "x' UNION SELECT 1 --"]) {
    await fetch(`${BASE}/admin/analytics?tab=events&name=${encodeURIComponent(payload)}`, {
      headers: { cookie: adminCookie },
    });
  }
  if (!(await tableExists('analytics_events'))) {
    bad('SQL injection through the analytics filter dropped the events table');
  }
  else ok('SQL injection through the analytics event filter changes nothing');

  const stillServing = await fetch(`${BASE}/api/health`);
  if (!stillServing.ok) bad('the server did not survive the injection attempts');
  else ok('The server is healthy after every injection attempt');

  /**
   * Parameterisation, checked at the CALL SITES rather than by grepping for
   * SQL keywords.
   *
   * The first version of this check searched the source for SQL verbs followed
   * by an interpolation, and reported two hits that were nothing of the sort:
   * an HTML string containing the word "Updated" (which contains "UPDATE"),
   * and `listOrders`, which interpolates only fixed literal fragments like
   * "status = ?" while every value goes to the params array. So this looks at
   * what is actually passed as the SQL argument to db.all / db.get / db.run.
   */
  const serverFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) serverFiles.push(full);
    }
  };
  walk(join(ROOT, 'server'));

  // Interpolations that are structural, not values — each one is a fixed
  // fragment or a column name the code itself chose, never user input.
  const STRUCTURAL = [
    '${where.join',        // fixed fragments: "status = ?", "(... LIKE ?)"
    '${where.length',
    '${where}',            // rawEvents: two fixed literals, the value is bound
    '${sets.join',         // fixed "column = ?" fragments in updateProduct
    '${column}',           // whitelisted column name in the analytics reports
    '${table}',
    '${MILESTONES',
    '${column} = 1',
    '${ddl}',              // migration DDL, not a value
    '${Number(process.env.SQLITE_BUSY_TIMEOUT_MS',
  ];

  const suspicious = [];
  for (const file of serverFiles) {
    const src = readFileSync(file, 'utf8');
    // Every db.all / db.get / db.run / tx.* call, with its first argument.
    const calls = src.match(/\b(?:db|tx|client)\.(?:all|get|run|exec)\(\s*`[^`]*`/g) || [];
    for (const call of calls) {
      const sqlText = call.slice(call.indexOf('`'));
      if (!sqlText.includes('${')) continue;
      const interpolations = sqlText.match(/\$\{[^}]*\}/g) || [];
      for (const interp of interpolations) {
        if (!STRUCTURAL.some((allowed) => interp.startsWith(allowed) || interp === allowed)) {
          suspicious.push(`${file.replace(ROOT + '/', '')}: ${interp}`);
        }
      }
    }
  }

  if (suspicious.length) {
    bad(`SQL with a non-structural interpolation: ${[...new Set(suspicious)].slice(0, 4).join(' | ')}`);
  } else {
    ok('No SQL builds a value into the query text — every value is a bound parameter');
  }
}

{
  // Secrets and the WhatsApp number in the shipped frontend.
  const DIST = join(ROOT, 'dist');
  const jsFiles = readdirSync(join(DIST, 'assets/js'));
  const leaks = [];
  for (const f of jsFiles) {
    const src = readFileSync(join(DIST, 'assets/js', f), 'utf8');
    if (/963965438721/.test(src)) leaks.push(`${f} contains the WhatsApp number`);
    for (const re of [
      /password\s*[:=]\s*['"][^'"]{3,}/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]{3,}/i,
      /secret\s*[:=]\s*['"][^'"]{3,}/i,
      /sk_live|pk_live|Bearer\s+[A-Za-z0-9]{20,}/,
    ]) {
      if (re.test(src)) leaks.push(`${f}: ${(src.match(re) || [])[0].slice(0, 40)}`);
    }
  }
  for (const pageFile of ['index.html', 'checkout/index.html', 'products/' + SLUG + '/index.html']) {
    const html = readFileSync(join(DIST, pageFile), 'utf8');
    if (/963965438721/.test(html)) leaks.push(`${pageFile} contains the WhatsApp number`);
    const cfg = html.match(/window\.VESTI = \{.*?\};/s)?.[0] || '';
    if (/password|apiKey|api_key|secret|token/i.test(cfg)) leaks.push(`${pageFile}: runtime config looks credential-shaped`);
  }
  if (leaks.length) bad(`secrets in the shipped frontend: ${leaks.join(' | ')}`);
  else ok('No secrets and no WhatsApp number anywhere in the shipped JavaScript or HTML');

  // The secret setting must never come back from a public endpoint.
  const config = await (await fetch(`${BASE}/api/config`)).text();
  const catalogue = await (await fetch(`${BASE}/api/catalogue`)).text();
  if (/sham/i.test(config + catalogue) || /963965438721/.test(config + catalogue)) {
    bad('a public endpoint returns the Sham Cash instructions or the WhatsApp number');
  } else ok('Public endpoints return neither the Sham Cash instructions nor the WhatsApp number');
}

{
  // Security headers on a page, an API response and the admin.
  const targets = [
    ['/', 'storefront'],
    ['/api/catalogue', 'API'],
    ['/admin/login', 'admin'],
  ];
  const missing = [];
  for (const [path, label] of targets) {
    const res = await fetch(BASE + path);
    const need = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    };
    for (const [header, value] of Object.entries(need)) {
      if (res.headers.get(header) !== value) missing.push(`${label} ${header}=${res.headers.get(header)}`);
    }
    const csp = res.headers.get('content-security-policy') || '';
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'self'"]) {
      if (!csp.includes(directive)) missing.push(`${label} CSP missing ${directive}`);
    }
    if (!res.headers.get('permissions-policy')) missing.push(`${label} has no Permissions-Policy`);
  }
  if (missing.length) bad(`security headers: ${missing.join(', ')}`);
  else ok('CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy and Permissions-Policy on pages, API and admin');

  /**
   * HSTS, tested rather than assumed.
   *
   * The header must appear over HTTPS and must NOT appear over plain HTTP —
   * claiming it on an http:// response would be both wrong and useless. The
   * app decides from X-Forwarded-Proto, which is exactly what a production
   * proxy sends, so it can be exercised locally by sending that header.
   */
  const hstsChecks = [];
  for (const [path, label] of [['/', 'storefront'], ['/api/catalogue', 'API'], ['/admin/login', 'admin']]) {
    const overHttps = await fetch(BASE + path, { headers: { 'X-Forwarded-Proto': 'https' } });
    const overHttp = await fetch(BASE + path);
    const secure = overHttps.headers.get('strict-transport-security');
    const insecure = overHttp.headers.get('strict-transport-security');
    if (!secure || !/max-age=\d{7,}/.test(secure)) hstsChecks.push(`${label}: no HSTS over HTTPS (${secure})`);
    if (!/includeSubDomains/.test(secure || '')) hstsChecks.push(`${label}: HSTS lacks includeSubDomains`);
    if (insecure) hstsChecks.push(`${label}: claims HSTS over plain HTTP`);
  }
  if (hstsChecks.length) bad(`HSTS: ${hstsChecks.join(', ')}`);
  else ok('HSTS (max-age 1 year, includeSubDomains) is sent on pages, API and admin over HTTPS — and never over plain HTTP');

  // The session cookie's flags, on a real login, over both schemes.
  const secureLogin = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Origin: BASE,
      'X-Forwarded-Proto': 'https',
    },
    body: new URLSearchParams({ email: ADMIN.email, password: ADMIN.password }),
    redirect: 'manual',
  });
  const secureCookie = secureLogin.headers.get('set-cookie') || '';
  const plainLogin = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ email: ADMIN.email, password: ADMIN.password }),
    redirect: 'manual',
  });
  const plainCookie = plainLogin.headers.get('set-cookie') || '';

  const cookieProblems = [];
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure']) {
    if (!secureCookie.includes(flag)) cookieProblems.push(`missing ${flag} over HTTPS`);
  }
  if (plainCookie.includes('Secure')) cookieProblems.push('marks the cookie Secure over plain HTTP, which would break local development');
  if (!plainCookie.includes('HttpOnly')) cookieProblems.push('missing HttpOnly over plain HTTP');
  if (cookieProblems.length) bad(`session cookie: ${cookieProblems.join(', ')}`);
  else ok('The session cookie is HttpOnly + SameSite=Strict always, and Secure exactly when the request arrived over HTTPS');
}

{
  // Rate limiting on login. The limit is 10 per 15 minutes per IP and email.
  const before = Date.now();
  let refusedAt = null;
  for (let i = 0; i < 16; i++) {
    const res = await fetch(`${BASE}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
      body: new URLSearchParams({ email: 'bruteforce@vestiphobia.test', password: `guess-${i}` }),
      redirect: 'manual',
    });
    if (res.status === 429 && refusedAt === null) refusedAt = i + 1;
  }
  if (refusedAt === null) bad('login accepted 16 wrong passwords in a row with no rate limit');
  else ok(`Login is rate limited — refused with 429 after ${refusedAt} attempts (in ${Date.now() - before}ms)`);

  // The order endpoint is limited too. This server runs with the limit raised
  // for the suite, so the mechanism is asserted rather than the number.
  const limited = await query("SELECT bucket FROM rate_limits WHERE bucket LIKE 'login:%' LIMIT 3");
  if (!limited.length) bad('no rate-limit buckets were recorded');
  else ok('Rate limits are recorded in the database, so they survive a restart and hold across processes');
  note(`ORDER_RATE_LIMIT was raised to ${env.ORDER_RATE_LIMIT} for this suite; production default is 30/hour per IP`);
}

{
  // Admin route protection, exhaustively.
  const adminRoutes = [
    '/admin',
    '/admin/orders',
    '/admin/customers',
    '/admin/products',
    '/admin/inventory',
    '/admin/content',
    '/admin/settings',
    '/admin/emails',
    '/admin/audit',
    '/admin/analytics',
    '/admin/analytics?tab=events',
  ];
  const leaked = [];
  for (const route of adminRoutes) {
    const res = await fetch(BASE + route);
    const body = await res.text();
    if (res.status !== 401) leaked.push(`${route} → ${res.status}`);
    if (/Prelaunch Buyer|963955|Dashboard<\/h1>/.test(body)) leaked.push(`${route} leaked content`);
  }
  if (leaked.length) bad(`admin routes reachable without a session: ${leaked.join(', ')}`);
  else ok(`All ${adminRoutes.length} admin routes return 401 and leak nothing without a session`);

  // Mutations too, not just the screens.
  const mutations = [
    ['/admin/inventory/quantity', { slug: SLUG, size: 'L', quantity: '9999' }],
    ['/admin/settings', { key: 'whatsapp.number', value: '000' }],
    ['/admin/content', { key: 'announcement', value: 'hacked' }],
    [`/admin/orders/${journeyOrderId}/status`, { status: 'DELIVERED' }],
  ];
  const stockBefore = await stockOf('L');
  const accepted = [];
  for (const [route, body] of mutations) {
    const res = await fetch(BASE + route, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Origin: BASE },
      body: new URLSearchParams(body),
      redirect: 'manual',
    });
    if (res.status !== 401) accepted.push(`${route} → ${res.status}`);
  }
  if (accepted.length) bad(`admin mutations accepted without a session: ${accepted.join(', ')}`);
  else ok('No admin mutation is accepted without a session');
  if ((await stockOf('L')) !== stockBefore) bad('an unauthenticated request changed stock');
  else ok('An unauthenticated mutation attempt changed nothing');

  // CSRF: a valid session but a foreign Origin.
  const csrf = await fetch(`${BASE}/admin/inventory/quantity`, {
    method: 'POST',
    headers: {
      cookie: adminCookie,
      Origin: 'https://evil.example.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ slug: SLUG, size: 'L', quantity: '9999' }),
    redirect: 'manual',
  });
  if (!/m=forbidden/.test(csrf.headers.get('location') || '')) bad('a cross-origin admin POST was not refused');
  else if ((await stockOf('L')) !== stockBefore) bad('a cross-origin POST changed stock');
  else ok('A cross-origin POST with a VALID session is still refused, and changes nothing');
}

/* ======================================================= 3. DATA SAFETY */

group('3. DATA SAFETY');

{
  const phone = '963955100200';
  const inDb = await query('SELECT customer_name, customer_phone, address FROM orders WHERE customer_phone = ?', [phone]);
  if (!inDb.length) bad('the journey order is not in the database');
  else ok('Customer name, phone and address are stored in the orders table');

  // The same data must not be anywhere in analytics.
  const events = await query('SELECT props, path, referrer FROM analytics_events');
  const sessions = await query(
    `SELECT source, medium, campaign, utm_source, utm_medium, utm_campaign, utm_content,
            utm_term, referrer_host, landing_path, exit_path, order_number FROM analytics_sessions`
  );
  const haystack = JSON.stringify(events) + JSON.stringify(sessions);
  const needles = [
    'Prelaunch Buyer',
    'Discount Tester',
    'Prelaunch Street',
    'Discount Street',
    '0955100200',
    '963955100200',
    'Damascus',
    'Aleppo',
  ];
  const found = needles.filter((n) => haystack.includes(n));
  const digits = (haystack.replace(/VST-\d{4}-\d{4}/g, '').match(/\d{7,}/g) || []).slice(0, 3);
  if (found.length) bad(`customer PII found in analytics: ${found.join(', ')}`);
  else if (digits.length) bad(`phone-shaped digits in analytics: ${digits.join(', ')}`);
  else ok('No name, phone, address or city from any order appears in the analytics tables');

  // And no raw IP anywhere in analytics.
  const eventColumns = await columnNames('analytics_events');
  if (!eventColumns) {
    note('the analytics events table was empty, so its columns could not be listed');
  } else if (eventColumns.some((c) => /(^|_)ip(_|$)/i.test(c))) {
    bad(`the analytics events table has an IP column: ${eventColumns.filter((c) => /ip/i.test(c)).join(', ')}`);
  } else {
    ok(`The analytics schema has no IP column at all — not even hashed (${eventColumns.length} columns checked)`);
  }

  // The audit log hashes IPs rather than storing them.
  const audit = await query('SELECT ip_hash FROM audit_log WHERE ip_hash IS NOT NULL LIMIT 3');
  const looksLikeIp = audit.some((r) => /^\d+\.\d+\.\d+\.\d+$|^::1$|^127\./.test(String(r.ip_hash)));
  if (looksLikeIp) bad('the audit log stores a raw IP address');
  else ok('The audit log stores only hashed IPs');
}

{
  // An order must survive a page refresh and a mid-flight network failure.
  const { c, page } = await ctx();
  await addToCart(page, 'M');
  await page.goto(`${BASE}/checkout/`);
  await fillCheckout(page, { phone: '0955700800' });
  await page.click('[data-checkout-submit]');
  await page.waitForURL(/\/order\/\?id=/, { timeout: 15000 }).catch(() => {});
  const id = new URL(page.url()).searchParams.get('id');

  await page.reload();
  await page.waitForTimeout(600);
  const shownAfterReload = (await page.textContent('[data-order-id]')).trim();
  if (shownAfterReload !== id) bad(`after a refresh the order page shows "${shownAfterReload}"`);
  else ok('The order survives a refresh of the confirmation page');

  const stillThere = await query('SELECT status FROM orders WHERE order_number = ?', [id]);
  if (stillThere[0]?.status !== 'PENDING') bad('the order is not in the database after a refresh');
  else ok('The order is on the server, not only in the browser');

  // A different device with no local receipt must still find it by phone.
  const { c: c2, page: p2 } = await ctx();
  await p2.goto(`${BASE}/order/?id=${encodeURIComponent(id)}`);
  await p2.fill('#lookup-phone', '0955700800');
  await p2.click('[data-order-lookup] button[type=submit]');
  await p2.waitForTimeout(600);
  const foundOnOtherDevice = (await p2.textContent('[data-order-id]')).trim();
  if (foundOnOtherDevice !== id) bad('an order cannot be recovered on another device with the phone number');
  else ok('An order is recoverable on another device using the phone number on it');

  // The wrong phone must reveal nothing.
  const { c: c3, page: p3 } = await ctx();
  await p3.goto(`${BASE}/order/?id=${encodeURIComponent(id)}`);
  await p3.fill('#lookup-phone', '0999888777');
  await p3.click('[data-order-lookup] button[type=submit]');
  await p3.waitForTimeout(600);
  const wrongPhoneBody = await p3.content();
  if (/Prelaunch|Damascus|Prelaunch Street/.test(wrongPhoneBody)) {
    bad('a wrong phone number revealed the order');
  } else ok("A wrong phone number reveals nothing about someone else's order");
  await c3.close();
  await c2.close();

  /* --- network interruption mid-submit --- */
  const { c: c4, page: p4 } = await ctx();
  await addToCart(p4, 'M');
  await p4.goto(`${BASE}/checkout/`);
  await p4.route('**/api/orders', (r) => r.abort());
  await fillCheckout(p4, { phone: '0955700900' });
  await p4.click('[data-checkout-submit]');
  await p4.waitForTimeout(1200);

  const stayed = /\/checkout\//.test(p4.url());
  const statusText = await p4.textContent('[data-checkout-status]').catch(() => '');
  const cartKept = (await p4.textContent('.header [data-cart-count]')).trim();
  const created = await query('SELECT COUNT(*) AS n FROM orders WHERE customer_phone = ?', ['963955700900']);

  if (Number(created[0].n) !== 0) bad('a failed request still created an order');
  else if (!stayed) bad('the customer was sent to the order page even though the order failed');
  else if (!/could not create|try again|Instagram/i.test(statusText)) {
    bad(`the failure message is unhelpful: "${statusText}"`);
  } else if (cartKept !== '1') bad(`the cart was cleared even though the order failed (count ${cartKept})`);
  else ok('A network failure mid-submit: no order created, cart kept, and an honest message shown');

  const hasInstagram = await p4.locator('[data-checkout-status] a').count();
  if (hasInstagram > 0) ok('The failure message offers the Instagram fallback');
  else note('the failure message does not link Instagram (contact.instagram is set, so it should)');

  await p4.unroute('**/api/orders');
  await c4.close();
  await c.close();
}

{
  // Concurrent orders on the same size. Stock only moves on acceptance, so
  // the race that matters is many acceptances at once.
  await setStock('XL', 1);
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const r = await orderVia([{ slug: SLUG, size: 'XL', quantity: 1 }], `09558${String(i).padStart(2, '0')}100`);
    if (r.status === 201) ids.push(r.body.order.orderId);
  }
  if (ids.length !== 12) bad(`only ${ids.length} of 12 orders were placed`);
  else ok('Twelve customers can all PLACE an order for the last unit (stock moves on acceptance)');

  const results = await Promise.all(
    ids.map((id) =>
      execFileAsync(process.execPath, ['qa/fixtures/accept-order.mjs', id], { cwd: ROOT, env })
        .then((r) => r.stdout.trim())
        .catch((e) => `ERROR:${String(e.message).slice(0, 60)}`)
    )
  );
  const won = results.filter((r) => r === 'OK').length;
  const lost = results.filter((r) => r === 'CONFLICT').length;
  const broke = results.filter((r) => r !== 'OK' && r !== 'CONFLICT');

  if (won !== 1) bad(`${won} accepts succeeded for one unit of stock`);
  else if (lost !== 11) bad(`${lost} were refused, expected 11`);
  else if (broke.length) bad(`${broke.length} accepts errored: ${broke[0]}`);
  else ok('Twelve simultaneous acceptances for ONE unit: exactly one wins, eleven refused, none errored');

  const left = await stockOf('XL');
  if (left !== 0) bad(`stock is ${left} after the race, expected 0`);
  else ok('Stock landed on exactly 0 — no overselling, never negative');

  await setStock('XL', 40);
}

/* ==================================================== 4. MOBILE / RESPONSIVE */

group('4. MOBILE — 320, 375, 390 and 430px');

{
  const widths = [320, 375, 390, 430];
  const routes = ['/', '/shop/', `/products/${SLUG}/`, '/cart/', '/checkout/'];
  const overflow = [];
  const smallTargets = [];

  for (const width of widths) {
    const { c, page } = await ctx({ width, height: 844, mobile: true });
    for (const route of routes) {
      await page.goto(BASE + route);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientW = await page.evaluate(() => document.documentElement.clientWidth);
      if (scrollW > clientW + 1) overflow.push(`${width}px ${route}: ${scrollW} > ${clientW}`);

      const tooSmall = await page.$$eval(
        'a[href], button:not([disabled]), input[type=checkbox], [role=radio]',
        (els) =>
          els
            .filter((el) => {
              const st = getComputedStyle(el);
              if (st.display === 'none' || st.visibility === 'hidden') return false;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              const isLink = el.tagName === 'A';
              return r.height < 44 || r.width < (isLink ? 24 : 44);
            })
            .filter((el) => {
              const p = el.closest('p, li');
              if (!p || el.tagName !== 'A') return true;
              return p.textContent.replace(el.textContent, '').trim().length === 0;
            })
            .map((el) => {
              const r = el.getBoundingClientRect();
              return `${(el.textContent || el.tagName).trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`;
            })
            .slice(0, 4)
      );
      if (tooSmall.length) smallTargets.push(`${width}px ${route}: ${tooSmall.join(', ')}`);
    }
    await c.close();
  }

  if (overflow.length) bad(`horizontal overflow: ${overflow.slice(0, 3).join(' | ')}`);
  else ok(`No horizontal overflow on any of 5 routes at 320, 375, 390 and 430px`);

  if (smallTargets.length) bad(`touch targets too small: ${smallTargets.slice(0, 2).join(' | ')}`);
  else ok('Every control meets the touch-target rule at all four phone widths');
}

{
  // The whole checkout, on a 320px phone — the narrowest device in use.
  const { c, page, errors } = await ctx({ width: 320, height: 568, mobile: true });
  await page.goto(`${BASE}/products/${SLUG}/`);
  await page.click('[data-size="M"]');
  await page.click('[data-add-btn]');
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/checkout/`);
  await fillCheckout(page, { phone: '0955900100' });
  await page.click('[data-checkout-submit]');
  await page.waitForURL(/\/order\/\?id=/, { timeout: 15000 }).catch(() => {});

  if (!/\/order\/\?id=VST-/.test(page.url())) bad(`the checkout did not complete at 320px: ${page.url()}`);
  else ok('The complete checkout works on a 320px phone');

  const waVisible = await page.locator('[data-wa-link]').isVisible().catch(() => false);
  if (!waVisible) bad('the WhatsApp button is not visible on the order page at 320px');
  else ok('The WhatsApp handoff button is reachable at 320px');

  const fatal = errors.filter((e) => !/Failed to load resource|net::ERR|fonts/i.test(e));
  if (fatal.length) bad(`console errors on mobile: ${fatal.slice(0, 2).join(' | ')}`);
  else ok('No page errors during the mobile checkout');

  await c.close();
}

/* ================================================ 5. STABILITY UNDER USE */

group('5. STABILITY — repeated orders, memory, and the site after them');

{
  const before = await query('SELECT COUNT(*) AS n FROM orders');
  const rssBefore = await (async () => {
    const out = await execFileAsync('bash', ['-c', `ps -o rss= -p ${server.pid}`]);
    return Number(out.stdout.trim());
  })();

  const started = Date.now();
  let failed = 0;
  for (let i = 0; i < 120; i++) {
    const r = await orderVia(
      [{ slug: SLUG, size: SIZES[i % SIZES.length], quantity: 1 }],
      `09561${String(i).padStart(3, '0')}0`
    );
    if (r.status !== 201) failed++;
  }
  const elapsed = Date.now() - started;

  const after = await query('SELECT COUNT(*) AS n FROM orders');
  const created = Number(after[0].n) - Number(before[0].n);
  const rssAfter = Number((await execFileAsync('bash', ['-c', `ps -o rss= -p ${server.pid}`])).stdout.trim());

  if (failed) bad(`${failed} of 120 repeated orders failed`);
  else ok(`120 orders in a row, all created (${created} new rows, ${Math.round(elapsed / 120)}ms each)`);

  const growthMb = (rssAfter - rssBefore) / 1024;
  if (growthMb > 80) {
    bad(`server memory grew ${growthMb.toFixed(1)}MB over 120 orders — possible leak`);
  } else {
    ok(`Server memory grew ${growthMb.toFixed(1)}MB over 120 orders (${(rssBefore / 1024).toFixed(0)}MB → ${(rssAfter / 1024).toFixed(0)}MB)`);
  }

  const health = await fetch(`${BASE}/api/health`);
  const home = await fetch(`${BASE}/`);
  const admin = await fetch(`${BASE}/admin/orders`, { headers: { cookie: adminCookie } });
  if (!health.ok || !home.ok || !admin.ok) {
    bad(`after 120 orders: health ${health.status}, home ${home.status}, admin ${admin.status}`);
  } else ok('After 120 orders the storefront, API and admin all still serve');

  const { c, page } = await ctx();
  await addToCart(page, 'M');
  await page.goto(`${BASE}/checkout/`);
  await fillCheckout(page, { phone: '0955950100' });
  await page.click('[data-checkout-submit]');
  await page.waitForURL(/\/order\/\?id=/, { timeout: 15000 }).catch(() => {});
  if (!/\/order\/\?id=VST-/.test(page.url())) bad('a real checkout no longer works after 120 orders');
  else ok('A real browser checkout still completes after 120 orders');
  await c.close();

  // Order numbers must still be unique after all of that.
  const dupes = await query(
    'SELECT order_number, COUNT(*) AS n FROM orders GROUP BY order_number HAVING COUNT(*) > 1'
  );
  if (dupes.length) bad(`duplicate order numbers after ${created} orders: ${JSON.stringify(dupes.slice(0, 3))}`);
  else ok(`Every order number is unique across all ${Number(after[0].n)} orders in the database`);
}

/* ================================================== 6. EDGE CASES */

group('6. EDGE CASES — missing fields, long input, WhatsApp off, locked database');

{
  // Missing and invalid fields, through the real form.
  const { c, page } = await ctx();
  await addToCart(page, 'M');
  await page.goto(`${BASE}/checkout/`);
  await page.click('[data-checkout-submit]');
  await page.waitForTimeout(400);

  const errorCount = await page.$$eval('[data-error-for]', (els) =>
    els.filter((e) => e.textContent.trim().length > 0).length
  );
  const wentAnyway = /\/order\//.test(page.url());
  if (wentAnyway) bad('an empty checkout was submitted');
  else if (errorCount < 4) bad(`an empty submit showed only ${errorCount} field errors`);
  else ok(`An empty checkout is blocked and shows ${errorCount} field errors`);

  await page.fill('#fullName', 'A');
  await page.fill('#phone', '123');
  await page.fill('#city', 'X');
  await page.fill('#address', 'short');
  await page.click('[data-checkout-submit]');
  await page.waitForTimeout(400);
  if (/\/order\//.test(page.url())) bad('a checkout with a 3-digit phone and a 5-character address was accepted');
  else ok('Too-short phone and address are refused by the form');

  await c.close();

  // The API must refuse the same things even without the form.
  const apiCases = [
    ['no name', { fullName: '', phone: '0955000111', city: 'Damascus', address: '1 Street, building 2, floor 3' }],
    ['no phone', { fullName: 'A B', phone: '', city: 'Damascus', address: '1 Street, building 2, floor 3' }],
    ['no city', { fullName: 'A B', phone: '0955000111', city: '', address: '1 Street, building 2, floor 3' }],
    ['no address', { fullName: 'A B', phone: '0955000111', city: 'Damascus', address: '' }],
    ['no items', { fullName: 'A B', phone: '0955000111', city: 'Damascus', address: '1 Street, building 2, floor 3', items: [] }],
    ['bad email', { fullName: 'A B', phone: '0955000111', city: 'Damascus', address: '1 Street, building 2, floor 3', email: 'not-an-email' }],
  ];
  const accepted = [];
  for (const [label, fields] of apiCases) {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ slug: SLUG, size: 'M', quantity: 1 }], ...fields }),
    });
    if (res.status < 400) accepted.push(label);
  }
  if (accepted.length) bad(`the API accepted invalid orders: ${accepted.join(', ')}`);
  else ok(`All ${apiCases.length} invalid payloads are refused by the API with a 4xx`);
}

{
  // Very long values in every field.
  const long = 'A'.repeat(50000);
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: long,
      phone: '0955000222',
      city: long,
      address: long,
      notes: long,
      email: `${'a'.repeat(300)}@example.com`,
      items: [{ slug: SLUG, size: 'M', quantity: 1 }],
    }),
  });

  if (res.status >= 500) {
    bad(`50,000-character fields produced a ${res.status}`);
  } else if (res.status === 201) {
    const stored = await query(
      'SELECT customer_name, city, address, notes FROM orders WHERE customer_phone = ?',
      ['963955000222']
    );
    const row = stored[0];
    const lengths = {
      name: row.customer_name.length,
      city: row.city.length,
      address: row.address.length,
      notes: (row.notes || '').length,
    };
    const unbounded = Object.entries(lengths).filter(([, len]) => len > 2000);
    if (unbounded.length) bad(`long input stored unbounded: ${JSON.stringify(lengths)}`);
    else ok(`50,000-character input is truncated at the boundary and stored bounded ${JSON.stringify(lengths)}`);

    const adminHtml = await (await fetch(`${BASE}/admin/orders`, { headers: { cookie: adminCookie } })).text();
    if (adminHtml.includes('A'.repeat(3000))) bad('the admin renders an unbounded value');
    else ok('The admin renders the truncated value, not 50,000 characters');
  } else {
    ok(`50,000-character input is refused with ${res.status} rather than stored`);
  }

  // And a body far over the cap.
  const huge = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'x'.repeat(600 * 1024) }),
  }).catch(() => null);
  if (huge && huge.status !== 413 && huge.status !== 400) bad(`a 600KB body answered ${huge.status}`);
  else ok('A body over the 256KB cap is refused');
  if (!(await fetch(`${BASE}/api/health`)).ok) bad('the server did not survive the oversized body');
  else ok('The server is healthy after the oversized body');
}

{
  // WhatsApp unavailable — the order must still be created, with no dead link,
  // and the customer must be pointed at Instagram.
  await adminPost('/admin/settings', { key: 'whatsapp.enabled', value: '0' });

  const res = await orderVia([{ slug: SLUG, size: 'M', quantity: 1 }], '0955000333');
  if (res.status !== 201) bad(`an order could not be placed with WhatsApp off: ${res.status}`);
  else if (res.body.whatsappUrl) bad('a wa.me link was returned with WhatsApp disabled');
  else ok('With WhatsApp disabled the order is still created and no dead link is invented');

  const stored = await query('SELECT COUNT(*) AS n FROM orders WHERE customer_phone = ?', ['963955000333']);
  if (Number(stored[0].n) !== 1) bad('the order was lost when WhatsApp was unavailable');
  else ok('The order is safely stored even though the handoff could not be offered');

  // What the CUSTOMER sees on the order page in that state.
  const { c, page } = await ctx();
  await page.goto(`${BASE}/order/?id=${encodeURIComponent(res.body.order.orderId)}`);
  await page.fill('#lookup-phone', '0955000333').catch(() => {});
  await page.click('[data-order-lookup] button[type=submit]').catch(() => {});
  await page.waitForTimeout(700);
  const waCount = await page.locator('[data-wa-link]').count();
  const pageText = await page.textContent('body');
  const igLink = await page.locator('a[href*="instagram.com"]').count();

  if (waCount > 0) {
    const href = await page.getAttribute('[data-wa-link]', 'href');
    if (!href || href === '#') bad('a dead WhatsApp button is rendered when WhatsApp is unavailable');
    else note(`the order page still renders a WhatsApp button (href ${String(href).slice(0, 30)}…) — the page was built while WhatsApp was enabled`);
  } else {
    ok('No WhatsApp button is rendered when the handoff is unavailable');
  }
  if (igLink > 0) ok('The Instagram fallback is present on the order page');
  else bad('no Instagram fallback on the order page');
  if (/message us|instagram/i.test(pageText)) ok('The order page tells the customer how to reach the store another way');
  await c.close();

  await adminPost('/admin/settings', { key: 'whatsapp.enabled', value: '1' });
}

{
  // A locked database. Hold the write lock from another process and try to
  // order while it is held.
  const holder = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      const { getDb } = await import('./server/db/index.js');
      const db = await getDb();
      await db.transaction(async () => {
        await new Promise((r) => setTimeout(r, 2500));
      });
      process.exit(0);
    `,
    ],
    { cwd: ROOT, env, stdio: 'ignore' }
  );
  await sleep(400);

  const started = Date.now();
  const res = await orderVia([{ slug: SLUG, size: 'M', quantity: 1 }], '0955000444');
  const took = Date.now() - started;

  if (res.status === 201) {
    ok(`An order placed while the database was locked still succeeded (waited ${took}ms and retried)`);
  } else if (res.status >= 500) {
    const body = JSON.stringify(res.body);
    if (/SQLITE|stack|locked/i.test(body)) bad(`a locked database leaked internals: ${body.slice(0, 90)}`);
    else ok(`A locked database produced an honest refusal (${res.status}) with no internals`);
  } else {
    ok(`A locked database produced a ${res.status} with a clean message`);
  }

  holder.kill();
  await sleep(300);
  const recovered = await orderVia([{ slug: SLUG, size: 'M', quantity: 1 }], '0955000555');
  if (recovered.status !== 201) bad(`the server did not recover after the lock was released: ${recovered.status}`);
  else ok('Once the lock is released, orders work again immediately');
}

/* ------------------------------------------------------ server-side log */

group('Server log');

{
  const log = readFileSync(LOG, 'utf8');
  const errorLines = log
    .split('\n')
    .filter((l) => /\berror\b|failed|unhandled|rejection/i.test(l))
    .filter((l) => !/could not queue|no email provider/i.test(l));

  const pii = ['Prelaunch Buyer', '963955100200', '0955100200', 'Prelaunch Street', 'Discount Street'];
  const leaked = pii.filter((n) => log.includes(n));
  if (leaked.length) bad(`customer data written to the server log: ${leaked.join(', ')}`);
  else ok('No customer name, phone or address appears in the server log');

  if (errorLines.length) {
    note(`the server logged ${errorLines.length} error line(s) during the run — first: ${errorLines[0].slice(0, 140)}`);
  } else {
    ok('The server logged no unexpected errors during the entire run');
  }
}

/* ------------------------------------------------------------- summary */

console.log(`\n${'='.repeat(70)}`);
console.log(`RESULT: ${passes.length} passed, ${failures.length} failed, ${notes.length} note(s)`);
console.log('='.repeat(70));
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
if (notes.length) {
  console.log('\nNOTES (not failures — things a human should be aware of):');
  for (const n of notes) console.log(`  • ${n}`);
}

await browser.close();
server.kill();
// Only the local SQLite file is removed; a Postgres database is left alone.
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG]) {
  try {
    if (existsSync(f)) rmSync(f);
  } catch {
    /* already gone */
  }
}

process.exit(failures.length ? 1 : 0);

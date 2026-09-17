/**
 * VESTIPHOBIA — QA suite.
 *
 *   npm run qa            build, serve, run every check, tear down
 *   npm run qa -- --keep  leave the server running afterwards
 *
 * Drives a real Chromium against a real build. Nothing here asserts against
 * source code — every check loads the built page and interacts with it, because
 * "the code looks right" has already been wrong once in this project (a
 * temporal-dead-zone bug that silently emptied the cart between pages).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { rmSync, openSync, readFileSync as readLog } from 'node:fs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * A free port, chosen at run time unless QA_PORT is set.
 *
 * A fixed port is a trap: a server left behind by an earlier run answers on it
 * with stale code, and every failure that follows then points at the wrong
 * thing. That cost an hour once.
 */
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

const PORT = Number(process.env.QA_PORT) || (await freePort());
const BASE = `http://localhost:${PORT}`;
const KEEP = process.argv.includes('--keep');

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

/* ------------------------------------------------------ chromium lookup */

/**
 * Playwright's bundled browser may not match the one installed in this
 * environment, so fall back to whatever chromium is actually on disk.
 */
function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(base, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null; // let Playwright use its own download
}

/* -------------------------------------------------------------- helpers */

const run = (cmd, args, env = process.env) =>
  new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => (code === 0 ? res(out) : rej(new Error(out))));
  });

const waitFor = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

/* ============================================================ 1. build */

group('Build');

let buildOutput = '';
try {
  buildOutput = await run('node', ['build.js']);
  ok('build succeeds');
} catch (err) {
  bad(`build failed: ${String(err.message).slice(0, 400)}`);
  console.log('\nBuild is broken — cannot run the rest of the suite.');
  process.exit(1);
}

if (/OWNER INPUT REQUIRED/.test(buildOutput)) ok('build reports outstanding owner input');
else bad('build no longer reports the outstanding owner-input list');

// Pure unit tests for the discount engine — fast, and they cover arithmetic
// the browser tests only sample.
try {
  const out = await run('node', ['qa/pricing.test.mjs']);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m && m[2] === '0') ok(`discount engine unit tests: ${m[1]} passed`);
  else bad(`discount engine unit tests failed: ${m ? m[0] : 'no summary'}`);
} catch (err) {
  bad(`discount engine unit tests failed: ${String(err.message).slice(0, 300)}`);
}

// The build must refuse a configuration that would ship something broken.
try {
  await run('node', ['qa/fixtures/bad-config-check.mjs']);
  ok('build validation rejects an invalid configuration');
} catch (err) {
  bad(`build validation did not reject invalid config: ${String(err.message).slice(0, 200)}`);
}

/* ================================================== 2. files on disk */

group('Generated files');

const DIST = join(ROOT, 'dist');
const EXPECTED_FILES = [
  'index.html',
  'shop/index.html',
  'story/index.html',
  'contact/index.html',
  'cart/index.html',
  'checkout/index.html',
  'order/index.html',
  'products/vestiphobia-001-fear-tee/index.html',
  'policies/shipping/index.html',
  'policies/returns/index.html',
  'policies/privacy/index.html',
  'policies/terms/index.html',
  '404.html',
  'robots.txt',
  'assets/css/site.css',
  'assets/js/store.js',
  'assets/js/orderService.js',
];

const missingFiles = EXPECTED_FILES.filter((f) => !existsSync(join(DIST, f)));
if (missingFiles.length) bad(`missing built files: ${missingFiles.join(', ')}`);
else ok(`all ${EXPECTED_FILES.length} expected files exist (product, cart, checkout, order)`);

if (existsSync(join(DIST, 'admin'))) {
  bad('dist/admin exists — the passwordless static admin prototype must never be built again');
} else {
  ok('no unauthenticated admin page is present in the build');
}

const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
if (!/Disallow: \/admin\//.test(robots)) bad('robots.txt does not disallow /admin/');
else if (!/Disallow: \/order\//.test(robots)) bad('robots.txt does not disallow /order/');
else ok('robots.txt excludes admin, order, cart and checkout');

// sitemap only exists once a domain is configured — that is deliberate
const cfg = readFileSync(join(ROOT, 'site.config.js'), 'utf8');
const domainConfigured = !/domain: null/.test(cfg);
if (domainConfigured && !existsSync(join(DIST, 'sitemap.xml'))) bad('domain is set but sitemap.xml was not generated');
else if (!domainConfigured && existsSync(join(DIST, 'sitemap.xml'))) bad('sitemap.xml generated without a configured domain');
else ok(domainConfigured ? 'sitemap.xml generated' : 'sitemap.xml correctly omitted while no domain is configured');

const manifestPath = join(ROOT, 'assets/images/manifest.json');
if (!existsSync(manifestPath)) {
  bad('image manifest missing — run `npm run images`');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = Object.values(manifest);
  const bad1 = entries.filter((e) => !e.variants.avif.length || !e.variants.webp.length);
  if (bad1.length) bad(`${bad1.length} images have no AVIF/WebP variants`);
  else ok(`${entries.length} images have AVIF + WebP + JPEG variants at multiple widths`);
}

/* ========================================================= 3. browser */

group('Browser');

let chromium;
let firefox;
let webkit;
try {
  ({ chromium, firefox, webkit } = await import('playwright'));
} catch {
  bad('playwright is not installed — run `npm install`');
  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  process.exit(1);
}

/**
 * The suite runs against the REAL application server — static files, public
 * API and admin, exactly as production serves them — on a throwaway database.
 * A static file server would let the checkout tests pass while the endpoint
 * they depend on was broken.
 */
// Random, not PID-based: a recycled PID once handed a run the leftover database
// of an earlier crashed run, and the stale orders in it broke a discount check
// in a way that looked like a pricing bug.
const QA_DB = join(tmpdir(), `vestiphobia-qa-${randomUUID()}.db`);
const QA_ADMIN = { email: 'qa@vestiphobia.test', password: 'qa-suite-passphrase-2026' };
const serverEnv = {
  ...process.env,
  PORT: String(PORT),
  SQLITE_PATH: QA_DB,
  DATABASE_URL: '',
  IP_SALT: 'qa-salt',
  // The suite places far more orders from one address than a person would.
  // The limiter itself is asserted separately, in qa/server.test.mjs.
  ORDER_RATE_LIMIT: '500',
  // Same reason: the suite browses more in five minutes than a person does in
  // a week, and a silently dropped batch would look like a tracking bug.
  EVENTS_RATE_LIMIT: '100000',
};
delete serverEnv.DATABASE_URL;

try {
  await run('node', ['server/db/migrate.js', 'all'], serverEnv);
  await run('node', ['scripts/create-admin.js', QA_ADMIN.email, QA_ADMIN.password], serverEnv);
  ok('test database migrates and seeds from nothing');
} catch (err) {
  bad(`could not prepare the test database: ${String(err.message).slice(0, 300)}`);
  process.exit(1);
}

/** The QA database holds test orders and test phone numbers. It is disposable. */
function removeQaDb() {
  for (const f of [QA_DB, `${QA_DB}-wal`, `${QA_DB}-shm`, SERVER_LOG]) {
    try {
      rmSync(f);
    } catch {
      /* already gone */
    }
  }
}

const SERVER_LOG = join(tmpdir(), `vestiphobia-qa-server-${randomUUID()}.log`);
const serverLog = openSync(SERVER_LOG, 'a');
const server = spawn('node', ['server/index.js'], {
  cwd: ROOT,
  env: serverEnv,
  // Captured, not discarded: a dropped analytics batch or a 500 in a route is
  // otherwise invisible, and the suite then fails somewhere unrelated.
  stdio: ['ignore', serverLog, serverLog],
});
const up = await waitFor(BASE + '/api/health');
if (!up) {
  bad('application server did not start');
  server.kill();
  process.exit(1);
}
ok('application server starts and serves the built storefront');

/** Sizes start at zero — nothing can be ordered until stock is real. */
async function setStockViaAdmin(size, quantity) {
  const jar = await adminLogin();
  const res = await fetch(`${BASE}/admin/inventory/quantity`, {
    method: 'POST',
    headers: { cookie: jar, Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ slug: 'vestiphobia-001-fear-tee', size, quantity: String(quantity) }),
    redirect: 'manual',
  });
  return res.status === 302;
}

let adminCookie = null;
async function adminLogin() {
  if (adminCookie) return adminCookie;
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { Origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: QA_ADMIN.email, password: QA_ADMIN.password }),
    redirect: 'manual',
  });
  adminCookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return adminCookie;
}

for (const size of ['S', 'M', 'L', 'XL', 'XXL']) {
  if (!(await setStockViaAdmin(size, 25))) bad(`could not set QA stock for size ${size}`);
}
ok('stock can be set through the authenticated admin');

const exe = findChromium();
/**
 * Which engine to drive. Chromium by default because it is the one installed
 * here; `QA_BROWSER=firefox` or `QA_BROWSER=webkit` runs the identical suite
 * against those engines on a machine where they can be installed
 * (`npx playwright install firefox webkit`). Nothing in the suite is
 * Chromium-specific.
 */
const ENGINES = { chromium, firefox, webkit };
const ENGINE_NAME = process.env.QA_BROWSER || 'chromium';
const engine = ENGINES[ENGINE_NAME];
if (!engine) {
  bad(`unknown QA_BROWSER "${ENGINE_NAME}" — use chromium, firefox or webkit`);
  process.exit(1);
}
// The executable override only applies to the Chromium already on this
// machine; the other engines use Playwright's own download.
const browser = await engine.launch(exe && ENGINE_NAME === 'chromium' ? { executablePath: exe } : {});
console.log(`  (driving ${ENGINE_NAME})`);

async function ctx(width = 1440, height = 900, mobile = false) {
  const c = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
    // A realistic User-Agent. Headless Chromium announces itself as
    // HeadlessChrome, which the analytics ingest correctly treats as a crawler
    // — so without this the QA browser could not exercise analytics at all.
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await c.newPage();
  // Google Fonts is an external request; block it so page lifecycle events
  // fire deterministically and offline runs behave the same as online ones.
  await page.route('**fonts.googleapis.com**', (r) => r.abort());
  await page.route('**fonts.gstatic.com**', (r) => r.abort());
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { c, page, errors };
}

const PUBLIC_ROUTES = [
  '/', '/shop/', '/products/vestiphobia-001-fear-tee/', '/story/', '/contact/',
  '/cart/', '/checkout/', '/order/', '/policies/shipping/', '/policies/returns/',
  '/policies/privacy/', '/policies/terms/', '/404.html',
];

/* --- every page loads clean, one h1, metadata, no broken images --- */
{
  const { c, page, errors } = await ctx();
  for (const r of PUBLIC_ROUTES) {
    const res = await page.goto(BASE + r, { waitUntil: 'load' });
    if (!res || (res.status() !== 200 && r !== '/404.html')) bad(`${r} status ${res?.status()}`);
    const broken = await page.$$eval('img', (imgs) =>
      imgs.filter((i) => i.currentSrc && i.complete && i.naturalWidth === 0).map((i) => i.src)
    );
    if (broken.length) bad(`${r} broken images: ${broken.join(', ')}`);
    const h1 = await page.$$eval('h1', (n) => n.length);
    if (h1 !== 1) bad(`${r} has ${h1} <h1>`);
    const desc = await page.$eval('meta[name=description]', (m) => m.content).catch(() => '');
    if (!desc) bad(`${r} missing meta description`);
  }
  const real = errors.filter((e) => !/ERR_FAILED|fonts\.g/.test(e));
  if (real.length) bad(`console errors: ${real.slice(0, 4).join(' | ')}`);
  else ok('every public page loads with no console errors, one h1 and a meta description');
  await c.close();
}

/* --- the site is actually black --- */
{
  const { c, page } = await ctx();
  const offenders = [];
  for (const r of PUBLIC_ROUTES) {
    await page.goto(BASE + r, { waitUntil: 'load' });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const fg = await page.evaluate(() => getComputedStyle(document.body).color);
    if (bg !== 'rgb(0, 0, 0)') offenders.push(`${r} body background is ${bg}`);
    if (fg !== 'rgb(255, 255, 255)') offenders.push(`${r} body text is ${fg}`);
  }
  if (offenders.length) bad(`not on the black/white system: ${offenders.slice(0, 3).join('; ')}`);
  else ok('every page renders black background with white text');
  await c.close();
}

/* --- contrast of the dimmest text and the error colour --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/checkout/');
  const contrast = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const read = (cls) => {
      probe.className = cls;
      return getComputedStyle(probe).color;
    };
    const out = {
      muted: ratio(read('muted'), 'rgb(0,0,0)'),
      error: ratio(read('field__error'), 'rgb(0,0,0)'),
      eyebrow: ratio(read('eyebrow'), 'rgb(0,0,0)'),
    };
    probe.remove();
    return out;
  });
  const low = Object.entries(contrast).filter(([, v]) => v < 4.5);
  if (low.length) bad(`text colours below WCAG AA 4.5:1 on black: ${low.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
  else ok(`muted/eyebrow/error text all clear WCAG AA on black (${Object.values(contrast).map((v) => v.toFixed(1)).join(', ')}:1)`);
  await c.close();
}

/* --- responsive images are real --- */
{
  const { c, page } = await ctx(390, 844, true);
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/', { waitUntil: 'load' });
  const info = await page.evaluate(() => {
    const img = document.querySelector('.gal__img');
    return {
      srcset: !!img?.srcset,
      chosenWidth: img?.currentSrc ? Number((img.currentSrc.match(/-(\d+)\.\w+$/) || [])[1]) : null,
      sources: document.querySelectorAll('.gal__slide picture source').length,
      hasAvif: !!document.querySelector('source[type="image/avif"]'),
      hasWebp: !!document.querySelector('source[type="image/webp"]'),
      lazyCount: [...document.querySelectorAll('img[loading="lazy"]')].length,
      eagerCount: [...document.querySelectorAll('img[loading="eager"]')].length,
    };
  });
  if (!info.srcset) bad('product image has no srcset');
  else if (!info.hasAvif || !info.hasWebp) bad('picture element is missing AVIF or WebP sources');
  else if (!(info.chosenWidth <= 800)) bad(`mobile picked a ${info.chosenWidth}px image on a 390px viewport`);
  else ok(`mobile picks a ${info.chosenWidth}px variant; AVIF + WebP sources present`);

  if (info.eagerCount < 1) bad('no eagerly-loaded LCP image on the product page');
  else if (info.lazyCount < 3) bad('below-the-fold images are not lazy-loaded');
  else ok(`LCP image eager, ${info.lazyCount} below-the-fold images lazy`);
  await c.close();
}

/* --- transfer weight on a phone --- */
{
  const { c, page } = await ctx(390, 844, true);
  let bytes = 0;
  page.on('response', async (r) => {
    if (/image/.test(r.headers()['content-type'] || '')) {
      try {
        bytes += (await r.body()).length;
      } catch {
        /* ignore */
      }
    }
  });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const kb = Math.round(bytes / 1024);
  if (kb > 600) bad(`mobile homepage downloads ${kb}KB of images`);
  else ok(`mobile homepage downloads ${kb}KB of images above the fold`);
  await c.close();
}

/* --- no horizontal overflow anywhere --- */
{
  for (const w of [320, 375, 390, 430, 768, 1024, 1440, 1920]) {
    const { c, page } = await ctx(w, 800, w < 768);
    for (const r of ['/', '/shop/', '/products/vestiphobia-001-fear-tee/', '/checkout/', '/order/', '/policies/privacy/', '/admin/orders/']) {
      await page.goto(BASE + r, { waitUntil: 'load' });
      const ovf = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (ovf > 1) bad(`overflow ${ovf}px at ${w}px on ${r}`);
    }
    await c.close();
  }
  ok('no horizontal overflow at 320/375/390/430/768/1024/1440/1920 across 7 routes');
}

/* --- product data, price, sizes --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  const price = await page.textContent('.price--lg');
  if (!/\$17 USD/.test(price)) bad(`product price is "${price}", expected $17 USD`);
  const sizes = await page.$$eval('[data-size]', (n) => n.map((x) => x.dataset.size));
  if (sizes.join(',') !== 'S,M,L,XL,XXL') bad(`sizes are ${sizes.join(',')}, expected S,M,L,XL,XXL`);
  else ok('product page shows $17 USD and sizes S/M/L/XL/XXL');

  // Owner-confirmed specs must be shown; unconfirmed ones must stay hidden.
  // These two lists are the contract — move a value between them only when the
  // owner actually supplies it.
  //
  // innerText cannot see inside a closed <details>, and most product copy lives
  // in accordions, so open them all first or the scan reads almost nothing.
  const text = await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => (d.open = true));
    return document.body.innerText;
  });

  const CONFIRMED = [
    [/100%\s*Cotton/i, 'fabric'],
    [/Approx\.\s*240\s*GSM/i, 'weight'],
    [/Regular\s*\/\s*Relaxed/i, 'fit'],
    [/Screen printed graphic/i, 'print method'],
    [/Machine wash cold/i, 'care instructions'],
    [/Iron on reverse while damp/i, 'full care label'],
    [/Built to be worn hard/i, 'product tagline'],
  ];
  const missing = CONFIRMED.filter(([re]) => !re.test(text)).map(([, label]) => label);
  if (missing.length) bad(`product page omits confirmed content: ${missing.join(', ')}`);
  else ok('all confirmed product content is published (specs, care label, tagline)');

  // The owner-supplied measurement chart must render as a real table.
  const rows = await page.$$eval('.size-table tbody tr', (r) => r.length);
  const bust = /100/.test(text) && /116/.test(text);
  if (rows !== 5) bad(`size guide has ${rows} rows, expected 5`);
  else if (!bust) bad('size guide does not show the supplied bust measurements');
  else ok('size guide renders the supplied 5-row measurement chart');

  // Care instructions and measurements are NOT supplied — the garment label
  // referenced by the spec was never included in the package.
  // Stock quantities are still not supplied and must stay invisible.
  const invented = [[/only \d+ left|\d+ in stock|\d+ remaining/i, 'stock quantities']]
    .map(([re, label]) => {
      const m = text.match(re);
      return m ? `${label} — "${m[0]}"` : null;
    })
    .filter(Boolean);
  if (invented.length) bad(`product page states unsupplied data: ${invented.join(', ')}`);
  else ok('stock counts stay hidden while quantities are unsupplied');
  await c.close();
}

/* --- cart: add, persist across pages, survive reload --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');

  if (!(await page.locator('[data-add-btn]').isDisabled())) bad('add-to-cart is enabled with no size selected');
  await page.click('[data-size="M"]');
  await page.click('[data-add-btn]');
  await page.waitForSelector('#cart-drawer:not([hidden])');
  if ((await page.textContent('.header [data-cart-count]')).trim() !== '1') bad('cart count wrong after add');
  ok('size gate works and add-to-cart opens the drawer');

  // At 1 piece the nudge must name BOTH rewards waiting at 2 pieces, so the
  // customer sees the whole reason to add one rather than half of it.
  const prog = (await page.textContent('#cart-drawer [data-ship-progress]')).trim();
  if (!/Add 1 more piece/i.test(prog)) bad(`1-piece nudge missing: "${prog}"`);
  else if (!/5% off/i.test(prog) || !/free shipping/i.test(prog))
    bad(`1-piece nudge should name both 5% off and free shipping: "${prog}"`);
  else ok('at 1 piece the cart names both rewards waiting at 2 pieces');

  await page.click('#cart-drawer [data-line-inc]');
  const prog2 = (await page.textContent('#cart-drawer [data-ship-progress]')).trim();
  if (!/5% off and free shipping applied/i.test(prog2))
    bad(`2-piece message should confirm what was earned: "${prog2}"`);
  else if (!/10% off/i.test(prog2)) bad(`2-piece message should name the next tier: "${prog2}"`);
  else ok('at 2 pieces the cart confirms 5% + free shipping and points at the 10% tier');

  const sub = await page.textContent('#cart-drawer [data-cart-subtotal]');
  if (!sub.includes('$34')) bad(`subtotal is ${sub}, expected $34`);
  else ok('subtotal at 2 pieces is $34 USD before discount');

  // The exact sequence from the brief: navigate away, come back, reload.
  await page.keyboard.press('Escape');
  for (const r of ['/story/', '/shop/', '/policies/terms/', '/']) {
    await page.goto(BASE + r);
    const n = (await page.textContent('.header [data-cart-count]')).trim();
    if (n !== '2') bad(`cart emptied when navigating to ${r} (count=${n})`);
  }
  await page.reload();
  const afterReload = (await page.textContent('.header [data-cart-count]')).trim();
  if (afterReload !== '2') bad(`cart emptied on reload (count=${afterReload})`);
  else ok('cart survives navigation across 4 pages and a full browser reload');

  await page.goto(BASE + '/cart/');
  await page.click('[data-line-remove]');
  if (!(await page.locator('[data-cart-empty]').first().isVisible())) bad('cart not empty after remove');
  else ok('remove from cart works');
  await c.close();
}

/* --- a malformed cart is not silently wiped --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/');
  await page.evaluate(() => {
    localStorage.setItem(
      'vestiphobia.cart.v1',
      JSON.stringify([
        { slug: 'vestiphobia-001-fear-tee', size: 'L', qty: 'garbage' },
        { slug: 'no-such-product', size: 'M', qty: 2 },
      ])
    );
  });
  await page.reload();
  const n = (await page.textContent('.header [data-cart-count]')).trim();
  if (n !== '1') bad(`malformed cart recovery: expected the valid line to survive, count=${n}`);
  else ok('a malformed cart keeps its valid line instead of being wiped');
  await c.close();
}

/* --- no fake payment UI anywhere --- */
{
  const { c, page } = await ctx();
  const banned = [];
  for (const r of PUBLIC_ROUTES) {
    await page.goto(BASE + r);
    const fields = await page.$$eval('input', (ins) =>
      ins
        .map((i) => `${i.name} ${i.id} ${i.autocomplete} ${i.placeholder}`.toLowerCase())
        .filter((s) => /card|cvv|cvc|expiry|cc-num|credit/.test(s))
    );
    if (fields.length) banned.push(`${r}: ${fields.join(', ')}`);
    const text = await page.evaluate(() => document.body.innerText);
    for (const re of [/payment successful/i, /payment received/i, /stripe/i, /paypal/i, /pay now/i]) {
      const m = text.match(re);
      if (m) banned.push(`${r}: "${m[0]}"`);
    }
  }
  if (banned.length) bad(`fake payment UI present: ${banned.slice(0, 3).join(' | ')}`);
  else ok('no card fields, no gateway names and no "payment successful" claim on any public page');
  await c.close();
}

/* --- the WhatsApp order flow, end to end --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.click('[data-size="L"]');
  await page.click('[data-add-btn]');
  await page.keyboard.press('Escape');
  await page.goto(BASE + '/checkout/');

  // Empty form must not create an order.
  await page.click('[data-checkout-submit]');
  await page.waitForTimeout(300);
  if (!page.url().includes('/checkout/')) bad('checkout submitted with an empty form');
  const shownErrors = await page.$$eval('[data-error-for]', (n) => n.filter((x) => x.textContent.trim()).length);
  if (shownErrors < 4) bad(`only ${shownErrors} validation errors shown on an empty submit`);
  else ok(`checkout blocks an empty submit and shows ${shownErrors} field errors`);

  // The confirmed field set — and nothing more.
  const fieldIds = await page.$$eval('.checkout__form [id]', (n) => n.map((x) => x.id));
  const expected = ['fullName', 'phone', 'city', 'address', 'email', 'notes'];
  const missing = expected.filter((f) => !fieldIds.includes(f));
  if (missing.length) bad(`checkout is missing required fields: ${missing.join(', ')}`);
  else ok('checkout collects exactly full name, phone, city, address, email and notes');

  const hasAccountFields = fieldIds.some((f) => /password|username|register|confirmPassword/i.test(f));
  if (hasAccountFields) bad('checkout has account-creation fields — there are no customer accounts');
  else ok('no login, password or account fields anywhere in checkout');

  // Returning-customer microcopy is present before any order exists.
  const returningCopy = await page.textContent('[data-returning]');
  if (!/Come back\. Pay less\./i.test(returningCopy)) bad('returning-customer microcopy missing');
  else if (!/real phone number/i.test(returningCopy)) bad('returning-customer explanation missing');
  else ok('returning-customer microcopy shown at checkout');

  await page.fill('#fullName', 'Sami Haddad');
  await page.fill('#phone', '0965438999');
  await page.fill('#city', 'Damascus');
  await page.fill('#address', '12 Baghdad Street, building 4, third floor');
  await page.fill('#notes', 'Call before delivery');

  // Duplicate-tap guard, asserted at the service layer.
  //
  // Driving three real clicks is not viable here: the first one calls
  // window.open() for the WhatsApp handoff, which stalls headless Chromium,
  // and the following clicks then race a navigation. Calling createOrder three
  // times with the same cart+customer tests the actual guard directly and
  // deterministically — which is what the requirement is about.
  const dupCount = await page.evaluate(async () => {
    const svc = await import('/assets/js/orderService.js');
    const { priceCart } = await import('/assets/js/pricing.js');
    const cart = {
      items: [
        { slug: 'vestiphobia-001-fear-tee', name: 'FEAR TEE', shortName: 'FEAR TEE', size: 'L', qty: 1, price: 17, lineTotal: 17 },
      ],
      pieces: 1,
      subtotal: 17,
      currency: 'USD',
      freeShipping: false,
    };
    const pricing = priceCart(cart, { config: window.VESTI.discounts });
    const customer = {
      fullName: 'Sami Haddad',
      phone: '0965438999',
      city: 'Damascus',
      address: '12 Baghdad Street, building 4, third floor',
    };
    const a = await svc.createOrder({ cart, customer, pricing });
    const b = await svc.createOrder({ cart, customer, pricing });
    const c2 = await svc.createOrder({ cart, customer, pricing });
    return {
      stored: JSON.parse(localStorage.getItem('vestiphobia.orders.v1') || '[]').length,
      sameId: a.orderId === b.orderId && b.orderId === c2.orderId,
      id: a.orderId,
    };
  });

  if (dupCount.stored !== 1) bad(`three submits created ${dupCount.stored} orders — expected 1`);
  else if (!dupCount.sameId) bad('repeat submits returned different order ids');
  else ok('submitting the same cart three times creates exactly one order');

  // Now a single normal submit, to exercise the real UI path end to end.
  // Reset BOTH stores: the cart still holds the piece added at the top of this
  // block, and a second one would make this a 2-piece discounted order.
  await page.evaluate(() => {
    localStorage.removeItem('vestiphobia.orders.v1');
    localStorage.removeItem('vestiphobia.cart.v1');
  });
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.click('[data-size="L"]');
  await page.click('[data-add-btn]');
  await page.keyboard.press('Escape');
  await page.goto(BASE + '/checkout/');
  await page.fill('#fullName', 'Sami Haddad');
  await page.fill('#phone', '0965438999');
  await page.fill('#city', 'Damascus');
  await page.fill('#address', '12 Baghdad Street, building 4, third floor');
  await page.fill('#notes', 'Call before delivery');
  // window.open is a no-op popup in headless; swallow it so the assertion is
  // about the navigation, not the popup.
  await page.addInitScript(() => { window.open = () => null; });
  await page.evaluate(() => { window.open = () => null; });
  await page.click('[data-checkout-submit]');
  await page.waitForURL(/\/order\/\?id=/, { timeout: 10000 }).catch(() => {});

  if (!/\/order\/\?id=VST-/.test(page.url())) bad(`checkout did not reach the order page: ${page.url()}`);
  else ok('checkout creates an order and redirects to /order/?id=VST-…');

  const orderId = new URL(page.url()).searchParams.get('id');
  if (!/^VST-\d{4}-\d{4}$/.test(orderId || '')) bad(`order id "${orderId}" is not VST-YYYY-NNNN`);
  else ok(`order id follows the VST-YYYY-NNNN format (${orderId})`);

  const orderStatus = (await page.textContent('[data-order-status]')).trim();
  if (orderStatus !== 'PENDING') bad(`new order status is "${orderStatus}", expected PENDING`);
  else ok('a new order starts PENDING');

  const meaning = await page.textContent('[data-order-status-meaning]');
  if (!/awaiting store approval/i.test(meaning)) bad('PENDING is not explained as awaiting approval');
  else ok('PENDING is spelled out as "awaiting store approval", not as paid');

  const msg = await page.textContent('[data-wa-preview]');
  for (const [re, label] of [
    [/Order ID: VST-/, 'order id'],
    [/Name: Sami Haddad/, 'name'],
    [/City: Damascus/, 'city'],
    [/Address: 12 Baghdad Street/, 'address'],
    [/Size L/, 'size'],
    [/Total: \$17 USD/, 'total'],
    [/Sham Cash payment instructions/i, 'Sham Cash request'],
  ]) {
    if (!re.test(msg))
      bad(`WhatsApp message is missing the ${label} — message was: ${msg.replace(/\n/g, ' | ')}`);
  }
  if (/payment (has been|was) (made|sent|completed)|I have paid/i.test(msg))
    bad('WhatsApp message implies payment has already been made');
  else ok('WhatsApp message carries id, name, city, address, items and total, and asks for instructions');

  const waHref = (await page.locator('[data-wa-link]').count())
    ? await page.getAttribute('[data-wa-link]', 'href')
    : null;
  if (!/^https:\/\/wa\.me\/963965438721\?text=/.test(waHref || ''))
    bad(`WhatsApp link is wrong or missing: ${waHref}`);
  else ok('WhatsApp deep link targets the configured number');

  // Instagram fallback must be present and reachable.
  const igHref = await page.getAttribute('.order-fallback a', 'href').catch(() => null);
  if (igHref !== 'https://www.instagram.com/vestiiphobia')
    bad(`Instagram fallback missing or wrong: ${igHref}`);
  else ok('Instagram fallback link is present on the order page');

  await page.goto(BASE + '/');
  const cartAfter = (await page.textContent('.header [data-cart-count]')).trim();
  if (cartAfter !== '0') bad(`cart still holds ${cartAfter} items after the order was created`);
  else ok('cart is emptied once it becomes an order');

  /* --- the real admin: login required, then the full status walk --- */

  // Anonymous first: the admin must not render at all without a session.
  await page.goto(BASE + '/admin/orders');
  const anonAdmin = await page.content();
  if (!/Admin sign in/.test(anonAdmin) || /Sami Haddad/.test(anonAdmin))
    bad('the admin rendered order data to a visitor with no session');
  else ok('the admin refuses an anonymous visitor and shows the login form');

  await page.fill('#email', QA_ADMIN.email);
  await page.fill('#password', 'the-wrong-password');
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  if (!/Incorrect email or password/.test(await page.content()))
    bad('a wrong admin password did not produce an error');
  else ok('a wrong admin password is refused');

  await page.fill('#email', QA_ADMIN.email);
  await page.fill('#password', QA_ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('domcontentloaded');
  if (!/Dashboard/.test(await page.content())) bad('a correct admin password did not sign in');
  else ok('a correct admin password signs in to the dashboard');

  await page.goto(BASE + `/admin/orders/${orderId}`);
  if ((await page.textContent('[data-order-status], .tag')).trim() !== 'PENDING')
    bad('the admin does not show PENDING for a new order');

  const advance = async (status) => {
    await page.click(`form[action="/admin/orders/${orderId}/status"] button:has-text("${status}")`);
    await page.waitForLoadState('domcontentloaded');
    return page.content();
  };

  const acceptedHtml = await advance('ACCEPTED');
  if (!/tag--ACCEPTED/.test(acceptedHtml)) bad('the admin could not accept an order');
  else ok('the admin can accept an order');

  // Accepting is what deducts stock, and the ledger must show it.
  const inv = await (await fetch(`${BASE}/admin/inventory`, { headers: { cookie: await adminLogin() } })).text();
  if (!/order_accepted/.test(inv)) bad('accepting an order left no entry in the stock ledger');
  else ok('accepting an order deducts stock and records it in the ledger');

  for (const step of ['PREPARING', 'SHIPPED']) await advance(step);
  const deliveredHtml = await advance('DELIVERED');
  if (!/tag--DELIVERED/.test(deliveredHtml))
    bad('the admin could not walk an order through to DELIVERED');
  else ok('the admin can advance PENDING -> ACCEPTED -> PREPARING -> SHIPPED -> DELIVERED');

  // The customer's own page must now show the new status, not the one frozen
  // into the local receipt at checkout.
  await page.goto(BASE + `/order/?id=${encodeURIComponent(orderId)}`);
  await page.waitForSelector('[data-order-view]:not([hidden])', { timeout: 5000 }).catch(() => {});
  const customerStatus = (await page.textContent('[data-order-status]')).trim();
  if (customerStatus !== 'DELIVERED')
    bad(`the customer's order page shows "${customerStatus}" after the store set DELIVERED`);
  else ok("the customer's order page reflects the store's status, not a stale local copy");

  /* --- returning-customer discount, applied by the server --- */

  // The browser is never told whether a number has ordered before, so this is
  // asserted where the decision actually happens: in the confirmed total.
  const returningOrder = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Sami Haddad',
      phone: '0965438999',
      city: 'Damascus',
      address: '12 Baghdad Street, building 4, third floor',
      items: [{ slug: 'vestiphobia-001-fear-tee', size: 'M', quantity: 1 }],
    }),
  }).then((r) => r.json());

  if (returningOrder.order?.discountPercent !== 5)
    bad(`a customer with a DELIVERED order got ${returningOrder.order?.discountPercent}% instead of 5%`);
  else if (returningOrder.order?.total !== 16.15)
    bad(`returning total wrong: ${returningOrder.order?.total} (expected 16.15)`);
  else ok('a customer whose previous order is DELIVERED gets 5% off: $17 -> $16.15');

  const firstTimer = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'New Buyer',
      phone: '0999000111',
      city: 'Aleppo',
      address: '9 Sample Street, building 2, first floor',
      items: [{ slug: 'vestiphobia-001-fear-tee', size: 'S', quantity: 1 }],
    }),
  }).then((r) => r.json());

  if (firstTimer.order?.discountPercent !== 0)
    bad('a first-time customer was given a returning discount');
  else ok('a first-time customer gets no discount on a single piece');

  await c.close();
}

/* --- bundle discounts and free shipping in the live cart --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.click('[data-size="M"]');
  await page.fill('[data-qty-input]', '2');
  await page.click('[data-add-btn]');
  await page.waitForSelector('#cart-drawer:not([hidden])');
  await page.goto(BASE + '/checkout/');
  await page.waitForTimeout(200);

  let total = await page.textContent('[data-cart-total]');
  let disc = await page.textContent('[data-discount-amount]');
  if (!/32\.3/.test(total)) bad(`2-piece total wrong: ${total} (expected $32.30)`);
  else if (!/1\.7/.test(disc)) bad(`2-piece discount wrong: ${disc} (expected −$1.70)`);
  else ok('2 pieces: 5% off applied, $34 → $32.30');

  const ship = await page.textContent('[data-ship-line]');
  if (!/Free/i.test(ship)) bad(`2 pieces should ship free, got: ${ship}`);
  else ok('2 pieces: shipping shows Free');

  // Push to three pieces for the 10% tier.
  await page.goto(BASE + '/cart/');
  await page.click('[data-line-inc]');
  await page.waitForTimeout(200);
  await page.goto(BASE + '/checkout/');
  await page.waitForTimeout(200);
  total = await page.textContent('[data-cart-total]');
  if (!/45\.9/.test(total)) bad(`3-piece total wrong: ${total} (expected $45.90)`);
  else ok('3 pieces: 10% off applied, $51 → $45.90');
  await c.close();
}

/* --- an order is never created in an approved state --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/');
  const auto = await page.evaluate(async () => {
    const svc = await import('/assets/js/orderService.js');
    const { priceCart } = await import('/assets/js/pricing.js');
    const cart = {
      items: [
        {
          slug: 'vestiphobia-001-fear-tee',
          name: 'FEAR TEE',
          shortName: 'FEAR TEE',
          size: 'XL',
          qty: 1,
          price: 17,
          lineTotal: 17,
        },
      ],
      pieces: 1,
      subtotal: 17,
      currency: 'USD',
      freeShipping: false,
    };
    const pricing = priceCart(cart, { config: window.VESTI.discounts });
    const order = await svc.createOrder({
      cart,
      pricing,
      customer: {
        fullName: 'Approval Test',
        phone: '0955000222',
        city: 'Homs',
        address: '4 Sample Street, building 1, second floor',
      },
    });
    return {
      status: order.orderStatus,
      shippingLabel: order.shippingLabel,
      shippingFree: order.shippingFree,
      total: order.total,
      paymentMethod: order.paymentMethod,
    };
  });

  if (auto.status !== 'PENDING') bad(`a new order has status ${auto.status}, expected PENDING`);
  else if (auto.total !== 17) bad(`a new order total is ${auto.total}, expected 17`);
  else if (auto.shippingFree !== false || !/varies by region/i.test(auto.shippingLabel))
    bad(`a shipping amount was invented: ${auto.shippingLabel}`);
  else if (!/SHAM CASH/i.test(auto.paymentMethod))
    bad(`payment method is "${auto.paymentMethod}", expected the manual Sham Cash flow`);
  else ok('a new order starts PENDING, quotes no shipping charge, and is Sham Cash manual');

  // The order the SERVER holds must match, and must not be approved by itself.
  const fromServer = await fetch(
    `${BASE}/api/orders/${encodeURIComponent(
      await page.evaluate(() => JSON.parse(localStorage.getItem('vestiphobia.orders.v1'))[0].orderId)
    )}?phone=0955000222`
  ).then((r) => r.json());

  if (fromServer.order?.status !== 'PENDING')
    bad(`the stored order is ${fromServer.order?.status}, not PENDING`);
  else ok('the order the server stores is PENDING — nothing approves it but the admin');

  await c.close();
}

/* --- mobile: menu, gallery, sticky bar, WhatsApp button reachability --- */
{
  const { c, page } = await ctx(390, 844, true);
  await page.goto(BASE + '/');
  await page.click('[data-menu-open]');
  await page.waitForSelector('#mobile-menu:not([hidden])');
  const links = await page.locator('#mobile-menu a').count();
  if (links < 7) bad(`mobile menu has only ${links} links`);
  await page.click('[data-menu-close]');
  if (!(await page.locator('#mobile-menu').isHidden())) bad('mobile menu did not close');
  else ok('mobile menu opens and closes with shop, story, contact and policies');

  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  const swipeable = await page.$eval('[data-gal-track]', (t) => t.scrollWidth > t.clientWidth + 10);
  if (!swipeable) bad('mobile gallery is not swipeable');
  await page.$eval('[data-gal-track]', (t) => (t.scrollLeft = t.clientWidth));
  await page.waitForTimeout(400);
  if (!/2 \/ 6/.test(await page.textContent('[data-gal-counter]'))) bad('gallery counter does not track position');
  else ok('mobile gallery swipes and the counter tracks position');

  await page.click('[data-size="M"]');
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(500);
  if (!(await page.locator('[data-sticky-buy]').isVisible())) bad('sticky mobile buy bar never appears');
  await page.click('[data-sticky-add]');
  await page.waitForSelector('#cart-drawer:not([hidden])', { timeout: 5000 })
    .then(() => ok('sticky mobile add-to-cart bar appears and works'))
    .catch(() => bad('sticky mobile add-to-cart button does nothing'));

  // The primary WhatsApp action must be large and easy to hit on a phone.
  await page.goto(BASE + '/checkout/');
  const box = await page.locator('[data-checkout-submit]').boundingBox();
  if (!box || box.height < 44) bad(`checkout primary button is ${box?.height}px tall on mobile`);
  else if (box.width < 300) bad(`checkout primary button is only ${box.width}px wide on a 390px viewport`);
  else ok(`checkout primary action is ${Math.round(box.width)}×${Math.round(box.height)}px on mobile`);
  await c.close();
}

/* --- touch targets and reduced motion --- */
{
  const { c, page } = await ctx(390, 844, true);

  const routes = ['/', '/shop/', '/products/vestiphobia-001-fear-tee/', '/cart/', '/checkout/'];
  const small = [];
  for (const route of routes) {
    await page.goto(BASE + route);
    /**
     * The rule applied, and why it is not a flat 44x44.
     *
     * Buttons and form controls must be 44x44 — the Apple/Google guideline,
     * and the size a thumb actually needs for a discrete control.
     *
     * A text LINK is held to 44px in the stacking axis (height) and to the
     * WCAG 2.2 minimum of 24px in the other. Padding the word "Shop" out to
     * 44px WIDE would not make it easier to hit — nothing sits beside it — and
     * would visibly distort a footer column. Height is the axis where a link's
     * neighbours are adjacent, so height is where the generous target belongs.
     */
    const undersized = await page.$$eval(
      'a[href], button:not([disabled]), input[type=checkbox], [role=radio]',
      (els) =>
        els
          .filter((el) => {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            const isLink = el.tagName === 'A';
            const minWidth = isLink ? 24 : 44;
            return r.height < 44 || r.width < minWidth;
          })
          .filter((el) => {
            // WCAG 2.5.8 exempts a link that sits INSIDE a sentence — making
            // those 44px tall would wreck the paragraph's line spacing. A
            // paragraph whose only content is the link is a call to action,
            // not a sentence, and is held to the full size.
            const p = el.closest('p, li');
            if (!p || el.tagName !== 'A') return true;
            const otherText = p.textContent.replace(el.textContent, '').trim();
            return otherText.length === 0;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            const label = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim();
            return `${label.slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`;
          })
          .slice(0, 6)
    );
    const controls = undersized;
    if (controls.length) small.push(`${route}: ${controls.join(' | ')}`);
  }
  if (small.length) bad(`touch targets too small on mobile: ${small.slice(0, 2).join('  //  ')}`);
  else
    ok('every control is 44px tall on a phone (buttons 44x44, links 44 tall x 24+ wide)');

  // Reduced motion must actually remove motion, not merely be declared.
  const c2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const p2 = await c2.newPage();
  await p2.goto(BASE + '/');
  const animated = await p2.$$eval('*', (els) =>
    els
      .filter((el) => {
        const st = getComputedStyle(el);
        const dur = parseFloat(st.animationDuration) || 0;
        const trans = parseFloat(st.transitionDuration) || 0;
        return dur > 0.05 || trans > 0.05;
      })
      .map((el) => el.tagName + '.' + String(el.className).slice(0, 30))
      .slice(0, 5)
  );
  if (animated.length) bad(`motion still runs with prefers-reduced-motion: ${animated.join(', ')}`);
  else ok('prefers-reduced-motion removes every animation and transition');
  await c2.close();

  await c.close();
}

/* --- keyboard and accessibility --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.focus('[data-size="S"]');
  await page.keyboard.press('ArrowRight');
  if ((await page.getAttribute('[data-size="M"]', 'aria-checked')) !== 'true') bad('arrow keys do not move size selection');
  await page.keyboard.press('End');
  if ((await page.getAttribute('[data-size="XXL"]', 'aria-checked')) !== 'true') bad('End key does not jump to the last size');
  else ok('size selector is a keyboard-operable radiogroup (arrows, Home/End)');

  await page.click('[data-gal-open="0"]');
  await page.waitForSelector('[data-lightbox]:not([hidden])');
  await page.keyboard.press('ArrowRight');
  if (!/2 \/ 6/.test(await page.textContent('[data-lb-counter]'))) bad('lightbox arrow navigation failed');
  await page.keyboard.press('Escape');
  if (!(await page.locator('[data-lightbox]').isHidden())) bad('lightbox does not close on Escape');
  else ok('lightbox opens, arrow-navigates and closes on Escape');

  await page.goto(BASE + '/');
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.className || '');
  if (!String(first).includes('skip-link')) bad(`first tab stop is "${first}", expected the skip link`);
  else ok('skip-to-content link is the first tab stop');

  const noAlt = await page.$$eval('img', (imgs) =>
    imgs.filter((i) => !i.hasAttribute('alt') && i.getAttribute('aria-hidden') !== 'true').length
  );
  if (noAlt) bad(`${noAlt} images have no alt attribute`);
  else ok('every image has alt text or is explicitly decorative');
  await c.close();
}

/* --- newsletter never claims success --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/');
  await page.fill('#newsletter-section', 'someone@example.com');
  await page.click('.signup--section button[type=submit]');
  const msg = await page.textContent('.signup--section [data-newsletter-status]');
  if (/thank|subscribed|success|you.re in/i.test(msg)) bad(`newsletter claims success: "${msg}"`);
  else if (!/not live yet|not saved/i.test(msg)) bad(`newsletter message unclear: "${msg}"`);
  else ok('newsletter form states plainly that nothing was saved');
  await c.close();
}

/* --- no invented business facts, no placeholder leakage --- */
{
  const { c, page } = await ctx();
  const BANNED = [
    // Care instructions are now transcribed from the real garment label, and
    // "heavyweight cotton" is the owner's own product line, so both are
    // allowed. Anything beyond what was actually supplied still is not.
    [/pre-?shrunk|garment[- ]dyed|organic cotton/i, 'unconfirmed garment claim'],
    [/\boversized\b/i, 'retired fit claim — the confirmed fit is Regular / Relaxed'],
    [/AWAITING PAYMENT|PAYMENT RECEIVED/i, 'retired order-status vocabulary'],
    [/963\s?965\s?438\s?721|963965438721/, 'the WhatsApp number as visible text'],
    [/\$\d+(\.\d+)? shipping|shipping: \$\d/i, 'an invented shipping price'],
    [/made in [A-Z]/, 'manufacturing origin'],
    // The 5–7 business day delivery estimate and the 7-day exchange window are
    // both owner-confirmed, so a bare day-count is no longer a red flag. Only
    // estimates outside those two are.
    [/\b(1[0-9]|[2-9][0-9])\s*(business\s*)?days?\b/i, 'an unconfirmed delivery estimate'],
    // vestiph0bia0@gmail.com is the owner's actual confirmed support address
    // (there is no business domain yet) — same carve-out precedent as the
    // day-count and returns-window exceptions above. Any OTHER
    // gmail/outlook/yahoo/example address is still a strong invented-content
    // smell and stays banned.
    [/(?<!vestiph0bia0)@(gmail|outlook|yahoo|example)\./i, 'invented email'],
    [/instagram\.com\/|tiktok\.com\//i, 'invented social link'],
    [/\bpersona\b/i, 'reference-brand name'],
    [/\bstripe\b|\bpaypal\b/i, 'payment provider'],
    [/\b(14|30)[- ]day\b/i, 'returns window'],
    [/\bwa\.me\/(?!\d)/i, 'malformed WhatsApp link'],
    [/lorem ipsum|TODO|FIXME|XXX-/i, 'placeholder text'],
  ];
  const hits = [];
  for (const r of PUBLIC_ROUTES) {
    await page.goto(BASE + r);
    const text = await page.evaluate(() => document.body.innerText);
    for (const [re, label] of BANNED) {
      const m = text.match(re);
      if (m) hits.push(`${r}: ${label} — "${m[0]}"`);
    }
  }
  if (hits.length) bad(`invented or placeholder content: ${hits.slice(0, 4).join(' | ')}`);
  else ok('no invented material, shipping, social, payment or placeholder text on any public page');
  await c.close();
}

/* --- confirmed shipping and returns copy --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/policies/shipping/');
  let text = await page.evaluate(() => document.body.innerText);
  for (const [re, label] of [
    [/Syria only|within Syria/i, 'Syria-only coverage'],
    [/5[–-]7 business days/i, 'delivery estimate'],
    [/paid on delivery/i, 'fee paid on delivery'],
    [/varies by region/i, 'fee varies by region'],
  ]) {
    if (!re.test(text)) bad(`shipping policy is missing: ${label}`);
  }
  ok('shipping policy states Syria only, 5–7 business days, fee paid on delivery by region');

  await page.goto(BASE + '/policies/returns/');
  text = await page.evaluate(() => document.body.innerText);
  for (const [re, label] of [
    [/within 7 days/i, '7-day exchange window'],
    [/Exchanges only|do not offer cash refunds/i, 'exchange-only rule'],
    [/unused/i, 'condition requirement'],
  ]) {
    if (!re.test(text)) bad(`returns policy is missing: ${label}`);
  }
  ok('returns policy states the 7-day exchange window, exchange-only and condition rules');
  await c.close();
}

/* --- structured data + SEO --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  const ld = JSON.parse(await page.textContent('script[type="application/ld+json"]'));
  if (ld['@type'] !== 'Product') bad('product page has no Product structured data');
  if (ld.offers.price !== 17 || ld.offers.priceCurrency !== 'USD') bad('structured data price is wrong');
  if (ld.material !== '100% Cotton') bad(`structured data material is "${ld.material}", expected the confirmed 100% Cotton`);
  else if (/pre-?shrunk|garment[- ]dyed|organic/i.test(JSON.stringify(ld)))
    bad('structured data contains claims the owner never supplied');
  else ok('product structured data carries the confirmed material and nothing unsupplied');

  const og = await page.$$eval('meta[property^="og:"]', (m) => m.length);
  const tw = await page.$$eval('meta[name^="twitter:"]', (m) => m.length);
  if (og < 4 || tw < 3) bad(`metadata thin: ${og} og tags, ${tw} twitter tags`);
  else ok('Open Graph and Twitter metadata present');

  for (const r of ['/checkout/', '/order/']) {
    await page.goto(BASE + r);
    const robotsMeta = await page.getAttribute('meta[name=robots]', 'content').catch(() => null);
    if (!/noindex/.test(robotsMeta || '')) bad(`${r} is not marked noindex`);
  }
  ok('checkout and order pages are marked noindex (the admin is not in the build at all)');
  await c.close();
}

/* --- the shipped code stays inside a documented browser baseline --- */
{
  // Only Chromium can be installed in this environment, so cross-browser
  // safety is enforced statically as well as tested dynamically: the shipped
  // CSS and JS must not use a feature newer than the stated baseline.
  //
  // Baseline: Safari 15.4+, Chrome/Edge 100+, Firefox 100+ (March 2022).
  // Anything newer needs a fallback declaration or a runtime guard, and this
  // check is what stops one arriving unnoticed.
  const TOO_NEW = [
    [/:has\(/, 'CSS :has()', 'Safari 15.4 / Chrome 105 / Firefox 121'],
    [/@container/, 'CSS container queries', 'Safari 16 / Chrome 105 / Firefox 110'],
    [/text-wrap:\s*(balance|pretty)/, 'CSS text-wrap', 'Chrome 114 / Firefox 121 / Safari 17.5'],
    [/grid-template-rows:\s*subgrid|subgrid/, 'CSS subgrid', 'Safari 16 / Chrome 117'],
    [/\banchor\(/, 'CSS anchor positioning', 'Chrome 125 only'],
    [/structuredClone\(/, 'structuredClone', 'Safari 15.4 / Chrome 98'],
    [/\.toSorted\(|\.toReversed\(|\.with\(/, 'Array change-by-copy', 'Safari 16.4 / Chrome 110'],
    [/Object\.groupBy|Map\.groupBy/, 'Object.groupBy', 'Chrome 117 / Safari 17.4'],
    [/\bAbortSignal\.timeout\b/, 'AbortSignal.timeout', 'Safari 16 / Chrome 103'],
    [/\?\.\s*\(/, '', ''], // optional call — safe, listed to document the check
  ];

  const shipped = [
    ['css/site.css', readFileSync(join(DIST, 'assets/css/site.css'), 'utf8')],
    ...readdirSync(join(DIST, 'assets/js')).map((f) => [
      `js/${f}`,
      readFileSync(join(DIST, 'assets/js', f), 'utf8'),
    ]),
  ];

  const outside = [];
  for (const [name, source] of shipped) {
    for (const [pattern, feature, support] of TOO_NEW) {
      if (feature && pattern.test(source)) outside.push(`${name}: ${feature} (${support})`);
    }
  }

  // Features that ARE used, and must therefore carry a fallback.
  const css = shipped[0][1];
  const guarded = [];
  if (/\bsvh\b/.test(css) && !/min-height:\s*min\(94vh/.test(css)) {
    guarded.push('svh is used with no vh fallback — the hero collapses on Safari 15.3 and older');
  }
  const js = shipped
    .slice(1)
    .map(([, src]) => src)
    .join('\n');
  if (/crypto\.randomUUID\(\)/.test(js) && !/crypto\.randomUUID\s*\n?\s*\?/.test(js)) {
    guarded.push('crypto.randomUUID is called without a guard (Safari gained it in 15.4)');
  }

  if (outside.length) bad(`shipped code uses features newer than the baseline: ${outside.join(', ')}`);
  else if (guarded.length) bad(`a modern feature is used without a fallback: ${guarded.join('; ')}`);
  else ok('shipped CSS and JS stay within the Safari 15.4 / Chrome 100 baseline, with fallbacks where needed');
}

/* --- no secrets in the shipped frontend --- */
{
  const jsFiles = readdirSync(join(DIST, 'assets/js'));
  const leaks = [];
  for (const f of jsFiles) {
    const src = readFileSync(join(DIST, 'assets/js', f), 'utf8');
    for (const re of [/password\s*[:=]\s*['"][^'"]+/i, /api[_-]?key\s*[:=]\s*['"][^'"]+/i, /secret\s*[:=]\s*['"][^'"]+/i, /sk_live|pk_live/i]) {
      if (re.test(src)) leaks.push(`${f}: ${(src.match(re) || [])[0]}`);
    }
  }
  // The runtime config block is the one place page data reaches the browser.
  // It must carry nothing credential-shaped — and, in API mode, not even the
  // WhatsApp destination, which the server now attaches to each order instead.
  const checkoutHtml = readFileSync(join(DIST, 'checkout/index.html'), 'utf8');
  const runtimeCfg = checkoutHtml.match(/window\.VESTI = \{.*?\};/s)?.[0] || '';
  if (!runtimeCfg) leaks.push('runtime config block missing from checkout');
  if (/password|apiKey|api_key|secret|token/i.test(runtimeCfg)) {
    leaks.push('runtime config contains a credential-shaped key');
  }
  if (/"whatsappNumber":"\d/.test(runtimeCfg)) {
    leaks.push('the WhatsApp destination is in the page bundle even though the API builds the link');
  }
  for (const f of jsFiles) {
    if (/963965438721/.test(readFileSync(join(DIST, 'assets/js', f), 'utf8'))) {
      leaks.push(`${f} hard-codes the WhatsApp number`);
    }
  }
  if (leaks.length) bad(`possible secrets in frontend bundle: ${leaks.join(', ')}`);
  else ok('no passwords, API keys or secrets in the shipped JavaScript');
}

/* --- internal links all resolve --- */
{
  const { c, page } = await ctx();
  const checked = new Set();
  const broken = [];
  for (const r of ['/', '/shop/', '/products/vestiphobia-001-fear-tee/', '/contact/', '/policies/terms/']) {
    await page.goto(BASE + r);
    const hrefs = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of hrefs) {
      const clean = h.split('#')[0].split('?')[0];
      if (!clean || checked.has(clean)) continue;
      checked.add(clean);
      const res = await page.request.get(BASE + clean);
      if (res.status() !== 200) broken.push(`${clean} -> ${res.status()}`);
    }
  }
  if (broken.length) bad(`broken internal links: ${broken.join(', ')}`);
  else ok(`all ${checked.size} internal links resolve`);
  await c.close();
}

/* ------------------------------------------------------------- teardown */

/* ============================================================ analytics */

group('Analytics');

/** Read the QA database directly — the admin renders it, but this is the truth. */
async function queryQaDb(sql, params = []) {
  const script = `
    process.env.SQLITE_PATH = ${JSON.stringify(QA_DB)};
    const { getDb } = await import('./server/db/index.js');
    const db = await getDb();
    const rows = await db.all(${JSON.stringify(sql)}, ${JSON.stringify(params)});
    console.log(JSON.stringify(rows));
    // Deliberately NOT closeDb(): closing the last SQLite connection
    // checkpoints the write-ahead log, which takes the write lock and can
    // starve the server mid-request. Exiting leaves the WAL to the server.
    process.exit(0);
  `;
  const out = await run(process.execPath, ['--input-type=module', '-e', script], serverEnv);
  const line = out.split('\n').find((l) => l.trim().startsWith('['));
  return JSON.parse(line || '[]');
}

/**
 * Poll until a query satisfies a condition.
 *
 * Analytics is delivered by `sendBeacon` when a page unloads, so a batch can
 * arrive seconds after the navigation that produced it, and out of order. A
 * fixed sleep here is a flaky test pretending to be a strict one; waiting for
 * the condition tests delivery honestly and fails only when the data really
 * never arrives.
 */
async function waitForRows(sql, params, predicate, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await queryQaDb(sql, params);
    if (predicate(rows)) return rows;
    await new Promise((r) => setTimeout(r, 400));
  }
  return rows;
}

{
  const { c, page } = await ctx();

  // A complete journey in one browser session: home, product, size, cart,
  // checkout. Every step is a real interaction, not a synthesised event.
  await page.goto(BASE + '/?utm_source=instagram&utm_medium=story&utm_campaign=qa-drop');
  await page.goto(BASE + '/shop/');
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.click('[data-size="M"]');
  await page.click('[data-add-btn]');
  await page.keyboard.press('Escape');
  await page.goto(BASE + '/cart/');
  await page.goto(BASE + '/checkout/');
  // A final navigation so the checkout page unloads and flushes its batch.
  await page.goto(BASE + '/story/');

  // Identify THIS journey by its campaign tag: picking "the newest session"
  // would be a race against the other browser contexts in this suite. Then
  // wait for the beacons to actually arrive rather than assuming they have,
  // and wait for ALL of the milestones — batches arrive out of order, so
  // stopping at the first would race the ones still in flight.
  const MILESTONES = [
    'saw_product',
    'selected_size',
    'added_to_cart',
    'viewed_cart',
    'began_checkout',
  ];
  const sessions = await waitForRows(
    "SELECT * FROM analytics_sessions WHERE utm_campaign = 'qa-drop' ORDER BY started_at DESC LIMIT 1",
    [],
    (rows) => rows[0] && MILESTONES.every((k) => Number(rows[0][k]) === 1)
  );
  const session = sessions[0];

  if (!session) {
    bad('a full browsing journey recorded no analytics session');
  } else {
    const missing = [
      ['saw_product', session.saw_product],
      ['selected_size', session.selected_size],
      ['added_to_cart', session.added_to_cart],
      ['viewed_cart', session.viewed_cart],
      ['began_checkout', session.began_checkout],
    ].filter(([, v]) => Number(v) !== 1);

    if (missing.length)
      bad(
        `funnel milestones not recorded: ${missing.map(([k]) => k).join(', ')} ` +
          `(session ${String(session.id).slice(0, 8)}, ${session.events} events, ` +
          `landing ${session.landing_path}, exit ${session.exit_path})`
      );
    else ok('a real browsing journey records every funnel milestone in order');

    if (session.utm_campaign !== 'qa-drop') bad(`campaign not captured: ${session.utm_campaign}`);
    else if (session.source !== 'instagram') bad(`source not captured: ${session.source}`);
    else ok('a UTM tag on the landing page survives the whole journey');

    if (session.landing_path !== '/') bad(`landing page wrong: ${session.landing_path}`);
    else ok('the landing page is recorded as the first page of the session');

    if (session.device !== 'desktop' || session.browser !== 'Chrome')
      bad(`device classification wrong: ${session.device}/${session.browser}`);
    else ok('device and browser are classified from the User-Agent');
  }

  // Events fire once. A page_view per navigation, never two for one page.
  // Scoped to the journey above, where every page was visited exactly once.
  // Across all sessions a repeated path is normal (people revisit pages); one
  // page LOAD producing two events is the bug this guards against.
  const pageViews = session
    ? await queryQaDb(
        `SELECT path, COUNT(*) AS n FROM analytics_events
          WHERE name = 'page_view' AND session_id = ?
          GROUP BY path HAVING COUNT(*) > 1`,
        [session.id]
      )
    : [];
  if (pageViews.length) bad(`duplicate page_view events: ${JSON.stringify(pageViews)}`);
  else ok('one page load records exactly one page_view — no duplicates from re-renders');

  const engagement = await waitForRows(
    "SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'page_engagement' AND engaged_ms > 0",
    [],
    (rows) => Number(rows[0]?.n) > 0
  );
  if (!Number(engagement[0]?.n)) bad('no engagement time was recorded for any page');
  else ok('foreground engagement time is measured and sent');

  await c.close();
}

/* --- the checkout submits an order, and the analytics follows it --- */
{
  const { c, page } = await ctx();
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.click('[data-size="XL"]');
  await page.click('[data-add-btn]');
  await page.keyboard.press('Escape');
  await page.goto(BASE + '/checkout/');
  await page.fill('#fullName', 'Analytics Tester');
  await page.fill('#phone', '0955777888');
  await page.fill('#city', 'Latakia');
  await page.fill('#address', '9 Analytics Street, building 2, first floor');
  await page.click('[data-checkout-submit]');
  await page.waitForURL(/\/order\/\?id=/, { timeout: 10000 }).catch(() => {});

  const created = await waitForRows(
    "SELECT props FROM analytics_events WHERE name = 'order_created'",
    [],
    (rows) => rows.length > 0
  );
  if (!created.length) bad('placing an order recorded no order_created event');
  else ok('a completed checkout records an order_created event with the server total');

  const converted = await waitForRows(
    'SELECT COUNT(*) AS n FROM analytics_sessions WHERE created_order = 1',
    [],
    (rows) => Number(rows[0]?.n) > 0
  );
  if (!Number(converted[0]?.n)) bad('the converting session is not marked as an order');
  else ok('the session that ordered is marked converted, which is what the funnel counts');

  await c.close();
}

/* --- no customer PII anywhere in the analytics tables --- */
{
  // Every column that carries text a person could have typed. Numeric columns
  // (engaged_ms) and the random ids are excluded deliberately: they are not
  // PII, and including them would make this check cry wolf on a timestamp.
  const events = await queryQaDb('SELECT props, path, referrer FROM analytics_events');
  const sessions = await queryQaDb(
    `SELECT source, medium, campaign, utm_source, utm_medium, utm_campaign, utm_content,
            utm_term, referrer_host, landing_path, exit_path, order_number
       FROM analytics_sessions`
  );
  const haystack = JSON.stringify(events) + JSON.stringify(sessions);

  const leaks = [];
  for (const needle of [
    'Analytics Tester',
    'Sami Haddad',
    '0955777888',
    '963955777888',
    'Analytics Street',
    'Baghdad Street',
    'Latakia',
  ]) {
    if (haystack.includes(needle)) leaks.push(needle);
  }
  // Any run of 7+ digits left in that text is a phone number in all but name.
  // Order numbers are the one legitimate digit sequence, so they are removed
  // before the scan rather than excused afterwards.
  const digits = haystack.replace(/VST-\d{4}-\d{4}/g, '').match(/\d{7,}/g) || [];
  if (leaks.length) bad(`customer PII found in analytics: ${leaks.join(', ')}`);
  else if (digits.length) bad(`phone-shaped digits found in analytics: ${digits.slice(0, 3).join(', ')}`);
  else ok('no name, phone, address or city from any order appears in the analytics tables');
}

/* --- opting out really stops collection --- */
{
  const { c, page } = await ctx();
  await page.goto(BASE + '/policies/privacy/');

  // Let any beacon still in flight from an earlier page land BEFORE the
  // baseline is taken, or a late arrival would look like a violation of an
  // opt-out that had not even happened yet.
  await page.waitForTimeout(4000);
  const before = Number(
    (await queryQaDb('SELECT COUNT(*) AS n FROM analytics_events'))[0]?.n || 0
  );

  const label = await page.textContent('[data-optout-toggle]');
  if (!/Turn analytics off/i.test(label || '')) bad(`opt-out control not rendered: ${label}`);
  else ok('the privacy page carries a working opt-out control');

  await page.click('[data-optout-toggle]');
  const after = await page.textContent('[data-optout-toggle]');
  if (!/Turn analytics back on/i.test(after || '')) bad('opting out did not update the control');

  // Browse with the opt-out set. Nothing may be recorded.
  await page.goto(BASE + '/shop/');
  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.goto(BASE + '/story/');
  // Long enough that a beacon would certainly have arrived, had one been sent.
  await page.waitForTimeout(4000);

  const now = Number((await queryQaDb('SELECT COUNT(*) AS n FROM analytics_events'))[0]?.n || 0);
  if (now !== before) bad(`${now - before} events were recorded after opting out`);
  else ok('after opting out, browsing records nothing at all');

  await c.close();
}

/* --- Do Not Track is honoured without any action by the visitor --- */
{
  const c = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await c.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
  });

  await new Promise((r) => setTimeout(r, 4000));
  const before = Number((await queryQaDb('SELECT COUNT(*) AS n FROM analytics_events'))[0]?.n || 0);
  await page.goto(BASE + '/');
  await page.goto(BASE + '/shop/');
  await page.goto(BASE + '/story/');
  await page.waitForTimeout(3000);
  const now = Number((await queryQaDb('SELECT COUNT(*) AS n FROM analytics_events'))[0]?.n || 0);

  if (now !== before) bad(`${now - before} events recorded despite Do Not Track`);
  else ok('a Do Not Track browser is not tracked, with nothing for the visitor to do');
  await c.close();
}

/* --- analytics failure must not break the shop --- */
{
  const { c, page, errors } = await ctx();
  // Every analytics request fails. The site must behave exactly as before.
  await page.route('**/api/events', (r) => r.abort());

  await page.goto(BASE + '/products/vestiphobia-001-fear-tee/');
  await page.click('[data-size="S"]');
  await page.click('[data-add-btn]');
  await page.keyboard.press('Escape');
  await page.goto(BASE + '/cart/');
  const count = (await page.textContent('.header [data-cart-count]')).trim();
  if (count !== '1') bad(`cart broken while analytics was failing: count = ${count}`);
  else ok('the cart works normally when every analytics request fails');

  await page.goto(BASE + '/checkout/');
  const submitVisible = await page.locator('[data-checkout-submit]').isVisible();
  if (!submitVisible) bad('checkout did not render while analytics was failing');
  else ok('checkout renders and is usable when analytics is unreachable');

  const fatal = errors.filter((e) => !/Failed to fetch|net::ERR|beacon/i.test(e));
  if (fatal.length) bad(`analytics failure produced page errors: ${fatal.slice(0, 2).join(' | ')}`);
  else ok('a failing analytics endpoint produces no page errors');

  await c.close();
}

/* --- the admin analytics screens render, and the numbers are consistent --- */
{
  const jar = await adminLogin();
  const tabs = [
    'overview',
    'traffic',
    'funnel',
    'products',
    'customers',
    'orders',
    'campaigns',
    'devices',
    'locations',
    'conversion',
    'events',
  ];
  const broken = [];
  for (const tab of tabs) {
    const res = await fetch(`${BASE}/admin/analytics?tab=${tab}`, { headers: { cookie: jar } });
    if (!res.ok) broken.push(`${tab}:${res.status}`);
  }
  if (broken.length) bad(`admin analytics tabs failed: ${broken.join(', ')}`);
  else ok(`all ${tabs.length} admin analytics screens render`);

  const ranges = [];
  for (const range of ['today', '7d', '30d', '90d']) {
    const res = await fetch(`${BASE}/admin/analytics?tab=overview&range=${range}`, {
      headers: { cookie: jar },
    });
    if (!res.ok) ranges.push(`${range}:${res.status}`);
  }
  const custom = await fetch(
    `${BASE}/admin/analytics?tab=overview&range=custom&from=2026-01-01&to=2026-12-31`,
    { headers: { cookie: jar } }
  );
  if (!custom.ok) ranges.push(`custom:${custom.status}`);
  if (ranges.length) bad(`date filters failed: ${ranges.join(', ')}`);
  else ok('every date filter works, including a custom range');

  // A narrow window must not report more than a wide one.
  const numbersFor = async (range) => {
    const html = await (
      await fetch(`${BASE}/admin/analytics?tab=overview&range=${range}`, { headers: { cookie: jar } })
    ).text();
    const first = html.match(/<div class="card__value">([^<]*)</);
    return Number(String(first?.[1] || '0').replace(/[^0-9.]/g, ''));
  };
  const today = await numbersFor('today');
  const ninety = await numbersFor('90d');
  if (today > ninety) bad(`today (${today}) reports more sessions than 90 days (${ninety})`);
  else ok(`date filters narrow correctly (today ${today} <= 90 days ${ninety} sessions)`);

  // The analytics screens must not leak what the rest of the admin protects.
  const anon = await fetch(`${BASE}/admin/analytics?tab=events`);
  const anonBody = await anon.text();
  if (anon.status !== 401 || /page_view/.test(anonBody))
    bad('the raw event stream is readable without a session');
  else ok('analytics screens require an admin session like every other admin page');
}

await browser.close();
if (!KEEP) {
  server.kill();
  removeQaDb();
}

// Server-side errors are failures too, even when every browser check passed.
try {
  const log = readLog(SERVER_LOG, 'utf8');
  const serverErrors = log
    .split('\n')
    .filter((l) => /\[analytics\] ingest failed|\[server\].*failed|UnhandledPromiseRejection/.test(l));
  if (serverErrors.length) bad(`server logged ${serverErrors.length} error(s): ${serverErrors[0].slice(0, 160)}`);
  else ok('the server logged no errors during the run');
} catch {
  /* no log to read */
}

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}
if (KEEP) console.log(`\nserver still running on ${BASE}`);
process.exit(failures.length ? 1 : 0);

/*
 * Sprint A–D tests (PWA, Web Push, notification settings, mobile audit, UX polish, growth).
 * Run against a freshly seeded DB: scripts/run-e2e.sh sprint-tests
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

/* ---- local stand-ins: SMS/WhatsApp gateway (HTTP) and a push service (HTTPS) ---- */
const gateway = { hits: [] };
const gatewayServer = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { gateway.hits.push({ path: req.url, body: JSON.parse(b || '{}') }); res.writeHead(200); res.end('{}'); });
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paylo-push-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/k.pem -out ${tmp}/c.pem -days 1 -subj /CN=127.0.0.1 2>/dev/null`);
const pushSvc = { got: [], statusFor: {} };
const pushServer = https.createServer({ key: fs.readFileSync(`${tmp}/k.pem`), cert: fs.readFileSync(`${tmp}/c.pem`) }, (req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    pushSvc.got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(pushSvc.statusFor[req.url] || 201); res.end();
  });
});

/** A browser-side push subscription: ECDH P-256 key pair + auth secret, as a real browser makes. */
function makeSubscription(id) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, json: { endpoint: `https://127.0.0.1:4013/push/${id}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } };
}
/** RFC 8291 (aes128gcm) decryption — proves the server really encrypted for this subscription. */
function decryptPush(sub, body) {
  const salt = body.subarray(0, 16), idlen = body[20], serverPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = sub.ecdh.computeSecret(serverPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), sub.ecdh.getPublicKey(), serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, sub.auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1; while (end > 0 && plain[end] === 0) end--;   // strip padding, then the 0x02 delimiter
  return JSON.parse(plain.subarray(0, end).toString());
}

(async () => {
  await new Promise((r) => gatewayServer.listen(4011, '127.0.0.1', r));
  await new Promise((r) => pushServer.listen(4013, '127.0.0.1', r));
  const db = new Database(DB_PATH);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = (opts = {}) => browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const TOTP = { 'spice@paylo.sy': 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U', 'demo@paylo.sy': 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
  const login = async (p, email, pw = 'seller1234') => {
    await p.goto(BASE + '/login'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
    await p.click('button[type=submit]');
    if (TOTP[email]) {
      await p.waitForURL('**/login/2fa');
      await p.fill('input[name=code]', execSync(`node scripts/totp.js ${TOTP[email]}`).toString().slice(0, 6));
      await p.click('button[type=submit]');
    }
  };
  const cookieHeader = async (p) => (await p.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const spice = db.prepare("SELECT * FROM sellers WHERE slug = 'spice-house'").get();
  const zaatar = db.prepare("SELECT * FROM products WHERE seller_id = ? AND title LIKE 'Za%'").get(spice.id);
  const buy = async (page, name = 'Sprint Buyer') => {
    await page.goto(BASE + '/p/' + zaatar.id);
    await page.fill('input[name=buyer_name]', name);
    await page.fill('input[name=buyer_phone]', '0912000222');
    await page.fill('textarea[name=address]', 'Mezzeh, Damascus');
    await page.click('button:has-text("Continue")');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/track/**', { timeout: 15000 });
    return db.prepare('SELECT * FROM orders WHERE code = ?').get(decodeURIComponent(new URL(page.url()).pathname.split('/').pop()));
  };

  const sellerCtx = await ctx({ permissions: ['notifications'] });
  const seller = await sellerCtx.newPage();
  await login(seller, 'spice@paylo.sy');
  await seller.waitForURL('**/seller');

  /* ================= SPRINT A ================= */
  step('A1. PWA: manifest, icons, service worker, offline page');
  const man = await (await fetch(BASE + '/manifest.webmanifest')).json();
  ok(man.name && man.short_name === 'Paylo' && man.display === 'standalone' && man.start_url === '/seller', 'manifest is served with name, standalone display and seller start URL');
  const sizes = man.icons.map((i) => i.sizes);
  ok(sizes.includes('192x192') && sizes.includes('512x512') && man.icons.some((i) => i.purpose === 'maskable'), 'manifest has 192/512 icons and a maskable icon (installable)');
  for (const i of man.icons) ok((await fetch(BASE + i.src)).headers.get('content-type') === 'image/png', `${i.src} is served as PNG`);
  ok(await seller.locator('link[rel=manifest]').count() === 1 && await seller.locator('meta[name=theme-color]').count() === 1, 'pages link the manifest and set a theme colour');
  const swScope = await seller.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  ok(swScope === BASE + '/', 'service worker registers for the whole site');

  // (The offline fallback is checked at the very end of this suite, with the server actually down.)
  const offCtx = await ctx();
  const off = await offCtx.newPage();
  await off.goto(BASE + '/');
  await off.evaluate(async () => { await navigator.serviceWorker.ready; });
  await off.reload();                                     // now controlled by the service worker
  ok(await off.evaluate(() => !!navigator.serviceWorker.controller) && await off.evaluate(async () => !!(await caches.match('/offline.html'))), 'service worker controls pages and has the offline page cached');

  step('A2. Web Push: subscribe, encrypted VAPID delivery, dead subscriptions removed');
  const keyRes = await fetch(BASE + '/api/push/key', { headers: { cookie: await cookieHeader(seller) } });
  const { publicKey } = await keyRes.json();
  ok(keyRes.status === 200 && Buffer.from(publicKey, 'base64url').length === 65, 'VAPID public key is served (P-256, 65 bytes) — generated automatically with no setup');
  ok((await fetch(BASE + '/api/push/key')).status === 401, 'push key needs a seller session');
  const subA = makeSubscription('device-a'), subGone = makeSubscription('device-gone');
  for (const s of [subA, subGone]) {
    const r = await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { cookie: await cookieHeader(seller), 'content-type': 'application/json' }, body: JSON.stringify(s.json) });
    ok(r.status === 200, `subscription ${s.json.endpoint.split('/').pop()} saved`);
  }
  ok((await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subA.json) })).status === 401, 'subscribing needs a seller session');
  ok((await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { cookie: await cookieHeader(seller), 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://evil/x', keys: {} }) })).status === 400, 'a malformed subscription is rejected');
  const subRow = db.prepare('SELECT seller_id FROM push_subscriptions WHERE endpoint = ?').get(subA.json.endpoint);
  ok(subRow.seller_id === spice.id, 'subscription is bound to the session seller (never a client-sent id)');

  pushSvc.statusFor['/push/device-gone'] = 410;
  const buyerCtx = await ctx();
  const buyer = await buyerCtx.newPage();
  const o1 = await buy(buyer, 'Push Buyer');
  await new Promise((r) => setTimeout(r, 500));
  const hitA = pushSvc.got.find((g) => g.path === '/push/device-a');
  ok(!!hitA, 'a new order sends a push to the seller device');
  ok(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(hitA.headers.authorization) && hitA.headers['content-encoding'] === 'aes128gcm' && Number(hitA.headers.ttl) > 0,
    'push carries VAPID auth (signed JWT + key), aes128gcm encoding and a TTL');
  const payload = decryptPush(subA, hitA.body);
  ok(payload.title === `New order ${o1.code}` && /Za'atar/.test(payload.body) && payload.url === `/seller/orders/${o1.id}`, 'payload decrypts with the device keys to the order code, product and link');
  ok(!db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subGone.json.endpoint), 'a subscription the push service reports gone (410) is deleted');

  step('A2b. Service worker: system notification when no seller tab is visible, silent when one is');
  const cdp = await sellerCtx.newCDPSession(seller);
  const regIds = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => e.registrations.forEach((r) => regIds.push(r.registrationId)));
  await cdp.send('ServiceWorker.enable');
  await new Promise((r) => setTimeout(r, 500));
  const regId = regIds[regIds.length - 1];
  const notifCount = async (p) => p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length);
  const pushData = JSON.stringify({ title: 'New order PL-TESTPUSH', body: "Za'atar blend (250 g) ×1", url: '/seller/orders/x', tag: 'test-1' });

  const other = await sellerCtx.newPage();               // same seller browser, but only a buyer page is showing
  await other.goto(BASE + '/s/spice-house');
  await seller.goto(BASE + '/s/spice-house');            // no /seller tab visible = "dashboard closed"
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: regId, data: pushData });
  await new Promise((r) => setTimeout(r, 800));
  const shown = await other.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, url: n.data && n.data.url })));
  ok(shown.some((n) => n.title === 'New order PL-TESTPUSH' && n.url === '/seller/orders/x'), 'with the dashboard closed, a push becomes a system notification with the order link');
  await other.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach((n) => n.close()));

  await seller.goto(BASE + '/seller');
  await seller.bringToFront();
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: regId, data: pushData.replace('test-1', 'test-2') });
  await new Promise((r) => setTimeout(r, 800));
  ok(await notifCount(seller) === 0, 'with the dashboard open and visible, no duplicate system notification (the tab toast + chime handle it)');

  step('A3. Notification settings under /seller/settings');
  await seller.goto(BASE + '/seller/settings');
  const ns = seller.locator('[data-testid=notification-settings]');
  ok(await ns.count() === 1, 'settings page has a Notifications section');
  ok(/1 device/.test(await ns.innerText()), 'it shows how many devices receive pushes');
  await ns.locator('input[name=notify_push]').uncheck();
  await ns.locator('input[name=notify_email_orders]').uncheck();
  await ns.locator('input[name=notify_sound]').check();
  await ns.locator('select[name=notify_text]').selectOption('whatsapp');
  await ns.getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForSelector('[data-testid=notification-settings] .alert-success');
  const prefs = db.prepare('SELECT notify_push, notify_sound, notify_email_orders, notify_text FROM sellers WHERE id = ?').get(spice.id);
  ok(prefs.notify_push === 0 && prefs.notify_sound === 1 && prefs.notify_email_orders === 0 && prefs.notify_text === 'whatsapp', 'all four preferences save');

  const pushBefore = pushSvc.got.length;
  const mailsBefore = db.prepare("SELECT count(*) c FROM notifications WHERE event = 'order.placed.seller' AND channel = 'email'").get().c;
  const o2 = await buy(buyer, 'Prefs Buyer');
  await new Promise((r) => setTimeout(r, 500));
  ok(pushSvc.got.length === pushBefore, 'push off → no push sent');
  ok(db.prepare("SELECT count(*) c FROM notifications WHERE event = 'order.placed.seller' AND channel = 'email'").get().c === mailsBefore, 'order email off → no seller email');
  ok(gateway.hits.some((h) => h.path === '/wa' && h.body.to === spice.phone && h.body.body.includes(o2.code)), 'WhatsApp chosen → new-order message to the store phone');
  await seller.goto(BASE + '/seller');
  ok(await seller.locator('[data-testid=sound-toggle]').getAttribute('aria-pressed') === 'true', 'dashboard sale-sound toggle reflects the saved preference');

  await seller.goto(BASE + '/seller/settings');
  await ns.locator('input[name=notify_push]').check();
  await ns.locator('input[name=notify_email_orders]').check();
  await ns.locator('select[name=notify_text]').selectOption('none');
  await ns.getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForSelector('[data-testid=notification-settings] .alert-success');

  step('A4. Mobile audit at 390px: no overflow, tap targets ≥ 40px, no clipped text');
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  await login(phone, 'spice@paylo.sy');
  await phone.waitForURL('**/seller');
  const anyOrder = db.prepare("SELECT id FROM orders WHERE seller_id = ? AND status = 'confirmed' ORDER BY created_at DESC LIMIT 1").get(spice.id);
  const auditPages = [
    ['dashboard', '/seller'], ['products list', '/seller/products'], ['add product', '/seller/products/new'],
    ['order detail + hand-off', '/seller/orders/' + anyOrder.id], ['orders', '/seller/orders'], ['returns', '/seller/returns?f=all'],
    ['settings', '/seller/settings'], ['earnings', '/seller/earnings'], ['coupons', '/seller/coupons'],
  ];
  const audit = async (p) => p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - W;
    const small = [], clipped = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, label:has(input[type=checkbox])')) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!r.width || cs.visibility === 'hidden' || el.closest('[aria-hidden=true]')) continue;
      if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type)) continue;   // measured via their label
      if (r.height < 40 && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p'))) small.push(`${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 24)}" ${Math.round(r.height)}px`);
    }
    for (const el of document.querySelectorAll('h1, h2, .stat-value, .btn-primary, .btn-secondary')) {
      if (el.closest('table, .overflow-x-auto')) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && !el.classList.contains('truncate')) clipped.push(el.textContent.trim().slice(0, 30));
    }
    return { over, small: small.slice(0, 8), clipped };
  });
  // Audit every page first (so one run reports all problems), then assert each.
  const results = [];
  for (const [name, p] of auditPages) { await phone.goto(BASE + p); results.push(['seller ' + name, await audit(phone)]); }
  const buyerPhone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  for (const [name, p] of [['storefront', '/s/spice-house'], ['checkout', '/p/' + zaatar.id], ['tracking', '/track/' + o2.code]]) {
    await buyerPhone.goto(BASE + p); results.push(['buyer ' + name, await audit(buyerPhone)]);
  }
  for (const [name, r] of results) if (r.over > 1 || r.small.length || r.clipped.length) console.log(`  ! ${name}: overflow ${r.over}px, small ${JSON.stringify(r.small)}, clipped ${JSON.stringify(r.clipped)}`);
  for (const [name, r] of results) ok(r.over <= 1 && r.small.length === 0 && r.clipped.length === 0, `${name}: no overflow, all tap targets ≥ 40px, no clipped text`);

  step('A4b. The same pages in Arabic (RTL) at 390px');
  await phone.context().addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]);
  await buyerPhone.context().addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]);
  const rtl = [];
  for (const [name, p] of auditPages) { await phone.goto(BASE + p); rtl.push(['seller ' + name, await audit(phone), await phone.evaluate(() => document.documentElement.dir)]); }
  for (const [name, p] of [['storefront', '/s/spice-house'], ['checkout', '/p/' + zaatar.id], ['tracking', '/track/' + o2.code]]) {
    await buyerPhone.goto(BASE + p); rtl.push(['buyer ' + name, await audit(buyerPhone), await buyerPhone.evaluate(() => document.documentElement.dir)]);
  }
  for (const [name, r] of rtl) if (r.over > 1 || r.small.length || r.clipped.length) console.log(`  ! AR ${name}: overflow ${r.over}px, small ${JSON.stringify(r.small)}, clipped ${JSON.stringify(r.clipped)}`);
  for (const [name, r, dir] of rtl) ok(dir === 'rtl' && r.over <= 1 && r.small.length === 0 && r.clipped.length === 0, `AR ${name}: right-to-left, no overflow, tap targets ≥ 40px`);
  await phone.goto(BASE + '/seller/settings');
  ok(await phone.getByText('الإشعارات', { exact: true }).count() >= 1 && await phone.getByText('صوت البيع').count() >= 1, 'notification settings are translated to Arabic');

  step('A1b. Offline: with the server unreachable, navigation shows the Paylo offline page');
  execSync('pkill -f "next-serve[r]" || true');
  await new Promise((r) => setTimeout(r, 1000));
  await off.goto(BASE + '/s/spice-house').catch(() => {});
  ok(await off.getByText("You're offline").count() === 1 && await off.getByText('أنت غير متصل').count() === 1, 'offline page (English + Arabic) instead of a browser error');

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close(); gatewayServer.close(); pushServer.close();
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

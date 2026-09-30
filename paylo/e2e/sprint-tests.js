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
  const TOTP = { 'fresh@paylo.sy': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'spice@paylo.sy': 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U', 'demo@paylo.sy': 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
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

  /* ================= SPRINT B ================= */
  step('B5. Empty states: every list says what it is for and what to do next');
  // A brand-new live store (2FA on, so not held) with nothing in it yet.
  const EMPTY_TOTP = 'ONSWG4TFORTGK3LQOR4Q';
  const eUid = 'u-empty', eSid = 's-empty';
  db.prepare("INSERT INTO users (id, email, password_hash, role, name, totp_secret, totp_enabled) VALUES (?, 'empty@paylo.sy', (SELECT password_hash FROM users WHERE email = 'spice@paylo.sy'), 'seller', 'New Seller', ?, 1)").run(eUid, EMPTY_TOTP);
  db.prepare("INSERT INTO sellers (id, user_id, store_name, slug, phone, governorate, status, kyc_status) VALUES (?, ?, 'Brand New Shop', 'brand-new-shop', '0999000111', 'Damascus', 'approved', 'approved')").run(eSid, eUid);
  TOTP['empty@paylo.sy'] = EMPTY_TOTP;
  const fresh = await (await ctx()).newPage();
  await login(fresh, 'empty@paylo.sy');
  await fresh.waitForURL('**/seller');
  const emptyCases = [
    ['/seller/products', 'No products yet.', 'New product', '/seller/products/new'],
    ['/seller/collections', 'No collections yet.', null],
    ['/seller/coupons', 'No discount codes yet.', null],
    ['/seller/variations', 'No option lists yet.', null],
    ['/seller/returns', 'No open returns', null],
    ['/seller/returns?f=all', 'No returns here.', null],
    ['/seller/orders', 'No orders yet', 'Open my store', '/s/brand-new-shop'],
    ['/seller/orders?state=closed', 'Nothing under “Closed”', 'See all orders', '/seller/orders'],
  ];
  for (const [p, title, cta, href] of emptyCases) {
    await fresh.goto(BASE + p);
    const es = fresh.locator('[data-testid=empty-state]');
    const txt = (await es.count()) ? await es.innerText() : '';
    const link = cta ? await es.getByRole('link', { name: cta }).getAttribute('href').catch(() => null) : null;
    ok(txt.includes(title) && txt.split('\n').length >= 2 && (!cta || link === href), `${p}: "${title}" with guidance${cta ? ` and a "${cta}" action` : ''}`);
  }
  await fresh.context().addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]);
  await fresh.goto(BASE + '/seller/products');
  ok(/أضف منتجك الأول/.test(await fresh.locator('[data-testid=empty-state]').innerText()), 'empty states are translated (Arabic)');

  step('B6. Hand-off: clear success state with the tracking number up front');
  const hoOrder = await buy(buyer, 'Handoff Buyer');
  await seller.goto(BASE + '/seller/orders/' + hoOrder.id);
  const hoForm = seller.locator('[data-testid=handoff-form]');
  await hoForm.getByLabel('Rider name or shipment reference').fill('Rider Sami');
  await hoForm.getByLabel(/Tracking number/).fill('TRK-SPRINT-1');
  await hoForm.getByRole('button', { name: 'Mark as handed off' }).click();
  const done = seller.locator('[data-testid=handoff-done]');
  await done.waitFor();
  ok(await seller.locator('[data-testid=handoff-form]').count() === 0, 'the form is replaced by a success card');
  const doneText = await done.innerText();
  ok(/Handed off/.test(doneText) && /Rider Sami/.test(doneText) && /buyer has been notified/.test(doneText), 'success card says it is handed off, by whom, and that the buyer was told');
  ok(await done.locator('[data-testid=tracking-number]').innerText() === 'TRK-SPRINT-1', 'tracking number is shown prominently');
  ok(doneText.includes('/track/' + hoOrder.code), "buyer's tracking link is right there to copy");
  await done.locator('input[name=tracking]').fill('TRK-SPRINT-2');
  await done.getByRole('button', { name: 'Update' }).click();
  await seller.waitForFunction(() => document.querySelector('[data-testid=tracking-number]')?.textContent === 'TRK-SPRINT-2');
  ok(true, 'tracking number can be corrected in place');
  await buyer.goto(BASE + '/track/' + hoOrder.code);
  ok(await buyer.getByText('TRK-SPRINT-2').count() === 1, 'the buyer sees the updated tracking number');

  step('B7. Commission breakdown (built earlier) is present and populated');
  await seller.goto(BASE + '/seller/earnings');
  ok(await seller.locator('[data-testid=earnings-table] tbody tr').count() >= 1 && await seller.locator('[data-testid=earnings-csv]').count() === 1, 'per-order breakdown with CSV export is live');

  step('B8. Product photos: drag-drop, multiple, reorder, cover first');
  const colorPng = async (c) => { const pg = await browser.newPage({ viewport: { width: 6, height: 6 } }); await pg.setContent(`<body style="margin:0;background:${c}"></body>`); const b = await pg.screenshot(); await pg.close(); return b; };
  const [RED, GREEN, BLUE] = [await colorPng('#f00'), await colorPng('#0f0'), await colorPng('#00f')];
  const uploadDir = path.join(process.cwd(), 'data', 'uploads');
  const bytesOf = (src) => fs.readFileSync(path.join(uploadDir, path.basename(src)));
  const dropFiles = async (p, files) => p.evaluate(async (fs2) => {
    const dt = new DataTransfer();
    for (const f of fs2) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: 'image/png' }));
    const el = document.querySelector('[data-testid=image-drop]');
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files.map(([name, buf]) => ({ name, b64: buf.toString('base64') })));

  await seller.goto(BASE + '/seller/products/new');
  await seller.fill('input[name=title]', 'Photo test jar');
  await seller.fill('input[name=price]', '20000');
  await seller.fill('input[name=stock]', '3');
  await dropFiles(seller, [['red.png', RED], ['green.png', GREEN]]);
  await seller.locator('[data-testid=image-picker]').setInputFiles({ name: 'blue.png', mimeType: 'image/png', buffer: BLUE });
  const tiles = seller.locator('[data-image-item]');
  ok(await tiles.count() === 3, 'two photos dropped + one picked = three, in that order');
  await tiles.nth(2).getByRole('button', { name: 'Move earlier' }).click();
  await tiles.nth(1).getByRole('button', { name: 'Move earlier' }).click();     // blue is now first
  await tiles.nth(2).getByRole('button', { name: 'Remove' }).click();            // drop green (now last)
  ok(await tiles.count() === 2 && await tiles.nth(0).getByText('Cover').count() === 1, 'reordered with ‹ ›, removed one; first is marked Cover');
  await seller.getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForURL('**saved=1');
  const jar = db.prepare("SELECT * FROM products WHERE seller_id = ? AND title = 'Photo test jar'").get(spice.id);
  let imgs = JSON.parse(jar.images);
  ok(imgs.length === 2 && bytesOf(imgs[0]).equals(BLUE) && bytesOf(imgs[1]).equals(RED), 'saved in the chosen order: blue (cover), red — green removed');

  await seller.goto(BASE + '/seller/products/' + jar.id);
  ok(await tiles.count() === 2, 'edit form shows the saved photos in order');
  await tiles.nth(1).dragTo(tiles.nth(0));                                        // mouse drag: red to the front
  await seller.locator('input[name=image_order]').evaluate((el) => { const o = JSON.parse(el.value); o.push('/uploads/another-stores-photo.png'); el.value = JSON.stringify(o); });
  await seller.getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForURL('**saved=1');
  imgs = JSON.parse(db.prepare('SELECT images FROM products WHERE id = ?').get(jar.id).images);
  ok(imgs.length === 2 && bytesOf(imgs[0]).equals(RED) && bytesOf(imgs[1]).equals(BLUE), 'drag-and-drop reorder saved (red is now the cover)');
  ok(!imgs.includes('/uploads/another-stores-photo.png'), "a forged path to someone else's photo is ignored");

  await seller.goto(BASE + '/seller/products/new');
  await dropFiles(seller, [1, 2, 3, 4, 5, 6].map((n) => [`p${n}.png`, RED]));
  ok(await tiles.count() === 5 && await seller.getByText('Up to 5 photos').count() === 1, 'more than 5 → capped at 5 with a clear message');
  ok(await seller.locator('[data-testid=image-drop]').count() === 0, 'drop zone hides once the 5-photo limit is reached');

  /* ================= SPRINT C ================= */
  step('C9. The seller’s post-purchase message is surfaced clearly');
  await seller.goto(BASE + '/seller/settings');
  const tyBox = seller.locator('textarea[name=thank_you_message]');
  await tyBox.fill('Shukran! Every jar is ground to order.');
  ok(/Every jar is ground to order/.test(await seller.locator('[data-testid=thank-you-preview]').innerText()), 'settings shows a live preview of the message as buyers will see it');
  await seller.locator('[data-testid=store-settings-form]').getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForSelector('[data-testid=store-settings-form] .alert-success');
  const tyOrder = await buy(buyer, 'Message Buyer');
  ok(/Every jar is ground to order/.test(await buyer.locator('[data-testid=thank-you]').innerText()), 'prominent on the confirmation page right after purchase');
  await buyer.goto(BASE + '/track/' + tyOrder.code);
  ok(/Every jar is ground to order/.test(await buyer.locator('[data-testid=thank-you-later]').innerText()), 'still there when the buyer comes back to track the order');

  step('C10. Sales chart on the seller dashboard');
  await seller.goto(BASE + '/seller');
  const chart = seller.locator('[data-testid=sales-chart]');
  ok(await chart.count() === 1 && await chart.locator('[data-bar]').count() === 30, 'chart shows the last 30 days, one bar per day');
  const expected = db.prepare("SELECT coalesce(sum(subtotal - refunded_amount),0) s, count(*) c FROM orders WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed','refunded') AND date(created_at) > date('now','-30 days')").get(spice.id);
  ok((await chart.locator('[data-testid=sales-total]').innerText()).replace(/\D/g, '') === String(expected.s) && (await chart.innerText()).includes(`${expected.c} orders`), `30-day total (${expected.s} SYP, ${expected.c} orders) matches the database`);
  const today = new Date().toISOString().slice(0, 10);
  ok(await chart.locator(`[data-bar="${today}"] path`).count() === 1 && /SYP/.test(await chart.locator(`[data-bar="${today}"] title`).textContent()), "today's bar is drawn and has a hover tooltip with the amount");
  await chart.getByText('Show as a table').click();
  ok(await chart.locator('table tbody tr').count() >= 1, 'the same numbers are available as a table');
  const arSeller = await (await ctx()).newPage();
  await arSeller.context().addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]);
  await login(arSeller, 'spice@paylo.sy');
  await arSeller.waitForURL('**/seller');
  ok(/المبيعات، آخر 30 يومًا/.test(await arSeller.locator('[data-testid=sales-chart]').innerText()) && await arSeller.evaluate(() => document.documentElement.dir) === 'rtl', 'chart renders in Arabic (RTL page, time still reads left→right)');

  step('C11. Checkout friction fixes (validated on Continue; errors return to the right step)');
  const co = await (await ctx()).newPage();
  await co.goto(BASE + '/p/' + zaatar.id);
  await co.fill('input[name=buyer_name]', 'Skips Phone');
  await co.click('button:has-text("Continue")');
  ok(!(await co.locator('button[type=submit]').isVisible()) && await co.evaluate(() => document.activeElement?.getAttribute('name')) === 'buyer_phone',
    'Continue with an empty phone stays on step 1 and puts the cursor on the phone field (before: it advanced, then "Place order" silently did nothing)');
  await co.fill('input[name=buyer_phone]', '12');
  await co.fill('textarea[name=address]', 'Mezzeh, Damascus');
  await co.click('button:has-text("Continue")');
  ok(!(await co.locator('button[type=submit]').isVisible()), 'a malformed phone is caught at Continue, using the same rule as the server');
  // Force a server-side rejection by removing the browser checks.
  await co.locator('input[name=buyer_phone]').evaluate((el) => { el.removeAttribute('pattern'); });
  await co.click('button:has-text("Continue")');
  await co.locator('button[type=submit]').click();
  await co.waitForFunction(() => document.activeElement?.getAttribute('name') === 'buyer_phone');
  ok(await co.locator('input[name=buyer_phone]').isVisible(), 'a server-side field error sends the buyer back to step 1 with the field focused (before: stuck on step 2, field hidden)');
  ok(await co.locator('input[name=buyer_name]').getAttribute('autocomplete') === 'name' && await co.locator('textarea[name=address]').getAttribute('autocomplete') === 'street-address', 'fields carry autocomplete hints so phones can fill saved details');

  /* ================= PRODUCTION HARDENING ================= */
  step('P6. Push failures are logged; only 404/410 removes the device');
  const subFlaky = makeSubscription('device-flaky');
  await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { cookie: await cookieHeader(seller), 'content-type': 'application/json' }, body: JSON.stringify(subFlaky.json) });
  pushSvc.statusFor['/push/device-flaky'] = 503;
  const gone2 = makeSubscription('device-gone-2');
  await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { cookie: await cookieHeader(seller), 'content-type': 'application/json' }, body: JSON.stringify(gone2.json) });
  pushSvc.statusFor['/push/device-gone-2'] = 404;
  const failBefore = db.prepare('SELECT count(*) c FROM push_failures').get().c;
  const pbCtx = await ctx(); await buy(await pbCtx.newPage(), 'Hardening Buyer'); await pbCtx.close();
  await new Promise((r) => setTimeout(r, 500));
  const fails = db.prepare('SELECT * FROM push_failures WHERE id > ? ORDER BY id').all(failBefore);
  const f503 = fails.find((f) => f.status_code === 503), f404 = fails.find((f) => f.status_code === 404);
  ok(!!f503 && f503.removed === 0 && f503.seller_id === spice.id && f503.endpoint_host === '127.0.0.1:4013', 'a 503 from the push service is logged with seller, host and code');
  ok(!!db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subFlaky.json.endpoint), '…and the device is kept (temporary failure)');
  ok(!!f404 && f404.removed === 1 && !db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(gone2.json.endpoint), 'a 404 is logged as removed and the subscription is deleted');
  ok(db.prepare("SELECT count(*) c FROM push_failures WHERE status_code = 410 AND removed = 1").get().c >= 1, 'the earlier 410 was logged as removed too');
  pushSvc.statusFor['/push/device-flaky'] = 201;

  step('P10. Push text follows the language the device subscribed in');
  const subAr = makeSubscription('device-ar');
  await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { cookie: (await cookieHeader(seller)) + '; paylo_lang=ar', 'content-type': 'application/json' }, body: JSON.stringify(subAr.json) });
  const arCtx = await ctx(); const arOrder = await buy(await arCtx.newPage(), 'Arabic Push Buyer'); await arCtx.close();
  await new Promise((r) => setTimeout(r, 500));
  const arHit = pushSvc.got.filter((g) => g.path === '/push/device-ar').pop();
  const arPayload = decryptPush(subAr, arHit.body);
  ok(arPayload.title === `طلب جديد ${arOrder.code}` && /ل\.س/.test(arPayload.body), 'an Arabic device gets an Arabic title and SYP amount');
  const enHit = pushSvc.got.filter((g) => g.path === '/push/device-a').pop();
  ok(decryptPush(subA, enHit.body).title === `New order ${arOrder.code}`, 'the English device still gets English for the same order');

  step('P4/P5/P8. Admin sees system health, worker heartbeat, delivery stats and dead-letter webhooks');
  db.prepare("INSERT INTO webhook_endpoints (id, seller_id, url, secret, events, active) VALUES ('ep-dead', ?, 'http://127.0.0.1:9/dead', 'x', '*', 1)").run(spice.id);
  db.prepare("INSERT INTO webhook_deliveries (endpoint_id, event, payload, status, error, attempts) VALUES ('ep-dead', 'order.created', '{}', 'dead', 'connect ECONNREFUSED', 6)").run();
  db.prepare("INSERT INTO webhook_deliveries (endpoint_id, event, payload, status, error, attempts, next_attempt_at) VALUES ('ep-dead', 'order.updated', '{}', 'failed', 'timeout', 2, datetime('now','-20 minutes'))").run();
  const adminCtx = await ctx(); const admin = await adminCtx.newPage();
  await login(admin, 'admin@paylo.sy', 'admin1234'); await admin.waitForURL('**/admin**');
  await admin.goto(BASE + '/admin/ops');
  const row = (name) => admin.locator(`[data-testid=ops-health] tr[data-check="${name}"]`);
  ok(await row('Webhook retry worker').getAttribute('data-level') === 'error' && await admin.getByText('never called in').count() === 1, 'before any worker call, the worker row is red ("never called in")');
  ok(/1 overdue/.test(await admin.locator('[data-testid=stat-wh-retrying]').innerText()), 'a retry due 20 minutes ago is flagged as overdue');
  ok(await row('WEBHOOK_RETRY_SECRET').getAttribute('data-level') === 'ok', 'WEBHOOK_RETRY_SECRET is reported set (value never shown)');
  ok(await admin.locator('[data-testid=ops-health]').getByText('dev-retry-secret').count() === 0, 'secret values never appear on the page');
  ok(await row('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY').getAttribute('data-level') === 'warn', 'unset VAPID keys are a warning (stored keys in use), not silently OK');
  ok(await row('APP_URL').getAttribute('data-level') !== 'ok', 'APP_URL on localhost is flagged');
  ok(await row('SMS_TRANSPORT (SMS_HTTP_URL / SMS_HTTP_TOKEN)').getAttribute('data-level') === 'ok', 'SMS gateway configured → OK');
  ok(await admin.locator('[data-testid=ops-dead-webhooks]').getByText('ECONNREFUSED').count() === 1, 'dead-letter webhooks are listed with their error');
  ok(Number((await admin.locator('[data-testid=stat-push-failed]').innerText()).match(/\d+/)[0]) >= 3 && await admin.locator('[data-testid=ops-push-failures]').getByText('HTTP 503').count() >= 1, 'push failures counted and listed');
  ok(Number((await admin.locator('[data-testid=stat-push-subs]').innerText()).match(/\d+/)[0]) === db.prepare('SELECT count(*) c FROM push_subscriptions').get().c, 'push device count matches the database');
  const bad = await fetch(BASE + '/api/internal/webhooks/retry', { method: 'POST', headers: { 'x-worker-secret': 'wrong' } });
  ok(bad.status === 401 && !db.prepare("SELECT value FROM settings WHERE key = 'webhook_worker_last_run'").get(), 'a wrong secret is refused and does not count as a heartbeat');
  const worker = require('child_process').spawn('node', ['scripts/webhook-worker.js'], { env: { ...process.env, APP_URL: BASE }, stdio: 'ignore' });
  for (let i = 0; i < 20 && !db.prepare("SELECT value FROM settings WHERE key = 'webhook_worker_last_run'").get(); i++) await new Promise((r) => setTimeout(r, 250));
  worker.kill();
  await admin.goto(BASE + '/admin/ops');
  ok(await row('Webhook retry worker').getAttribute('data-level') === 'ok', 'after the bundled worker ticks, the worker row turns green');
  ok(!/overdue/.test(await admin.locator('[data-testid=stat-wh-retrying]').innerText()), 'the worker processed the overdue retry');
  await admin.setViewportSize({ width: 390, height: 844 });
  ok(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'ops page has no horizontal overflow at 390px');
  await adminCtx.close();

  step('P9. A brand-new approved seller sees a first-sale checklist');
  const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (id, email, password_hash, role, name, totp_secret, totp_enabled) VALUES ('u-fresh', 'fresh@paylo.sy', ?, 'seller', 'Fresh Seller', ?, 1)")
    .run(bcrypt.hashSync('seller1234', 10), TOTP['fresh@paylo.sy']);
  db.prepare("INSERT INTO sellers (id, user_id, store_name, slug, phone, governorate, status) VALUES ('s-fresh', 'u-fresh', 'Fresh Shop', 'fresh-shop', '0933000111', 'Damascus', 'approved')").run();
  const fCtx = await ctx(); const newSeller = await fCtx.newPage();
  await login(newSeller, 'fresh@paylo.sy'); await newSeller.waitForURL('**/seller');
  const stepDone = async (k) => newSeller.locator(`[data-testid=onboarding] [data-step=${k}]`).getAttribute('data-done');
  ok(await newSeller.locator('[data-testid=onboarding]').count() === 1, 'checklist shown to a seller with no orders');
  ok(await stepDone('ob_2fa') === '1' && await stepDone('ob_kyc') === '0' && await stepDone('ob_product') === '0', '2FA done; identity and first product still to do');
  await newSeller.locator('[data-step=ob_product] a').click(); await newSeller.waitForURL('**/seller/products/new');
  ok(true, '"Start" on the product step opens the new-product form');
  db.prepare("INSERT INTO products (id, seller_id, title, price, stock, status) VALUES ('p-fresh', 's-fresh', 'First thing', 10000, 3, 'active')").run();
  await newSeller.goto(BASE + '/seller');
  ok(await stepDone('ob_product') === '1', 'adding a product ticks the step');
  await newSeller.context().addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]); await newSeller.reload();
  ok(await newSeller.locator('[data-testid=onboarding]').getByText('احصل على أول عملية بيع').count() === 1 && await newSeller.evaluate(() => document.documentElement.dir) === 'rtl', 'checklist in Arabic, RTL');
  db.prepare("UPDATE orders SET seller_id = 's-fresh' WHERE id = ?").run(arOrder.id);
  await newSeller.reload();
  ok(await newSeller.locator('[data-testid=onboarding]').count() === 0, 'checklist disappears after the first order');
  await fCtx.close();

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

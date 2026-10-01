/*
 * Payment-readiness and Shopier-detail phases (1–3).
 * Run against a freshly seeded DB: scripts/run-e2e.sh phase-tests
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');
const ONLY = (process.env.PHASES || '1,2,3,4,5').split(',');
let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

(async () => {
  const db = new Database(DB_PATH);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = (opts = {}) => browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const TOTP = { 'spice@paylo.sy': 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U', 'demo@paylo.sy': 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', 'newbie@paylo.sy': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'owner@paylo.sy': 'KRSXG5CTMVRXEZLUKN2XAZLSEBB2EWDN' };
  const login = async (p, email, pw = 'seller1234') => {
    await p.goto(BASE + '/login'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pw);
    await p.click('button[type=submit]');
    if (TOTP[email]) {
      await p.waitForURL('**/login/2fa');
      await p.fill('input[name=code]', execSync(`node scripts/totp.js ${TOTP[email]}`).toString().slice(0, 6));
      await p.click('button[type=submit]');
    }
  };
  const spice = db.prepare("SELECT * FROM sellers WHERE slug = 'spice-house'").get();
  const zaatar = db.prepare("SELECT * FROM products WHERE seller_id = ? AND title LIKE 'Za%'").get(spice.id);
  const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  const adminCtx = await ctx(); const admin = await adminCtx.newPage();
  await login(admin, 'admin@paylo.sy', 'admin1234'); await admin.waitForURL('**/admin**');
  const saveToggles = async (on) => {
    await admin.goto(BASE + '/admin/settings');
    await admin.locator('input[name=pay_bank_transfer_enabled]').setChecked(on.includes('bank_transfer'));
    await admin.getByRole('button', { name: 'Save' }).click();
    await admin.waitForSelector('.alert-success');
  };
  const fillBuyer = async (p, name = 'Phase Buyer') => {
    await p.goto(BASE + '/p/' + zaatar.id);
    await p.fill('input[name=buyer_name]', name); await p.fill('input[name=buyer_phone]', '0912000555');
    await p.fill('textarea[name=address]', 'Mezzeh, Damascus');
    await p.click('button:has-text("Continue")');
  };
  const methodsShown = (p) => p.locator('input[name=payment_method]').evaluateAll((els) => els.map((e) => e.value));

  if (ONLY.includes('1')) {
    step('1.1 Policy defaults: transfers only — COD off, bank transfer on, card off');
    ok(setting('pay_cod_enabled') === '0' && setting('pay_bank_transfer_enabled') === '1' && setting('pay_card_enabled') === '0', 'settings: COD off, bank transfer ON, card off');
    ok(!!setting('migr_cod_off_v1'), 'the one-time COD-off migration is recorded');
    ok(!setting('cod_enabled') && !setting('bank_transfer_enabled') && !setting('card_enabled'), 'old keys were migrated away (no duplicates)');
    const bCtx = await ctx(); const b = await bCtx.newPage();
    await fillBuyer(b);
    ok(JSON.stringify(await methodsShown(b)) === JSON.stringify(['bank_transfer']), 'checkout offers bank transfer only — COD absent, card hidden');
    ok(await b.locator('input[name=payment_method][value=bank_transfer]').isChecked(), 'bank transfer is preselected');
    ok(await b.getByText('Cash on delivery').count() === 0, 'no cash-on-delivery wording on the product page');

    step('1.1/2.5 COD posted anyway → refused server-side, no order created');
    const ordersBefore = db.prepare('SELECT count(*) c FROM orders').get().c;
    await b.locator('input[name=payment_method][value=bank_transfer]').evaluate((el) => { el.value = 'cod'; });
    await b.locator('button[type=submit]').click();
    await b.waitForSelector('text=That payment method is not available.');
    ok(db.prepare('SELECT count(*) c FROM orders').get().c === ordersBefore, 'a forged COD post is refused with a clear message; no order created');
    await fillBuyer(b);
    await b.locator('input[name=payment_method][value=bank_transfer]').evaluate((el) => { el.value = 'card'; });
    await b.locator('button[type=submit]').click();
    await b.waitForSelector('text=That payment method is not available.');
    ok(db.prepare('SELECT count(*) c FROM orders').get().c === ordersBefore, 'a forged card post is refused too');

    step('1.1 Admin: COD toggle visible but locked by policy; saving never re-enables it');
    await admin.goto(BASE + '/admin/settings');
    const codBox = admin.locator('input[name=pay_cod_enabled]');
    ok(await codBox.count() === 1 && await codBox.isDisabled() && !(await codBox.isChecked()), 'COD checkbox is shown, unchecked and disabled');
    ok(await admin.getByText('Disabled by policy').count() >= 1, 'labelled "disabled by policy"');
    await codBox.evaluate((el) => { el.disabled = false; el.checked = true; });
    await admin.getByRole('button', { name: 'Save' }).click();
    await admin.waitForSelector('.alert-success');
    ok(setting('pay_cod_enabled') === '0', 'even a forged form post does not switch COD back on');

    step('1.1 Bank transfer switched off → nothing to pay with; existing orders unaffected');
    const openBefore = db.prepare("SELECT count(*) c FROM orders WHERE payment_method = 'bank_transfer' AND status = 'awaiting_payment'").get().c;
    await saveToggles([]);
    await b.goto(BASE + '/p/' + zaatar.id);
    ok(await b.getByText('That payment method is not available.').count() === 1, 'checkout says no payment method is available');
    ok(db.prepare("SELECT count(*) c FROM orders WHERE payment_method = 'bank_transfer' AND status = 'awaiting_payment'").get().c === openBefore, 'existing open bank-transfer orders are untouched by the toggle');
    await saveToggles(['bank_transfer']);

    step('1.1 Card needs the env flag and a configured provider, not just the admin toggle');
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'pay_card_enabled'").run();
    await fillBuyer(b);
    ok(!(await methodsShown(b)).includes('card'), 'admin toggle alone does not show card (PAYMENT_CARD_ENABLED is not set)');

    step('1.4 Admin sees the live state without secrets');
    await admin.goto(BASE + '/admin/settings');
    const row = (m) => admin.locator(`[data-testid=payment-status] tr[data-method=${m}]`);
    ok(await row('cod').getAttribute('data-live') === '0' && await row('bank_transfer').getAttribute('data-live') === '1' && await row('card').getAttribute('data-live') === '0', 'status panel: COD off, bank transfer on, card off');
    ok(/PAYMENT_CARD_ENABLED=1/.test(await row('card').innerText()), 'card row says exactly what is missing');
    await admin.goto(BASE + '/admin/ops');
    ok(await admin.locator('[data-testid=ops-health] tr[data-check="Payment: card"]').getAttribute('data-level') === 'error', 'System health flags card turned on but blocked');
    ok(await admin.locator('[data-testid=ops-health] tr[data-check="Payment: bank_transfer"]').getAttribute('data-level') === 'ok', 'System health shows bank transfer on');
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'pay_card_enabled'").run();

    step('1.2 Bank transfer: the proof flow works end to end');
    await fillBuyer(b, 'Transfer Buyer');
    ok(await b.getByText('Our bank details').isVisible(), 'bank details shown again');
    await b.locator('button[type=submit]').click();
    await b.waitForURL('**/track/**');
    const code = decodeURIComponent(new URL(b.url()).pathname.split('/').pop());
    const tOrder = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
    ok(tOrder.payment_method === 'bank_transfer' && tOrder.status === 'awaiting_payment', 'bank-transfer order placed and awaiting payment');
    await b.fill('input[name=reference]', 'TRX-PHASE-1');
    await b.setInputFiles('input[name=proof]', { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a8f70000000049454e44ae426082', 'hex') });
    await b.locator('form:has(input[name=proof]) button[type=submit]').click();
    await b.waitForLoadState('networkidle');
    ok(db.prepare("SELECT status FROM bank_transfers WHERE order_id = ?").get(tOrder.id).status === 'submitted', 'buyer uploads the receipt');
    // Turning bank transfer off now must not strand this buyer.
    await saveToggles([]);
    await admin.goto(BASE + '/admin/orders/' + tOrder.id);
    await admin.getByRole('button', { name: 'Confirm payment' }).click();
    await admin.waitForSelector('span.badge:has-text("Ready to fulfil")');
    ok(db.prepare('SELECT status FROM orders WHERE id = ?').get(tOrder.id).status === 'confirmed', 'admin confirms the transfer even after the method was switched off (existing orders unaffected)');
    await saveToggles(['bank_transfer']);
    await bCtx.close();

    step('1.3 check:env guards card payments');
    const envRun = (extra) => { try { execSync('node scripts/check-env.js', { env: { PATH: process.env.PATH, SESSION_SECRET: 'x'.repeat(40), APP_URL: 'https://paylo.example', WEBHOOK_RETRY_SECRET: 'y', OWNER_EMAIL: 'o@x.sy', ...extra }, cwd: process.cwd(), stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
    ok(envRun({}) === 0, 'check:env passes with the required production variables');
    ok(envRun({ PAYMENT_CARD_ENABLED: '1' }) === 1, 'check:env fails when card is enabled on the mock provider');
    ok(envRun({ PAYMENT_CARD_ENABLED: '1', PAYMENT_PROVIDER: 'qnb' }) === 1, 'check:env fails when card is enabled on the unconfigured qnb placeholder');
  }

  if (ONLY.includes('2')) {
    const sCtx = await ctx(); const seller = await sCtx.newPage();
    await login(seller, 'spice@paylo.sy'); await seller.waitForURL('**/seller');
    const cookie = (await sCtx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');

    step('2.1 Seller message language is an explicit setting (default Arabic)');
    ok(db.prepare('SELECT preferred_lang FROM sellers WHERE id = ?').get(spice.id).preferred_lang === 'ar', 'preferred_lang column exists and defaults to Arabic');
    await seller.goto(BASE + '/seller/settings');
    ok(await seller.locator('[data-testid=preferred-lang]').inputValue() === 'ar', 'settings show the current choice');

    step('2.2 Payouts page before any payout run: empty state');
    await seller.goto(BASE + '/seller/payouts');
    ok(await seller.getByText('No payouts yet.').count() === 1 && await seller.locator('[data-testid=payouts-table]').count() === 0, 'EmptyState explains when payouts start');

    step('2.2 Earnings: full breakdown, and the CSV has exactly the page columns');
    await seller.goto(BASE + '/seller/earnings');
    const pageCols = await seller.locator('[data-testid=earnings-table] thead th').evaluateAll((ths) => ths.map((th) => th.getAttribute('data-col')));
    const csv = await (await fetch(BASE + '/seller/earnings/export', { headers: { cookie } })).text();
    const csvCols = csv.split('\r\n')[0].split(',');
    ok(JSON.stringify(pageCols) === JSON.stringify(csvCols), `page and CSV share the same ${csvCols.length} columns in the same order`);
    for (const c of ['paid', 'commission', 'commission_vat', 'net', 'delivery_fee_platform_held', 'order', 'date', 'order_state']) ok(csvCols.includes(c), `column present: ${c}`);
    const csvRows = csv.split('\r\n').filter(Boolean).slice(1).map((l) => l.match(/"((?:[^"]|"")*)"/g).map((x) => x.slice(1, -1).replace(/""/g, '"')));
    ok(csvRows.length === await seller.locator('[data-testid=earnings-table] tbody tr').count(), 'CSV has one line per page row');
    const idx = (k) => csvCols.indexOf(k);
    const recon = csvRows.every((r) => r[idx('payout_status')] === 'refunded' || Number(r[idx('paid')]) - Number(r[idx('commission')]) - Number(r[idx('commission_vat')]) - Number(r[idx('refund_borne_by_seller')]) === Number(r[idx('net')]));
    ok(recon, 'every line reconciles: goods paid − commission − VAT − refunds you bore = net');
    const o1 = db.prepare("SELECT * FROM orders WHERE seller_id = ? AND delivery_fee > 0 AND status NOT IN ('cancelled','payment_failed') LIMIT 1").get(spice.id);
    const line = csvRows.find((r) => r[idx('order')] === o1.code);
    ok(Number(line[idx('delivery_fee_platform_held')]) === o1.delivery_fee && Number(line[idx('net')]) === o1.seller_net, 'delivery fee is its own column and never inside the net');
    ok((await seller.locator('[data-testid=earnings-delivery]').innerText()).includes('Never commissioned'), 'page calls the delivery fee out as platform-held, not commissioned');

    step('2.2 After a payout run: per-period breakdown adds up to the amount paid');
    const aCtx2 = await ctx(); const adm = await aCtx2.newPage();
    await login(adm, 'admin@paylo.sy', 'admin1234'); await adm.waitForURL('**/admin**');
    await adm.goto(BASE + '/admin/payouts');
    await adm.getByRole('button', { name: /Generate this week/ }).click();
    await adm.waitForLoadState('networkidle');
    const payout = db.prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY created_at DESC LIMIT 1').get(spice.id);
    ok(!!payout, 'a payout run was created for the store');
    await seller.goto(BASE + '/seller/payouts');
    const prow = seller.locator(`[data-payout="${payout.id}"]`);
    const cells = await prow.locator('td').allInnerTexts();
    const num = (x) => Number((x || '').replace(/[^\d]/g, '')) || 0;
    ok(num(cells[2]) - num(cells[3]) - num(cells[4]) - num(cells[5]) === payout.amount && num(cells[6]) === payout.amount, `gross − commission − VAT − refunds = ${payout.amount} (the amount paid)`);
    ok(num(cells[7]) === db.prepare('SELECT sum(delivery_fee) s FROM orders WHERE payout_id = ?').get(payout.id).s, 'delivery fees held for the period are shown separately');
    await aCtx2.close();

    step('2.4 First-run checklist for a new store');
    const bcrypt = require('bcryptjs');
    db.prepare("INSERT INTO users (id, email, password_hash, role, name, totp_secret, totp_enabled) VALUES ('u-newbie', 'newbie@paylo.sy', ?, 'seller', 'New Seller', ?, 1)").run(bcrypt.hashSync('seller1234', 10), TOTP['newbie@paylo.sy']);
    db.prepare("INSERT INTO sellers (id, user_id, store_name, slug, phone, governorate, status) VALUES ('s-newbie', 'u-newbie', 'Newbie Shop', 'newbie-shop', '0933000222', 'Damascus', 'approved')").run();
    const nCtx = await ctx({ permissions: ['clipboard-read', 'clipboard-write'] }); const nb = await nCtx.newPage();
    await login(nb, 'newbie@paylo.sy'); await nb.waitForURL('**/seller');
    const stepState = (k) => nb.locator(`[data-testid=onboarding] [data-step=${k}]`).getAttribute('data-done');
    ok(await nb.locator('[data-testid=onboarding] [data-step]').evaluateAll((els) => els.map((e) => e.getAttribute('data-step')).join()) === 'ob_product,ob_copy_link,ob_notifications,ob_kyc', 'steps: first product, copy store link, enable alerts, verify identity');
    await nb.locator('[data-step=ob_copy_link] button').click();
    await nb.waitForFunction(() => document.querySelector('[data-step=ob_copy_link]')?.getAttribute('data-done') === '1');
    for (let i = 0; i < 20 && !db.prepare("SELECT onboarding_link_copied c FROM sellers WHERE id = 's-newbie'").get().c; i++) await new Promise((r) => setTimeout(r, 150));
    await nb.reload();
    ok(await stepState('ob_copy_link') === '1', 'copying the store link ticks that step, and it stays ticked after reload');
    await nb.locator('[data-step=ob_product] a').click(); await nb.waitForURL('**/seller/products/new');
    db.prepare("INSERT INTO products (id, seller_id, title, price, stock, status) VALUES ('p-newbie', 's-newbie', 'First thing', 10000, 3, 'active')").run();
    await nb.goto(BASE + '/seller');
    ok(await stepState('ob_product') === '1', 'adding the first product ticks that step');
    await nb.locator('[data-testid=onboarding-dismiss]').click();
    await nb.waitForFunction(() => !document.querySelector('[data-testid=onboarding]'));
    await nb.reload();
    ok(await nb.locator('[data-testid=onboarding]').count() === 0, 'Hide dismisses it for good');
    await nCtx.close();

    step('2.6 Store settings are one coherent area');
    await seller.goto(BASE + '/seller/settings');
    ok(await seller.locator('[data-testid=store-settings-form] fieldset[data-group]').evaluateAll((f) => f.map((x) => x.dataset.group).join()) === 'store-details,storefront,after-purchase,payout', 'grouped: store details, storefront (logo, banner, announcement, About), after purchase, payouts');
    ok(await seller.locator('#storefront input[name=announcement]').count() === 1 && await seller.locator('#storefront input[name=logo]').count() === 1 && await seller.locator('#after-purchase textarea[name=thank_you_message]').count() === 1, 'each field sits in its group; one Save for all');

    step('2.2/2.6 Phone width, Arabic');
    await sCtx.addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]);
    await seller.setViewportSize({ width: 390, height: 844 });
    for (const pth of ['/seller/earnings', '/seller/payouts', '/seller/settings', '/seller']) {
      await seller.goto(BASE + pth);
      ok(await seller.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.scrollWidth <= window.innerWidth + 1), `${pth}: RTL, no horizontal page overflow at 390px`);
    }
    await sCtx.close();
  }

  if (ONLY.includes('3')) {
    step('3.1 Ops queue: delivered COD orders whose cash is not recorded, with one-click confirm');
    // Delivery currently auto-records COD cash (see addendum §8a), so this state is set up
    // directly: a delivered COD order whose cash Paylo has not recorded.
    const cod = db.prepare("SELECT * FROM orders WHERE payment_method = 'cod' AND status = 'delivered' LIMIT 1").get();
    db.prepare("UPDATE orders SET payment_status = 'pending' WHERE id = ?").run(cod.id);
    await admin.goto(BASE + '/admin/ops');
    const q = admin.locator('[data-testid=ops-cod-queue]');
    ok(await q.locator(`tr[data-code="${cod.code}"]`).count() === 1, 'the order is listed in the COD queue');
    await q.locator(`tr[data-code="${cod.code}"] input[name=note]`).fill('Rider handover #7');
    await q.locator(`tr[data-code="${cod.code}"]`).getByRole('button', { name: 'Confirm' }).click();
    await admin.waitForFunction((c) => !document.querySelector(`[data-testid=ops-cod-queue] tr[data-code="${c}"]`), cod.code);
    ok(db.prepare('SELECT payment_status FROM orders WHERE id = ?').get(cod.id).payment_status === 'collected_cod', 'one click records the cash (same markCodCollected action as the order page)');
    ok(!!db.prepare("SELECT 1 FROM audit_log WHERE entity_id = ? AND action = 'cod.collected'").get(cod.id), 'the confirmation is in the audit log');
    ok(await admin.locator(`[data-testid=ops-cod-queue] tr[data-code="${cod.code}"]`).count() === 0, 'and the order leaves the queue');

    step('3.x System health still accurate after all phases');
    const levels = await admin.locator('[data-testid=ops-health] tr').evaluateAll((trs) => Object.fromEntries(trs.map((tr) => [tr.dataset.check, tr.dataset.level])));
    ok(levels['Payment: cod'] === 'warn' && levels['Payment: bank_transfer'] === 'ok' && levels['Payment: card'] === 'warn', 'payment rows: bank transfer on; COD and card off (not errors)');
    ok(levels['WEBHOOK_RETRY_SECRET'] === 'ok' && levels['SESSION_SECRET'] !== undefined, 'the earlier config checks are all still listed');
  }

  if (ONLY.includes('4')) {
    const fs = require('fs'), os = require('os'), { spawn } = require('child_process');

    step('T1. Transfers only: a pre-policy database is migrated, COD switched off on first start');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paylo-mig-'));
    const oldDb = path.join(tmpDir, 'old.db');
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(DB_PATH, oldDb);
    const od = new Database(oldDb);
    od.prepare("UPDATE settings SET value = '1' WHERE key = 'pay_cod_enabled'").run();
    od.prepare("DELETE FROM settings WHERE key = 'migr_cod_off_v1'").run();
    od.close();
    const srv = spawn('npx', ['next', 'start', '-p', '3057'], { env: { ...process.env, DATABASE_PATH: oldDb }, stdio: 'ignore', detached: true });
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch('http://localhost:3057/s/spice-house').then((r) => r.ok).catch(() => false); }
    const od2 = new Database(oldDb, { readonly: true });
    ok(up && od2.prepare("SELECT value FROM settings WHERE key = 'pay_cod_enabled'").get().value === '0' && !!od2.prepare("SELECT 1 FROM settings WHERE key = 'migr_cod_off_v1'").get(), 'COD is switched off by the migration (not a manual step) and the migration is recorded');
    ok(od2.prepare("SELECT count(*) c FROM orders WHERE payment_method = 'cod'").get().c > 0, 'old COD orders and their history are untouched');
    od2.close();
    try { process.kill(-srv.pid); } catch {}

    step('T2. One account per email and per phone — enforced by the database itself');
    const dbErr = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
    const custPhone = db.prepare("SELECT phone FROM users WHERE email = 'customer@paylo.sy'").get().phone;
    ok(custPhone === '+963955111222', `existing account phones are stored canonical (${custPhone})`);
    ok(/UNIQUE|email/.test(dbErr(() => db.prepare("INSERT INTO users (id, email, password_hash, role, name) VALUES ('dup1', 'CUSTOMER@paylo.sy', 'x', 'customer', 'Dup')").run()) || ''), 'raw INSERT of a duplicate email (different case) fails in SQLite');
    ok(/UNIQUE|phone/.test(dbErr(() => db.prepare("INSERT INTO users (id, email, password_hash, role, name, phone) VALUES ('dup2', 'dup2@x.sy', 'x', 'customer', 'Dup', ?)").run(custPhone)) || ''), 'raw INSERT of a duplicate phone fails in SQLite');
    ok(/email_taken/.test(dbErr(() => db.prepare(`INSERT INTO store_registration_requests (id, full_name, phone, email, national_id, store_name, slug, governorate, password_hash)
      VALUES ('dupR', 'Dup Person', '+963999000111', 'customer@paylo.sy', '12345678901', 'Dup', 'dup-r', 'Damascus', 'x')`).run()) || ''), 'an application may not reuse an account email (trigger: email_taken)');
    ok(/phone_taken/.test(dbErr(() => db.prepare(`INSERT INTO store_registration_requests (id, full_name, phone, email, national_id, store_name, slug, governorate, password_hash)
      VALUES ('dupR2', 'Dup Person', ?, 'fresh-x@x.sy', '12345678902', 'Dup', 'dup-r2', 'Damascus', 'x')`).run(custPhone)) || ''), 'an application may not reuse an account phone (trigger: phone_taken)');
    const pendingReg = db.prepare("SELECT email, phone FROM store_registration_requests WHERE status = 'PENDING_REVIEW' LIMIT 1").get();
    ok(/email_taken/.test(dbErr(() => db.prepare("INSERT INTO users (id, email, password_hash, role, name) VALUES ('dup3', ?, 'x', 'customer', 'Dup')").run(pendingReg.email)) || ''), 'an account may not take the email of a pending application');
    { // Guest checkout with an account's phone and email: allowed (uniqueness is for accounts only).
      const gCtx = await ctx(); const gp = await gCtx.newPage();
      await gp.goto(BASE + '/p/' + zaatar.id);
      await gp.fill('input[name=buyer_name]', 'Guest Twin'); await gp.fill('input[name=buyer_phone]', '0955111222'); await gp.fill('input[name=buyer_email]', 'customer@paylo.sy');
      await gp.fill('textarea[name=address]', 'Mezzeh, Damascus'); await gp.click('button:has-text("Continue")');
      await gp.locator('button[type=submit]').click();
      ok(await gp.waitForURL('**/track/**', { timeout: 15000 }).then(() => true).catch(() => false), 'guest orders are exempt: an account\'s phone and email can be reused freely at checkout');
      await gCtx.close();
    }

    const reg = async (data) => {
      const c = await ctx(); const p = await c.newPage();
      await p.goto(BASE + '/apply');
      await p.fill('input[name=name]', data.name ?? 'Samir Haddad'); await p.fill('input[name=email]', data.email);
      await p.fill('input[name=phone]', data.phone); await p.fill('input[name=national_id]', data.nid);
      await p.fill('input[name=password]', 'password123'); await p.fill('input[name=store_name]', 'Store ' + data.email); await p.fill('input[name=slug]', 'st-' + data.email.split('@')[0]);
      await p.click('button[type=submit]');
      const res = await Promise.race([p.waitForURL('**/apply/confirmation', { timeout: 15000 }).then(() => 'ok'), p.waitForSelector('.alert-error', { timeout: 15000 }).then(async () => (await p.locator('.alert-error').innerText()).trim())]);
      await c.close(); return res;
    };
    ok(/already uses this email/.test(await reg({ email: 'Customer@Paylo.sy', phone: '0911000101', nid: '11111111101' })), 'application with an account email → email_taken message');
    ok(/already uses this phone/.test(await reg({ email: 'p1@x.sy', phone: '+963 955 111 222', nid: '11111111102' })), 'application with an account phone in another format → phone_taken message');
    ok(/Syrian mobile/.test(await reg({ email: 'p2@x.sy', phone: '021 1234567', nid: '11111111103' })), 'a landline / non-Syrian-mobile number is refused with a clear message');

    step('T3. National ID: format, Arabic digits, placeholders, duplicates, rate limit');
    ok(/exactly 11 digits/.test(await reg({ email: 'n1@x.sy', phone: '0911000201', nid: '1234567890' })), '10 digits → rejected (national_id_invalid)');
    ok(/exactly 11 digits/.test(await reg({ email: 'n2@x.sy', phone: '0911000202', nid: '1234567890A' })), 'letters → rejected');
    ok(await reg({ email: 'n3@x.sy', phone: '0911000203', nid: '١٢٣٤٥٦٧٨٩٠١' }) === 'ok', 'Arabic-Indic digits are accepted…');
    ok(db.prepare("SELECT national_id FROM store_registration_requests WHERE email = 'n3@x.sy'").get().national_id === '12345678901', '…and stored as ASCII digits');
    ok(/already associated/.test(await reg({ email: 'n4@x.sy', phone: '0911000204', nid: '12345678901' })), 'same national number as an active application → generic duplicate message (never confirms the ID)');
    for (const nm of ['test', 'asdf', 'x', '12345', 'Test User']) ok(/full name/.test(await reg({ name: nm, email: `nm${nm.length}${nm[0]}@x.sy`, phone: '0911000' + (300 + nm.length), nid: '1999999' + String(1000 + nm.length) })), `placeholder name "${nm}" rejected`);
    const rp = '0911000999';
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await reg({ email: `rl${i}@x.sy`, phone: rp, nid: '12' }));
    ok(/Too many applications/.test(results[5]) && !results.slice(0, 5).some((r) => /Too many/.test(r)), 'the 6th attempt from one phone in a day is rate-limited');
    ok(db.prepare('SELECT count(*) c FROM registration_attempts WHERE phone = ?').get('+963911000999').c === 6, 'attempts are counted per normalised phone');

    step('T4. Analytics: order_placed snapshot, funnel events, privacy, never breaks checkout');
    const evBefore = db.prepare('SELECT max(id) m FROM analytics_events').get().m || 0;
    const aCtx = await ctx(); const ab = await aCtx.newPage();
    await ab.goto(BASE + '/p/' + zaatar.id);
    await ab.fill('input[name=buyer_name]', 'Event Buyer'); await ab.fill('input[name=buyer_phone]', '0912000777');
    await ab.fill('input[name=buyer_email]', 'event-buyer@example.com');
    await ab.fill('textarea[name=address]', 'Secret Street 42, Mezzeh, Damascus');
    await ab.click('button:has-text("Continue")');
    await ab.locator('button[type=submit]').click();
    await ab.waitForURL('**/track/**');
    const evOrder = db.prepare('SELECT * FROM orders WHERE code = ?').get(decodeURIComponent(new URL(ab.url()).pathname.split('/').pop()));
    await new Promise((r) => setTimeout(r, 400));
    const evs = db.prepare('SELECT * FROM analytics_events WHERE id > ? ORDER BY id').all(evBefore);
    const names = evs.map((e) => e.name);
    ok(['product_view', 'checkout_start', 'checkout_submit', 'order_placed'].every((n) => names.includes(n)), `funnel events recorded: ${[...new Set(names)].join(', ')}`);
    const placed = evs.find((e) => e.name === 'order_placed');
    const pp = JSON.parse(placed.props);
    ok(placed.order_id === evOrder.id && placed.seller_id === spice.id && placed.product_id === zaatar.id, 'order_placed is linked to the order, seller and product');
    ok(['unit_price', 'qty', 'subtotal', 'delivery_fee', 'discount', 'total', 'method', 'governorate', 'hour_of_day', 'price_at_event'].every((k) => k in pp) && pp.total === evOrder.total && pp.method === 'bank_transfer' && pp.price_at_event === evOrder.unit_price, 'full commercial snapshot with price_at_event');
    const blob = JSON.stringify(evs);
    ok(!blob.includes('Secret Street') && !blob.includes('event-buyer@example.com') && !blob.includes('0912000777') && !blob.includes('Event Buyer'), 'no address, email, phone or buyer name in any event');
    ok(evs.every((e) => !e.ip_hash || /^[0-9a-f]{32}$/.test(e.ip_hash)) && placed.session_id && placed.session_id === evs.find((e) => e.name === 'product_view').session_id, 'IPs hashed; browser and server events share the session id');
    ok((await fetch(BASE + '/api/analytics/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'order_placed', props: { total: 1 } }) })).status === 400, 'the browser cannot send money events (order_placed refused by /collect)');
    ok((await fetch(BASE + '/api/analytics/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'product_view', product_id: zaatar.id, props: { national_id: '12345678901', note: '12345678901' } }) })).status === 200
      && !db.prepare("SELECT props FROM analytics_events ORDER BY id DESC LIMIT 1").get().props.includes('12345678901'), 'a national ID slipped into props is stripped');
    // Break the event table: checkout must still work.
    db.exec('ALTER TABLE analytics_events RENAME TO analytics_events_off');
    await ab.goto(BASE + '/p/' + zaatar.id);
    await ab.fill('input[name=buyer_name]', 'No Analytics Buyer'); await ab.fill('input[name=buyer_phone]', '0912000778');
    await ab.fill('textarea[name=address]', 'Mezzeh, Damascus'); await ab.click('button:has-text("Continue")');
    await ab.locator('button[type=submit]').click();
    await ab.waitForURL('**/track/**', { timeout: 15000 });
    db.exec('ALTER TABLE analytics_events_off RENAME TO analytics_events');
    ok(!!db.prepare("SELECT 1 FROM orders WHERE buyer_name = 'No Analytics Buyer'").get(), 'with the analytics table broken, checkout still completes (track() never throws)');
    await aCtx.close();
    const editPrice = zaatar.price + 500;
    const sCtx = await ctx(); const sp = await sCtx.newPage();
    await login(sp, 'spice@paylo.sy'); await sp.waitForURL('**/seller');
    await sp.goto(BASE + '/seller/products/' + zaatar.id);
    await sp.fill('input[name=price]', String(editPrice));
    await sp.getByRole('button', { name: /Save/ }).first().click();
    await sp.waitForURL('**saved=1**');
    const ph = db.prepare('SELECT * FROM product_price_history WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(zaatar.id);
    const upd = db.prepare("SELECT props FROM analytics_events WHERE name = 'seller_product_update' AND product_id = ? ORDER BY id DESC LIMIT 1").get(zaatar.id);
    ok(ph && ph.old_price === zaatar.price && ph.new_price === editPrice && JSON.parse(upd.props).price_at_event === editPrice, 'a price edit lands in product_price_history and the update event carries price_at_event');
    await sCtx.close();

    step('T5. Owner analytics: aggregates, funnel, CSV exports, owner-only');
    const oCtx = await ctx(); const ow = await oCtx.newPage();
    await login(ow, 'owner@paylo.sy', 'owner-change-me-1234'); await ow.waitForURL('**/owner');
    await ow.goto(BASE + '/owner/analytics');
    const computeBtn = ow.getByRole('button', { name: /Compute now|Refresh now/ });
    await computeBtn.click(); await ow.waitForSelector('[data-testid=oa-funnel]');
    ok(Number(await ow.locator('[data-testid=funnel-orders]').innerText()) >= 1 && Number(await ow.locator('[data-testid=funnel-views]').innerText()) >= 1, 'funnel shows sessions that viewed and ordered');
    ok(await ow.locator('[data-testid=oa-daily]').count() === 1 && await ow.locator('[data-testid=top-revenue] tbody tr').count() >= 1 && await ow.locator('[data-testid=oa-prices] tbody tr').count() >= 1, 'GMV by day, top products by revenue and price distribution render');
    ok(await ow.locator('[data-testid=oa-hours] [data-label]').count() === 24 && await ow.locator('[data-testid=oa-weekdays] [data-label]').count() === 7, 'orders by hour (24) and weekday (7)');
    const oCookie = (await oCtx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const daily = await (await fetch(BASE + '/owner/analytics/export?kind=daily&days=90', { headers: { cookie: oCookie } })).text();
    ok(daily.startsWith('day,gmv,orders,aov') && daily.trim().split('\r\n').length === 91, 'daily CSV: header + 90 days');
    const raw = await (await fetch(BASE + '/owner/analytics/export?kind=events&days=7', { headers: { cookie: oCookie } })).text();
    ok(raw.startsWith('id,at,name,session_id') && raw.includes('order_placed') && !raw.includes('Secret Street') && !raw.includes('12345678901'), 'raw events CSV downloads, with no address or national ID');
    const adminCookie = (await adminCtx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    ok((await fetch(BASE + '/owner/analytics/export?kind=events', { headers: { cookie: adminCookie } })).status === 404, 'an admin (not owner) gets 404 on the export');

    step('T6. Owner and admin dashboards: live counts, transfer queue first, search, no dead links');
    await ow.goto(BASE + '/owner');
    const tile = async (p, id) => p.locator(`[data-testid=${id}]`).getAttribute('data-value');
    ok(Number(await tile(ow, 'q-registrations')) === db.prepare("SELECT count(*) c FROM store_registration_requests WHERE status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED')").get().c, 'owner: pending-registration count matches the database');
    ok(Number(await tile(ow, 'q-transfers')) === db.prepare("SELECT count(*) c FROM bank_transfers b JOIN orders o ON o.id = b.order_id WHERE b.status = 'submitted' AND o.status = 'awaiting_payment'").get().c, 'owner: transfers-to-confirm count matches');
    ok(await ow.locator('[data-testid=ow-latest-regs] tbody tr').count() >= 1, 'owner: latest pending registrations listed with review links');
    for (const href of ['/owner', '/owner/registrations', '/owner/analytics']) { const r = await ow.goto(BASE + href); ok(r.status() === 200, `owner link ${href} → 200`); }
    await ow.context().addCookies([{ name: 'paylo_lang', value: 'ar', url: BASE }]);
    await ow.goto(BASE + '/owner');
    ok(await ow.getByText('نظرة المالك').count() === 1, 'owner console renders in Arabic');
    await oCtx.close();

    // A transfer with a receipt, waiting for the admin.
    const tCtx = await ctx(); const tb = await tCtx.newPage();
    await tb.goto(BASE + '/p/' + zaatar.id);
    await tb.fill('input[name=buyer_name]', 'Queue Buyer'); await tb.fill('input[name=buyer_phone]', '0912000779'); await tb.fill('input[name=buyer_email]', 'queue.buyer@example.com');
    await tb.fill('textarea[name=address]', 'Mezzeh, Damascus'); await tb.click('button:has-text("Continue")');
    await tb.locator('button[type=submit]').click(); await tb.waitForURL('**/track/**');
    const qCode = decodeURIComponent(new URL(tb.url()).pathname.split('/').pop());
    await tb.fill('input[name=reference]', 'TRX-QUEUE');
    await tb.locator('form:has(input[name=reference]) button[type=submit]').click();
    await tb.waitForLoadState('networkidle'); await tCtx.close();
    await admin.goto(BASE + '/admin');
    const queue = admin.locator('[data-testid=transfer-queue]');
    ok(await admin.evaluate(() => {
      const q = document.querySelector('[data-testid=transfer-queue]'), tiles = document.querySelector('[data-testid=admin-queues]');
      return !!q && !!tiles && !!(q.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), 'admin home: the bank-transfer queue comes before every other queue');
    ok(await queue.locator(`tr[data-code="${qCode}"]`).count() === 1, 'the new receipt is in the queue');
    await queue.locator(`tr[data-code="${qCode}"] form`).first().getByRole('button', { name: 'Confirm payment' }).click();
    await admin.waitForFunction((c) => !document.querySelector(`[data-testid=transfer-queue] tr[data-code="${c}"]`), qCode);
    ok(db.prepare('SELECT status FROM orders WHERE code = ?').get(qCode).status === 'confirmed', 'confirmed inline from the dashboard (same reviewTransfer path)');
    for (const [term, label] of [[qCode, 'code'], ['queue.buyer@example.com', 'email'], ['+963 912 000 779', 'phone typed in another format']]) {
      await admin.goto(BASE + '/admin/orders?q=' + encodeURIComponent(term));
      ok(await admin.getByText(qCode).count() >= 1, `order search finds it by ${label}`);
    }
    await admin.goto(BASE + '/admin/audit?type=sensitive');
    ok(await admin.locator('tbody tr').count() >= 1 && (await admin.locator('tbody').innerText()).includes('payment.confirmed'), 'audit log: "sensitive actions" filter shows the confirmation');
    await admin.goto(BASE + '/admin/sellers?status=approved');
    ok(await admin.locator('tbody tr').count() === db.prepare("SELECT count(*) c FROM sellers WHERE status = 'approved'").get().c, 'seller list filters by status');
    const navLinks = await admin.locator('header nav').first().locator('a').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    for (const href of navLinks) { const r = await admin.goto(BASE + href); ok(r.status() === 200 && await admin.getByText('Page not found').count() === 0, `admin link ${href} → 200`); }
    for (const id of ['a-kyc', 'a-disputes', 'a-payouts', 'a-failed-msgs', 'a-pending-sellers']) {
      await admin.goto(BASE + '/admin');
      const href = await admin.locator(`[data-testid=${id}]`).getAttribute('href');
      const r = await admin.goto(BASE + href); ok(r.status() === 200, `dashboard tile ${id} → ${href} → 200`);
    }
  }

  if (ONLY.includes('5')) {
    step('D1. Forest & Cream design system: homepage at 390px, both languages');
    for (const lang of ['en', 'ar']) {
      const c = await ctx({ viewport: { width: 390, height: 844 }, isMobile: true });
      await c.addCookies([{ name: 'paylo_lang', value: lang, url: BASE }]);
      const p = await c.newPage(); await p.goto(BASE + '/');
      const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        phone: !!document.querySelector('[data-testid=hero-showcase] .hs-phone'), glyphs: document.querySelectorAll('img[src^="/hero/"][src$=".svg"]').length,
        bg: getComputedStyle(document.body).backgroundColor, h1: getComputedStyle(document.querySelector('h1')).fontWeight }));
      ok(m.sw <= m.cw + 1, `${lang}: no horizontal overflow at 390px (content ${m.sw}px, viewport ${m.cw}px)`);
      ok(m.phone && m.glyphs === 0, `${lang}: hero shows the phone storefront, no illustrated glyph cards`);
      ok(m.bg === 'rgb(248, 244, 236)' && Number(m.h1) >= 800, `${lang}: cream background #F8F4EC and an extrabold headline`);
      await c.close();
    }
  }

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close(); db.close();
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

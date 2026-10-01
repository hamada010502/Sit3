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
const ONLY = (process.env.PHASES || '1,2,3').split(',');
let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

(async () => {
  const db = new Database(DB_PATH);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = (opts = {}) => browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const TOTP = { 'spice@paylo.sy': 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U', 'demo@paylo.sy': 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', 'newbie@paylo.sy': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
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

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close(); db.close();
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

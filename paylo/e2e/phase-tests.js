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
    for (const m of ['cod', 'bank_transfer']) await admin.locator(`input[name=pay_${m}_enabled]`).setChecked(on.includes(m));
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
    step('1.1 Defaults: COD and bank transfer on, card off');
    ok(setting('pay_cod_enabled') === '1' && setting('pay_bank_transfer_enabled') === '1' && setting('pay_card_enabled') === '0', 'settings default to COD on, bank transfer ON, card off');
    ok(!setting('cod_enabled') && !setting('bank_transfer_enabled') && !setting('card_enabled'), 'old keys were migrated away (no duplicates)');
    const bCtx = await ctx(); const b = await bCtx.newPage();
    await fillBuyer(b);
    ok(JSON.stringify(await methodsShown(b)) === JSON.stringify(['cod', 'bank_transfer']), 'checkout offers COD and bank transfer by default, no card');

    step('1.1/2.5 Only COD enabled → others hidden in the UI AND refused by the server');
    const openBefore = db.prepare("SELECT count(*) c FROM orders WHERE payment_method = 'bank_transfer' AND status = 'awaiting_payment'").get().c;
    await saveToggles(['cod']);
    ok(setting('pay_bank_transfer_enabled') === '0', 'admin saved bank transfer off');
    await fillBuyer(b);
    ok(JSON.stringify(await methodsShown(b)) === JSON.stringify(['cod']), 'checkout now lists only COD');
    // Post bank_transfer anyway: forge the radio's value before submitting.
    await b.locator('input[name=payment_method][value=cod]').evaluate((el) => { el.value = 'bank_transfer'; });
    const ordersBefore = db.prepare('SELECT count(*) c FROM orders').get().c;
    await b.locator('button[type=submit]').click();
    await b.waitForSelector('text=That payment method is not available.');
    ok(db.prepare('SELECT count(*) c FROM orders').get().c === ordersBefore, 'a forged bank-transfer post is refused server-side with a clear message; no order created');
    await fillBuyer(b);
    await b.locator('input[name=payment_method][value=cod]').evaluate((el) => { el.value = 'card'; });
    await b.locator('button[type=submit]').click();
    await b.waitForSelector('text=That payment method is not available.');
    ok(db.prepare('SELECT count(*) c FROM orders').get().c === ordersBefore, 'a forged card post is refused too');
    ok(db.prepare("SELECT count(*) c FROM orders WHERE payment_method = 'bank_transfer' AND status = 'awaiting_payment'").get().c === openBefore, 'existing open bank-transfer orders are untouched by the toggle');

    step('1.1 Card needs the env flag and a configured provider, not just the admin toggle');
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'pay_card_enabled'").run();
    await fillBuyer(b);
    ok(!(await methodsShown(b)).includes('card'), 'admin toggle alone does not show card (PAYMENT_CARD_ENABLED is not set)');

    step('1.4 Admin sees the live state without secrets');
    await admin.goto(BASE + '/admin/settings');
    const row = (m) => admin.locator(`[data-testid=payment-status] tr[data-method=${m}]`);
    ok(await row('cod').getAttribute('data-live') === '1' && await row('bank_transfer').getAttribute('data-live') === '0' && await row('card').getAttribute('data-live') === '0', 'status panel: COD on, bank transfer off, card off');
    ok(/PAYMENT_CARD_ENABLED=1/.test(await row('card').innerText()), 'card row says exactly what is missing');
    await admin.goto(BASE + '/admin/ops');
    ok(await admin.locator('[data-testid=ops-health] tr[data-check="Payment: card"]').getAttribute('data-level') === 'error', 'System health flags card turned on but blocked');
    ok(await admin.locator('[data-testid=ops-health] tr[data-check="Payment: cod"]').getAttribute('data-level') === 'ok', 'System health shows COD on');
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'pay_card_enabled'").run();

    step('1.2 Bank transfer back on → visible and the proof flow still works');
    await saveToggles(['cod', 'bank_transfer']);
    await fillBuyer(b, 'Transfer Buyer');
    await b.getByText('Bank transfer', { exact: true }).click();
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
    await saveToggles(['cod']);
    await admin.goto(BASE + '/admin/orders/' + tOrder.id);
    await admin.getByRole('button', { name: 'Confirm payment' }).click();
    await admin.waitForSelector('span.badge:has-text("Ready to fulfil")');
    ok(db.prepare('SELECT status FROM orders WHERE id = ?').get(tOrder.id).status === 'confirmed', 'admin confirms the transfer even after the method was switched off (existing orders unaffected)');
    await saveToggles(['cod', 'bank_transfer']);
    await bCtx.close();

    step('1.3 check:env guards card payments');
    const envRun = (extra) => { try { execSync('node scripts/check-env.js', { env: { PATH: process.env.PATH, SESSION_SECRET: 'x'.repeat(40), APP_URL: 'https://paylo.example', WEBHOOK_RETRY_SECRET: 'y', OWNER_EMAIL: 'o@x.sy', ...extra }, cwd: process.cwd(), stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
    ok(envRun({}) === 0, 'check:env passes with the required production variables');
    ok(envRun({ PAYMENT_CARD_ENABLED: '1' }) === 1, 'check:env fails when card is enabled on the mock provider');
    ok(envRun({ PAYMENT_CARD_ENABLED: '1', PAYMENT_PROVIDER: 'qnb' }) === 1, 'check:env fails when card is enabled on the unconfigured qnb placeholder');
  }

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close(); db.close();
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

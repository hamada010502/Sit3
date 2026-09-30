/*
 * Shopier-parity features. Each numbered section maps to one item in the parity plan.
 * Run against a freshly seeded DB: scripts/run-e2e.sh parity-tests
 */
const { chromium } = require('playwright');
const { createHmac } = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');
const LOGISTICS_SECRET = process.env.LOGISTICS_WEBHOOK_SECRET || 'dev-logistics-secret';

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

(async () => {
  const db = new Database(DB_PATH);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const newPage = async () => (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const login = async (p, email, pw) => {
    await p.goto(BASE + '/login');
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', pw);
    await p.click('button[type=submit]');
  };
  const spice = db.prepare("SELECT * FROM sellers WHERE slug = 'spice-house'").get();

  const seller = await newPage();
  await login(seller, 'spice@paylo.sy', 'seller1234');
  await seller.waitForURL('**/seller');
  const admin = await newPage();
  await login(admin, 'admin@paylo.sy', 'admin1234');
  await admin.waitForURL('**/admin');

  /* ---------------- 1. Next payout, prominent ---------------- */
  step('1. Next payout date is prominent on the seller dashboard');
  const card = seller.locator('[data-testid=next-payout]');
  ok(await card.count() === 1, 'dashboard has a dedicated next-payout card');
  const cardText = await card.innerText();
  ok(/Wednesday/.test(cardText), 'card names the transfer weekday (Wednesday)');
  ok(/Tuesday 18:00 UTC/.test(cardText), 'card states the Tuesday 18:00 UTC cutoff');
  ok(/(days|hours) left/.test(cardText), 'card shows time remaining to the cutoff');
  ok(/156,750/.test(cardText), 'card shows the amount going out in this run (156,750 SYP)');

  /* ---------------- 2. Courier auto-close ---------------- */
  step('2. Courier events auto-close rider / Yalla Go orders without seller action');
  const sign = (body, secret = LOGISTICS_SECRET, ts = Math.floor(Date.now() / 1000)) =>
    `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
  const courier = async (payload, sig) => {
    const body = JSON.stringify(payload);
    const res = await fetch(BASE + '/api/logistics/events', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig === null ? {} : { 'paylo-signature': sig ?? sign(body) }) }, body });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const riderOrder = db.prepare("SELECT * FROM orders WHERE seller_id = ? AND status = 'confirmed' AND fulfillment_method = 'platform_rider'").get(spice.id);
  ok(!!riderOrder, 'seed has an open rider order: ' + riderOrder.code);
  await seller.goto(BASE + '/seller/orders/' + riderOrder.id);
  ok(await seller.locator('[data-testid=courier-autoclose]').count() === 1, 'seller order page explains the courier will close it automatically');

  ok((await courier({ order_code: riderOrder.code, event: 'picked_up', courier: 'Paylo Rider' }, null)).status === 401, 'unsigned courier event is rejected (401)');
  ok((await courier({ order_code: riderOrder.code, event: 'picked_up', courier: 'Paylo Rider' }, sign('x', 'wrong-secret'))).status === 401, 'wrongly signed courier event is rejected (401)');
  const stale = JSON.stringify({ order_code: riderOrder.code, event: 'picked_up', courier: 'Paylo Rider' });
  ok((await courier(JSON.parse(stale), sign(stale, LOGISTICS_SECRET, Math.floor(Date.now() / 1000) - 3600))).status === 401, 'replayed/stale-timestamp event is rejected (401)');
  ok(db.prepare('SELECT status FROM orders WHERE id = ?').get(riderOrder.id).status === 'confirmed', 'rejected events never moved the order');

  const r1 = await courier({ order_code: riderOrder.code, event: 'picked_up', courier: 'Paylo Rider', reference: 'RIDER-7' });
  const afterPick = db.prepare('SELECT * FROM orders WHERE id = ?').get(riderOrder.id);
  ok(r1.status === 200 && afterPick.status === 'handed_off' && afterPick.order_state === 'closed', 'pickup auto-hands-off and closes the order (no seller click)');
  ok(afterPick.handed_off_at && afterPick.fulfillment_ref === 'RIDER-7', 'hand-off time and courier reference recorded');
  const lastEv = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(riderOrder.id);
  ok(lastEv.actor === 'system' && /Collected by Paylo Rider/.test(lastEv.note), 'timeline attributes the hand-off to the courier, as system');
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE event = 'order.collected.seller' AND recipient = 'spice@paylo.sy'").get(), 'seller is told no action is needed');

  const r2 = await courier({ order_code: riderOrder.code, event: 'picked_up', courier: 'Paylo Rider' });
  ok(r2.status === 200 && r2.json.result === 'noop', 'replaying the same event is an idempotent no-op');

  const r3 = await courier({ order_code: riderOrder.code, event: 'delivered', courier: 'Paylo Rider' });
  const afterDel = db.prepare('SELECT * FROM orders WHERE id = ?').get(riderOrder.id);
  ok(r3.status === 200 && afterDel.status === 'delivered', 'delivery event marks the order delivered');
  ok(afterDel.payment_status === 'collected_cod', 'COD is recorded as collected on courier delivery (payout-eligible path)');

  const pickupOrder = db.prepare("SELECT code FROM orders WHERE fulfillment_method = 'logistics_pickup' LIMIT 1").get();
  ok((await courier({ order_code: pickupOrder.code, event: 'delivered', courier: 'Paylo Rider' })).status === 409, 'non-courier (logistics pickup) order is refused (409)');
  ok((await courier({ order_code: 'PL-NOSUCH00', event: 'delivered', courier: 'X' })).status === 404, 'unknown order code returns 404');

  /* ---------------- 3. Seller-facing returns list ---------------- */
  step('3. Sellers see their own returns and disputes');
  const buyer = await newPage();
  const openReturn = async (code, reason, desc) => {
    await buyer.goto(BASE + '/track/' + code);
    await buyer.locator('details summary', { hasText: /Request a return|Report a problem/ }).click();
    await buyer.selectOption('select[name=reason]', reason);
    await buyer.fill('textarea[name=description]', desc);
    await buyer.getByRole('button', { name: 'Submit report' }).click();
    await buyer.waitForSelector('text=A report is open on this order');
  };
  const spiceDelivered = db.prepare("SELECT * FROM orders WHERE seller_id = ? AND status = 'delivered' AND payout_id IS NULL ORDER BY created_at LIMIT 1").get(spice.id);
  await openReturn(spiceDelivered.code, 'damaged', 'Jar lid cracked in transit');
  await seller.goto(BASE + '/seller');
  ok(await seller.locator('[data-testid=returns-alert]').count() === 1, 'dashboard flags open returns and links to them');
  await seller.goto(BASE + '/seller/returns');
  const retTable = seller.locator('[data-testid=seller-returns]');
  ok(await retTable.getByText(spiceDelivered.code).count() === 1, 'seller sees the return opened on their order');
  ok(await retTable.getByText('The item arrived damaged').count() === 1 && await retTable.getByText('Jar lid cracked').count() === 1, 'reason and buyer description are shown');
  ok(await seller.getByText('Open (1)').count() === 1, 'open-returns count is shown on the filter');

  const demo = await newPage();
  await login(demo, 'demo@paylo.sy', 'seller1234');
  await demo.waitForURL('**/login/2fa');
  const { execSync } = require('child_process');
  await demo.fill('input[name=code]', execSync('node scripts/totp.js JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP').toString().slice(0, 6));
  await demo.click('button[type=submit]');
  await demo.waitForURL('**/seller');
  await demo.goto(BASE + '/seller/returns?f=all');
  ok(await demo.getByText(spiceDelivered.code).count() === 0, "another seller never sees this seller's return");

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

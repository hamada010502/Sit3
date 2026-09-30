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

  /* ---------------- 4. Partial refunds + liability ---------------- */
  step('4. Partial refunds resolve liability correctly on a partial amount');
  const ord = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const refundsOf = (id) => db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at').all(id);
  const dispute = db.prepare("SELECT * FROM disputes WHERE order_id = ? AND status = 'open'").get(spiceDelivered.id);
  const A0 = ord(spiceDelivered.id);
  const resolveForm = () => admin.locator(`[id="${dispute.id}"] form`).last();

  // 4a. Too large a "partial" is refused, visibly, and changes nothing.
  await admin.goto(BASE + '/admin/disputes');
  await resolveForm().locator('select[name=resolution]').selectOption('partial_refund');
  await resolveForm().locator('input[name=amount]').fill(String(A0.subtotal));
  await resolveForm().getByRole('button', { name: 'Resolve' }).click();
  await admin.waitForSelector('[data-testid=dispute-error]');
  ok(/less than/.test(await admin.locator('[data-testid=dispute-error]').innerText()), 'a "partial" refund of the full goods value is refused with a clear error');
  ok(ord(spiceDelivered.id).status === 'disputed' && refundsOf(spiceDelivered.id).length === 0, 'refused partial refund left the order and ledger untouched');

  // 4b. Seller liable: payout drops by the refund minus the commission given back.
  await admin.goto(BASE + '/admin/disputes');
  await resolveForm().locator('select[name=resolution]').selectOption('partial_refund');
  await resolveForm().locator('input[name=amount]').fill('30000');
  await resolveForm().locator('select[name=liability]').selectOption('seller');
  await resolveForm().getByRole('button', { name: 'Resolve' }).click();
  await admin.waitForLoadState('networkidle');
  const A1 = ord(spiceDelivered.id);
  const commissionBack = Math.round((A0.commission_amount * 30000) / A0.subtotal);
  const [rA] = refundsOf(spiceDelivered.id);
  ok(rA && rA.kind === 'partial' && rA.amount === 30000 && rA.liability === 'seller' && rA.dispute_id === dispute.id, 'ledger row: partial, 30,000, liability seller, tied to the dispute');
  ok(db.prepare('SELECT status, liability FROM disputes WHERE id = ?').get(dispute.id).liability === 'seller', 'dispute records liability = seller');
  ok(A1.status === 'delivered' && A1.order_state === 'closed', 'order returns to its pre-dispute status (delivered/closed), not "refunded"');
  ok(A1.refunded_amount === 30000, 'order tracks 30,000 refunded so far');
  ok(A1.commission_amount === A0.commission_amount - commissionBack, `commission reduced proportionally (−${commissionBack})`);
  ok(A1.seller_net === A0.seller_net - (30000 - commissionBack), `seller net reduced by refund minus commission returned (${A0.seller_net} → ${A1.seller_net})`);
  ok(rA.seller_net_delta === A1.seller_net - A0.seller_net, 'ledger seller_net_delta matches the actual change');
  ok(!!db.prepare("SELECT 1 FROM payments WHERE order_id = ? AND amount = -30000 AND status = 'refunded'").get(spiceDelivered.id), 'a −30,000 refund payment is recorded against the order');

  // 4c–e. Non-seller liability: buyer refunded, seller payout untouched.
  const partialViaOrderPage = async (orderId, amount, liability) => {
    await admin.goto(BASE + '/admin/orders/' + orderId);
    const f = admin.locator('[data-testid=partial-refund-form]');
    await f.locator('input[name=amount]').fill(String(amount));
    await f.locator('select[name=liability]').selectOption(liability);
    await f.getByRole('button', { name: 'Partial refund' }).click();
    await admin.waitForSelector('[data-testid=refund-ledger]');
  };
  const byTitle = (sellerId, title) => db.prepare("SELECT * FROM orders WHERE seller_id = ? AND product_title = ? AND status = 'delivered' ORDER BY created_at LIMIT 1").get(sellerId, title);
  const lina = db.prepare("SELECT id FROM sellers WHERE slug = 'lina-handmade'").get();
  const cases = [
    ['logistics', byTitle(lina.id, 'Olive-wood serving board'), 50000],
    ['platform', byTitle(spice.id, 'Arabic coffee with cardamom (500 g)'), 20000],
    ['none', byTitle(lina.id, 'Damascus rose scented candle'), 15000],
  ];
  for (const [liab, o, amt] of cases) {
    await partialViaOrderPage(o.id, amt, liab);
    const after = ord(o.id);
    const [r] = refundsOf(o.id);
    ok(r && r.liability === liab && r.amount === amt && r.seller_net_delta === 0, `liability ${liab}: ledger records ${amt} with zero seller impact`);
    ok(after.seller_net === o.seller_net && after.commission_amount === o.commission_amount, `liability ${liab}: seller net and commission unchanged`);
    ok(after.refunded_amount === amt && after.status === 'delivered', `liability ${liab}: order stays delivered with ${amt} refunded`);
  }

  // Validation: no money collected yet → no partial refund offered.
  const pendingCod = db.prepare("SELECT * FROM orders WHERE payment_method = 'cod' AND payment_status = 'pending' AND status = 'confirmed' LIMIT 1").get();
  await admin.goto(BASE + '/admin/orders/' + pendingCod.id);
  ok(await admin.locator('[data-testid=partial-refund-form]').count() === 0, 'no partial refund offered before any money is collected');

  // Full refund after a partial refunds only what is left.
  const guide = db.prepare("SELECT * FROM orders WHERE product_title = 'Candle-making guide (PDF)' AND status = 'delivered' LIMIT 1").get();
  await partialViaOrderPage(guide.id, 10000, 'platform');
  await admin.goto(BASE + '/admin/orders/' + guide.id);
  await admin.getByRole('button', { name: 'Refunded', exact: true }).click();
  await admin.waitForLoadState('networkidle');
  const guideRefunds = refundsOf(guide.id);
  ok(ord(guide.id).status === 'refunded', 'full refund after a partial still moves the order to refunded');
  ok(guideRefunds.length === 2 && guideRefunds[1].kind === 'full' && guideRefunds[1].amount === guide.total - 10000, `full refund after partial refunds only the remaining ${guide.total - 10000}`);

  // Payout run pays the reduced seller net, not subtotal − commission.
  await admin.goto(BASE + '/admin/payouts');
  await admin.getByRole('button', { name: "Generate this week's payouts" }).click();
  await admin.waitForURL('**/admin/payouts?generated=*');
  const refundedIn = ord(spiceDelivered.id);
  const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(refundedIn.payout_id);
  const netSum = db.prepare('SELECT sum(seller_net) s FROM orders WHERE payout_id = ?').get(payout.id).s;
  ok(!!payout && payout.amount === netSum, `spice payout (${payout.amount}) equals the sum of seller nets, including the seller-liable reduction`);

  // Seller and buyer can both see it.
  await seller.goto(BASE + '/seller/orders/' + spiceDelivered.id);
  ok(await seller.locator('[data-testid=refunded-amount]').count() === 1, 'seller sees the refunded amount on the order');
  await buyer.goto(BASE + '/track/' + spiceDelivered.code);
  ok(await buyer.getByText('has been refunded to you on this order').count() === 1, 'buyer tracking page shows the partial refund');

  /* ---------------- 5. Seller coupons ---------------- */
  step('5. Sellers create discount codes; checkout applies them correctly');
  const makeCoupon = async ({ code, kind = 'percent', value, min = '', max = '' }) => {
    await seller.goto(BASE + '/seller/coupons');
    const f = seller.locator('[data-testid=coupon-form]');
    await f.locator('input[name=code]').fill(code);
    await f.locator('select[name=kind]').selectOption(kind);
    await f.locator('input[name=value]').fill(String(value));
    await f.locator('input[name=min_subtotal]').fill(String(min));
    await f.locator('input[name=max_uses]').fill(String(max));
    await f.getByRole('button', { name: 'Create code' }).click();
    await seller.waitForLoadState('networkidle');
  };
  await makeCoupon({ code: 'x', value: 10 });
  ok(await seller.getByText('Use 3–24 letters').count() === 1, 'malformed code is rejected');
  await makeCoupon({ code: 'TOOMUCH', value: 95 });
  ok(await seller.getByText('Percent must be 1–90').count() === 1, 'percent above 90 is rejected');
  await makeCoupon({ code: 'eid20', value: 20, max: 1 });
  ok(!!db.prepare("SELECT 1 FROM coupons WHERE seller_id = ? AND code = 'EID20'").get(spice.id), 'code is created (normalised to upper case)');
  await makeCoupon({ code: 'EID20', value: 5 });
  ok(await seller.getByText('You already have a code with that name').count() === 1, 'duplicate code for the same store is rejected');
  await makeCoupon({ code: 'BULK5K', kind: 'fixed', value: 5000, min: 100000 });
  await makeCoupon({ code: 'RACE1', value: 10, max: 1 });

  const zaatar = db.prepare("SELECT * FROM products WHERE seller_id = ? AND title LIKE 'Za%'").get(spice.id);
  const buyNow = async (page, { code, qty = 1, name = 'Coupon Buyer' }) => {
    await page.goto(BASE + '/p/' + zaatar.id);
    await page.fill('input[name=buyer_name]', name);
    await page.fill('input[name=buyer_phone]', '0912345000');
    await page.fill('textarea[name=address]', 'Shaalan, Damascus');
    await page.locator('input[name=quantity]').fill(String(qty));
    await page.click('button:has-text("Continue")');
    if (code) {
      await page.getByLabel('Discount code').fill(code);
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.waitForSelector('[data-testid=discount-line], [data-testid=coupon-box] .alert-error');
    }
  };
  const place = async (page) => {
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/track/**', { timeout: 15000 });
    return db.prepare('SELECT * FROM orders WHERE code = ?').get(decodeURIComponent(new URL(page.url()).pathname.split('/').pop()));
  };

  const b1 = await newPage();
  await buyNow(b1, { code: 'eid20' });
  ok(/7,000/.test(await b1.locator('[data-testid=discount-line]').innerText()), 'preview shows 20% off 35,000 = 7,000');
  const o1 = await place(b1);
  ok(o1.coupon_code === 'EID20' && o1.discount_amount === 7000, 'order records code EID20 and 7,000 discount');
  ok(o1.subtotal === 28000 && o1.delivery_fee === 15000 && o1.total === 43000, 'discount comes off goods only; delivery fee (15,000) untouched');
  ok(o1.commission_amount === 1400 && o1.seller_net === 26600, 'commission is charged on the paid 28,000 (5% = 1,400), seller net 26,600');
  ok(db.prepare("SELECT used_count FROM coupons WHERE code = 'EID20'").get().used_count === 1, 'use is counted');

  const b2 = await newPage();
  await buyNow(b2, { code: 'EID20' });
  ok(await b2.getByText('That code is not valid for this store').count() === 1, 'a used-up code is refused at preview');

  await buyNow(b2, { code: 'BULK5K' });
  ok(await b2.getByText('below the minimum for this code').count() === 1, 'minimum order is enforced (35,000 < 100,000)');
  await buyNow(b2, { code: 'BULK5K', qty: 3 });
  ok(/5,000/.test(await b2.locator('[data-testid=discount-line]').innerText()), 'fixed 5,000 applies once the minimum is met');

  db.prepare("INSERT INTO coupons (id, seller_id, code, kind, value) VALUES ('c-lina', (SELECT id FROM sellers WHERE slug = 'lina-handmade'), 'LINA10', 'percent', 10)").run();
  await buyNow(b2, { code: 'LINA10' });
  ok(await b2.getByText('That code is not valid for this store').count() === 1, "another store's code does not work here");

  // Concurrent race on the last use: both preview fine, only one can take it.
  const [race1, race2] = [await newPage(), await newPage()];
  await buyNow(race1, { code: "RACE1", name: "Racer One" });
  await buyNow(race2, { code: "RACE1", name: "Racer Two" });
  const outcome = async (p) => {
    await p.locator('button[type=submit]').click();
    return p.waitForURL('**/track/**', { timeout: 15000 }).then(() => 'ordered').catch(() => 'refused');
  };
  const results = await Promise.all([outcome(race1), outcome(race2)]);
  const raceOrders = db.prepare("SELECT count(*) c FROM orders WHERE coupon_code = 'RACE1'").get().c;
  ok(raceOrders === 1 && db.prepare("SELECT used_count FROM coupons WHERE code = 'RACE1'").get().used_count === 1,
    `two concurrent checkouts on a 1-use code create exactly one discounted order (${results.join(', ')})`);

  // Cancelling gives the use back.
  await admin.goto(BASE + '/admin/orders/' + o1.id);
  await admin.getByRole('button', { name: 'Cancelled', exact: true }).click();
  await admin.waitForLoadState('networkidle');
  ok(db.prepare('SELECT status FROM orders WHERE id = ?').get(o1.id).status === 'cancelled' && db.prepare("SELECT used_count FROM coupons WHERE code = 'EID20'").get().used_count === 0, 'cancelling the order releases its coupon use');

  await seller.goto(BASE + '/seller/orders/' + (db.prepare("SELECT id FROM orders WHERE coupon_code = 'RACE1'").get().id));
  ok(await seller.locator('[data-testid=order-discount]').count() === 1, 'seller sees the discount and code on the order');

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

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

  /* ---------------- 6. Collections ---------------- */
  step('6. Products can be grouped into collections, filterable on the storefront');
  const addCollection = async (name) => {
    await seller.goto(BASE + '/seller/collections');
    await seller.getByLabel('Collection name').fill(name);
    await seller.getByRole('button', { name: 'Add collection' }).click();
    await seller.waitForLoadState('networkidle');
  };
  await addCollection('Spice blends');
  await addCollection('Coffee');
  await addCollection('coffee');
  ok(await seller.getByText('already have a collection with that name').count() === 1, 'duplicate collection name is rejected');
  const colSpice = db.prepare("SELECT * FROM collections WHERE seller_id = ? AND slug = 'spice-blends'").get(spice.id);
  const colCoffee = db.prepare("SELECT * FROM collections WHERE seller_id = ? AND slug = 'coffee'").get(spice.id);
  ok(colSpice && colCoffee, 'collections created with URL-safe slugs');

  const setCollection = async (productId, collectionId, forge) => {
    await seller.goto(BASE + '/seller/products/' + productId);
    const sel = seller.locator('select[name=collection_id]');
    if (forge) await sel.evaluate((el, v) => { el.options[1].value = v; el.selectedIndex = 1; }, forge);
    else await sel.selectOption(collectionId);
    await seller.getByRole('button', { name: 'Save', exact: true }).click();
    await seller.waitForURL('**saved=1');
  };
  const coffeeP = db.prepare("SELECT * FROM products WHERE seller_id = ? AND title LIKE 'Arabic coffee%'").get(spice.id);
  const sevenP = db.prepare("SELECT * FROM products WHERE seller_id = ? AND title LIKE 'Seven-spice%'").get(spice.id);
  await setCollection(zaatar.id, colSpice.id);
  await setCollection(coffeeP.id, colCoffee.id);
  ok(db.prepare('SELECT collection_id FROM products WHERE id = ?').get(zaatar.id).collection_id === colSpice.id, 'product assigned to a collection from the product form');

  const linaCol = db.prepare("SELECT id FROM collections WHERE slug = 'kitchen'").get();
  await setCollection(sevenP.id, null, linaCol.id);
  ok(db.prepare('SELECT collection_id FROM products WHERE id = ?').get(sevenP.id).collection_id === null, "a forged id for another store's collection is ignored");

  const shopper = await newPage();
  await shopper.goto(BASE + '/s/spice-house');
  const chips = shopper.locator('[data-testid=collection-chips]');
  ok(await chips.getByText('Coffee').count() === 1 && await chips.getByText('Spice blends').count() === 1, 'storefront shows collection chips');
  ok(await shopper.getByText('Seven-spice mix').count() === 1 && await shopper.getByText('Arabic coffee').count() === 1, '"All" shows every product, categorised or not');
  await chips.getByText('Coffee').click();
  await shopper.waitForURL('**?c=coffee');
  ok(await shopper.getByText('Arabic coffee').count() === 1 && await shopper.getByText("Za'atar blend").count() === 0 && await shopper.getByText('Seven-spice mix').count() === 0, '?c=coffee shows only that collection');
  await shopper.goto(BASE + '/s/spice-house?c=no-such-collection');
  ok(await shopper.getByText('Seven-spice mix').count() === 1, 'unknown collection slug falls back to all products');

  await seller.goto(BASE + '/seller/collections');
  await seller.locator('[data-testid=collection-list] > div', { hasText: 'Coffee' }).getByRole('button', { name: 'Delete' }).click();
  await seller.waitForLoadState('networkidle');
  ok(!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(colCoffee.id) && db.prepare('SELECT collection_id, status FROM products WHERE id = ?').get(coffeeP.id).collection_id === null,
    'deleting a collection keeps its products, uncategorised');
  await shopper.goto(BASE + '/s/spice-house');
  ok(await shopper.locator('[data-testid=collection-chips]').getByText('Coffee').count() === 0 && await shopper.getByText('Arabic coffee').count() === 1, 'deleted collection disappears; product still for sale');

  await addCollection('Empty one');
  await shopper.goto(BASE + '/s/spice-house');
  ok(await shopper.locator('[data-testid=collection-chips]').getByText('Empty one').count() === 0, 'empty collections are hidden from buyers');

  /* ================= PHASE 2 ================= */
  /* ---------------- 7. Per-variant images ---------------- */
  step('7. Each variant can have its own photo');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const cups = db.prepare("SELECT * FROM products WHERE title = 'Ceramic espresso cups'").get();
  const variantImg = (label) => db.prepare('SELECT image_path FROM product_variants WHERE product_id = ? AND label = ?').get(cups.id, label).image_path;
  await demo.goto(BASE + '/seller/products/' + cups.id);
  await demo.locator('[data-variant-row]').nth(1).locator('input[type=file]').setInputFiles({ name: 'indigo.png', mimeType: 'image/png', buffer: PNG });
  await demo.getByRole('button', { name: 'Save', exact: true }).click();
  await demo.waitForURL('**saved=1');
  const indigoPath = variantImg('Small / Indigo');
  ok(/^\/uploads\/.+\.png$/.test(indigoPath || ''), 'uploaded photo is stored on the Small / Indigo variant');
  ok(variantImg('Small / Sand') === null, 'other variants are unaffected');

  await demo.goto(BASE + '/seller/products/' + cups.id);
  ok(await demo.locator('[data-testid=variant-thumb]').count() === 1, 'edit form shows the existing variant photo');
  await demo.getByRole('button', { name: 'Save', exact: true }).click();
  await demo.waitForURL('**saved=1');
  ok(variantImg('Small / Indigo') === indigoPath, 're-saving keeps the photo');

  await demo.goto(BASE + '/seller/products/' + cups.id);
  await demo.locator('input[name=variants]').evaluate((el) => { const rows = JSON.parse(el.value); rows[0].image = '/uploads/someone-elses.png'; el.value = JSON.stringify(rows); });
  await demo.getByRole('button', { name: 'Save', exact: true }).click();
  await demo.waitForURL('**saved=1');
  ok(variantImg('Small / Sand') === null, 'a forged image path is not accepted');

  const cupsBuyer = await newPage();
  await cupsBuyer.goto(BASE + '/p/' + cups.id);
  const indigoId = db.prepare("SELECT id FROM product_variants WHERE product_id = ? AND label = 'Small / Indigo'").get(cups.id).id;
  const sandId = db.prepare("SELECT id FROM product_variants WHERE product_id = ? AND label = 'Small / Sand'").get(cups.id).id;
  await cupsBuyer.selectOption('select[name=variant_id]', indigoId);
  ok(await cupsBuyer.locator('[data-testid=variant-image]').getAttribute('src') === indigoPath, 'buyer sees the Indigo photo when choosing Small / Indigo');
  await cupsBuyer.selectOption('select[name=variant_id]', sandId);
  ok(await cupsBuyer.locator('[data-testid=variant-image]').count() === 0, 'no variant photo shown for a variant without one');

  /* ---------------- 8. Global variation settings ---------------- */
  step('8. Reusable option lists generate variants on any product');
  const addPreset = async (name, values) => {
    await seller.goto(BASE + '/seller/variations');
    const f = seller.locator('[data-testid=preset-new]');
    await f.locator('input[name=name]').fill(name);
    await f.locator('input[name=values]').fill(values);
    await f.getByRole('button', { name: 'Add option list' }).click();
    await seller.waitForLoadState('networkidle');
  };
  await addPreset('Size', 'S, M, L, m');
  const sizeRow = db.prepare("SELECT \"values\" v FROM variation_presets WHERE seller_id = ? AND name = 'Size'").get(spice.id);
  ok(sizeRow && JSON.stringify(JSON.parse(sizeRow.v)) === '["S","M","L"]', 'values are trimmed and de-duplicated (S, M, L)');
  await addPreset('Colour', 'Red');
  ok(await seller.getByText('Add at least two values').count() === 1, 'a list with fewer than two values is rejected');
  await addPreset('Colour', 'Red, Blue');
  await addPreset('size', 'XS, XL');
  ok(await seller.getByText('already have an option list with that name').count() === 1, 'duplicate list name (case-insensitive) is rejected');

  await seller.goto(BASE + '/seller/products/new');
  await seller.fill('input[name=title]', 'Linen apron');
  await seller.fill('input[name=price]', '45000');
  const picker = seller.locator('[data-testid=preset-picker]');
  await picker.locator('select').nth(0).selectOption({ label: 'Size' });
  await picker.locator('select').nth(1).selectOption({ label: 'Colour' });
  await picker.getByRole('button', { name: 'Apply' }).click();
  ok(await seller.locator('[data-variant-row]').count() === 6, 'applying Size × Colour generates 6 variant rows');
  ok(await seller.locator('input[name=option1_name]').inputValue() === 'Size' && await seller.locator('input[name=option2_name]').inputValue() === 'Colour', 'option names are filled from the lists');
  await seller.locator('[data-variant-row]').nth(0).locator('input[type=number]').nth(1).fill('4');
  await picker.getByRole('button', { name: 'Apply' }).click();
  ok(await seller.locator('[data-variant-row]').nth(0).locator('input[type=number]').nth(1).inputValue() === '4', 're-applying keeps stock already entered on existing rows');
  await seller.getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForURL('**saved=1');
  const apron = db.prepare("SELECT id FROM products WHERE seller_id = ? AND title = 'Linen apron'").get(spice.id);
  const apronLabels = db.prepare('SELECT label, price, stock FROM product_variants WHERE product_id = ? ORDER BY position').all(apron.id);
  ok(apronLabels.length === 6 && apronLabels[0].label === 'S / Red' && apronLabels[5].label === 'L / Blue', 'saved product has all six combinations in order');
  ok(apronLabels.every((v) => v.price === 45000) && apronLabels[0].stock === 4, 'generated rows take the base price; entered stock is saved');

  await demo.goto(BASE + '/seller/products/new');
  ok(await demo.locator('[data-testid=preset-picker]').count() === 0, "another store never sees this store's option lists");

  /* ---------------- 9. Richer store settings ---------------- */
  step('9. Announcement bar, logo/banner management and About page builder');
  const saveSettings = async (fn) => {
    await seller.goto(BASE + '/seller/settings');
    await fn();
    await seller.getByRole('button', { name: 'Save', exact: true }).click();
    await seller.waitForSelector('text=Saved');
  };
  await saveSettings(async () => {
    await seller.fill('input[name=announcement]', 'Free cardamom sample with every order this week');
    await seller.locator('input[name=logo]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  });
  const store1 = await newPage();
  await store1.goto(BASE + '/s/spice-house');
  ok(/Free cardamom sample/.test(await store1.locator('[data-testid=store-announcement]').innerText()), 'announcement shows on the storefront');
  await store1.goto(BASE + '/p/' + zaatar.id);
  ok(await store1.locator('[data-testid=store-announcement]').count() === 1, 'announcement also shows on product pages');
  const logoPath = db.prepare('SELECT logo_path FROM sellers WHERE id = ?').get(spice.id).logo_path;
  ok(/^\/uploads\//.test(logoPath || ''), 'logo uploaded');
  await seller.goto(BASE + '/seller/settings');
  ok(await seller.locator('[data-testid=logo-preview]').count() === 1, 'settings shows a preview of the current logo');

  await saveSettings(async () => { await seller.fill('textarea[name=bio]', 'Freshly ground spices'); });
  ok(db.prepare('SELECT logo_path FROM sellers WHERE id = ?').get(spice.id).logo_path === logoPath, 'saving other settings keeps the logo');
  await saveSettings(async () => {
    await seller.locator('input[name=remove_logo]').check();
    await seller.fill('input[name=announcement]', '');
  });
  const after9 = db.prepare('SELECT logo_path, announcement FROM sellers WHERE id = ?').get(spice.id);
  ok(after9.logo_path === null, 'logo can be removed');
  await store1.goto(BASE + '/s/spice-house');
  ok(after9.announcement === null && await store1.locator('[data-testid=store-announcement]').count() === 0, 'clearing the announcement hides the bar');

  await seller.goto(BASE + '/seller/settings/about');
  ok(await seller.locator('[data-about-row]').count() === 1 && /Family spice shop/.test(await seller.locator('[data-about-row] textarea').first().inputValue()),
    "the store's existing plain About text is imported as the first section");
  const addSection = async (heading, body) => {
    await seller.getByRole('button', { name: /Add section/ }).click();
    const row = seller.locator('[data-about-row]').last();
    await row.getByLabel('Heading').fill(heading);
    await row.getByLabel('Text').fill(body);
    return row;
  };
  await addSection('Our shop', 'Family business since 1987. <b>Not bold</b>');
  const second = await addSection('Our grinder', 'Stone-ground to order.');
  await second.locator('input[type=file]').setInputFiles({ name: 'grinder.png', mimeType: 'image/png', buffer: PNG });
  await second.getByRole('button', { name: 'Move up' }).click();
  await seller.locator('input[name=sections]').evaluate((el) => { const r = JSON.parse(el.value); r[2].image = '/uploads/not-mine.png'; el.value = JSON.stringify(r); });
  await seller.getByRole('button', { name: 'Save', exact: true }).click();
  await seller.waitForSelector('text=Saved');
  const saved = JSON.parse(db.prepare('SELECT about_sections s FROM sellers WHERE id = ?').get(spice.id).s);
  ok(saved.length === 3 && /Family spice shop/.test(saved[0].body) && saved[1].heading === 'Our grinder' && saved[2].heading === 'Our shop', 'sections saved in the reordered order');
  ok(/^\/uploads\//.test(saved[1].image || '') && saved[2].image === null, 'section photo stored; a forged photo path is dropped');

  await store1.goto(BASE + '/s/spice-house');
  await store1.locator('[data-testid=about-link]').click();
  await store1.waitForURL('**/s/spice-house/about');
  const aboutText = await store1.locator('[data-testid=about-sections]').innerText();
  ok(aboutText.indexOf('Our grinder') < aboutText.indexOf('Our shop'), 'public About page renders sections in order');
  ok(aboutText.includes('<b>Not bold</b>') && await store1.locator('[data-testid=about-sections] b').count() === 0, 'section text is rendered as text, never as HTML');
  ok(await store1.locator('[data-testid=about-sections] img').count() === 1, 'section photo is shown');

  /* ---------------- 10. Short numeric product links ---------------- */
  step('10. Short numeric product links sit alongside /p/<id> and /s/<slug>');
  const codes = db.prepare('SELECT short_code FROM products').all().map((r) => r.short_code);
  ok(codes.every((c) => Number.isInteger(c) && c >= 1000000 && c <= 9999999), `every product has a 7-digit short code (${codes.length} products, incl. backfilled seed data)`);
  ok(new Set(codes).size === codes.length, 'short codes are unique');
  const apronCode = db.prepare('SELECT short_code FROM products WHERE id = ?').get(apron.id).short_code;
  ok(!!apronCode, 'a newly created product gets a short code');

  await seller.goto(BASE + '/seller/products/' + zaatar.id);
  ok((await seller.locator('[data-testid=short-link]').innerText()).includes('/' + db.prepare('SELECT short_code FROM products WHERE id = ?').get(zaatar.id).short_code), 'seller sees and can copy the short link');

  const zCode = db.prepare('SELECT short_code FROM products WHERE id = ?').get(zaatar.id).short_code;
  const hop = await fetch(BASE + '/' + zCode, { redirect: 'manual' });
  ok([307, 308].includes(hop.status) && hop.headers.get('location').endsWith('/p/' + zaatar.id), `/${zCode} redirects to /p/${zaatar.id}`);
  const viaShort = await newPage();
  await viaShort.goto(BASE + '/' + zCode);
  ok(viaShort.url().endsWith('/p/' + zaatar.id) && await viaShort.locator('input[name=buyer_name]').count() === 1, 'a buyer following the short link lands on the working checkout page');

  ok((await fetch(BASE + '/1234567', { redirect: 'manual' })).status === 404, 'unknown short code is a 404');
  ok((await fetch(BASE + '/not-a-route', { redirect: 'manual' })).status === 404, 'non-numeric unknown paths are still plain 404s');
  ok((await fetch(BASE + '/login')).status === 200 && (await fetch(BASE + '/track')).status === 200, 'existing routes are not shadowed by the short-link route');

  await seller.goto(BASE + '/seller/products/' + apron.id);
  await seller.getByRole('button', { name: 'Delete', exact: true }).click();
  await seller.waitForLoadState('networkidle');
  ok((await fetch(BASE + '/' + apronCode, { redirect: 'manual' })).status === 404, "a removed product's short link stops working");

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

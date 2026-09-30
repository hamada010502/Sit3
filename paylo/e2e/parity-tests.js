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

// Local SMS/WhatsApp gateway stand-in: records every message; can be told to fail.
const http = require('http');
const gateway = { hits: [], failNext: false };
const gatewayServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    gateway.hits.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    if (gateway.failNext) { gateway.failNext = false; res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
});

(async () => {
  await new Promise((r) => gatewayServer.listen(4011, '127.0.0.1', r));
  const db = new Database(DB_PATH);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const newPage = async () => (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const TOTP_SECRETS = { 'spice@paylo.sy': 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U', 'demo@paylo.sy': 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
  const totpNow = (secret) => require('child_process').execSync(`node scripts/totp.js ${secret}`).toString().slice(0, 6);
  // Logs in and, for accounts with 2FA, completes the second factor.
  const login = async (p, email, pw) => {
    await p.goto(BASE + '/login');
    await p.fill('input[name=email]', email);
    await p.fill('input[name=password]', pw);
    await p.click('button[type=submit]');
    if (TOTP_SECRETS[email]) {
      await p.waitForURL('**/login/2fa');
      await p.fill('input[name=code]', totpNow(TOTP_SECRETS[email]));
      await p.click('button[type=submit]');
    }
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

  /* ================= PHASE 3 ================= */
  /* ---------------- 11a. SMS / WhatsApp actually delivered ---------------- */
  step('11a. Buyer SMS / WhatsApp messages are really sent through the configured gateway');
  const smsHits = gateway.hits.filter((h) => h.path === '/sms');
  ok(smsHits.length > 0, `SMS gateway received ${smsHits.length} real HTTP deliveries during this run`);
  ok(smsHits.every((h) => h.auth === 'Bearer sms-test-token' && h.body.to && h.body.body && h.body.channel === 'sms'), 'each carries the bearer token and a {to, body, channel} payload');
  const smsRows = db.prepare("SELECT status, count(*) c FROM notifications WHERE channel = 'sms' GROUP BY status").all();
  ok(smsRows.length === 1 && smsRows[0].status === 'sent', `every SMS is recorded as "sent", not just logged (${JSON.stringify(smsRows)})`);

  const textBuyer = await newPage();
  db.prepare("UPDATE settings SET value = 'whatsapp' WHERE key = 'text_channel'").run();
  const waBefore = gateway.hits.filter((h) => h.path === '/wa').length;
  await buyNow(textBuyer, { name: 'WhatsApp Buyer' });
  const waOrder = await place(textBuyer);
  const waHits = gateway.hits.filter((h) => h.path === '/wa').slice(waBefore);
  ok(waHits.length >= 1 && waHits.some((h) => h.body.body.includes(waOrder.code) && h.auth === 'Bearer wa-test-token' && h.body.channel === 'whatsapp'), 'with text channel = WhatsApp, the order confirmation goes to the WhatsApp gateway');
  ok(!gateway.hits.some((h) => h.path === '/sms' && h.body.body.includes(waOrder.code)), 'and not also by SMS — one channel, never both');
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE channel = 'whatsapp' AND status = 'sent' AND body LIKE ?").get(`%${waOrder.code}%`), 'recorded as a sent WhatsApp message');
  db.prepare("UPDATE settings SET value = 'sms' WHERE key = 'text_channel'").run();

  gateway.failNext = true;
  await buyNow(textBuyer, { name: 'Gateway Down' });
  const failOrder = await place(textBuyer);
  ok(!!db.prepare("SELECT 1 FROM notifications WHERE channel = 'sms' AND status = 'failed: HTTP 500' AND body LIKE ?").get(`%${failOrder.code}%`), 'a gateway error is recorded as failed, and the order still goes through');

  /* ---------------- 11b + 12. New-order alerts on the open dashboard ---------------- */
  step('11b/12. Open dashboard announces new orders: toast, desktop notification, sale sound');
  const alertCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await alertCtx.addInitScript(() => {
    window.__notes = [];
    window.Notification = class { constructor(title, opts) { window.__notes.push({ title, body: opts && opts.body }); } };
    window.Notification.permission = 'default';
    window.Notification.requestPermission = async () => { window.Notification.permission = 'granted'; return 'granted'; };
  });
  const watch = await alertCtx.newPage();
  await login(watch, 'spice@paylo.sy', 'seller1234');
  await watch.waitForURL('**/seller');
  await watch.locator('[data-testid=enable-desktop]').click();
  await watch.waitForSelector('[data-testid=desktop-on]');
  ok(true, 'seller can turn on desktop alerts from the dashboard');
  await watch.locator('[data-testid=sound-toggle]').click();
  ok(await watch.locator('[data-testid=sound-toggle]').getAttribute('aria-pressed') === 'true', 'sale sound can be switched on');
  const chimesBefore = await watch.evaluate(() => window.__paylo_chimes || 0);
  await watch.waitForTimeout(1500); // let the baseline poll set its cursor

  const alertBuyer = await newPage();
  await buyNow(alertBuyer, { name: 'Alert Buyer' });
  const alertOrder = await place(alertBuyer);
  await watch.locator('[data-testid=order-toasts]').getByText(alertOrder.code).waitFor({ timeout: 25000 });
  ok(true, `in-page toast appears for the new order ${alertOrder.code}`);
  const notes = await watch.evaluate(() => window.__notes);
  ok(notes.some((n) => n.title.includes(alertOrder.code) && /Za'atar/.test(n.body)), 'a desktop notification fires with the order code and product');
  ok(await watch.evaluate(() => window.__paylo_chimes || 0) > chimesBefore, 'the sale sound plays on the new order');
  ok(notes.filter((n) => n.title.includes('PL-')).length === 1, 'existing orders at page load are not re-announced');

  await watch.reload();
  ok(await watch.locator('[data-testid=sound-toggle]').getAttribute('aria-pressed') === 'true', 'sale-sound preference is remembered');

  const demoCookies = (await demo.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const demoFeed = await (await fetch(BASE + '/api/seller/new-orders?since=1970-01-01', { headers: { cookie: demoCookies } })).json();
  ok(!demoFeed.orders.some((o) => o.code === alertOrder.code), "another seller's feed never includes this store's orders");
  ok((await fetch(BASE + '/api/seller/new-orders?since=1970-01-01')).status === 401, 'the feed requires a seller session');

  /* ---------------- 13. Responsive web still intact ---------------- */
  step('13. Mobile layout: no horizontal overflow on the new pages (390px)');
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await phoneCtx.newPage();
  await login(phone, 'spice@paylo.sy', 'seller1234');
  await phone.waitForURL('**/seller');
  const pages = ['/seller', '/seller/returns?f=all', '/seller/coupons', '/seller/collections', '/seller/variations', '/seller/settings', '/seller/settings/about',
    '/seller/products/' + zaatar.id, '/s/spice-house', '/s/spice-house/about', '/s/lina-handmade', '/p/' + cups.id, '/track/' + spiceDelivered.code];
  for (const pth of pages) {
    await phone.goto(BASE + pth);
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 1, `${pth} fits a 390px screen (overflow ${over}px)`);
  }

  /* ================= PHASE 4 ================= */
  /* ---------------- 14. Commission breakdown history ---------------- */
  step('14. Commission breakdown shows every order line by line, matching what is paid out');
  const fmt = (n) => n.toLocaleString('en-US');
  await seller.goto(BASE + '/seller/payouts');
  await seller.locator('[data-testid=earnings-link]').click();
  await seller.waitForURL('**/seller/earnings');
  const expectNet = db.prepare("SELECT coalesce(sum(seller_net),0) s FROM orders WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed','refunded')").get(spice.id).s;
  ok((await seller.locator('[data-testid=earnings-net]').innerText()).includes(fmt(expectNet)), `page net (${fmt(expectNet)}) equals the sum of seller_net the payout run uses`);
  const liveCount = db.prepare("SELECT count(*) c FROM orders WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed')").get(spice.id).c;
  ok(await seller.locator('[data-testid=earnings-table] tbody tr').count() === liveCount, `one line per order (${liveCount}); cancelled orders excluded`);

  const refRow = seller.locator(`[data-testid=earnings-table] tr[data-code="${spiceDelivered.code}"]`);
  const refText = await refRow.innerText();
  const bore = 30000 - commissionBack;
  ok(refText.includes('− ' + fmt(30000)) && refText.includes(`you bore ${fmt(bore)}`), `partially refunded order shows the 30,000 refund and the ${fmt(bore)} the seller bore`);
  ok(/In payout run/.test(refText), 'shows it is already in a payout run');
  const raceOrder = db.prepare("SELECT * FROM orders WHERE coupon_code = 'RACE1'").get();
  const raceText = await seller.locator(`[data-testid=earnings-table] tr[data-code="${raceOrder.code}"]`).innerText();
  ok(raceText.includes('− ' + fmt(raceOrder.discount_amount)) && raceText.includes(fmt(raceOrder.seller_net)), 'discounted order shows list price, discount and resulting net');

  const month = new Date().toISOString().slice(0, 7);
  await seller.goto(BASE + '/seller/earnings?m=' + month);
  const monthCount = db.prepare("SELECT count(*) c FROM orders WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed') AND strftime('%Y-%m', created_at) = ?").get(spice.id, month).c;
  ok(await seller.locator('[data-testid=earnings-table] tbody tr').count() === monthCount, `month filter shows only ${month} (${monthCount} orders)`);

  db.prepare('UPDATE orders SET product_title = ? WHERE id = ?').run('=HYPERLINK("http://evil")', raceOrder.id);
  const spiceCookies = (await seller.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const csvRes = await fetch(BASE + '/seller/earnings/export', { headers: { cookie: spiceCookies } });
  const csv = await csvRes.text();
  ok(csvRes.headers.get('content-type').startsWith('text/csv') && csv.split('\r\n')[0].startsWith('date,order,product'), 'CSV export downloads with a header row');
  ok(csv.split('\r\n').filter(Boolean).length === liveCount + 1, 'CSV has one line per order');
  ok(csv.includes(`"'=HYPERLINK(""http://evil"")`) && !csv.includes(',"=HYPERLINK'), 'a formula in a product title is neutralised in the CSV');
  const demoCsv = await (await fetch(BASE + '/seller/earnings/export', { headers: { cookie: demoCookies } })).text();
  ok(!demoCsv.includes(spiceDelivered.code), "another seller's export never contains this store's orders");
  ok((await fetch(BASE + '/seller/earnings/export')).status === 401, 'export requires a seller session');

  /* ---------------- 15. Custom post-purchase message ---------------- */
  step('15. Each seller can set a message buyers see right after purchase');
  const thanks = 'Shukran! Ground fresh the morning it ships.\n<i>Keep sealed</i> after opening.';
  await saveSettings(async () => { await seller.fill('textarea[name=thank_you_message]', thanks); });
  ok(db.prepare('SELECT thank_you_message m FROM sellers WHERE id = ?').get(spice.id).m === thanks, 'message saved from store settings');

  const tyBuyer = await newPage();
  await tyBuyer.goto(BASE + '/p/' + zaatar.id);
  await tyBuyer.fill('input[name=buyer_name]', 'Thank You Buyer');
  await tyBuyer.fill('input[name=buyer_phone]', '0912345111');
  await tyBuyer.fill('input[name=buyer_email]', 'ty-buyer@example.com');
  await tyBuyer.fill('textarea[name=address]', 'Mezzeh, Damascus');
  await tyBuyer.click('button:has-text("Continue")');
  const tyOrder = await place(tyBuyer);
  const tyBox = tyBuyer.locator('[data-testid=thank-you]');
  ok(await tyBox.count() === 1 && (await tyBox.innerText()).includes('Ground fresh the morning it ships'), 'confirmation page shows the seller’s message');
  ok((await tyBox.innerText()).includes('<i>Keep sealed</i>') && await tyBox.locator('i').count() === 0, 'message renders as text, never HTML');
  const tyMail = db.prepare("SELECT body FROM notifications WHERE channel = 'email' AND recipient = 'ty-buyer@example.com' AND event = 'order.placed'").get();
  ok(tyMail && tyMail.body.includes('A note from Damascus Spice House') && tyMail.body.includes('Ground fresh the morning it ships'), 'message is included in the confirmation email');

  await tyBuyer.goto(BASE + '/track/' + tyOrder.code);
  ok(await tyBuyer.locator('[data-testid=thank-you]').count() === 0, 'shown only right after purchase, not on later visits to tracking');
  const linaOrder = db.prepare("SELECT code FROM orders WHERE seller_id = (SELECT id FROM sellers WHERE slug = 'lina-handmade') LIMIT 1").get();
  await tyBuyer.goto(BASE + '/track/' + linaOrder.code + '?new=1');
  ok(await tyBuyer.locator('[data-testid=thank-you]').count() === 0, "another store's orders never show this store's message");

  /* ---------------- 16. Bulk product actions ---------------- */
  step('16. Bulk price and stock updates across multiple products');
  const lp = (title) => db.prepare("SELECT * FROM products WHERE seller_id = ? AND title = ?").get(lina.id, title);
  const vPrices = (pid) => db.prepare('SELECT price FROM product_variants WHERE product_id = ? ORDER BY position').all(pid).map((r) => r.price);
  const candle0 = lp('Damascus rose scented candle'), cups0 = lp('Ceramic espresso cups'), guide0 = lp('Candle-making guide (PDF)'), board0 = lp('Olive-wood serving board'), tote0 = lp('Embroidered tote bag');
  const cupsV0 = vPrices(cups0.id);
  const candleOrderPrice0 = db.prepare('SELECT unit_price FROM orders WHERE product_id = ? LIMIT 1').get(candle0.id).unit_price;
  const bulk = async (titles, act, value, forgeId) => {
    await demo.goto(BASE + '/seller/products');
    for (const title of titles) await demo.locator(`[data-product-row="${title}"] input[name=ids]`).check();
    if (forgeId) await demo.evaluate((v) => { const i = document.createElement('input'); i.type = 'checkbox'; i.name = 'ids'; i.value = v; i.checked = true; i.setAttribute('form', 'bulk-form'); document.body.appendChild(i); }, forgeId);
    const bar = demo.locator('[data-testid=bulk-bar]');
    await bar.locator('select[name=bulk_action]').selectOption(act);
    if (value !== undefined) await bar.locator('input[name=bulk_value]').fill(String(value));
    await bar.getByRole('button', { name: 'Apply to selected' }).click();
    await demo.waitForSelector('[data-testid=bulk-result], [data-testid=bulk-bar] .alert-error');
    return (await bar.innerText());
  };

  await bulk(['Damascus rose scented candle', 'Ceramic espresso cups', 'Candle-making guide (PDF)'], 'price_pct', 10);
  ok(lp('Damascus rose scented candle').price === Math.round(candle0.price * 1.1) && lp('Candle-making guide (PDF)').price === Math.round(guide0.price * 1.1), '+10% raises plain and digital product prices');
  ok(JSON.stringify(vPrices(cups0.id)) === JSON.stringify(cupsV0.map((p) => Math.round(p * 1.1))), '+10% also raises every variant price, keeping their differences');
  ok(db.prepare('SELECT unit_price FROM orders WHERE product_id = ? LIMIT 1').get(candle0.id).unit_price === candleOrderPrice0, 'existing orders keep the price they were placed at');

  const setTxt = await bulk(['Damascus rose scented candle', 'Ceramic espresso cups'], 'price_set', 90000);
  ok(lp('Damascus rose scented candle').price === 90000, 'set price applies to a product without variants');
  ok(JSON.stringify(vPrices(cups0.id)) === JSON.stringify(cupsV0.map((p) => Math.round(p * 1.1))) && /Ceramic espresso cups \(has variants/.test(setTxt), 'a product with variants is skipped and named, not flattened');

  const stockTxt = await bulk(['Olive-wood serving board', 'Candle-making guide (PDF)', 'Embroidered tote bag'], 'stock_set', 7);
  ok(lp('Olive-wood serving board').stock === 7 && lp('Embroidered tote bag').stock === 7, 'set stock updates physical products');
  ok(tote0.status === 'out_of_stock' && lp('Embroidered tote bag').status === 'active', 'a sold-out product comes back on sale when stock is set');
  ok(/Candle-making guide \(PDF\) \(digital/.test(stockTxt), 'digital product is skipped for stock');

  await bulk(['Damascus rose scented candle', 'Olive-wood serving board'], 'deactivate');
  ok(lp('Damascus rose scented candle').status === 'inactive' && lp('Olive-wood serving board').status === 'inactive', 'bulk deactivate');
  const shop2 = await newPage();
  await shop2.goto(BASE + '/s/lina-handmade');
  ok(await shop2.getByText('Olive-wood serving board').count() === 0, 'deactivated products leave the storefront');
  await bulk(['Damascus rose scented candle', 'Olive-wood serving board'], 'activate');
  ok(lp('Damascus rose scented candle').status === 'active', 'bulk activate');

  const zaatarBefore = db.prepare('SELECT price FROM products WHERE id = ?').get(zaatar.id).price;
  await bulk(['Olive-wood serving board'], 'price_set', 12345, zaatar.id);
  ok(db.prepare('SELECT price FROM products WHERE id = ?').get(zaatar.id).price === zaatarBefore && lp('Olive-wood serving board').price === 12345, "a forged id for another store's product is ignored");

  ok(/Select at least one product/.test(await bulk([], 'price_pct', 5)), 'nothing selected → clear error');
  ok(/between −90 and \+500/.test(await bulk(['Olive-wood serving board'], 'price_pct', 0)), 'a 0% change is rejected');

  /* ---------------- 17. Webhook retry worker ---------------- */
  step('17. Failed webhook deliveries are retried with backoff, then dead-lettered');
  const hook = { queue: [], got: [], delayMs: 0 };
  const hookServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      hook.got.push({ body, sig: req.headers['paylo-signature'] });
      if (hook.delayMs) await new Promise((r) => setTimeout(r, hook.delayMs));
      res.writeHead(hook.queue.length ? hook.queue.shift() : 200); res.end();
    });
  });
  await new Promise((r) => hookServer.listen(4012, '127.0.0.1', r));
  const HOOK_SECRET = 'whsec_retrytest';
  db.prepare("INSERT INTO webhook_endpoints (id, seller_id, url, secret, events, active) VALUES ('ep-retry', ?, 'http://127.0.0.1:4012/hook', ?, 'order.created', 1)").run(spice.id, HOOK_SECRET);
  const retry = (secret = 'dev-retry-secret') => fetch(BASE + '/api/internal/webhooks/retry', { method: 'POST', headers: secret ? { 'x-worker-secret': secret } : {} });
  const del = (id) => db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id);
  const makeDue = (id) => db.prepare("UPDATE webhook_deliveries SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?").run(id);
  const secsUntil = (ts) => Math.round((Date.parse(ts.replace(' ', 'T') + 'Z') - Date.now()) / 1000);
  const validSig = (h) => { const [, t, v] = h.sig.match(/t=(\d+),v1=([0-9a-f]+)/); return createHmac('sha256', HOOK_SECRET).update(`${t}.${h.body}`).digest('hex') === v; };

  ok((await retry(null)).status === 401 && (await retry('wrong')).status === 401, 'retry endpoint rejects callers without the worker secret');

  hook.queue.push(500);
  const whBuyer = await newPage();
  await buyNow(whBuyer, { name: 'Webhook Buyer' });
  const whOrder = await place(whBuyer);
  const d1 = db.prepare("SELECT * FROM webhook_deliveries WHERE endpoint_id = 'ep-retry' ORDER BY id DESC LIMIT 1").get();
  const eventId = JSON.parse(d1.payload).id;
  ok(d1.status === 'failed' && d1.attempts === 1 && JSON.parse(d1.payload).data.code === whOrder.code, 'first delivery failed (HTTP 500) and is recorded');
  ok(Math.abs(secsUntil(d1.next_attempt_at) - 60) <= 10, `first retry is scheduled ~1 minute out (${secsUntil(d1.next_attempt_at)}s)`);
  ok((await (await retry()).json()).retried === 0 && del(d1.id).attempts === 1, 'nothing is re-sent before it is due');

  hook.queue.push(500);
  makeDue(d1.id);
  await retry();
  ok(del(d1.id).attempts === 2 && del(d1.id).status === 'failed' && Math.abs(secsUntil(del(d1.id).next_attempt_at) - 300) <= 10, 'second failure backs off to ~5 minutes');
  makeDue(d1.id);
  await retry();
  const d1done = del(d1.id);
  ok(d1done.status === 'delivered' && d1done.attempts === 3 && d1done.next_attempt_at === null, 'third attempt succeeds; delivery marked delivered after 3 attempts');
  const sameEvent = hook.got.filter((h) => JSON.parse(h.body).id === eventId);
  ok(sameEvent.length === 3 && new Set(sameEvent.map((h) => h.body)).size === 1, 'every attempt re-sent the identical body (same event id) so receivers can de-duplicate');
  ok(sameEvent.every(validSig), 'every attempt carries a valid signature over a fresh timestamp');

  // Two workers at once must not double-send.
  hook.queue.push(500);
  const whOrder2 = await (async () => { await buyNow(whBuyer, { name: 'Race Hook' }); return place(whBuyer); })();
  const d2 = db.prepare("SELECT * FROM webhook_deliveries WHERE endpoint_id = 'ep-retry' ORDER BY id DESC LIMIT 1").get();
  const before2 = hook.got.length;
  makeDue(d2.id);
  hook.delayMs = 400;
  await Promise.all([retry(), retry(), retry()]);
  hook.delayMs = 0;
  ok(hook.got.slice(before2).filter((h) => JSON.parse(h.body).data.code === whOrder2.code).length === 1 && del(d2.id).status === 'delivered', 'three concurrent worker ticks send a due delivery exactly once');

  // Dead-letter after the last attempt.
  hook.queue.push(500);
  await buyNow(whBuyer, { name: 'Dead Hook' });
  await place(whBuyer);
  const d3 = db.prepare("SELECT * FROM webhook_deliveries WHERE endpoint_id = 'ep-retry' ORDER BY id DESC LIMIT 1").get();
  db.prepare('UPDATE webhook_deliveries SET attempts = 5 WHERE id = ?').run(d3.id);
  makeDue(d3.id);
  hook.queue.push(500);
  await retry();
  ok(del(d3.id).status === 'dead' && del(d3.id).attempts === 6 && del(d3.id).next_attempt_at === null, 'after the 6th failed attempt the delivery is dead-lettered, no more retries');

  await seller.goto(BASE + '/seller/developers');
  const cell = seller.locator(`[data-testid=delivery-${d3.id}]`);
  ok(/Gave up/.test(await cell.innerText()) && /6 attempt/.test(await cell.innerText()), 'seller sees the dead delivery and its attempt count');
  await cell.getByRole('button', { name: 'Retry now' }).click();
  await seller.waitForLoadState('networkidle');
  ok(del(d3.id).status === 'delivered', 'seller can manually retry a dead delivery once the endpoint is back');
  hookServer.close();

  /* ---------------- H. 2FA hold ---------------- */
  step('H. A live store whose seller has no 2FA is held until they turn it on');
  const spiceUserId = db.prepare('SELECT user_id FROM sellers WHERE id = ?').get(spice.id).user_id;
  // A fresh payout-eligible order: bought, collected and delivered by the courier.
  const holdBuyer = await newPage();
  await buyNow(holdBuyer, { name: 'Hold Buyer' });
  const holdOrder = await place(holdBuyer);
  await courier({ order_code: holdOrder.code, event: 'picked_up', courier: 'Paylo Rider' });
  await courier({ order_code: holdOrder.code, event: 'delivered', courier: 'Paylo Rider' });
  db.prepare("UPDATE orders SET closed_at = datetime('now', '-1 day') WHERE id = ?").run(holdOrder.id);
  const eligibleBefore = db.prepare("SELECT count(*) c FROM orders WHERE seller_id = ? AND payout_id IS NULL AND status = 'delivered' AND payment_status IN ('collected_cod','confirmed')").get(spice.id).c;
  db.prepare('UPDATE users SET totp_enabled = 0 WHERE id = ?').run(spiceUserId);
  const heldBuyer = await newPage();
  await heldBuyer.goto(BASE + '/s/spice-house');
  ok(await heldBuyer.getByText('This store is not available').count() === 1, 'storefront is hidden');
  await heldBuyer.goto(BASE + '/p/' + zaatar.id);
  ok(await heldBuyer.locator('input[name=buyer_name]').count() === 0, 'product page offers no checkout');
  await heldBuyer.goto(BASE + '/' + zCode);
  ok(await heldBuyer.locator('input[name=buyer_name]').count() === 0, 'short link leads nowhere buyable');
  await heldBuyer.goto(BASE + '/s/spice-house/about');
  ok(await heldBuyer.getByText('This store is not available').count() === 1, 'About page is hidden');
  await seller.goto(BASE + '/seller/orders');
  ok(seller.url().includes('/seller/security?hold=1') && await seller.locator('[data-testid=tfa-hold]').count() === 1, 'seller pages redirect to Security with a hold notice');
  await seller.goto(BASE + '/seller/security');
  ok(seller.url().endsWith('/seller/security'), 'Security itself stays reachable so the seller can fix it');
  ok(eligibleBefore > 0, `precondition: the store had payout-eligible orders (${eligibleBefore})`);
  await admin.goto(BASE + '/admin/payouts');
  await admin.getByRole('button', { name: "Generate this week's payouts" }).click();
  await admin.waitForURL('**/admin/payouts?generated=*');
  ok(db.prepare("SELECT count(*) c FROM orders WHERE seller_id = ? AND payout_id IS NULL AND status = 'delivered' AND payment_status IN ('collected_cod','confirmed')").get(spice.id).c === eligibleBefore, 'payout run skips the held store: its orders stay unpaid');
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(spiceUserId);
  await heldBuyer.goto(BASE + '/s/spice-house');
  ok(await heldBuyer.getByText('This store is not available').count() === 0, 'turning 2FA back on releases the hold immediately');
  await seller.goto(BASE + '/seller/orders');
  ok(seller.url().endsWith('/seller/orders'), 'seller pages unlock again');
  await admin.goto(BASE + '/admin/payouts');
  await admin.getByRole('button', { name: "Generate this week's payouts" }).click();
  await admin.waitForURL('**/admin/payouts?generated=*');
  ok(!!db.prepare('SELECT payout_id FROM orders WHERE id = ?').get(holdOrder.id).payout_id, 'once 2FA is back on, the next payout run pays the held order (so the hold was the only reason it was skipped)');

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
  gatewayServer.close();
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });

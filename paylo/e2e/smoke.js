/*
 * End-to-end smoke test for the Paylo v2 build.
 *
 * Covers: seller application → mandatory 2FA → admin approval → KYC → products with
 * variants and digital goods → cash-on-delivery checkout → hand-off/close → delivery and
 * cash collection → payout run → bank-transfer checkout with receipt review → return and
 * refund with liability → address change → digital auto-delivery → REST API → webhook
 * signatures → audit trail → Arabic RTL.
 *
 * Requires a running, seeded app:  npm run db:reset && npm run build && npm start
 * Then:  node e2e/smoke.js     (env: BASE_URL, CHROMIUM_PATH)
 */
const { chromium } = require('playwright');
const { createHmac } = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

/* --- TOTP, so the test can satisfy the mandatory second factor --- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const code = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(code % 1e6).padStart(6, '0');
}

/** Waits for text to appear rather than sampling it, so assertions never race a navigation. */
const seen = (page, text, timeout = 10000) =>
  page.getByText(text).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const deskVp = { viewport: { width: 1440, height: 950 } };
  const ctxAdmin = await browser.newContext(deskVp);
  const ctxSeller = await browser.newContext(deskVp);
  const ctxBuyer = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const admin = await ctxAdmin.newPage(), seller = await ctxSeller.newPage(), buyer = await ctxBuyer.newPage();
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
  const tag = Date.now().toString(36);
  const slug = 'e2e-' + tag;
  const email = slug + '@test.sy';
  const store = 'E2E Store ' + tag;

  step('1. Seller submits a store registration request');
  await seller.goto(BASE + '/apply');
  await seller.fill('input[name=name]', 'E2E Seller');
  await seller.fill('input[name=email]', email);
  await seller.fill('input[name=phone]', '0912345678');
  await seller.fill('input[name=national_id]', '9988' + tag.slice(-6));
  await seller.fill('input[name=password]', 'password123');
  await seller.fill('input[name=store_name]', store);
  await seller.fill('input[name=slug]', slug);
  await seller.click('button[type=submit]');
  await seller.waitForURL('**/apply/confirmation');
  ok(await seller.getByText('Registration received').count() === 1, 'confirmation screen shown, not a dashboard');
  ok(await seller.getByText('Your store is not active yet').count() === 1, 'confirmation states the store is not yet active');
  const noSession = (await ctxSeller.cookies()).find((c) => c.name === 'paylo_session');
  ok(!noSession, 'submitting does not create a session — no account exists yet');
  await shot(seller, '01-registration-confirmation');

  step('2. Login fails — no account exists until approved');
  await seller.goto(BASE + '/login');
  await seller.fill('input[name=email]', email);
  await seller.fill('input[name=password]', 'password123');
  await seller.click('button[type=submit]');
  await seller.waitForSelector('text=Wrong email or password');
  ok(true, 'no account to log into before approval');

  step('2b. Admin logs in (used later for order/dispute/payout management, unrelated to registration review)');
  await admin.goto(BASE + '/login');
  await admin.fill('input[name=email]', 'admin@paylo.sy');
  await admin.fill('input[name=password]', 'admin1234');
  await admin.click('button[type=submit]');
  await admin.waitForURL('**/admin');
  ok(true, 'admin session established for later order operations');

  step('3. Owner reviews and approves the registration');
  const owner = await browser.newContext(deskVp).then((c) => c.newPage());
  await owner.goto(BASE + '/login');
  await owner.fill('input[name=email]', 'owner@paylo.sy');
  await owner.fill('input[name=password]', 'owner-change-me-1234');
  await owner.click('button[type=submit]');
  await owner.waitForURL('**/login/2fa');
  await owner.fill('input[name=code]', totp('KRSXG5CTMVRXEZLUKN2XAZLSEBB2EWDN'));
  await owner.getByRole('button', { name: 'Log in' }).click();
  await owner.waitForURL('**/owner');
  await owner.goto(BASE + '/owner/registrations');
  ok(await seen(owner, store), 'new registration listed for the owner');
  await owner.locator('tr', { hasText: email }).getByRole('link', { name: 'View' }).click();
  ok(await seen(owner, '9988' + tag.slice(-6)), 'full national ID visible on the protected detail screen');
  await owner.getByRole('button', { name: 'Approve & create store' }).click();
  await owner.waitForSelector('span.badge:has-text("Approved")');
  ok(true, 'owner approved the registration; store is created and live immediately');
  await shot(owner, '02-owner-registration-approved');

  step('4. Seller logs in with the password chosen at registration');
  await seller.goto(BASE + '/login');
  await seller.fill('input[name=email]', email);
  await seller.fill('input[name=password]', 'password123');
  await seller.click('button[type=submit]');
  await seller.waitForURL('**/seller');
  ok(await seen(seller, 'Turn on two-factor authentication'), 'post-approval 2FA nag banner shown (approval could not gate on 2FA — no account existed yet to enable it on)');

  step('5. Enable two-factor; KYC is already approved from the registration review');
  await seller.goto(BASE + '/seller/security');
  const secret = (await seller.locator('code').first().innerText()).trim();
  ok(/^[A-Z2-7]{16,}$/.test(secret), 'enrolment secret issued');
  await seller.fill('input[name=code]', totp(secret));
  await seller.getByRole('button', { name: 'Turn on two-factor' }).click();
  await seller.waitForSelector('text=Recovery codes');
  ok(await seller.getByText('Two-factor is on').count() === 1, 'two-factor enabled');
  await seller.goto(BASE + '/seller/verification');
  ok(await seen(seller, 'Verified'), 'KYC already approved — the registration review satisfied it, no resubmission needed');
  await shot(seller, '02-2fa-enabled');

  step('6. Seller adds a product with variants and a digital product');
  await seller.goto(BASE + '/seller/products/new');
  await seller.fill('input[name=title]', 'E2E Candle');
  await seller.fill('input[name=price]', '50000');
  await seller.fill('input[name=option1_name]', 'Size');
  await seller.getByRole('button', { name: '+ Add variant' }).click();
  await seller.getByRole('button', { name: '+ Add variant' }).click();
  const rows = seller.locator('[data-variant-row]');
  await rows.nth(0).locator('input[type=text]').first().fill('Small');
  await rows.nth(0).locator('input[type=number]').nth(0).fill('50000');
  await rows.nth(0).locator('input[type=number]').nth(1).fill('4');
  await rows.nth(1).locator('input[type=text]').first().fill('Large');
  await rows.nth(1).locator('input[type=number]').nth(0).fill('80000');
  await rows.nth(1).locator('input[type=number]').nth(1).fill('2');
  await seller.setInputFiles('input[name=images]', upload('p.png'));
  await seller.getByRole('button', { name: 'Save' }).click();
  await seller.waitForURL('**/seller/products/*?saved=1');
  const productUrl = (await seller.locator('code').first().innerText()).trim();
  ok(/\/p\/[a-f0-9]+$/.test(productUrl), 'checkout link generated');
  ok(await seller.locator('img[src^="/uploads/"]').count() === 1, 'image stored');

  await seller.goto(BASE + '/seller/products/new');
  await seller.getByText('Digital', { exact: true }).click();
  await seller.fill('input[name=title]', 'E2E Guide');
  await seller.fill('input[name=price]', '30000');
  await seller.fill('textarea[name=digital_note]', 'Download: https://example.com/guide.pdf');
  await seller.getByRole('button', { name: 'Save' }).click();
  await seller.waitForURL('**/seller/products/*?saved=1');
  const digitalUrl = (await seller.locator('code').first().innerText()).trim();
  ok(digitalUrl !== productUrl, 'digital product created');
  await shot(seller, '04-seller-products');

  const rel = (u) => u.replace(/^https?:\/\/[^/]+/, BASE);

  step('7. Buyer checks out with cash on delivery');
  await buyer.goto(BASE + '/s/' + slug);
  ok(await seen(buyer, 'From'), 'storefront shows a "from" price for variants');
  await shot(buyer, '05-storefront');
  await buyer.goto(rel(productUrl));
  await buyer.selectOption('select[name=variant_id]', { index: 1 });
  await buyer.fill('input[name=buyer_name]', 'Buyer One');
  await buyer.fill('input[name=buyer_phone]', '0999888777');
  await buyer.fill('input[name=buyer_email]', 'buyer@test.sy');
  await buyer.selectOption('select[name=governorate]', 'Damascus');
  await buyer.fill('textarea[name=address]', 'Mezzeh street 5');
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  ok(await seen(buyer, 'Cash on delivery'), 'step two lists the phase-appropriate methods');
  ok(await buyer.getByText('Card', { exact: true }).count() === 0, 'card is hidden while the rail is unconfirmed');
  await shot(buyer, '06-checkout-step2');
  await buyer.getByRole('button', { name: /Place order/ }).click();
  await buyer.waitForURL('**/track/PL-*');
  const code = buyer.url().match(/PL-[A-Z0-9]+/)[0];
  ok(await buyer.locator('span.badge:has-text("Ready to fulfil")').count() >= 1, 'COD order is immediately fulfillable: ' + code);
  ok(await buyer.locator('span.badge:has-text("Open")').count() >= 1, 'commercial state is Open');
  await shot(buyer, '07-tracking-open');

  step('8. Buyer requests an address change, admin applies it');
  await buyer.locator('summary', { hasText: 'Change the delivery address' }).click();
  await buyer.selectOption('select[name=governorate]', 'Aleppo');
  await buyer.fill('textarea[name=address]', 'Aziziyeh street 9');
  await buyer.getByRole('button', { name: 'Request change' }).click();
  await buyer.waitForSelector('text=Address change requested');
  await admin.goto(BASE + '/admin/orders');
  await admin.locator('tr', { hasText: code }).getByRole('link', { name: 'View', exact: true }).click();
  await admin.getByRole('button', { name: 'Apply change' }).click();
  await admin.waitForSelector('text=Logistics partner');
  ok(await seen(admin, 'Aleppo'), 'address change moved the order to the pickup model');

  step('9. Seller hands off — the order closes');
  await seller.goto(BASE + '/seller/orders?state=open');
  await seller.locator('tr', { hasText: code }).getByRole('link', { name: 'View', exact: true }).click();
  await seller.fill('input[name=ref]', 'RIDER-1');
  await seller.fill('input[name=tracking]', 'TRK-99');
  await seller.getByRole('button', { name: 'Mark as handed off' }).click();
  await seller.waitForSelector('span.badge:has-text("Closed")');
  ok(true, 'hand-off moved the order to Closed');
  await shot(seller, '08-order-closed');

  step('10. Delivery and cash collection');
  await admin.reload();
  await admin.fill('input[name=pickup_location]', 'Aleppo — Partner office, Baron St.');
  await admin.getByRole('button', { name: 'Mark ready for pickup' }).click();
  await admin.waitForSelector('span.badge:has-text("Ready for pickup")');
  await buyer.goto(BASE + '/track/' + code);
  ok(await seen(buyer, 'Baron St.'), 'buyer sees the pickup point');
  await buyer.getByRole('button', { name: 'I received my order' }).click();
  await buyer.waitForSelector('span.badge:has-text("Delivered")');
  ok(await buyer.locator('span.badge:has-text("Cash collected")').count() >= 1, 'delivery records the cash as collected');
  await shot(buyer, '09-tracking-delivered');

  step('11. Weekly payout run');
  await admin.goto(BASE + '/admin/payouts');
  ok(await seen(admin, store), 'order is payout-eligible');
  await admin.getByRole('button', { name: "Generate this week's payouts" }).click();
  await admin.waitForURL('**/admin/payouts?generated=*');
  const row = admin.locator('tr', { hasText: store }).first();
  await row.locator('input[name=reference]').fill('TRX-' + tag);
  await row.getByRole('button', { name: 'Mark as paid' }).click();
  await admin.waitForSelector('text=TRX-' + tag);
  ok(true, 'payout generated and marked paid');
  await shot(admin, '10-admin-payouts');
  await seller.goto(BASE + '/seller/payouts');
  ok(await seen(seller, '76,000 SYP'), 'seller net = 80,000 − 5% commission');
  await shot(seller, '11-seller-payouts');

  step('12. Bank transfer: receipt upload and admin confirmation');
  await buyer.goto(rel(productUrl));
  await buyer.selectOption('select[name=variant_id]', { index: 0 });
  await buyer.fill('input[name=buyer_name]', 'Buyer Two');
  await buyer.fill('input[name=buyer_phone]', '0988777666');
  await buyer.fill('input[name=buyer_email]', 'buyer2@test.sy');
  await buyer.selectOption('select[name=governorate]', 'Damascus');
  await buyer.fill('textarea[name=address]', 'Shaalan street 3');
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  await buyer.getByText('Bank transfer', { exact: true }).click();
  ok(await buyer.getByText('Our bank details').isVisible(), 'bank details shown for a transfer');
  await buyer.getByRole('button', { name: /Place order/ }).click();
  await buyer.waitForURL('**/track/PL-*');
  const code2 = buyer.url().match(/PL-[A-Z0-9]+/)[0];
  ok(await buyer.locator('span.badge:has-text("Awaiting payment")').count() >= 1, 'transfer order waits for payment');
  await buyer.fill('input[name=reference]', 'BANK-' + tag);
  await buyer.setInputFiles('input[name=proof]', upload('receipt.png'));
  await buyer.getByRole('button', { name: 'Send for confirmation' }).click();
  await buyer.waitForSelector('text=Receipt received');
  ok(true, 'receipt submitted');
  await shot(buyer, '12-transfer-submitted');

  await seller.goto(BASE + '/seller/orders');
  await seller.locator('tr', { hasText: code2 }).getByRole('link', { name: 'View', exact: true }).click();
  ok(await seller.getByRole('button', { name: 'Mark as handed off' }).count() === 0, 'seller cannot ship before the transfer clears');

  await admin.goto(BASE + '/admin/orders');
  await admin.locator('tr', { hasText: code2 }).getByRole('link', { name: 'View', exact: true }).click();
  ok(await seen(admin, 'BANK-' + tag), 'admin sees the reference');
  await admin.getByRole('button', { name: 'Confirm payment' }).click();
  await admin.waitForSelector('span.badge:has-text("Ready to fulfil")');
  ok(true, 'transfer confirmed, order released to the seller');

  step('13. Return request refunded with liability recorded');
  await seller.reload();
  await seller.getByRole('button', { name: 'Mark as handed off' }).click();
  await seller.waitForSelector('span.badge:has-text("Closed")');
  await buyer.goto(BASE + '/track/' + code2);
  await buyer.locator('summary', { hasText: 'Report a problem' }).click();
  await buyer.selectOption('select[name=reason]', 'damaged');
  await buyer.fill('textarea[name=description]', 'Arrived cracked');
  await buyer.getByRole('button', { name: 'Submit report' }).click();
  await buyer.waitForSelector('text=A report is open');
  await admin.goto(BASE + '/admin/disputes');
  const card = admin.locator('div.card-pad', { hasText: code2 }).first();
  await card.locator('select[name=resolution]').selectOption('refund');
  await card.locator('select[name=liability]').selectOption('logistics');
  await card.locator('textarea[name=note]').fill('Damaged in transit, recovering from the partner');
  await card.getByRole('button', { name: 'Resolve' }).click();
  await admin.waitForURL('**/admin/disputes');
  await buyer.reload();
  ok(await buyer.locator('span.badge:has-text("Returned")').count() >= 1, 'refund after fulfilment lands in Returned');
  await shot(buyer, '13-returned');

  step('14. Digital order delivers itself on payment');
  await buyer.goto(rel(digitalUrl));
  await buyer.fill('input[name=buyer_name]', 'Buyer Three');
  await buyer.fill('input[name=buyer_phone]', '0977666555');
  await buyer.fill('input[name=buyer_email]', 'buyer3@test.sy');
  ok(await buyer.locator('textarea[name=address]').count() === 0, 'digital checkout asks for no shipping address');
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  ok(await buyer.getByText('Cash on delivery').count() === 0, 'cash on delivery is not offered for digital goods');
  await buyer.getByRole('button', { name: /Place order/ }).click();
  await buyer.waitForURL('**/track/PL-*');
  const code3 = buyer.url().match(/PL-[A-Z0-9]+/)[0];
  await admin.goto(BASE + '/admin/orders');
  await admin.locator('tr', { hasText: code3 }).getByRole('link', { name: 'View', exact: true }).click();
  await admin.getByRole('button', { name: 'Confirm payment' }).click();
  await admin.waitForSelector('span.badge:has-text("Delivered")');
  ok(true, 'digital order auto-delivered on confirmation');

  step('15. Two-factor is enforced at login');
  await seller.goto(BASE + '/logout');
  await seller.goto(BASE + '/login');
  await seller.fill('input[name=email]', email);
  await seller.fill('input[name=password]', 'password123');
  await seller.click('button[type=submit]');
  await seller.waitForURL('**/login/2fa');
  ok(true, 'password alone stops at the second factor');
  await seller.fill('input[name=code]', '000000');
  await seller.getByRole('button', { name: 'Log in' }).click();
  await seller.waitForSelector('text=That code did not match');
  ok(true, 'a wrong code is rejected');
  await seller.fill('input[name=code]', totp(secret));
  await seller.getByRole('button', { name: 'Log in' }).click();
  await seller.waitForURL('**/seller');
  ok(true, 'a valid code completes the login');

  step('16. REST API');
  await seller.goto(BASE + '/seller/developers');
  await seller.fill('input[name=name]', 'e2e');
  await seller.getByRole('button', { name: 'Create token' }).click();
  await seller.waitForSelector('text=Copy this token now');
  const token = (await seller.locator('code', { hasText: /^plo_/ }).first().innerText()).trim();
  ok(token.startsWith('plo_'), 'API token issued');
  const unauth = await seller.request.get(BASE + '/api/v1/orders');
  ok(unauth.status() === 401, 'API rejects an unauthenticated request');
  const apiRes = await seller.request.get(BASE + '/api/v1/orders?state=closed', { headers: { authorization: 'Bearer ' + token } });
  const apiJson = await apiRes.json();
  ok(apiRes.status() === 200 && Array.isArray(apiJson.data), 'API lists orders');
  ok(apiJson.data.every((o) => o.state === 'closed'), 'API honours the state filter');
  ok(!JSON.stringify(apiJson).includes('card_last4'), 'API response carries no card fields');
  const meRes = await seller.request.get(BASE + '/api/v1/me', { headers: { authorization: 'Bearer ' + token } });
  const me = await meRes.json();
  ok(me.kyc_status === 'approved' && me.balances.lifetime > 0, 'API reports balances');

  step('17. Webhook delivery and signature');
  // A real receiver, so the HMAC is verified over the bytes Paylo actually sends.
  const received = [];
  const hookServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { received.push({ headers: req.headers, raw }); res.writeHead(200).end('ok'); });
  });
  await new Promise((r) => hookServer.listen(4599, '127.0.0.1', r));

  await seller.goto(BASE + '/seller/developers');
  await seller.fill('input[name=url]', 'http://127.0.0.1:4599/hook');
  await seller.getByRole('button', { name: 'Add endpoint' }).click();
  await seller.waitForSelector('text=whsec_');
  const whsec = (await seller.locator('code', { hasText: /^whsec_/ }).first().innerText()).trim();
  ok(whsec.startsWith('whsec_'), 'endpoint created with a signing secret');

  // Place an order so the endpoint fires for real.
  await buyer.goto(rel(productUrl));
  await buyer.selectOption('select[name=variant_id]', { index: 0 });
  await buyer.fill('input[name=buyer_name]', 'Buyer Four');
  await buyer.fill('input[name=buyer_phone]', '0966555444');
  await buyer.selectOption('select[name=governorate]', 'Damascus');
  await buyer.fill('textarea[name=address]', 'Malki street 1');
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  await buyer.getByRole('button', { name: /Place order/ }).click();
  await buyer.waitForURL('**/track/PL-*');

  for (let i = 0; i < 40 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 250));
  hookServer.close();
  ok(received.length > 0, `endpoint received ${received.length} delivery/deliveries`);
  const hook = received[0];
  ok(hook.headers['paylo-event'] === 'order.created', 'event name sent in the header');
  const parts = Object.fromEntries(String(hook.headers['paylo-signature']).split(',').map((x) => x.split('=')));
  const expect = createHmac('sha256', whsec).update(`${parts.t}.${hook.raw}`).digest('hex');
  ok(expect === parts.v1, 'HMAC-SHA256 over "<timestamp>.<raw body>" verifies against the endpoint secret');
  const tampered = createHmac('sha256', whsec).update(`${parts.t}.${hook.raw}x`).digest('hex');
  ok(tampered !== parts.v1, 'a modified body no longer matches the signature');
  ok(JSON.parse(hook.raw).data.code.startsWith('PL-'), 'payload carries the order');
  await seller.goto(BASE + '/seller/developers');
  ok(await seen(seller, 'delivered'), 'delivery is recorded in the dashboard');

  step('18. Audit trail and notifications');
  await admin.goto(BASE + '/admin/audit');
  const auditRows = await admin.locator('tbody tr').count();
  ok(auditRows >= 15, `audit trail recorded ${auditRows} entries`);
  ok(await seen(admin, 'store_registration_request'), 'registration approval decision is in the audit trail');
  await shot(admin, '14-audit');
  await admin.goto(BASE + '/admin/notifications?channel=sms');
  ok(await admin.locator('tbody tr').count() >= 3, 'SMS notifications were queued');
  await shot(admin, '15-notifications');

  step('19. Arabic RTL');
  await buyer.goto(BASE + '/track/' + code);
  await buyer.getByRole('button', { name: 'العربية' }).click();
  await buyer.waitForSelector('html[dir=rtl]');
  ok(await seen(buyer, 'تتبّع الطلب'), 'tracking page renders in Arabic, right to left');
  ok(await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow in RTL');
  await shot(buyer, '16-arabic');

  await browser.close();
  console.log(`\nALL PASSED — ${passed} assertions`);
})().catch(async (e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });

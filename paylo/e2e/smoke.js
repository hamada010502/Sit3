/* End-to-end smoke test: seller application → admin approval → product → checkout → hand-off → delivery → dispute/refund → payout → Arabic RTL.
 * Requires a running app (npm run build && npm start) seeded with `npm run seed`, and Playwright: `npm i -g playwright && npx playwright install chromium`.
 * Run: node e2e/smoke.js   (env: BASE_URL, CHROMIUM_PATH) */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓ ' + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctxAdmin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxSeller = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxBuyer = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const admin = await ctxAdmin.newPage(), seller = await ctxSeller.newPage(), buyer = await ctxBuyer.newPage();
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });

  console.log('1. New seller applies');
  const slug = 'e2e-' + Date.now().toString(36);
  await seller.goto(BASE + '/apply');
  await seller.fill('input[name=name]', 'E2E Seller'); await seller.fill('input[name=email]', slug + '@test.sy');
  await seller.fill('input[name=password]', 'password123'); await seller.fill('input[name=store_name]', 'E2E Store');
  await seller.fill('input[name=slug]', slug); await seller.fill('input[name=phone]', '0912345678');
  await seller.click('button[type=submit]'); await seller.waitForURL('**/seller');
  ok(await seller.locator('text=Application under review').count() === 1, 'pending screen shown');
  await shot(seller, '01-seller-pending');

  console.log('2. Admin approves');
  await admin.goto(BASE + '/login'); await admin.fill('input[name=email]', 'admin@paylo.sy'); await admin.fill('input[name=password]', 'admin1234');
  await admin.click('button[type=submit]'); await admin.waitForURL('**/admin');
  await shot(admin, '02-admin-dashboard');
  await admin.goto(BASE + '/admin/sellers?status=pending');
  await admin.locator('tr', { hasText: slug + '@test.sy' }).getByText('View').click();
  await admin.locator('form', { has: admin.getByRole('button', { name: 'Approve' }) }).locator('input[name=note]').fill('Welcome aboard');
  await admin.getByRole('button', { name: 'Approve' }).click();
  await admin.waitForSelector('span.badge:has-text("Approved")');
  ok(true, 'seller approved');

  console.log('3. Seller creates product with image');
  await seller.goto(BASE + '/seller/products/new');
  await seller.fill('input[name=title]', 'E2E Candle'); await seller.fill('input[name=price]', '50000'); await seller.fill('input[name=stock]', '2');
  await seller.fill('textarea[name=description]', 'Test product');
  // tiny PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await seller.setInputFiles('input[name=images]', { name: 'a.png', mimeType: 'image/png', buffer: png });
  await seller.click('button[type=submit]'); await seller.waitForURL('**/seller/products/*?saved=1');
  const productUrl = await seller.locator('code').first().innerText();
  ok(/\/p\/[a-f0-9]+$/.test(productUrl), 'checkout link generated: ' + productUrl);
  ok((await seller.locator('img[src^="/uploads/"]').count()) === 1, 'image uploaded');
  const imgSrc = await seller.locator('img[src^="/uploads/"]').getAttribute('src');
  const imgRes = await seller.request.get(BASE + imgSrc);
  ok(imgRes.status() === 200 && imgRes.headers()['content-type'] === 'image/png', 'uploaded image served at runtime');
  await shot(seller, '03-seller-product');

  console.log('4. Buyer: storefront + declined card + successful payment');
  await buyer.goto(BASE + '/s/' + slug);
  ok(await buyer.locator('text=E2E Candle').count() === 1, 'storefront lists product');
  await shot(buyer, '04-storefront-mobile');
  await buyer.goto(productUrl.replace(/^https?:\/\/[^/]+/, BASE));
  const fillCheckout = async (card) => {
    await buyer.fill('input[name=buyer_name]', 'Buyer One'); await buyer.fill('input[name=buyer_phone]', '0999888777');
    await buyer.fill('input[name=buyer_email]', 'buyer@test.sy'); await buyer.selectOption('select[name=governorate]', 'Aleppo');
    await buyer.fill('textarea[name=address]', 'Aziziyeh street 5'); await buyer.fill('input[name=card_number]', card);
    await buyer.fill('input[name=card_holder]', 'BUYER ONE'); await buyer.fill('input[name=card_exp]', '12/29'); await buyer.fill('input[name=card_cvc]', '123');
  };
  await fillCheckout('4000 0000 0000 0002');
  ok((await buyer.locator('text=25,000 SYP').count()) >= 1, 'non-Damascus delivery fee applied');
  await buyer.click('button[type=submit]');
  await buyer.waitForSelector('text=Payment declined');
  ok(await buyer.locator('text=Insufficient funds').count() === 1, 'declined card handled');
  await shot(buyer, '05-checkout-declined');
  await fillCheckout('5555 5555 5555 4444');
  await buyer.click('button[type=submit]'); await buyer.waitForURL('**/track/PL-*');
  const code = buyer.url().match(/PL-[A-Z0-9]+/)[0];
  ok(await buyer.locator('text=Payment confirmed').count() >= 1, 'order paid: ' + code);
  await shot(buyer, '06-tracking-paid');

  console.log('5. Seller sees order, stock decremented, hands off');
  await seller.goto(BASE + '/seller');
  ok(await seller.locator('text=' + code).count() === 1, 'order on seller dashboard');
  await seller.locator('tr', { hasText: code }).getByText('View').click();
  await seller.fill('input[name=ref]', 'SHP-123'); await seller.getByRole('button', { name: 'Mark as handed off' }).click();
  await seller.waitForSelector('span.badge:has-text("Handed off")');
  ok(true, 'handed off');
  await shot(seller, '07-seller-order-handed-off');

  console.log('6. Admin: ready for pickup, buyer sees it, then delivered');
  await admin.goto(BASE + '/admin/orders');
  await admin.locator('tr', { hasText: code }).getByText('View').click();
  await admin.fill('input[name=pickup_location]', 'Aleppo — Partner office, Baron St.'); await admin.getByRole('button', { name: 'Mark ready for pickup' }).click();
  await admin.waitForSelector('span.badge:has-text("Ready for pickup")');
  await buyer.reload();
  ok(await buyer.locator('text=Baron St.').count() >= 1, 'buyer sees pickup location');
  await shot(buyer, '08-tracking-ready');
  await buyer.getByRole('button', { name: 'I received my order' }).click();
  await buyer.waitForSelector('span.badge:has-text("Delivered")');
  ok(true, 'buyer confirmed delivery');

  console.log('7. Dispute → admin refund');
  await buyer.locator('summary', { hasText: 'Report a problem' }).click();
  await buyer.selectOption('select[name=reason]', 'damaged'); await buyer.fill('textarea[name=description]', 'Cracked');
  await buyer.getByRole('button', { name: 'Submit report' }).click();
  await buyer.waitForSelector('text=A report is open');
  await admin.goto(BASE + '/admin/disputes');
  ok(await admin.locator('text=' + code).count() >= 1, 'dispute visible to admin');
  await shot(admin, '09-admin-disputes');
  const card = admin.locator('div.card-pad', { hasText: code });
  await card.locator('select[name=resolution]').selectOption('refund'); await card.locator('select[name=liability]').selectOption('logistics');
  await card.locator('textarea[name=note]').fill('Damaged in transit, recovering from partner');
  await card.getByRole('button', { name: 'Resolve' }).click();
  await admin.waitForURL('**/admin/disputes'); await admin.goto(BASE + '/admin/disputes?all=1'); await admin.waitForSelector('text=Resolved — refunded');
  await buyer.reload();
  ok(await buyer.locator('text=refunded to your card').count() >= 1, 'buyer sees refund');
  await shot(buyer, '10-tracking-refunded');

  console.log('8. Second order (Damascus) → delivered → payout');
  await buyer.goto(productUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await fillCheckout('5555 5555 5555 4444'); await buyer.selectOption('select[name=governorate]', 'Damascus');
  await buyer.click('button[type=submit]'); await buyer.waitForURL('**/track/PL-*');
  const code2 = buyer.url().match(/PL-[A-Z0-9]+/)[0];
  await seller.goto(BASE + '/seller/orders?status=paid');
  await seller.locator('tr', { hasText: code2 }).getByText('View').click();
  await seller.getByRole('button', { name: 'Mark as handed off' }).click(); await seller.waitForSelector('span.badge:has-text("Handed off")');
  await admin.goto(BASE + '/admin/orders'); await admin.locator('tr', { hasText: code2 }).getByText('View').click();
  await admin.getByRole('button', { name: 'Outsource to Yalla Go' }).click(); await admin.waitForSelector('text=Yalla Go courier');
  await admin.getByRole('button', { name: 'Mark in transit' }).click(); await admin.waitForSelector('span.badge:has-text("In transit")');
  await admin.getByRole('button', { name: 'Mark delivered' }).click(); await admin.waitForSelector('span.badge:has-text("Delivered")');
  await shot(admin, '11-admin-order-delivered');
  await seller.goto(BASE + '/seller/products');
  ok(await seller.locator('text=Out of stock').count() === 1, 'stock hit zero → auto out_of_stock');
  await admin.goto(BASE + '/admin/payouts');
  ok(await admin.locator('text=E2E Store').count() >= 1, 'order eligible for payout');
  await admin.getByRole('button', { name: "Generate this week's payouts" }).click();
  await admin.waitForURL('**/admin/payouts?generated=*');
  await admin.locator('tr', { hasText: 'E2E Store' }).locator('input[name=reference]').fill('TRX-1');
  await admin.locator('tr', { hasText: 'E2E Store' }).getByRole('button', { name: 'Mark as paid' }).click();
  await admin.waitForSelector('text=TRX-1');
  await shot(admin, '12-admin-payouts');
  await seller.goto(BASE + '/seller/payouts');
  ok(await seller.locator('text=46,250 SYP').count() >= 1, 'seller net = 50,000 − 7.5% = 46,250');
  await shot(seller, '13-seller-payouts');

  console.log('9. Arabic / RTL');
  await buyer.goto(BASE + '/track/' + code2);
  await buyer.getByRole('button', { name: 'العربية' }).click();
  await buyer.waitForSelector('html[dir=rtl]');
  ok(await buyer.locator('text=تتبّع الطلب').count() === 1, 'Arabic tracking page in RTL');
  await shot(buyer, '14-tracking-arabic');
  await admin.goto(BASE + '/admin/emails');
  const n = await admin.locator('tbody tr').count();
  ok(n >= 8, 'email log has ' + n + ' notifications');
  await shot(admin, '15-admin-emails');
  await browser.close();
  console.log('\nALL PASSED');
})().catch(async (e) => { console.error('FAILED:', e.message); process.exit(1); });

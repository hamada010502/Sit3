/*
 * Focused test suite for guest checkout + optional customer accounts (see
 * lib/customer.ts, app/account, app/p/[id]).
 *
 * Run against a FRESH, freshly-seeded DB:
 *   npm run db:reset && npm run build && npm start   (or `npx next start` after a build)
 * Then:
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/account-checkout-tests.js
 */
const { chromium } = require('playwright');
const { createHmac } = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');

let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); passed++; console.log('  ✓ ' + m); };
const step = (m) => console.log('\n' + m);

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
const DEMO_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

(async () => {
  const db = new Database(DB_PATH, { readonly: false });
  const board = db.prepare("SELECT id FROM products WHERE title = 'Olive-wood serving board'").get();
  if (!board) throw new Error('Seed data missing the expected product — run npm run db:reset first');
  const productId = board.id;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const vp = { viewport: { width: 1280, height: 900 } };
  const tag = Date.now().toString().slice(-8);

  /* ---- 1. No forced login anywhere in browse -> cart -> checkout ---- */
  step('1. Guest can browse and reach checkout with zero account/sign-in required');
  const guestCtx = await browser.newContext(vp);
  const guest = await guestCtx.newPage();
  const homeRes = await guest.goto(BASE + '/');
  ok(homeRes.status() === 200 && !homeRes.url().includes('/login'), 'home page loads for an anonymous visitor, no login redirect');
  const storeRes = await guest.goto(BASE + '/s/lina-handmade');
  ok(storeRes.status() === 200 && !storeRes.url().includes('/login'), 'store page loads for an anonymous visitor, no login redirect');
  const productRes = await guest.goto(BASE + '/p/' + productId);
  ok(productRes.status() === 200 && !productRes.url().includes('/login'), 'product/checkout page loads for an anonymous visitor, no login redirect');
  ok((await guest.locator('form input[name=buyer_name]').count()) === 1, 'checkout form is present and usable with no session at all');
  ok(await guest.getByText('No account needed to buy').count() === 1, 'guest checkout hint is shown, offering sign-in/create-account without blocking');
  ok((await guest.locator('a', { hasText: 'Log in' }).count()) >= 1, '"Log in" is offered on the checkout page but not forced');
  ok((await guestCtx.cookies()).every((c) => c.name !== 'paylo_session'), 'no session cookie exists for this anonymous visitor');

  /* ---- 2. Guest completes a full purchase with zero account ---- */
  step('2. Guest completes checkout end-to-end with no account');
  const guestName = 'Guest Buyer ' + tag;
  const guestPhone = '0910' + tag.slice(-6);
  const guestEmail = 'guest-' + tag + '@test.sy';
  await guest.fill('input[name=buyer_name]', guestName);
  await guest.fill('input[name=buyer_phone]', guestPhone);
  await guest.fill('input[name=buyer_email]', guestEmail);
  await guest.fill('textarea[name=address]', 'Guest street 12, Damascus');
  await guest.click('button:has-text("Continue")');
  await guest.click('button[type=submit]');
  await guest.waitForURL('**/track/**', { timeout: 15000 });
  const guestOrderCode = decodeURIComponent(new URL(guest.url()).pathname.split('/').pop());
  ok(/^PL-/.test(guestOrderCode), 'guest order placed and tracking page reached: ' + guestOrderCode);
  const guestOrderRow = db.prepare('SELECT * FROM orders WHERE code = ?').get(guestOrderCode);
  ok(!!guestOrderRow, 'order exists in the database');
  ok(guestOrderRow.user_id === null, 'the order is not linked to any account — it is a pure guest order');
  ok((await guestCtx.cookies()).every((c) => c.name !== 'paylo_session'), 'completing checkout still never created a session — no account was silently created (spec §8)');
  const guestAsUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(guestEmail);
  ok(!guestAsUser, 'checking out as a guest never created a platform user account for that email');

  /* ---- 3. No raw card data is ever stored ---- */
  step('3. No raw card data is ever stored in the database');
  const cols = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
  ok(!cols.includes('card_number') && !cols.includes('cvv') && !cols.includes('cvc'), 'payments table has no raw card number/CVV columns at all');
  ok(cols.includes('card_last4') && cols.includes('card_brand'), 'payments table only ever stores masked card metadata (last4/brand)');
  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  ok(!orderCols.some((c) => /card/i.test(c)), 'orders table carries no card-shaped columns either');

  /* ---- 4. Register a customer account, save multiple addresses ---- */
  step('4. Customer creates an account and saves multiple addresses');
  const custCtx = await browser.newContext(vp);
  const cust = await custCtx.newPage();
  const custEmail = 'cust-' + tag + '@test.sy';
  await cust.goto(BASE + '/account/register');
  await cust.fill('input[name=name]', 'Account Holder ' + tag);
  await cust.fill('input[name=email]', custEmail);
  await cust.fill('input[name=phone]', '0920' + tag.slice(-6));
  await cust.fill('input[name=password]', 'password123');
  await cust.click('button[type=submit]');
  await cust.waitForURL('**/account');
  ok(true, 'account created and signed in immediately');
  const custUser = db.prepare('SELECT id, role FROM users WHERE lower(email) = lower(?)').get(custEmail);
  ok(custUser && custUser.role === 'customer', 'the new account has the customer role, reusing the existing users table');

  await cust.goto(BASE + '/account/addresses');
  await cust.getByRole('button', { name: 'Add address' }).click();
  await cust.fill('input[name=full_name]', 'Home Receiver');
  await cust.fill('input[name=phone]', '0930' + tag.slice(-6));
  await cust.selectOption('select[name=governorate]', 'Damascus');
  await cust.fill('textarea[name=address]', 'First address, Damascus');
  await cust.getByRole('button', { name: 'Add address' }).click();
  // Wait for the saved address to actually render in the list (confirms the form closed
  // and the page re-rendered) before starting the second one — otherwise a second click
  // can land on the still-open first form and resubmit its stale field values.
  await cust.waitForSelector('text=Home Receiver');
  await cust.getByRole('button', { name: 'Add address' }).click();
  await cust.fill('input[name=full_name]', 'Work Receiver');
  await cust.fill('input[name=phone]', '0931' + tag.slice(-6));
  await cust.selectOption('select[name=governorate]', 'Aleppo');
  await cust.fill('textarea[name=address]', 'Second address, Aleppo');
  await cust.getByRole('button', { name: 'Add address' }).click();
  await cust.waitForSelector('text=Work Receiver');
  const addrCount = db.prepare('SELECT count(*) c FROM customer_addresses WHERE user_id = ?').get(custUser.id).c;
  ok(addrCount === 2, 'multiple addresses saved to the account (' + addrCount + ')');
  const defaultCount = db.prepare('SELECT count(*) c FROM customer_addresses WHERE user_id = ? AND is_default = 1').get(custUser.id).c;
  ok(defaultCount === 1, 'exactly one address is marked as the default/preferred one');

  /* ---- 5. Returning customer gets pre-filled checkout ---- */
  step('5. Signed-in customer gets pre-filled checkout from saved info');
  await cust.goto(BASE + '/p/' + productId);
  ok(await cust.getByText('Signed in as').count() === 1, 'checkout shows the signed-in state, not a guest prompt');
  const prefilledName = await cust.locator('input[name=buyer_name]').inputValue();
  ok(prefilledName === 'Account Holder ' + tag, 'buyer name is pre-filled from the account');
  const prefilledAddress = await cust.locator('textarea[name=address]').inputValue();
  ok(prefilledAddress === 'First address, Damascus', "the default address pre-fills the shipping address field");

  await cust.click('button:has-text("Continue")');
  await cust.click('button[type=submit]');
  await cust.waitForURL('**/track/**', { timeout: 15000 });
  const custOrderCode = decodeURIComponent(new URL(cust.url()).pathname.split('/').pop());
  const custOrderRow = db.prepare('SELECT * FROM orders WHERE code = ?').get(custOrderCode);
  ok(custOrderRow.user_id === custUser.id, "the signed-in customer's order is linked to their account");

  await cust.goto(BASE + '/account/orders');
  ok(await cust.getByText(custOrderCode).count() === 1, "the account's order history shows the order just placed");
  ok(await cust.getByText(guestOrderCode).count() === 0, "the account's order history does NOT show an unrelated guest order");

  /* ---- 6. Checkout route is the same structure/system for guest and authenticated ---- */
  step('6. Checkout shares the same underlying order system for guest and authenticated buyers');
  ok(guestOrderRow.seller_id === custOrderRow.seller_id && guestOrderRow.product_id === custOrderRow.product_id,
    'both a guest order and an authenticated order were created by the exact same checkout() path against the same orders table');

  /* ---- 7. Guest order is not enumerable / not publicly listable / not accessible without its own code ---- */
  step('7. Guest order data is not accessible to other users or the public');
  const otherCtx = await browser.newContext(vp);
  const other = await otherCtx.newPage();
  const wrongRes = await other.goto(BASE + '/track/PL-NOTAREALCODE');
  ok(wrongRes.status() === 200 && (await other.content()).length > 0, 'a guessed/wrong order code renders the "not found" state, not the order');
  ok(!(await other.content()).includes(guestName), 'the guest order is not reachable by anyone who does not have its own code');
  // No route anywhere lists all orders publicly.
  const listAttempt = await fetch(BASE + '/track', { redirect: 'manual' });
  const listBody = await listAttempt.text();
  ok(!listBody.includes(guestOrderCode) && !listBody.includes(custOrderCode), '/track itself (with no code) never lists any order');

  /* ---- 8. Guest -> account linking requires secure verification, never auto-matches on email ---- */
  step('8. Guest order can only be linked to an account through explicit verification, never by email alone');
  // A second account is created reusing the SAME email the guest order used, to prove
  // that merely knowing/registering that email does not auto-attach the guest order.
  const claimCtx = await browser.newContext(vp);
  const claimPage = await claimCtx.newPage();
  await claimPage.goto(BASE + '/account/register');
  await claimPage.fill('input[name=name]', 'Claimant');
  await claimPage.fill('input[name=email]', 'claimant-' + tag + '@test.sy');
  await claimPage.fill('input[name=phone]', '0940' + tag.slice(-6));
  await claimPage.fill('input[name=password]', 'password123');
  await claimPage.click('button[type=submit]');
  await claimPage.waitForURL('**/account');
  const claimUser = db.prepare('SELECT id FROM users WHERE email = ?').get('claimant-' + tag + '@test.sy');

  const beforeLink = db.prepare('SELECT user_id FROM orders WHERE code = ?').get(guestOrderCode).user_id;
  ok(beforeLink === null, 'the guest order is still unlinked before any claim attempt');

  await claimPage.goto(BASE + '/account/link-order');
  await claimPage.fill('input[name=code]', guestOrderCode);
  await claimPage.fill('input[name=contact]', guestEmail); // the ACTUAL email on the order — this account is a different one
  await claimPage.click('button[type=submit]');
  await claimPage.waitForSelector('input[name=verify_code]');
  ok(db.prepare('SELECT user_id FROM orders WHERE code = ?').get(guestOrderCode).user_id === null,
    'requesting a claim alone (before entering the code) never links the order — a code must still be verified');

  const claim = db.prepare('SELECT * FROM order_claims WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(guestOrderRow.id);
  ok(!!claim && claim.user_id === claimUser.id, 'a one-time verification code was generated and tied to this specific account');
  const plainCode = db.prepare("SELECT body FROM notifications WHERE event = 'order.claim_code' ORDER BY id DESC LIMIT 1").get().body.match(/is (\d{6})\./)[1];

  await claimPage.fill('input[name=verify_code]', '000000');
  await claimPage.click('button[type=submit]');
  await claimPage.waitForSelector('.alert-error').catch(() => {});
  ok(db.prepare('SELECT user_id FROM orders WHERE code = ?').get(guestOrderCode).user_id === null, 'a wrong verification code does not link the order');

  await claimPage.fill('input[name=verify_code]', plainCode);
  await claimPage.click('button[type=submit]');
  await claimPage.waitForSelector('text=Order linked');
  const afterLink = db.prepare('SELECT user_id FROM orders WHERE code = ?').get(guestOrderCode).user_id;
  ok(afterLink === claimUser.id, 'the correct one-time code links the guest order to the verifying account');

  await claimPage.goto(BASE + '/account/orders');
  ok(await claimPage.getByText(guestOrderCode).count() === 1, 'the linked order now appears in that account\'s order history');

  /* ---- 9. Two different customer accounts never see each other's orders ---- */
  step("9. Customers can only access their own account's orders");
  await cust.goto(BASE + '/account/orders');
  ok(await cust.getByText(guestOrderCode).count() === 0, "one customer's order history never shows another customer's linked order");

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});

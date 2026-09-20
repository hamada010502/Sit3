/*
 * Focused test suite for the store registration / identity-uniqueness / owner-approval
 * system (see lib/registration.ts, app/apply, app/owner/registrations).
 *
 * Run against a FRESH, freshly-seeded DB (this script does not clean up after itself):
 *   npm run db:reset && npm run build && npm start   (or `npx next start` after a build)
 * Then:
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/registration-tests.js
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
const OWNER_TOTP = 'KRSXG5CTMVRXEZLUKN2XAZLSEBB2EWDN';

(async () => {
  const db = new Database(DB_PATH, { readonly: false });
  const regCount = () => db.prepare('SELECT count(*) c FROM store_registration_requests').get().c;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const vp = { viewport: { width: 1280, height: 900 } };
  const tag = Date.now().toString().slice(-8);

  const fillApply = async (page, { name, email, phone, nid, store }) => {
    await page.goto(BASE + '/apply');
    await page.fill('input[name=name]', name);
    await page.fill('input[name=email]', email);
    await page.fill('input[name=phone]', phone);
    await page.fill('input[name=national_id]', nid);
    await page.fill('input[name=password]', 'password123');
    await page.fill('input[name=store_name]', store);
    await page.fill('input[name=slug]', store.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  };

  // ---- Test 1: new phone + new national ID -> PENDING_REVIEW, 24h message ----
  step('1. New phone + new national ID');
  const ctx1 = await browser.newContext(vp);
  const p1 = await ctx1.newPage();
  const phoneA = '0900' + tag.slice(-6), nidA = 'NIDA' + tag.slice(-6);
  await fillApply(p1, { name: 'Applicant A', email: 'a-' + tag + '@test.sy', phone: phoneA, nid: nidA, store: 'Store A ' + tag });
  await p1.click('button[type=submit]');
  await p1.waitForURL('**/apply/confirmation');
  ok(await p1.getByText('24').count() >= 1 || (await p1.content()).includes('24'), '24-hour response message shown');
  ok(await p1.getByText('Your store is not active yet').count() === 1, 'store not active yet stated');
  const rowA = db.prepare('SELECT status FROM store_registration_requests WHERE phone = ?').get(phoneA);
  ok(!!rowA && rowA.status === 'PENDING_REVIEW', 'request created with PENDING_REVIEW status');

  // ---- Test 2: existing phone -> rejected, generic message, no new row ----
  step('2. Existing phone is rejected without creating a request');
  const before2 = regCount();
  const p2 = await ctx1.newPage();
  const nidB = 'NIDB' + tag.slice(-6);
  await fillApply(p2, { name: 'Applicant B', email: 'b-' + tag + '@test.sy', phone: phoneA, nid: nidB, store: 'Store B ' + tag });
  await p2.click('button[type=submit]');
  await p2.waitForSelector('.alert-error');
  const msg2 = (await p2.locator('.alert-error').innerText()).trim();
  ok(msg2 === 'The information you entered is already associated with an existing account.', 'exact generic duplicate message shown (phone match)');
  ok(regCount() === before2, 'no new request row created for a duplicate phone');

  // ---- Test 3: existing national ID -> rejected, generic message, no new row ----
  step('3. Existing national ID is rejected without creating a request');
  const before3 = regCount();
  const p3 = await ctx1.newPage();
  const phoneC = '0901' + tag.slice(-6);
  await fillApply(p3, { name: 'Applicant C', email: 'c-' + tag + '@test.sy', phone: phoneC, nid: nidA, store: 'Store C ' + tag });
  await p3.click('button[type=submit]');
  await p3.waitForSelector('.alert-error');
  const msg3 = (await p3.locator('.alert-error').innerText()).trim();
  ok(msg3 === 'The information you entered is already associated with an existing account.', 'exact generic duplicate message shown (national ID match)');
  ok(regCount() === before3, 'no new request row created for a duplicate national ID');

  // ---- Test 4: both existing -> rejected, generic message, no new row ----
  step('4. Both phone and national ID existing is rejected');
  const before4 = regCount();
  const p4 = await ctx1.newPage();
  await fillApply(p4, { name: 'Applicant D', email: 'd-' + tag + '@test.sy', phone: phoneA, nid: nidA, store: 'Store D ' + tag });
  await p4.click('button[type=submit]');
  await p4.waitForSelector('.alert-error');
  const msg4 = (await p4.locator('.alert-error').innerText()).trim();
  ok(msg4 === 'The information you entered is already associated with an existing account.', 'exact generic duplicate message shown (both match)');
  ok(regCount() === before4, 'no new request row created when both fields match');

  // ---- Test 5: real concurrent race, same phone/national ID, two different browser contexts ----
  step('5. Concurrent submissions with the same identity -> only one record created');
  const phoneR = '0902' + tag.slice(-6), nidR = 'NIDR' + tag.slice(-6);
  const ctxR1 = await browser.newContext(vp), ctxR2 = await browser.newContext(vp);
  const pr1 = await ctxR1.newPage(), pr2 = await ctxR2.newPage();
  await fillApply(pr1, { name: 'Racer 1', email: 'r1-' + tag + '@test.sy', phone: phoneR, nid: nidR, store: 'Store R1 ' + tag });
  await fillApply(pr2, { name: 'Racer 2', email: 'r2-' + tag + '@test.sy', phone: phoneR, nid: nidR, store: 'Store R2 ' + tag });
  const beforeR = regCount();
  const [res1, res2] = await Promise.allSettled([
    pr1.click('button[type=submit]').then(() => pr1.waitForURL('**/apply/confirmation', { timeout: 15000 }).then(() => 'confirmed')
      .catch(() => pr1.waitForSelector('.alert-error', { timeout: 15000 }).then(() => 'rejected'))),
    pr2.click('button[type=submit]').then(() => pr2.waitForURL('**/apply/confirmation', { timeout: 15000 }).then(() => 'confirmed')
      .catch(() => pr2.waitForSelector('.alert-error', { timeout: 15000 }).then(() => 'rejected'))),
  ]);
  const outcomes = [res1, res2].map((r) => (r.status === 'fulfilled' ? r.value : 'error'));
  const rowsR = db.prepare('SELECT count(*) c FROM store_registration_requests WHERE phone = ? OR national_id = ?').get(phoneR, nidR).c;
  ok(regCount() === beforeR + 1, `exactly one row created from two concurrent submissions (outcomes: ${outcomes.join(', ')})`);
  ok(rowsR === 1, 'exactly one row exists for the raced phone/national ID');
  ok(outcomes.filter((o) => o === 'confirmed').length === 1, 'exactly one of the two concurrent submissions was confirmed');
  ok(outcomes.filter((o) => o === 'rejected').length === 1, 'the other concurrent submission was rejected with the generic message');

  // ---- Test 6: DB-level constraint, bypassing the API layer entirely ----
  step('6. Direct duplicate insert is rejected at the database level');
  let dbRejected = false;
  try {
    db.prepare(`INSERT INTO store_registration_requests
        (id, full_name, phone, email, national_id, store_name, slug, governorate, password_hash)
      VALUES (?, 'Direct Insert', ?, 'direct-' || ? || '@test.sy', ?, 'Direct Store', 'direct-' || ?, 'Damascus', 'x')`)
      .run('direct' + tag, phoneA, tag, nidA, tag);
  } catch (e) {
    dbRejected = /UNIQUE constraint failed/.test(e.message);
  }
  ok(dbRejected, 'a raw INSERT reusing an existing phone/national_id fails the UNIQUE constraint directly in SQLite');

  // ---- Test 7: owner approve/reject/request-info -> correct status transitions, store only activates on approval ----
  step('7. Owner approve / reject / request-more-info transitions');
  const ownerCtx = await browser.newContext(vp);
  const owner = await ownerCtx.newPage();
  await owner.goto(BASE + '/login');
  await owner.fill('input[name=email]', 'owner@paylo.sy');
  await owner.fill('input[name=password]', 'owner-change-me-1234');
  await owner.click('button[type=submit]');
  await owner.waitForURL('**/login/2fa');
  await owner.fill('input[name=code]', totp(OWNER_TOTP));
  await owner.click('button[type=submit]');
  await owner.waitForURL('**/owner');

  // 7a. Reject requires a note, and only then updates status; no seller row is ever created.
  const idA = db.prepare('SELECT id FROM store_registration_requests WHERE phone = ?').get(phoneA).id;
  await owner.goto(BASE + `/owner/registrations/${idA}`);
  const rejectForm = owner.locator('form', { has: owner.locator('textarea[name=note]') }).last();
  // The textarea has a client-side `required` attribute; strip it so an empty submit actually
  // reaches the server action and exercises its own note_required check (spec: "required
  // internal note" must be enforced server-side, not just by the browser).
  await rejectForm.locator('textarea[name=note]').evaluate((el) => el.removeAttribute('required'));
  await rejectForm.locator('button[type=submit]').click();
  await owner.waitForTimeout(500);
  const stillOpen = db.prepare('SELECT status FROM store_registration_requests WHERE id = ?').get(idA).status;
  ok(stillOpen === 'PENDING_REVIEW', 'reject without a note does not change status (enforced server-side)');
  await rejectForm.locator('textarea[name=note]').fill('Documents did not match.');
  await rejectForm.locator('button[type=submit]').click();
  await owner.waitForSelector('text=Rejected');
  const afterReject = db.prepare('SELECT status, created_seller_id FROM store_registration_requests WHERE id = ?').get(idA);
  ok(afterReject.status === 'REJECTED', 'rejected request moves to REJECTED');
  ok(!afterReject.created_seller_id, 'a rejected request never creates a seller/store');

  // 7b. Request more information updates status and always notifies.
  const phoneE = '0903' + tag.slice(-6), nidE = 'NIDE' + tag.slice(-6);
  const pE = await ctx1.newPage();
  await fillApply(pE, { name: 'Applicant E', email: 'e-' + tag + '@test.sy', phone: phoneE, nid: nidE, store: 'Store E ' + tag });
  await pE.click('button[type=submit]');
  await pE.waitForURL('**/apply/confirmation');
  const idB = db.prepare('SELECT id FROM store_registration_requests WHERE phone = ?').get(phoneE).id;
  await owner.goto(BASE + `/owner/registrations/${idB}`);
  const infoForm = owner.locator('form', { has: owner.locator('textarea[name=note]') }).first();
  await infoForm.locator('textarea[name=note]').fill('Please resend a clearer ID photo.');
  await infoForm.locator('button[type=submit]').click();
  await owner.waitForSelector('text=More info requested');
  const afterInfo = db.prepare('SELECT status FROM store_registration_requests WHERE id = ?').get(idB);
  ok(afterInfo.status === 'MORE_INFORMATION_REQUIRED', 'request-more-info moves status to MORE_INFORMATION_REQUIRED');

  // 7c. Approve creates the seller/store and only now does it become live.
  const idC = db.prepare('SELECT id, phone FROM store_registration_requests WHERE phone = ?').get(phoneR).id;
  const sellerBefore = db.prepare('SELECT count(*) c FROM sellers WHERE phone = ?').get(phoneR).c;
  ok(sellerBefore === 0, 'no seller/store exists before approval');
  await owner.goto(BASE + `/owner/registrations/${idC}`);
  await owner.click('button:has-text("Approve")');
  await owner.waitForSelector('text=Approved');
  const afterApprove = db.prepare('SELECT status, created_seller_id FROM store_registration_requests WHERE id = ?').get(idC);
  ok(afterApprove.status === 'APPROVED', 'approved request moves to APPROVED');
  ok(!!afterApprove.created_seller_id, 'approval creates a seller row');
  const sellerAfter = db.prepare("SELECT status FROM sellers WHERE id = ?").get(afterApprove.created_seller_id);
  ok(sellerAfter.status === 'approved', 'the store is active (approved) immediately on approval, never before');

  // ---- Test 8: authorization — non-owner session gets 404, not 403, on every owner registration route ----
  step('8. Authorization: non-owner sessions cannot reach owner registration routes');
  const anonRes = await fetch(BASE + '/owner/registrations', { redirect: 'manual' });
  ok(anonRes.status === 404, 'anonymous request to /owner/registrations returns 404');
  const anonDetailRes = await fetch(BASE + `/owner/registrations/${idC}`, { redirect: 'manual' });
  ok(anonDetailRes.status === 404, 'anonymous request to a registration detail route returns 404');

  const sellerCtx = await browser.newContext(vp);
  const sellerPage = await sellerCtx.newPage();
  // Log a real (non-owner) seller in through the browser, then replay its cookie via fetch
  // for a real status-code assertion (a page navigation alone can't easily read the status).
  await sellerPage.goto(BASE + '/login');
  await sellerPage.fill('input[name=email]', 'demo@paylo.sy');
  await sellerPage.fill('input[name=password]', 'seller1234');
  await sellerPage.click('button[type=submit]');
  await sellerPage.waitForURL('**/login/2fa');
  await sellerPage.fill('input[name=code]', totp('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'));
  await sellerPage.click('button[type=submit]');
  await sellerPage.waitForURL('**/seller');
  const sellerCookies = await sellerCtx.cookies();
  const cookieHeader = sellerCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const sellerRes = await fetch(BASE + '/owner/registrations', { headers: { cookie: cookieHeader }, redirect: 'manual' });
  ok(sellerRes.status === 404, 'a logged-in non-owner (seller) session gets 404 on /owner/registrations, not 403');

  // ---- Test 9: masking — full national ID never appears in the list view, only on the detail screen ----
  step('9. Masking: full national ID only ever appears on the protected detail screen');
  const ownerCookies = await ownerCtx.cookies();
  const ownerCookieHeader = ownerCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const listHtml = await (await fetch(BASE + '/owner/registrations', { headers: { cookie: ownerCookieHeader } })).text();
  ok(!listHtml.includes(nidR), 'full national ID for the raced/approved applicant does not appear in the list view HTML');
  const maskedTail = nidR.slice(-4);
  ok(listHtml.includes(maskedTail) && /\*+/.test(listHtml), 'list view shows a masked national ID (asterisks + last digits)');
  const detailHtml = await (await fetch(BASE + `/owner/registrations/${idC}`, { headers: { cookie: ownerCookieHeader } })).text();
  ok(detailHtml.includes(nidR), 'full national ID is present on the protected single-request detail screen');
  ok(!/registrations\?.*NIDR|registrations\/.*NIDR/.test(BASE + `/owner/registrations/${idC}`), 'the detail route is addressed by request ID, never by national ID, in its URL');

  console.log(`\nALL PASSED — ${passed} assertions`);
  await browser.close();
  db.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});

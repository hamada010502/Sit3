/*
 * Seeds a working dataset: an admin, an approved+verified seller with products
 * (including variants and a digital item), and a seller still awaiting approval.
 * Run: npm run seed    (use `npm run db:reset` first after a schema change)
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'lib', 'schema.sql'), 'utf8'));

const defaults = {
  commission_rate: '5', commission_fixed_fee: '0', commission_vat_rate: '0',
  delivery_fee_damascus: '15000', delivery_fee_other: '25000',
  logistics_partner_name: 'Partner logistics company (TBD)', yalla_go_enabled: '1',
  cod_enabled: '1', bank_transfer_enabled: '1', card_enabled: '0',
  bank_name: 'QNB Syria', bank_account_name: 'Paylo Trading', bank_iban: 'SY00 0000 0000 0000 0000 0000',
  bank_note: 'Put your order code in the transfer reference.',
  payout_cutoff_day: '2', payout_cutoff_hour: '18', payout_transfer_day: '3', payout_eligibility: 'on_close',
  address_change_window_hours: '24', notify_email: '1', notify_sms: '1',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@paylo.sy';
const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD || 'admin1234';
const SELLER_PASS = 'seller1234';
// Fixed so the end-to-end test can compute valid codes. Never ship a fixed secret to production.
const DEMO_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
// Owner account: single, hard-coded identity (see lib/owner.ts). Email must match OWNER_EMAIL
// in the environment (or this default) for the owner-only routes to ever authorize this login.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'owner@paylo.sy').toLowerCase();
const OWNER_PASS = process.env.OWNER_SEED_PASSWORD || 'owner-change-me-1234';
const OWNER_TOTP = 'KRSXG5CTMVRXEZLUKN2XAZLSEBB2EWDN';

function upsertUser(email, pass, role, name, totp) {
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) return ex.id;
  const uid = id();
  db.prepare('INSERT INTO users (id, email, password_hash, role, name, totp_secret, totp_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid, email, bcrypt.hashSync(pass, 10), role, name, totp || null, totp ? 1 : 0);
  return uid;
}

upsertUser(ADMIN_EMAIL, ADMIN_PASS, 'admin', 'Paylo Admin');

const demoUid = upsertUser('demo@paylo.sy', SELLER_PASS, 'seller', 'Lina Haddad', DEMO_TOTP);
let demo = db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(demoUid);
if (!demo) {
  const sid = id();
  db.prepare(`INSERT INTO sellers (id, user_id, store_name, slug, instagram, phone, governorate, bio, about, payout_details,
      status, kyc_status, kyc_legal_name, kyc_national_id, reviewed_at, kyc_reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'approved', ?, ?, datetime('now'), datetime('now'))`)
    .run(sid, demoUid, 'Lina Handmade', 'lina-handmade', 'lina.handmade', '0933123456', 'Damascus',
      'Handmade candles, ceramics and small gifts from Damascus.',
      'Everything is made in a small studio in Old Damascus. Orders usually ship the next day.',
      'QNB Syria — IBAN SY00 0000 0000 0000 0000 0000 (demo)', 'Lina Haddad', '01020304050');
  demo = { id: sid };

  const insP = db.prepare(`INSERT INTO products (id, seller_id, type, title, description, price, stock, images, digital_note, option1_name, option2_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`);
  const insV = db.prepare('INSERT INTO product_variants (id, product_id, option1_value, option2_value, label, price, stock, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  const candle = id();
  insP.run(candle, demo.id, 'physical', 'Damascus rose scented candle', 'Hand-poured soy wax, about 40 hours of burn time.', 85000, 12, null, null, null, 'active');

  const cups = id();
  insP.run(cups, demo.id, 'physical', 'Ceramic espresso cups', 'Glazed stoneware, dishwasher safe.', 140000, 0, null, 'Size', 'Colour', 'active');
  const cupVariants = [['Small', 'Sand', 140000, 6], ['Small', 'Indigo', 140000, 4], ['Large', 'Sand', 185000, 3], ['Large', 'Indigo', 185000, 2]];
  cupVariants.forEach(([o1, o2, price, stock], i) => insV.run(id(), cups, o1, o2, `${o1} / ${o2}`, price, stock, i));
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(cupVariants.reduce((s, v) => s + v[3], 0), cups);

  const board = id();
  insP.run(board, demo.id, 'physical', 'Olive-wood serving board', 'Solid olive wood, oiled finish, 35 cm.', 220000, 3, null, null, null, 'active');

  const guide = id();
  insP.run(guide, demo.id, 'digital', 'Candle-making guide (PDF)', 'A 40-page walkthrough of the whole process.', 45000, 0,
    'Download: https://example.com/paylo-demo-guide.pdf — the link stays valid for 30 days.', null, null, 'active');

  const tote = id();
  insP.run(tote, demo.id, 'physical', 'Embroidered tote bag', 'Cotton canvas, Aghabani-style embroidery.', 95000, 0, null, null, null, 'out_of_stock');
}

const pendUid = upsertUser('pending@paylo.sy', SELLER_PASS, 'seller', 'Omar Kanaan');
if (!db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(pendUid)) {
  db.prepare('INSERT INTO sellers (id, user_id, store_name, slug, instagram, phone, governorate, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id(), pendUid, 'Omar Sneakers', 'omar-sneakers', 'omar.kicks', '0944555666', 'Aleppo', 'Imported sneakers, Aleppo.');
}

/* ---------------- richer demo data so every dashboard has something to show ---------------- */

const orderCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'PL-';
  for (const b of crypto.randomBytes(8)) s += a[b % a.length];
  return s;
};
const daysAgo = (n, h = 12) => {
  const d = new Date(Date.now() - n * 86400000);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};
const RATE = 5;

/** Mirrors lib/orders.ts checkout(): same fee maths, fulfilment choice and event trail. */
function seedOrder({ sellerId, product, buyer, qty = 1, method = 'cod', status, state, userId = null, ago = 1 }) {
  const oid = id();
  const subtotal = product.price * qty;
  const fee = product.type === 'digital' ? 0 : buyer.governorate === 'Damascus' ? 15000 : 25000;
  const commission = Math.round((subtotal * RATE) / 100);
  const created = daysAgo(ago);
  const fulfil = product.type === 'digital' ? 'digital' : buyer.governorate === 'Damascus' ? 'platform_rider' : 'logistics_pickup';
  const paid = ['handed_off', 'in_transit', 'delivered', 'refunded'].includes(status) || (status === 'confirmed' && method !== 'cod');
  const paymentStatus = status === 'refunded' ? 'refunded' : status === 'delivered' && method === 'cod' ? 'collected_cod' : paid ? 'confirmed' : 'pending';
  db.prepare(`INSERT INTO orders (id, code, seller_id, product_id, user_id, product_title, product_type, unit_price, quantity,
      subtotal, delivery_fee, total, commission_rate, commission_amount, seller_net, buyer_name, buyer_phone, buyer_email,
      governorate, address, payment_method, payment_status, fulfillment_method, order_state, status, created_at,
      paid_at, handed_off_at, delivered_at, closed_at, refunded_at, returned_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    oid, orderCode(), sellerId, product.id, userId, product.title, product.type, product.price, qty,
    subtotal, fee, subtotal + fee, RATE, commission, subtotal - commission, buyer.name, buyer.phone, buyer.email || null,
    buyer.governorate, buyer.address, method, paymentStatus, fulfil, state, status, created,
    paid ? created : null,
    ['handed_off', 'in_transit', 'delivered', 'refunded'].includes(status) ? daysAgo(ago - 1) : null,
    status === 'delivered' ? daysAgo(Math.max(0, ago - 2)) : null,
    state === 'closed' ? daysAgo(ago - 1) : null,
    status === 'refunded' ? daysAgo(Math.max(0, ago - 3)) : null,
    state === 'returned' ? daysAgo(Math.max(0, ago - 3)) : null,
    created);
  const ev = db.prepare('INSERT INTO order_events (order_id, from_status, to_status, from_state, to_state, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ev.run(oid, null, method === 'bank_transfer' ? 'awaiting_payment' : 'confirmed', null, 'open', 'buyer', `Placed via ${method}`, created);
  if (['handed_off', 'in_transit', 'delivered', 'refunded'].includes(status)) ev.run(oid, 'confirmed', 'handed_off', 'open', 'closed', 'seller', 'Handed to courier', daysAgo(ago - 1));
  if (status === 'delivered') ev.run(oid, 'handed_off', 'delivered', 'closed', 'closed', 'admin', 'Delivered', daysAgo(Math.max(0, ago - 2)));
  if (status === 'refunded') ev.run(oid, 'handed_off', 'refunded', 'closed', 'returned', 'admin', 'Return accepted, refunded', daysAgo(Math.max(0, ago - 3)));
  db.prepare('INSERT INTO payments (id, order_id, method, provider, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id(), oid, method, method === 'cod' ? 'courier' : 'manual', subtotal + fee,
      paymentStatus === 'refunded' ? 'refunded' : paymentStatus === 'pending' ? 'pending' : 'captured', created);
  if (method === 'bank_transfer') {
    db.prepare('INSERT INTO bank_transfers (id, order_id, amount, status, reference, submitted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id(), oid, subtotal + fee, status === 'awaiting_payment' ? 'submitted' : 'confirmed', 'TRX-' + oid.slice(0, 6).toUpperCase(), created, created);
  }
  return oid;
}

// Customer account — buyers never need one, but this shows the optional account side.
const CUSTOMER_EMAIL = 'customer@paylo.sy';
const CUSTOMER_PASS = 'customer1234';
let customer = db.prepare('SELECT id FROM users WHERE email = ?').get(CUSTOMER_EMAIL);
if (!customer) {
  const cid = id();
  db.prepare("INSERT INTO users (id, email, password_hash, role, name, phone) VALUES (?, ?, ?, 'customer', ?, ?)")
    .run(cid, CUSTOMER_EMAIL, bcrypt.hashSync(CUSTOMER_PASS, 10), 'Rania Khoury', '0955111222');
  const insA = db.prepare('INSERT INTO customer_addresses (id, user_id, label, full_name, phone, governorate, address, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insA.run(id(), cid, 'Home', 'Rania Khoury', '0955111222', 'Damascus', 'Mazzeh, Villat Gharbiya, Building 14, Floor 3', 1);
  insA.run(id(), cid, 'Work', 'Rania Khoury', '0955111222', 'Damascus', 'Abu Rummaneh, Al-Jalaa St, Office 7', 0);
  customer = { id: cid };
}

// A second live store with NO two-factor, so a seller dashboard can be opened with just a password.
const spiceUid = upsertUser('spice@paylo.sy', SELLER_PASS, 'seller', 'Karim Aswad');
let spice = db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(spiceUid);
if (!spice) {
  const sid = id();
  db.prepare(`INSERT INTO sellers (id, user_id, store_name, slug, instagram, phone, governorate, bio, about, payout_details,
      status, kyc_status, kyc_legal_name, kyc_national_id, reviewed_at, kyc_reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'approved', ?, ?, datetime('now'), datetime('now'))`)
    .run(sid, spiceUid, 'Damascus Spice House', 'spice-house', 'spicehouse.dm', '0944777888', 'Damascus',
      'Za\'atar, sumac, seven-spice and coffee blends, ground fresh in Al-Bzouriyah.',
      'Family spice shop since 1987. Everything is ground to order and packed the same day.',
      'QNB Syria — IBAN SY11 1111 1111 1111 1111 1111 (demo)', 'Karim Aswad', '02030405060');
  const insP = db.prepare(`INSERT INTO products (id, seller_id, type, title, description, price, stock, images, status)
    VALUES (?, ?, 'physical', ?, ?, ?, ?, '[]', 'active')`);
  insP.run(id(), sid, "Za'atar blend (250 g)", 'Wild thyme, sumac, toasted sesame. Aleppo style.', 35000, 40);
  insP.run(id(), sid, 'Arabic coffee with cardamom (500 g)', 'Medium roast, ground fine, 20% cardamom.', 60000, 25);
  insP.run(id(), sid, 'Seven-spice mix (200 g)', 'Allspice, pepper, cinnamon, clove, nutmeg, cumin, coriander.', 28000, 30);
  spice = { id: sid };
}

// Orders across every commercial state, so dashboards, payouts and analytics are populated.
const demoSeller = db.prepare("SELECT id FROM sellers WHERE slug = 'lina-handmade'").get();
if (demoSeller && !db.prepare('SELECT 1 FROM orders WHERE seller_id = ?').get(demoSeller.id)) {
  const p = (title) => db.prepare('SELECT id, title, price, type FROM products WHERE seller_id = ? AND title = ?').get(demoSeller.id, title);
  const candle = p('Damascus rose scented candle'), board = p('Olive-wood serving board'), guide = p('Candle-making guide (PDF)');
  const rania = { name: 'Rania Khoury', phone: '0955111222', email: CUSTOMER_EMAIL, governorate: 'Damascus', address: 'Mazzeh, Villat Gharbiya, Building 14, Floor 3' };
  const sami = { name: 'Sami Haddad', phone: '0933444555', email: 'sami@example.com', governorate: 'Aleppo', address: 'Al-Aziziyah, Baron St 22' };
  const nour = { name: 'Nour Saleh', phone: '0966222333', governorate: 'Damascus', address: 'Bab Touma, near the church, 5' };
  const layla = { name: 'Layla Mansour', phone: '0977888999', email: 'layla@example.com', governorate: 'Homs', address: 'Al-Waer, Block 3, Apt 12' };
  seedOrder({ sellerId: demoSeller.id, product: candle, buyer: rania, qty: 2, status: 'delivered', state: 'closed', userId: customer.id, ago: 18 });
  seedOrder({ sellerId: demoSeller.id, product: board, buyer: sami, status: 'delivered', state: 'closed', ago: 14 });
  seedOrder({ sellerId: demoSeller.id, product: candle, buyer: nour, status: 'handed_off', state: 'closed', ago: 6 });
  seedOrder({ sellerId: demoSeller.id, product: guide, buyer: layla, method: 'bank_transfer', status: 'delivered', state: 'closed', ago: 5 });
  seedOrder({ sellerId: demoSeller.id, product: board, buyer: rania, status: 'confirmed', state: 'open', userId: customer.id, ago: 1 });
  seedOrder({ sellerId: demoSeller.id, product: candle, buyer: layla, method: 'bank_transfer', status: 'awaiting_payment', state: 'open', ago: 0 });
  seedOrder({ sellerId: demoSeller.id, product: board, buyer: nour, status: 'refunded', state: 'returned', ago: 10 });
}
if (spice && !db.prepare('SELECT 1 FROM orders WHERE seller_id = ?').get(spice.id)) {
  const sp = db.prepare('SELECT id, title, price, type FROM products WHERE seller_id = ? ORDER BY price').all(spice.id);
  const omar = { name: 'Omar Darwish', phone: '0988111000', governorate: 'Damascus', address: 'Midan, Al-Hamra St 9' };
  const rania = { name: 'Rania Khoury', phone: '0955111222', email: CUSTOMER_EMAIL, governorate: 'Damascus', address: 'Abu Rummaneh, Al-Jalaa St, Office 7' };
  seedOrder({ sellerId: spice.id, product: sp[1], buyer: omar, qty: 3, status: 'delivered', state: 'closed', ago: 12 });
  seedOrder({ sellerId: spice.id, product: sp[2], buyer: rania, status: 'delivered', state: 'closed', userId: customer.id, ago: 8 });
  seedOrder({ sellerId: spice.id, product: sp[0], buyer: omar, qty: 2, status: 'confirmed', state: 'open', ago: 2 });
}

// Store registrations waiting in the owner's review queue.
if (!db.prepare('SELECT 1 FROM store_registration_requests').get()) {
  const insR = db.prepare(`INSERT INTO store_registration_requests (id, full_name, phone, email, national_id, store_name, slug,
      instagram, governorate, bio, password_hash, status, info_request_note, submitted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const pw = bcrypt.hashSync('applicant1234', 10);
  insR.run(id(), 'Hala Qassem', '0911223344', 'hala@example.com', '01122334455', 'Hala Knits', 'hala-knits', 'halaknits',
    'Latakia', 'Hand-knitted scarves and baby blankets.', pw, 'PENDING_REVIEW', null, daysAgo(0, 9), daysAgo(0, 9));
  insR.run(id(), 'Yousef Barakat', '0922334455', 'yousef@example.com', '02233445566', 'Barakat Leather', 'barakat-leather', null,
    'Aleppo', 'Hand-stitched leather wallets and belts.', pw, 'PENDING_REVIEW', null, daysAgo(1, 15), daysAgo(1, 15));
  insR.run(id(), 'Mira Haddad', '0933556677', 'mira@example.com', '03344556677', 'Mira Ceramics', 'mira-ceramics', 'miraceramics',
    'Tartus', 'Wheel-thrown ceramics.', pw, 'MORE_INFORMATION_REQUIRED', 'Please send a photo of your workshop.', daysAgo(3, 11), daysAgo(2, 10));
}

// 2FA is on unconditionally at creation — the owner account has no code path that can
// disable it (see app/seller/security: owner has no sellers row, so it can never reach
// that action even if it tried the URL directly).
const ownerUid = upsertUser(OWNER_EMAIL, OWNER_PASS, 'owner', 'Paylo Owner', OWNER_TOTP);
db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(ownerUid);

const APP = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
console.log('Seeded.\n');
console.log('  Log in at ' + APP + '/login\n');
console.log(`  Platform owner   ${OWNER_EMAIL} / ${OWNER_PASS}`);
console.log(`                   2FA code: npm run totp -- ${OWNER_TOTP}   → dashboard ${APP}/owner`);
console.log(`  Admin            ${ADMIN_EMAIL} / ${ADMIN_PASS}   → ${APP}/admin`);
console.log(`  Store (no 2FA)   spice@paylo.sy / ${SELLER_PASS}   → ${APP}/seller`);
console.log(`  Store (2FA on)   demo@paylo.sy / ${SELLER_PASS}`);
console.log(`                   2FA code: npm run totp -- ${DEMO_TOTP}`);
console.log(`  Store (pending)  pending@paylo.sy / ${SELLER_PASS}`);
console.log(`  Customer         ${CUSTOMER_EMAIL} / ${CUSTOMER_PASS}   → ${APP}/account\n`);
console.log('  Share links for buyers (no account needed):');
console.log(`    ${APP}/s/spice-house`);
console.log(`    ${APP}/s/lina-handmade`);

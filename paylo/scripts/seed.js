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

console.log('Seeded.');
console.log(`  Admin:            ${ADMIN_EMAIL} / ${ADMIN_PASS}`);
console.log(`  Seller (live):    demo@paylo.sy / ${SELLER_PASS}  — 2FA on, TOTP secret ${DEMO_TOTP}`);
console.log(`                    storefront /s/lina-handmade`);
console.log(`  Seller (pending): pending@paylo.sy / ${SELLER_PASS}`);

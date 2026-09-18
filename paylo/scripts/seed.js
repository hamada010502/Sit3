/* Seeds an admin, a demo seller (approved) with products, and a pending seller. Run: npm run seed */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'lib', 'schema.sql'), 'utf8'));
const defaults = { commission_rate: '7.5', delivery_fee_damascus: '15000', delivery_fee_other: '25000', payout_hold_days: '0', logistics_partner_name: 'Partner logistics company (TBD)', yalla_go_enabled: '1' };
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@paylo.sy';
const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD || 'admin1234';
const SELLER_PASS = 'seller1234';

function upsertUser(email, pass, role, name) {
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) return ex.id;
  const uid = id();
  db.prepare('INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)').run(uid, email, bcrypt.hashSync(pass, 10), role, name);
  return uid;
}

upsertUser(ADMIN_EMAIL, ADMIN_PASS, 'admin', 'Paylo Admin');

const demoUid = upsertUser('demo@paylo.sy', SELLER_PASS, 'seller', 'Lina Haddad');
let demo = db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(demoUid);
if (!demo) {
  const sid = id();
  db.prepare("INSERT INTO sellers (id, user_id, store_name, slug, instagram, phone, governorate, bio, payout_details, status, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', datetime('now'))")
    .run(sid, demoUid, 'Lina Handmade', 'lina-handmade', 'lina.handmade', '0933123456', 'Damascus', 'Handmade candles, ceramics and small gifts from Damascus.', 'Bank: QNB Syria — IBAN SY00 0000 0000 0000 0000 0000 (demo)');
  demo = { id: sid };
  const products = [
    ['Scented soy candle — Damascus rose', 'Hand-poured soy wax, 200 g, ~40 h burn time.', 85000, 12],
    ['Ceramic espresso cup set (2)', 'Glazed stoneware, dishwasher safe.', 140000, 5],
    ['Olive-wood serving board', 'Solid olive wood from Idlib, oiled finish, 35 cm.', 220000, 3],
    ['Embroidered tote bag', 'Cotton canvas, Aghabani-style embroidery.', 95000, 0],
  ];
  const ins = db.prepare("INSERT INTO products (id, seller_id, title, description, price, stock, images, status) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)");
  for (const [t, d, p, s] of products) ins.run(id(), sid, t, d, p, s, s === 0 ? 'out_of_stock' : 'active');
}

const pendUid = upsertUser('pending@paylo.sy', SELLER_PASS, 'seller', 'Omar Kanaan');
if (!db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(pendUid)) {
  db.prepare('INSERT INTO sellers (id, user_id, store_name, slug, instagram, phone, governorate, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id(), pendUid, 'Omar Sneakers', 'omar-sneakers', 'omar.kicks', '0944555666', 'Aleppo', 'Imported sneakers, Aleppo.');
}

console.log('Seeded.');
console.log(`  Admin:          ${ADMIN_EMAIL} / ${ADMIN_PASS}`);
console.log(`  Seller (live):  demo@paylo.sy / ${SELLER_PASS}   → storefront /s/lina-handmade`);
console.log(`  Seller (pending): pending@paylo.sy / ${SELLER_PASS}`);

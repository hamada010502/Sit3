import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { normalizePhone } from './id-validate';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'paylo.db');

declare global {
  // eslint-disable-next-line no-var
  var __payloDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (global.__payloDb) return global.__payloDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  global.__payloDb = db;
  return db;
}

function migrate(db: Database.Database) {
  db.exec(fs.readFileSync(path.join(process.cwd(), 'lib', 'schema.sql'), 'utf8'));
  migrateUsersRoleOwner(db);
  migrateAuditActorOwner(db);
  migrateSellerUniqueIdentity(db);
  migrateUsersRoleCustomer(db);
  migrateOrdersUserId(db);
  migrateUsersPhone(db);
  migrateAccountIdentity(db);
  addColumn(db, 'orders', 'refunded_amount', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'orders', 'discount_amount', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'orders', 'coupon_code', 'TEXT');
  addColumn(db, 'products', 'collection_id', 'TEXT REFERENCES collections(id) ON DELETE SET NULL');
  addColumn(db, 'product_variants', 'image_path', 'TEXT');
  addColumn(db, 'sellers', 'announcement', 'TEXT');
  addColumn(db, 'sellers', 'about_sections', 'TEXT');
  addColumn(db, 'sellers', 'thank_you_message', 'TEXT');
  addColumn(db, 'sellers', 'notify_push', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'sellers', 'notify_sound', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'sellers', 'notify_email_orders', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'sellers', 'notify_text', "TEXT NOT NULL DEFAULT 'none'");
  addColumn(db, 'sellers', 'onboarding_dismissed', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'sellers', 'onboarding_link_copied', 'INTEGER NOT NULL DEFAULT 0');
  // Language of emails/SMS to the seller. Stores that already received English through
  // their latest push device keep English, so nobody's messages switch language on upgrade.
  if (addColumn(db, 'sellers', 'preferred_lang', "TEXT NOT NULL DEFAULT 'ar'") && hasTable(db, 'push_subscriptions')) {
    db.exec(`UPDATE sellers SET preferred_lang = 'en' WHERE (SELECT lang FROM push_subscriptions p WHERE p.seller_id = sellers.id
      ORDER BY created_at DESC, rowid DESC LIMIT 1) = 'en'`);
  }
  addColumn(db, 'webhook_deliveries', 'last_attempt_at', 'TEXT');
  addColumn(db, 'webhook_deliveries', 'next_attempt_at', 'TEXT');
  db.exec("CREATE INDEX IF NOT EXISTS idx_deliveries_due ON webhook_deliveries(status, next_attempt_at)");
  addColumn(db, 'products', 'short_code', 'INTEGER');
  addColumn(db, 'push_subscriptions', 'lang', "TEXT NOT NULL DEFAULT 'en'");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_short_code ON products(short_code)');
  backfillShortCodes(db);

  const defaults: Record<string, string> = {
    // Commission (Functional Spec §2.4). Percentages stay provisional until a settlement
    // partner is confirmed (v2 §3), so they are configurable and frozen per order.
    commission_rate: '5', commission_fixed_fee: '0', commission_vat_rate: '0',
    // Delivery
    delivery_fee_damascus: '15000', delivery_fee_other: '25000',
    logistics_partner_name: 'Partner logistics company (TBD)', yalla_go_enabled: '1',
    // Payment methods (lib/payment-methods.ts). Bank transfer defaults ON: it needs no bank
    // API. Card stays off until a settlement partner signs (v2 §3) and additionally needs
    // PAYMENT_CARD_ENABLED=1 and a configured provider.
    // Transfers only (policy): no new cash-on-delivery checkouts. COD code paths stay for
    // orders placed before the policy.
    pay_cod_enabled: '0', pay_bank_transfer_enabled: '1', pay_card_enabled: '0',
    bank_name: '', bank_account_name: '', bank_iban: '', bank_note: '',
    // Payout calendar (v2 §4.3): cutoff Tuesday 18:00 UTC, transfer Wednesday.
    payout_cutoff_day: '2', payout_cutoff_hour: '18', payout_transfer_day: '3',
    payout_eligibility: 'on_close',
    // Buyer self-service
    address_change_window_hours: '24',
    // Notification channels
    notify_email: '1', notify_sms: '1', text_channel: 'sms',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  // Carry an admin's earlier choice over from the pre-rename keys (cod_enabled → pay_cod_enabled…).
  for (const m of ['cod', 'bank_transfer', 'card']) {
    const old = db.prepare('SELECT value FROM settings WHERE key = ?').get(`${m}_enabled`) as { value: string } | undefined;
    if (old) { ins.run(`pay_${m}_enabled`, old.value); db.prepare('DELETE FROM settings WHERE key = ?').run(`${m}_enabled`); }
  }
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
  // One-time policy migration: switch COD off on databases created before "transfers only".
  // Recorded, so it never runs again (tests and any deliberate override keep their value).
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_cod_off_v1'").get()) {
    db.transaction(() => {
      db.prepare("UPDATE settings SET value = '0' WHERE key = 'pay_cod_enabled'").run();
      ins.run('migr_cod_off_v1', new Date().toISOString());
    })();
  }
}

/**
 * SQLite can't ALTER a CHECK constraint in place, so a database created before the
 * 'owner' role existed still has `role IN ('admin','seller')` on the users table —
 * inserting an owner row would fail that constraint. This detects the stale
 * constraint (by reading the table's own SQL back from sqlite_master) and rebuilds
 * the table with the widened constraint, preserving every row and every foreign key
 * that references users(id). No-op once the constraint already includes 'owner'.
 */
function migrateUsersRoleOwner(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'owner'")) return;

  const rebuild = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','seller','owner')),
        name TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_recovery TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new SELECT id, email, password_hash, role, name, totp_secret, totp_enabled, totp_recovery, last_login_at, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
  });
  rebuild();
}

/** Same problem, same fix, for audit_log.actor_type — audit() is called with actor_type
 * 'owner' as soon as the owner account logs in, and a stale CHECK constraint would
 * reject that insert. No FKs reference audit_log.id, so this rebuild is simpler than
 * migrateUsersRoleOwner's. */
function migrateAuditActorOwner(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'owner'")) return;

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE audit_log_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('buyer','seller','admin','owner','system','api')),
        actor_id TEXT,
        actor_label TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO audit_log_new SELECT id, actor_type, actor_id, actor_label, entity_type, entity_id, action, detail, created_at FROM audit_log;
      DROP TABLE audit_log;
      ALTER TABLE audit_log_new RENAME TO audit_log;
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    `);
  });
  rebuild();
}

/**
 * Adds the DB-level uniqueness that store registration (lib/registration.ts) relies on:
 * one phone, one national ID, per store. Unlike the CHECK-constraint migrations above,
 * a UNIQUE INDEX can be added to an existing table without rebuilding it — but creating
 * one over data that already has duplicates throws, and this must never take the whole
 * app down on boot. If a deployment already has legacy duplicate phones (from before
 * this constraint existed), the index is skipped and a warning is logged; the
 * registration flow's own application-level check still blocks new collisions going
 * forward regardless of whether this index could be created.
 */
function migrateSellerUniqueIdentity(db: Database.Database) {
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_phone_unique ON sellers(phone);');
  } catch (e) {
    console.warn('[db] Could not enforce unique sellers.phone (existing duplicate data?):', (e as Error).message);
  }
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_national_id_unique ON sellers(kyc_national_id) WHERE kyc_national_id IS NOT NULL;");
  } catch (e) {
    console.warn('[db] Could not enforce unique sellers.kyc_national_id (existing duplicate data?):', (e as Error).message);
  }
}

/**
 * One account per email and per phone (accounts + non-rejected seller applications).
 * 1. One-time: phones in users / registrations / sellers are rewritten to +9639XXXXXXXX where
 *    they parse as Syrian mobiles (a value that would collide is left as is and reported).
 * 2. Partial unique indexes inside each table.
 * 3. Triggers for the rule that spans two tables (an index cannot): an application may not
 *    reuse an account's email/phone, and an account may not take the email/phone of a pending
 *    application. RAISE messages are the i18n keys the app shows (email_taken / phone_taken).
 * Guest orders are untouched: orders.buyer_phone/email are free to repeat.
 */
function migrateAccountIdentity(db: Database.Database) {
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_phone_norm_v1'").get()) {
    let skipped = 0;
    const norm = (table: string, col: string) => {
      const rows = db.prepare(`SELECT rowid r, ${col} v FROM ${table} WHERE ${col} IS NOT NULL`).all() as { r: number; v: string }[];
      const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`);
      for (const row of rows) {
        const n = normalizePhone(row.v);
        if (!n || n === row.v) continue;
        try { upd.run(n, row.r); } catch { skipped++; }
      }
    };
    db.transaction(() => {
      norm('users', 'phone'); norm('store_registration_requests', 'phone'); norm('sellers', 'phone');
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('migr_phone_norm_v1', new Date().toISOString());
    })();
    if (skipped) console.warn(`[db] ${skipped} phone number(s) left un-normalised because the canonical form already exists (duplicate data).`);
  }
  const idx = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci ON users(lower(email))',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_email_active ON store_registration_requests(lower(email)) WHERE status != 'REJECTED'",
  ];
  for (const sql of idx) {
    try { db.exec(sql); } catch (e) { console.warn('[db] Could not create unique index (existing duplicate data?):', sql, (e as Error).message); }
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_reg_identity_ins BEFORE INSERT ON store_registration_requests
    WHEN NEW.status != 'REJECTED' BEGIN
      SELECT RAISE(ABORT, 'email_taken') WHERE EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(NEW.email));
      SELECT RAISE(ABORT, 'phone_taken') WHERE EXISTS (SELECT 1 FROM users WHERE phone = NEW.phone);
    END;
    CREATE TRIGGER IF NOT EXISTS trg_reg_identity_upd BEFORE UPDATE OF email, phone ON store_registration_requests
    WHEN NEW.status != 'REJECTED' BEGIN
      SELECT RAISE(ABORT, 'email_taken') WHERE lower(NEW.email) != lower(OLD.email) AND EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(NEW.email));
      SELECT RAISE(ABORT, 'phone_taken') WHERE NEW.phone != OLD.phone AND EXISTS (SELECT 1 FROM users WHERE phone = NEW.phone);
    END;
    CREATE TRIGGER IF NOT EXISTS trg_users_identity_ins BEFORE INSERT ON users BEGIN
      SELECT RAISE(ABORT, 'email_taken') WHERE EXISTS (SELECT 1 FROM store_registration_requests
        WHERE lower(email) = lower(NEW.email) AND status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED'));
      SELECT RAISE(ABORT, 'phone_taken') WHERE NEW.phone IS NOT NULL AND EXISTS (SELECT 1 FROM store_registration_requests
        WHERE phone = NEW.phone AND status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED'));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_users_identity_upd BEFORE UPDATE OF email, phone ON users BEGIN
      SELECT RAISE(ABORT, 'email_taken') WHERE lower(NEW.email) != lower(OLD.email) AND EXISTS (SELECT 1 FROM store_registration_requests
        WHERE lower(email) = lower(NEW.email) AND status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED'));
      SELECT RAISE(ABORT, 'phone_taken') WHERE NEW.phone IS NOT NULL AND NEW.phone IS NOT OLD.phone AND EXISTS (SELECT 1 FROM store_registration_requests
        WHERE phone = NEW.phone AND status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED'));
    END;
  `);
}

/** Same problem, same fix, as migrateUsersRoleOwner — widens the CHECK to include the
 * 'customer' role for a database created before optional customer accounts existed. */
function migrateUsersRoleCustomer(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'customer'")) return;

  const rebuild = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','seller','owner','customer')),
        name TEXT NOT NULL,
        phone TEXT,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_recovery TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, role, name, totp_secret, totp_enabled, totp_recovery, last_login_at, created_at)
        SELECT id, email, password_hash, role, name, totp_secret, totp_enabled, totp_recovery, last_login_at, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
  });
  rebuild();
}

/** orders.user_id and users.phone are plain nullable columns (no CHECK involved), so
 * unlike the role migrations above these can be added in place — no table rebuild needed. */
function migrateOrdersUserId(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  if (cols.some((c) => c.name === 'user_id')) return;
  db.exec('ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES users(id);');
}
function migrateUsersPhone(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (cols.some((c) => c.name === 'phone')) return;
  db.exec('ALTER TABLE users ADD COLUMN phone TEXT;');
}

/** Random 7-digit code not yet used by any product. */
export function newShortCode(db: Database.Database = getDb()): number {
  for (;;) {
    const n = 1_000_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9_000_000);
    if (!db.prepare('SELECT 1 FROM products WHERE short_code = ?').get(n)) return n;
  }
}
function backfillShortCodes(db: Database.Database) {
  const rows = db.prepare('SELECT id FROM products WHERE short_code IS NULL').all() as { id: string }[];
  const set = db.prepare('UPDATE products SET short_code = ? WHERE id = ?');
  for (const r of rows) set.run(newShortCode(db), r.id);
}

/** Adds a plain column in place if a database predates it (no CHECK, so no rebuild). */
function addColumn(db: Database.Database, table: string, column: string, decl: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl};`);
  return true;
}
const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export function getSetting(key: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}
export function setSetting(key: string, value: string) {
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}
export function newOrderCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'PL-';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
export function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

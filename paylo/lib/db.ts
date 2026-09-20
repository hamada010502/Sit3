import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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

  const defaults: Record<string, string> = {
    // Commission (Functional Spec §2.4). Percentages stay provisional until a settlement
    // partner is confirmed (v2 §3), so they are configurable and frozen per order.
    commission_rate: '5', commission_fixed_fee: '0', commission_vat_rate: '0',
    // Delivery
    delivery_fee_damascus: '15000', delivery_fee_other: '25000',
    logistics_partner_name: 'Partner logistics company (TBD)', yalla_go_enabled: '1',
    // Payment methods. Card stays off until the Phase-2 bank confirmation lands (v2 §3);
    // it additionally requires PAYMENT_CARD_ENABLED=1 in the environment.
    cod_enabled: '1', bank_transfer_enabled: '1', card_enabled: '0',
    bank_name: '', bank_account_name: '', bank_iban: '', bank_note: '',
    // Payout calendar (v2 §4.3): cutoff Tuesday 18:00 UTC, transfer Wednesday.
    payout_cutoff_day: '2', payout_cutoff_hour: '18', payout_transfer_day: '3',
    payout_eligibility: 'on_close',
    // Buyer self-service
    address_change_window_hours: '24',
    // Notification channels
    notify_email: '1', notify_sms: '1',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
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

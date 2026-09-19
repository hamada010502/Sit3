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

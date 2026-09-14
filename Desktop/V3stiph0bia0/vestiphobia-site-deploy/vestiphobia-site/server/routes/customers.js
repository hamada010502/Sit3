/**
 * VESTIPHOBIA — customers.
 *
 * There are no customer accounts. A "customer" is the aggregate of orders
 * sharing a normalised phone number, which is why search by phone has to work
 * on any format the owner might type.
 *
 * Nothing here is ever exposed publicly: every function in this file is behind
 * an authenticated admin session.
 */

import { getDb, fromCents } from '../db/index.js';
import { normalisePhone } from '../lib/validate.js';
import { now } from '../db/index.js';

export async function listCustomers({ q, limit = 100 } = {}) {
  const db = await getDb();
  if (q) {
    const digits = normalisePhone(q);
    const term = `%${String(q).trim().slice(0, 60).toLowerCase()}%`;
    // Match a normalised phone, a partial phone as typed, or a name.
    // LOWER() on both sides: LIKE is case-insensitive in SQLite but not in
    // Postgres, and an owner searching a customer by name should not have to
    // guess the capitalisation the customer used at checkout.
    return db.all(
      `SELECT * FROM customers
        WHERE phone LIKE ? OR LOWER(phone) LIKE ? OR LOWER(name) LIKE ? OR LOWER(latest_city) LIKE ?
        ORDER BY updated_at DESC LIMIT ?`,
      [`%${digits}%`, term, term, term, Math.min(Number(limit) || 100, 500)]
    );
  }
  return db.all('SELECT * FROM customers ORDER BY updated_at DESC LIMIT ?', [
    Math.min(Number(limit) || 100, 500),
  ]);
}

export async function getCustomer(phone) {
  const db = await getDb();
  const key = normalisePhone(phone);
  const customer = await db.get('SELECT * FROM customers WHERE phone = ?', [key]);
  if (!customer) return null;

  const orders = await db.all(
    'SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at DESC',
    [key]
  );
  const discounts = orders
    .filter((o) => o.discount_percent > 0)
    .map((o) => ({
      orderNumber: o.order_number,
      percent: o.discount_percent,
      label: o.discount_label,
      amount: fromCents(o.discount_cents),
    }));

  return {
    ...customer,
    totalSpend: fromCents(customer.total_spend_cents),
    orders,
    discounts,
    // The returning discount depends on this, so it is surfaced explicitly
    // rather than left for the reader to infer from the order list.
    isReturning: Number(customer.delivered_count) > 0,
  };
}

export async function setCustomerNote(phone, note, { adminId } = {}) {
  const db = await getDb();
  await db.run('UPDATE customers SET notes = ?, updated_at = ? WHERE phone = ?', [
    String(note ?? '').slice(0, 4000),
    now(),
    normalisePhone(phone),
  ]);
  return { ok: true };
}

export async function customerStats() {
  const db = await getDb();
  const total = await db.get('SELECT COUNT(*) AS n FROM customers');
  const returning = await db.get('SELECT COUNT(*) AS n FROM customers WHERE delivered_count > 0');
  return {
    total: Number(total?.n ?? 0),
    returning: Number(returning?.n ?? 0),
  };
}

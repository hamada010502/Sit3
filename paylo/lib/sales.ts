import { getDb } from './db';

export interface DaySales { day: string; sales: number; orders: number }

/** Daily sales for a seller: goods value buyers paid (after discounts), excluding
 * cancelled, failed and fully refunded orders. Days with no orders are zero-filled. */
export function dailySales(sellerId: string, days = 30, now = new Date()): DaySales[] {
  const rows = getDb().prepare(`SELECT date(created_at) d, sum(subtotal - refunded_amount) s, count(*) c FROM orders
    WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed','refunded') AND date(created_at) > date(?, ?)
    GROUP BY d`).all(sellerId, now.toISOString().slice(0, 10), `-${days} days`) as { d: string; s: number; c: number }[];
  const by = new Map(rows.map((r) => [r.d, r]));
  const out: DaySales[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day: d, sales: by.get(d)?.s ?? 0, orders: by.get(d)?.c ?? 0 });
  }
  return out;
}

import { getDb } from './db';
import { payoutEligibleOrders } from './orders';
import type { Order, Payout } from './types';

export type EarningStatus = 'paid' | 'in_payout' | 'available' | 'pending' | 'refunded';
export interface EarningRow {
  id: string; code: string; created_at: string; product: string; qty: number;
  listPrice: number; discount: number; paid: number; commissionRate: number; commission: number;
  refunded: number; sellerRefund: number; net: number; deliveryFee: number;
  status: EarningStatus; payoutRef: string | null; payoutDate: string | null;
}
export interface EarningsTotals { listPrice: number; discount: number; paid: number; commission: number; refunded: number; sellerRefund: number; net: number }

/**
 * Per-order commission breakdown. Reads the same columns the payout run pays from
 * (seller_net, commission_amount, commission_vat), so this page can never disagree with
 * what is actually transferred. A fully refunded order nets to 0: it is never paid out.
 */
export function sellerEarnings(sellerId: string, month?: string): { rows: EarningRow[]; totals: EarningsTotals } {
  const db = getDb();
  const monthOk = month && /^\d{4}-\d{2}$/.test(month);
  const orders = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed')
    ${monthOk ? "AND strftime('%Y-%m', created_at) = ?" : ''} ORDER BY created_at DESC`)
    .all(...(monthOk ? [sellerId, month] : [sellerId])) as Order[];
  const payouts = new Map((db.prepare('SELECT * FROM payouts WHERE seller_id = ?').all(sellerId) as Payout[]).map((p) => [p.id, p]));
  const eligible = new Set(payoutEligibleOrders(sellerId).map((o) => o.id));
  const sellerRefunds = new Map((db.prepare(
    'SELECT order_id, -sum(seller_net_delta) s FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.seller_id = ? GROUP BY order_id',
  ).all(sellerId) as { order_id: string; s: number }[]).map((r) => [r.order_id, r.s]));

  const rows: EarningRow[] = orders.map((o) => {
    const p = o.payout_id ? payouts.get(o.payout_id) : undefined;
    const status: EarningStatus = o.status === 'refunded' ? 'refunded'
      : p?.status === 'paid' ? 'paid' : p ? 'in_payout' : eligible.has(o.id) ? 'available' : 'pending';
    const refundedAll = o.status === 'refunded';
    return {
      id: o.id, code: o.code, created_at: o.created_at, product: o.product_title + (o.variant_label ? ` · ${o.variant_label}` : ''), qty: o.quantity,
      listPrice: o.subtotal + o.discount_amount, discount: o.discount_amount, paid: o.subtotal,
      commissionRate: o.commission_rate, commission: refundedAll ? 0 : o.commission_amount + o.commission_vat,
      refunded: refundedAll ? o.subtotal : o.refunded_amount, sellerRefund: refundedAll ? 0 : (sellerRefunds.get(o.id) ?? 0),
      net: refundedAll ? 0 : o.seller_net, deliveryFee: o.delivery_fee,
      status, payoutRef: p?.reference ?? null, payoutDate: p?.paid_at ?? null,
    };
  });
  const sum = (k: keyof EarningsTotals) => rows.reduce((a, r) => a + (r[k] as number), 0);
  return { rows, totals: { listPrice: sum('listPrice'), discount: sum('discount'), paid: sum('paid'), commission: sum('commission'), refunded: sum('refunded'), sellerRefund: sum('sellerRefund'), net: sum('net') } };
}

export const earningMonths = (sellerId: string) =>
  (getDb().prepare("SELECT DISTINCT strftime('%Y-%m', created_at) m FROM orders WHERE seller_id = ? ORDER BY m DESC").all(sellerId) as { m: string }[]).map((r) => r.m);

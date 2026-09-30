import { getDb } from './db';
import { payoutEligibleOrders } from './orders';
import type { Order, Payout } from './types';
import type { TKey } from './i18n';

export type EarningStatus = 'paid' | 'in_payout' | 'available' | 'pending' | 'refunded';
export interface EarningRow {
  id: string; code: string; created_at: string; product: string; qty: number;
  listPrice: number; discount: number; paid: number; commissionRate: number; commission: number;
  refunded: number; sellerRefund: number; net: number; deliveryFee: number;
  commissionExVat: number; commissionVat: number; orderState: Order['order_state']; orderStatus: Order['status'];
  status: EarningStatus; payoutRef: string | null; payoutDate: string | null;
}
export interface EarningsTotals { listPrice: number; discount: number; paid: number; commission: number; commissionExVat: number; commissionVat: number; refunded: number; sellerRefund: number; net: number; deliveryFee: number }

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
      commissionExVat: refundedAll ? 0 : o.commission_amount, commissionVat: refundedAll ? 0 : o.commission_vat,
      orderState: o.order_state, orderStatus: o.status,
      status, payoutRef: p?.reference ?? null, payoutDate: p?.paid_at ?? null,
    };
  });
  const sum = (k: keyof EarningsTotals) => rows.reduce((a, r) => a + (r[k] as number), 0);
  return { rows, totals: { listPrice: sum('listPrice'), discount: sum('discount'), paid: sum('paid'), commission: sum('commission'), commissionExVat: sum('commissionExVat'), commissionVat: sum('commissionVat'), refunded: sum('refunded'), sellerRefund: sum('sellerRefund'), net: sum('net'), deliveryFee: sum('deliveryFee') } };
}

export const earningMonths = (sellerId: string) =>
  (getDb().prepare("SELECT DISTINCT strftime('%Y-%m', created_at) m FROM orders WHERE seller_id = ? ORDER BY m DESC").all(sellerId) as { m: string }[]).map((r) => r.m);

/**
 * The one column list for the earnings page AND its CSV export, so the two never drift.
 * `money` columns are formatted on the page; the CSV always carries plain integers.
 * Delivery fee is shown separately: Paylo collects it and pays the courier, it is never
 * commissioned and never part of the seller's net.
 */
export type EarningColumn = { key: string; label: TKey; value: (r: EarningRow) => string | number | null; money?: boolean; negative?: boolean };
export const EARNING_COLUMNS: EarningColumn[] = [
  { key: 'date', label: 'date', value: (r) => r.created_at.slice(0, 10) },
  { key: 'order', label: 'order', value: (r) => r.code },
  { key: 'product', label: 'product', value: (r) => r.product },
  { key: 'qty', label: 'quantity', value: (r) => r.qty },
  { key: 'list_price', label: 'earn_list_price', value: (r) => r.listPrice, money: true },
  { key: 'discount', label: 'discount', value: (r) => r.discount, money: true, negative: true },
  { key: 'paid', label: 'earn_gross_goods', value: (r) => r.paid, money: true },
  { key: 'commission_rate', label: 'earn_commission_rate', value: (r) => r.commissionRate },
  { key: 'commission', label: 'commission', value: (r) => r.commissionExVat, money: true, negative: true },
  { key: 'commission_vat', label: 'earn_commission_vat', value: (r) => r.commissionVat, money: true, negative: true },
  { key: 'refunded', label: 'refunded_so_far', value: (r) => r.refunded, money: true, negative: true },
  { key: 'refund_borne_by_seller', label: 'earn_refunds_you_bore', value: (r) => r.sellerRefund, money: true, negative: true },
  { key: 'net', label: 'earn_net', value: (r) => r.net, money: true },
  { key: 'delivery_fee_platform_held', label: 'earn_delivery_held', value: (r) => r.deliveryFee, money: true },
  { key: 'order_state', label: 'order_state', value: (r) => r.orderState },
  { key: 'fulfilment_status', label: 'fulfillment_state', value: (r) => r.orderStatus },
  { key: 'payout_status', label: 'status', value: (r) => r.status },
  { key: 'payout_reference', label: 'reference', value: (r) => r.payoutRef },
  { key: 'payout_date', label: 'earn_payout_date', value: (r) => r.payoutDate?.slice(0, 10) ?? null },
];

export interface PayoutBreakdown { gross: number; commissionExVat: number; commissionVat: number; deliveryHeld: number; refundsBorne: number }

/** Per payout run: what its orders added up to, from the same order columns the run paid. */
export function payoutBreakdowns(sellerId: string): Map<string, PayoutBreakdown> {
  const rows = getDb().prepare(`SELECT o.payout_id id, sum(o.subtotal) gross, sum(o.commission_amount) c, sum(o.commission_vat) v, sum(o.delivery_fee) d,
      sum(o.subtotal - o.commission_amount - o.commission_vat - o.seller_net) rb
    FROM orders o WHERE o.seller_id = ? AND o.payout_id IS NOT NULL GROUP BY o.payout_id`).all(sellerId) as { id: string; gross: number; c: number; v: number; d: number; rb: number }[];
  return new Map(rows.map((r) => [r.id, { gross: r.gross, commissionExVat: r.c, commissionVat: r.v, deliveryHeld: r.d, refundsBorne: r.rb }]));
}

import { getDb } from './db';
import { deliveryStats } from './health';
import { nextTransferDate } from './payouts-schedule';

/**
 * Live counts for the owner and admin dashboards. Each is a single indexed COUNT/SUM, so
 * unlike lib/analytics.ts (cached heavy aggregates) these are computed on page load and
 * are never stale.
 */
export function queueCounts() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const d = deliveryStats();
  return {
    pendingRegistrations: one("SELECT count(*) c FROM store_registration_requests WHERE status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED')"),
    kycWaiting: one("SELECT count(*) c FROM sellers WHERE kyc_status = 'submitted'"),
    transfersToConfirm: one("SELECT count(*) c FROM bank_transfers b JOIN orders o ON o.id = b.order_id WHERE b.status = 'submitted' AND o.status = 'awaiting_payment'"),
    transfersAwaitingProof: one("SELECT count(*) c FROM bank_transfers b JOIN orders o ON o.id = b.order_id WHERE b.status = 'awaiting_proof' AND o.status = 'awaiting_payment'"),
    openDisputes: one("SELECT count(*) c FROM disputes WHERE status IN ('open','investigating')"),
    failedPayouts: one("SELECT count(*) c FROM payouts WHERE status = 'failed'"),
    pendingPayouts: one("SELECT count(*) c FROM payouts WHERE status = 'pending'"),
    codUncollected: one("SELECT count(*) c FROM orders WHERE payment_method = 'cod' AND status = 'delivered' AND payment_status NOT IN ('collected_cod','refunded')"),
    webhooksDead: d.webhooksDead, webhooksRetrying: d.webhooksRetrying, pushFailed7d: d.pushFailed7d, notifyFailed7d: d.notifyFailed7d,
  };
}

export function moneySummary() {
  const db = getDb();
  const sum = (sql: string) => (db.prepare(sql).get() as { s: number | null }).s ?? 0;
  return {
    // Sellers' money Paylo has received and not yet paid out (excludes refunded orders).
    heldForSellers: sum(`SELECT sum(o.seller_net) s FROM orders o LEFT JOIN payouts p ON p.id = o.payout_id
      WHERE o.payment_status IN ('confirmed','collected_cod') AND o.status != 'refunded' AND (o.payout_id IS NULL OR p.status != 'paid')`),
    // Commission on paid orders placed this calendar month (UTC), net of refunds returned.
    commissionThisMonth: sum(`SELECT sum(commission_amount + commission_vat) s FROM orders
      WHERE payment_status IN ('confirmed','collected_cod') AND status != 'refunded' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`),
    nextPayoutDate: nextTransferDate().toISOString().slice(0, 10),
    failedPayoutAmount: sum("SELECT sum(amount) s FROM payouts WHERE status = 'failed'"),
  };
}

export function growthSummary() {
  const db = getDb();
  const g = (since: string) => db.prepare(`SELECT count(*) n, coalesce(sum(total - refunded_amount), 0) gmv FROM orders
    WHERE created_at >= datetime('now', ?) AND status NOT IN ('cancelled','payment_failed')`).get(since) as { n: number; gmv: number };
  const today = db.prepare(`SELECT count(*) n, coalesce(sum(total - refunded_amount), 0) gmv FROM orders
    WHERE date(created_at, '+3 hours') = date('now', '+3 hours') AND status NOT IN ('cancelled','payment_failed')`).get() as { n: number; gmv: number };
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    today, d7: g('-7 days'), d30: g('-30 days'),
    newSellers30d: one("SELECT count(*) c FROM sellers WHERE created_at >= datetime('now','-30 days')"),
  };
}

export function latestRegistrations(limit = 5) {
  return getDb().prepare(`SELECT id, full_name, store_name, governorate, status, submitted_at FROM store_registration_requests
    WHERE status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED') ORDER BY submitted_at DESC LIMIT ?`).all(limit) as
    { id: string; full_name: string; store_name: string; governorate: string; status: string; submitted_at: string }[];
}

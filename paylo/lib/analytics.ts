import { getDb, nowIso } from './db';
import { payoutEligibleOrders } from './orders';
import { nextTransferDate } from './payouts-schedule';

/**
 * Owner-dashboard aggregates. Every function here does a handful of GROUP BY queries
 * over indexed columns — cheap individually — but the point of caching them (see
 * writeCache/readCache below) is that the owner pages never run ANY of this on a
 * plain page load. Both the "Refresh now" server action and the scheduled
 * /api/internal/refresh-analytics endpoint call these same functions and write one
 * row each into analytics_cache; the pages only ever read that table.
 */

export const OVERVIEW_KEY = 'owner_overview';
export const MARKET_KEY = 'owner_market_analytics';

export function writeCache(key: string, payload: unknown) {
  getDb().prepare('INSERT INTO analytics_cache (key, computed_at, payload) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET computed_at = excluded.computed_at, payload = excluded.payload')
    .run(key, nowIso(), JSON.stringify(payload));
}

export function readCache<T>(key: string): { computedAt: string; data: T } | null {
  const row = getDb().prepare('SELECT computed_at, payload FROM analytics_cache WHERE key = ?').get(key) as { computed_at: string; payload: string } | undefined;
  if (!row) return null;
  return { computedAt: row.computed_at, data: JSON.parse(row.payload) as T };
}

/* ------------------------------ Overview ------------------------------ */

export interface StoreSummary {
  id: string; store_name: string; slug: string; status: string;
  product_count: number; order_count: number; last_activity: string | null;
}
export interface OwnerOverview {
  storeCount: number;
  stores: StoreSummary[];
  incomeByDay: { period: string; commission: number; gmv: number }[];
  incomeByWeek: { period: string; commission: number; gmv: number }[];
  incomeByMonth: { period: string; commission: number; gmv: number }[];
  gmvByStore: { store_name: string; gmv: number; commission: number }[];
  orderVolumeByState: Record<'open' | 'closed' | 'cancelled' | 'returned', number>;
  pendingPayoutTotal: number;
  nextPayoutDate: string;
  flaggedOrders: FlaggedOrder[];
}
export interface FlaggedOrder {
  id: string; code: string; store_name: string; buyer_name: string; total: number;
  reason: string; since: string | null;
}

export function computeOwnerOverview(): OwnerOverview {
  const db = getDb();

  const stores = db.prepare(`
    SELECT s.id, s.store_name, s.slug, s.status,
      (SELECT count(*) FROM products p WHERE p.seller_id = s.id AND p.status != 'removed') product_count,
      (SELECT count(*) FROM orders o WHERE o.seller_id = s.id) order_count,
      (SELECT max(o.created_at) FROM orders o WHERE o.seller_id = s.id) last_activity
    FROM sellers s WHERE s.status = 'approved' ORDER BY last_activity DESC`).all() as StoreSummary[];

  // Income = commission actually realized, i.e. on orders that reached Closed.
  const incomeByDay = db.prepare(`
    SELECT date(created_at) period, sum(commission_amount + commission_vat) commission, sum(subtotal) gmv
    FROM orders WHERE order_state = 'closed' AND created_at >= datetime('now', '-30 days')
    GROUP BY period ORDER BY period`).all() as { period: string; commission: number; gmv: number }[];
  const incomeByWeek = db.prepare(`
    SELECT strftime('%Y-W%W', created_at) period, sum(commission_amount + commission_vat) commission, sum(subtotal) gmv
    FROM orders WHERE order_state = 'closed' AND created_at >= datetime('now', '-84 days')
    GROUP BY period ORDER BY period`).all() as { period: string; commission: number; gmv: number }[];
  const incomeByMonth = db.prepare(`
    SELECT strftime('%Y-%m', created_at) period, sum(commission_amount + commission_vat) commission, sum(subtotal) gmv
    FROM orders WHERE order_state = 'closed' AND created_at >= datetime('now', '-365 days')
    GROUP BY period ORDER BY period`).all() as { period: string; commission: number; gmv: number }[];

  const gmvByStore = db.prepare(`
    SELECT s.store_name, coalesce(sum(o.subtotal), 0) gmv, coalesce(sum(o.commission_amount + o.commission_vat), 0) commission
    FROM sellers s LEFT JOIN orders o ON o.seller_id = s.id AND o.order_state = 'closed'
    WHERE s.status = 'approved' GROUP BY s.id ORDER BY gmv DESC`).all() as { store_name: string; gmv: number; commission: number }[];

  const stateRows = db.prepare('SELECT order_state, count(*) c FROM orders GROUP BY order_state').all() as { order_state: string; c: number }[];
  const orderVolumeByState = { open: 0, closed: 0, cancelled: 0, returned: 0 };
  for (const r of stateRows) if (r.order_state in orderVolumeByState) (orderVolumeByState as Record<string, number>)[r.order_state] = r.c;

  const pendingPayoutTotal = payoutEligibleOrders().reduce((s, o) => s + o.seller_net, 0);

  const flaggedOrders: FlaggedOrder[] = [];
  const flag = (sql: string, reason: string) => {
    const rows = db.prepare(sql).all() as { id: string; code: string; store_name: string; buyer_name: string; total: number; since: string | null }[];
    for (const r of rows) flaggedOrders.push({ ...r, reason });
  };
  flag(`SELECT o.id, o.code, s.store_name, o.buyer_name, o.total, b.submitted_at since
        FROM orders o JOIN sellers s ON s.id = o.seller_id JOIN bank_transfers b ON b.order_id = o.id
        WHERE b.status IN ('awaiting_proof','submitted')`, 'Bank transfer awaiting confirmation');
  flag(`SELECT o.id, o.code, s.store_name, o.buyer_name, o.total, o.created_at since
        FROM orders o JOIN sellers s ON s.id = o.seller_id
        WHERE o.status = 'confirmed' AND o.created_at <= datetime('now','-2 days')`, 'Paid, not shipped in 2+ days');
  flag(`SELECT o.id, o.code, s.store_name, o.buyer_name, o.total, o.handed_off_at since
        FROM orders o JOIN sellers s ON s.id = o.seller_id
        WHERE o.status IN ('handed_off','in_transit','ready_for_pickup') AND coalesce(o.handed_off_at, o.created_at) <= datetime('now','-7 days')`, 'In delivery 7+ days');
  flag(`SELECT o.id, o.code, s.store_name, o.buyer_name, o.total, o.delivered_at since
        FROM orders o JOIN sellers s ON s.id = o.seller_id
        WHERE o.payment_method = 'cod' AND o.status = 'delivered' AND o.payment_status != 'collected_cod'`, 'Delivered, cash not recorded');
  flag(`SELECT o.id, o.code, s.store_name, o.buyer_name, o.total, o.created_at since
        FROM orders o JOIN sellers s ON s.id = o.seller_id
        WHERE o.status = 'payment_failed' AND o.created_at >= datetime('now','-30 days')`, 'Payment failed');
  flag(`SELECT o.id, o.code, s.store_name, o.buyer_name, o.total, a.created_at since
        FROM orders o JOIN sellers s ON s.id = o.seller_id JOIN address_change_requests a ON a.order_id = o.id
        WHERE a.status = 'pending'`, 'Address change pending review');
  flaggedOrders.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));

  return {
    storeCount: stores.length, stores, incomeByDay, incomeByWeek, incomeByMonth, gmvByStore,
    orderVolumeByState: orderVolumeByState as OwnerOverview['orderVolumeByState'],
    pendingPayoutTotal, nextPayoutDate: nextTransferDate().toISOString().slice(0, 10), flaggedOrders,
  };
}

/* --------------------------- Market analytics --------------------------- */

export interface ProductRank { product_id: string; title: string; store_name: string; seller_id: string; qty: number; revenue: number }
export interface MarketAnalytics {
  topProductsOverall: ProductRank[];
  topProductsByStore: Record<string, ProductRank[]>;
  stores: { id: string; store_name: string }[];
  aov: number;
  avgSpendPerBuyer: number;
  distinctBuyers: number;
  repeatBuyerRate: number;
  avgOrdersPerBuyer: number;
  geo: { governorate: string; orders: number; total: number }[];
  paymentMix: { payment_method: string; orders: number; total: number }[];
  byHour: { hour: number; orders: number }[];
  byWeekday: { weekday: number; orders: number }[];
  /** Last 90 days, zero-filled; GMV = goods + delivery buyers paid, net of refunds. */
  daily: { day: string; gmv: number; orders: number; aov: number }[];
  topByRevenue: ProductRank[];
  /** Live product prices per category (collection name, else product type). */
  priceByCategory: { category: string; products: number; min: number; p25: number; median: number; p75: number; max: number; buckets: number[] }[];
  priceBucketEdges: number[];
  /** Last 30 days of the event log: distinct sessions per step (orders: placed events). */
  funnel: { views: number; checkoutStarts: number; ordersPlaced: number; viewSessions: number; startSessions: number; orderSessions: number };
  growth: { newSellers30d: number; newSellers7d: number; pendingRegistrations: number; approvedSellers: number };
}

const PRICE_EDGES = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** Orders that meaningfully represent a sale: excludes cancelled and never-paid orders. */
const SOLD_FILTER = "o.order_state != 'cancelled' AND o.status != 'payment_failed' AND o.status != 'awaiting_payment'";

export function computeMarketAnalytics(): MarketAnalytics {
  const db = getDb();

  const stores = db.prepare("SELECT id, store_name FROM sellers WHERE status = 'approved' ORDER BY store_name").all() as { id: string; store_name: string }[];

  const productRows = db.prepare(`
    SELECT o.product_id, o.product_title title, s.store_name, o.seller_id, sum(o.quantity) qty, sum(o.subtotal) revenue
    FROM orders o JOIN sellers s ON s.id = o.seller_id
    WHERE ${SOLD_FILTER} GROUP BY o.product_id ORDER BY qty DESC`).all() as ProductRank[];
  const topProductsOverall = productRows.slice(0, 20);
  const topProductsByStore: Record<string, ProductRank[]> = {};
  for (const p of productRows) {
    (topProductsByStore[p.seller_id] ??= []).push(p);
  }
  for (const k of Object.keys(topProductsByStore)) topProductsByStore[k] = topProductsByStore[k].slice(0, 20);

  const totals = db.prepare(`SELECT coalesce(avg(total),0) aov, count(*) n FROM orders o WHERE ${SOLD_FILTER}`).get() as { aov: number; n: number };

  const perBuyer = db.prepare(`
    SELECT buyer_phone, count(*) orders, sum(total) spend FROM orders o
    WHERE ${SOLD_FILTER} GROUP BY buyer_phone`).all() as { buyer_phone: string; orders: number; spend: number }[];
  const distinctBuyers = perBuyer.length;
  const avgSpendPerBuyer = distinctBuyers ? perBuyer.reduce((s, b) => s + b.spend, 0) / distinctBuyers : 0;
  const avgOrdersPerBuyer = distinctBuyers ? perBuyer.reduce((s, b) => s + b.orders, 0) / distinctBuyers : 0;
  const repeatBuyerRate = distinctBuyers ? perBuyer.filter((b) => b.orders > 1).length / distinctBuyers : 0;

  const geo = db.prepare(`SELECT governorate, count(*) orders, sum(total) total FROM orders o WHERE ${SOLD_FILTER} GROUP BY governorate ORDER BY orders DESC`).all() as { governorate: string; orders: number; total: number }[];
  const paymentMix = db.prepare(`SELECT payment_method, count(*) orders, sum(total) total FROM orders o WHERE ${SOLD_FILTER} GROUP BY payment_method`).all() as { payment_method: string; orders: number; total: number }[];
  // created_at is UTC; Syria is UTC+3 all year, so hours and weekdays are shifted to local time.
  const byHourRows = db.prepare(`SELECT cast(strftime('%H', created_at, '+3 hours') as integer) hour, count(*) orders FROM orders o WHERE ${SOLD_FILTER} GROUP BY hour`).all() as { hour: number; orders: number }[];
  const byWeekdayRows = db.prepare(`SELECT cast(strftime('%w', created_at, '+3 hours') as integer) weekday, count(*) orders FROM orders o WHERE ${SOLD_FILTER} GROUP BY weekday`).all() as { weekday: number; orders: number }[];
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byHourRows.find((r) => r.hour === hour)?.orders ?? 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, orders: byWeekdayRows.find((r) => r.weekday === weekday)?.orders ?? 0 }));

  const dailyRows = db.prepare(`SELECT date(created_at, '+3 hours') d, sum(total - refunded_amount) gmv, count(*) n FROM orders o
    WHERE ${SOLD_FILTER} AND created_at >= datetime('now','-91 days') GROUP BY d`).all() as { d: string; gmv: number; n: number }[];
  const dmap = new Map(dailyRows.map((r) => [r.d, r]));
  const today = new Date(Date.now() + 3 * 3600_000);
  const daily = Array.from({ length: 90 }, (_, i) => {
    const day = new Date(today.getTime() - (89 - i) * 86400_000).toISOString().slice(0, 10);
    const r = dmap.get(day);
    return { day, gmv: r?.gmv ?? 0, orders: r?.n ?? 0, aov: r && r.n ? Math.round(r.gmv / r.n) : 0 };
  });
  const topByRevenue = [...productRows].sort((a, b) => b.revenue - a.revenue).slice(0, 20);

  const live = db.prepare(`SELECT p.price, coalesce(c.name, p.type) category FROM products p LEFT JOIN collections c ON c.id = p.collection_id
    JOIN sellers s ON s.id = p.seller_id WHERE p.status IN ('active','out_of_stock') AND s.status = 'approved'`).all() as { price: number; category: string }[];
  const byCat = new Map<string, number[]>();
  for (const r of live) (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r.price);
  const q = (xs: number[], f: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(f * (xs.length - 1))))];
  const priceByCategory = [...byCat.entries()].map(([category, xs]) => {
    xs.sort((a, b) => a - b);
    const buckets = Array(PRICE_EDGES.length + 1).fill(0);
    for (const x of xs) buckets[PRICE_EDGES.findIndex((e) => x < e) === -1 ? PRICE_EDGES.length : PRICE_EDGES.findIndex((e) => x < e)]++;
    return { category, products: xs.length, min: xs[0], p25: q(xs, 0.25), median: q(xs, 0.5), p75: q(xs, 0.75), max: xs[xs.length - 1], buckets };
  }).sort((a, b) => b.products - a.products);

  const ev = (name: string) => db.prepare(`SELECT count(*) n, count(DISTINCT session_id) s FROM analytics_events WHERE name = ? AND at >= datetime('now','-30 days')`).get(name) as { n: number; s: number };
  const v = ev('product_view'), c = ev('checkout_start'), o = ev('order_placed');
  const funnel = { views: v.n, checkoutStarts: c.n, ordersPlaced: o.n, viewSessions: v.s, startSessions: c.s, orderSessions: o.s };

  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const growth = {
    newSellers30d: one("SELECT count(*) c FROM sellers WHERE status = 'approved' AND created_at >= datetime('now','-30 days')"),
    newSellers7d: one("SELECT count(*) c FROM sellers WHERE status = 'approved' AND created_at >= datetime('now','-7 days')"),
    pendingRegistrations: one("SELECT count(*) c FROM store_registration_requests WHERE status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED')"),
    approvedSellers: one("SELECT count(*) c FROM sellers WHERE status = 'approved'"),
  };

  return {
    topProductsOverall, topProductsByStore, stores, aov: totals.aov, avgSpendPerBuyer, distinctBuyers,
    repeatBuyerRate, avgOrdersPerBuyer, geo, paymentMix, byHour, byWeekday,
    daily, topByRevenue, priceByCategory, priceBucketEdges: PRICE_EDGES, funnel, growth,
  };
}

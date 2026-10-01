import { cookies } from 'next/headers';
import { getDb } from './db';
import { clientIp, hashIp, userAgent } from './request-meta';

/**
 * Append-only analytics event log (analytics_events).
 *
 * Rules:
 *  - track() NEVER throws. A logging failure must not break checkout or any money path:
 *    it is caught, logged to the server console, and dropped.
 *  - Money-relevant events (order_placed, payment_confirmed, refunds, price changes) are
 *    recorded server-side only. Lightweight funnel events (views, variant selects,
 *    checkout start) may come from the browser through /api/analytics/collect.
 *  - props never carry a national ID, a full address, a password, an email or card data;
 *    sanitizeProps() removes them by key and drops any value shaped like a national number.
 *  - IPs are stored only as a salted hash.
 */
export type AnalyticsEventName =
  | 'product_view' | 'variant_select' | 'checkout_start' | 'checkout_submit' | 'order_placed'
  | 'payment_confirmed' | 'order_cancelled' | 'order_refunded' | 'seller_product_create' | 'seller_product_update'
  | 'search_or_store_view' | 'registration_submit';

/** Events the browser may send. Everything else is server-only. */
export const CLIENT_EVENTS: AnalyticsEventName[] = ['product_view', 'variant_select', 'checkout_start', 'search_or_store_view'];

export interface TrackContext {
  sessionId?: string | null; actorType?: string | null; actorId?: string | null;
  sellerId?: string | null; productId?: string | null; variantId?: string | null; orderId?: string | null;
  ipHash?: string | null; userAgent?: string | null;
}

export const SESSION_COOKIE = 'paylo_sid';
const BLOCKED_KEY = /national|nid\b|^id_number|address|password|passwd|secret|token|email|card|iban|cvc|pan\b/i;

export function sanitizeProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (BLOCKED_KEY.test(k)) continue;
    if (typeof v === 'string' && /^\s*\d{11}\s*$/.test(v)) continue; // looks like a national number
    if (v === undefined || typeof v === 'function') continue;
    out[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

/** Request-derived context (session cookie, hashed IP, user agent); empty outside a request. */
export function requestContext(): TrackContext {
  let sessionId: string | null = null;
  try { sessionId = cookies().get(SESSION_COOKIE)?.value?.slice(0, 64) ?? null; } catch { /* not in a request */ }
  return { sessionId, ipHash: hashIp(clientIp()), userAgent: userAgent() };
}

export function track(name: AnalyticsEventName, props: Record<string, unknown> = {}, ctx: TrackContext = {}): void {
  try {
    const c = { ...requestContext(), ...ctx };
    getDb().prepare(`INSERT INTO analytics_events (name, session_id, actor_type, actor_id, seller_id, product_id, variant_id, order_id, props, ip_hash, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, c.sessionId ?? null, c.actorType ?? null, c.actorId ?? null, c.sellerId ?? null, c.productId ?? null,
        c.variantId ?? null, c.orderId ?? null, JSON.stringify(sanitizeProps(props)), c.ipHash ?? null, c.userAgent ?? null);
  } catch (e) {
    console.warn(`[analytics] dropped ${name}:`, (e as Error).message);
  }
}

/** Records a price change in product_price_history and as a seller_product_update event. Never throws. */
export function recordPriceChange(p: { productId: string; variantId?: string | null; sellerId: string; oldPrice: number | null; newPrice: number; source: string; actorId?: string | null }) {
  try {
    if (p.oldPrice === p.newPrice) return;
    getDb().prepare('INSERT INTO product_price_history (product_id, variant_id, seller_id, old_price, new_price, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.productId, p.variantId ?? null, p.sellerId, p.oldPrice, p.newPrice, p.source);
  } catch (e) {
    console.warn('[analytics] price history dropped:', (e as Error).message);
  }
}

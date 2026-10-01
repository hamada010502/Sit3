import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CLIENT_EVENTS, track, type AnalyticsEventName } from '@/lib/analytics-events';
import { clientIp, hashIp } from '@/lib/request-meta';

export const dynamic = 'force-dynamic';

/**
 * Browser funnel events only (CLIENT_EVENTS). seller_id is derived here from the product or
 * store, never taken from the client. Rate-limited per hashed IP (in-process window): a
 * flood is dropped with 429 and never reaches checkout.
 */
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 120;
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const key = hashIp(clientIp()) ?? 'anon';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) hits.clear();

  const body = await req.json().catch(() => null) as { name?: string; product_id?: string; variant_id?: string; store_slug?: string; props?: Record<string, unknown> } | null;
  if (!body || !CLIENT_EVENTS.includes(body.name as AnalyticsEventName)) return NextResponse.json({ error: 'bad_event' }, { status: 400 });
  const db = getDb();
  let sellerId: string | null = null, productId: string | null = null, variantId: string | null = null;
  if (body.product_id) {
    const p = db.prepare('SELECT id, seller_id FROM products WHERE id = ?').get(String(body.product_id)) as { id: string; seller_id: string } | undefined;
    if (!p) return NextResponse.json({ error: 'unknown_product' }, { status: 400 });
    productId = p.id; sellerId = p.seller_id;
    if (body.variant_id && db.prepare('SELECT 1 FROM product_variants WHERE id = ? AND product_id = ?').get(String(body.variant_id), p.id)) variantId = String(body.variant_id);
  } else if (body.store_slug) {
    sellerId = (db.prepare('SELECT id FROM sellers WHERE slug = ?').get(String(body.store_slug)) as { id: string } | undefined)?.id ?? null;
  }
  const props = typeof body.props === 'object' && body.props ? body.props : {};
  track(body.name as AnalyticsEventName, props, { actorType: 'buyer', sellerId, productId, variantId });
  return NextResponse.json({ ok: true });
}

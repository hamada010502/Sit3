import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { isOwnerAccount } from '@/lib/owner';
import { computeMarketAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/**
 * Owner-only CSV downloads (middleware + this DB-backed check, same rule as requireOwner).
 *   kind=daily&days=30|90   GMV / orders / AOV per day (Syria time)
 *   kind=products           top products by revenue and units
 *   kind=prices             price distribution per category
 *   kind=geo                orders and totals per governorate
 *   kind=events&days=N      raw analytics_events, last N days (max 365). No names, phones,
 *                           emails, addresses or national IDs exist in that table to export.
 * Non-owners get a plain 404, like every other /owner route.
 */
const cell = (v: unknown) => { let x = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
const csv = (head: string[], rows: unknown[][]) => [head.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';

export async function GET(req: Request) {
  const u = getCurrentUser();
  if (!u || !isOwnerAccount(u.email, u.role, u.totp_enabled)) return new NextResponse('Not found', { status: 404 });
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') || 'daily';
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  let body: string;
  if (kind === 'events') {
    const rows = getDb().prepare(`SELECT id, at, name, session_id, actor_type, actor_id, seller_id, product_id, variant_id, order_id, props, ip_hash, user_agent
      FROM analytics_events WHERE at >= datetime('now', ?) ORDER BY id`).all(`-${days} days`) as Record<string, unknown>[];
    const head = ['id', 'at', 'name', 'session_id', 'actor_type', 'actor_id', 'seller_id', 'product_id', 'variant_id', 'order_id', 'props', 'ip_hash', 'user_agent'];
    body = csv(head, rows.map((r) => head.map((h) => r[h])));
  } else {
    const d = computeMarketAnalytics();
    if (kind === 'products') {
      const units = new Map(d.topProductsOverall.map((p, i) => [p.product_id, i + 1]));
      body = csv(['rank_by_revenue', 'rank_by_units', 'product_id', 'title', 'store', 'units', 'revenue'],
        d.topByRevenue.map((p, i) => [i + 1, units.get(p.product_id) ?? '', p.product_id, p.title, p.store_name, p.qty, p.revenue]));
    } else if (kind === 'prices') {
      const e = d.priceBucketEdges;
      const labels = Array.from({ length: e.length + 1 }, (_, i) => (i === 0 ? `lt_${e[0]}` : i === e.length ? `gte_${e[i - 1]}` : `${e[i - 1]}_${e[i]}`));
      body = csv(['category', 'products', 'min', 'p25', 'median', 'p75', 'max', ...labels], d.priceByCategory.map((c) => [c.category, c.products, c.min, c.p25, c.median, c.p75, c.max, ...c.buckets]));
    } else if (kind === 'geo') {
      body = csv(['governorate', 'orders', 'total'], d.geo.map((g) => [g.governorate, g.orders, g.total]));
    } else {
      const n = days >= 90 ? 90 : 30;
      body = csv(['day', 'gmv', 'orders', 'aov'], d.daily.slice(-n).map((x) => [x.day, x.gmv, x.orders, x.aov]));
    }
  }
  return new NextResponse(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="paylo-${kind}${kind === 'events' || kind === 'daily' ? '-' + days + 'd' : ''}.csv"`, 'cache-control': 'no-store' } });
}

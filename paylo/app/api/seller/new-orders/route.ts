import { NextResponse } from 'next/server';
import { getCurrentSeller } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * New-order feed for the open seller dashboard. Scoped to the session's own store.
 * No `since` → returns only the current cursor (the baseline, so nothing already
 * there is announced). With `since` → orders created strictly after it, oldest first.
 */
export async function GET(req: Request) {
  const s = getCurrentSeller();
  if (!s || s.seller.status !== 'approved') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const since = new URL(req.url).searchParams.get('since');
  const db = getDb();
  const cursorRow = db.prepare('SELECT max(created_at) c FROM orders WHERE seller_id = ?').get(s.seller.id) as { c: string | null };
  if (!since) return NextResponse.json({ cursor: cursorRow.c ?? '1970-01-01 00:00:00', orders: [] });
  const orders = db.prepare(
    'SELECT id, code, product_title, total, created_at FROM orders WHERE seller_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 20',
  ).all(s.seller.id, since) as { id: string; code: string; product_title: string; total: number; created_at: string }[];
  return NextResponse.json({ cursor: orders.length ? orders[orders.length - 1].created_at : since, orders });
}

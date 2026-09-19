import { NextResponse } from 'next/server';
import { authenticate, pagination } from '@/lib/api';
import { getDb } from '@/lib/db';
import { publicOrder } from '@/lib/orders';
import type { Order } from '@/lib/types';

const STATES = ['open', 'closed', 'cancelled', 'returned'];

export async function GET(req: Request) {
  const auth = authenticate(req);
  if ('response' in auth) return auth.response;
  const { limit, offset, params } = pagination(req);
  const state = params.get('state');
  const where = ['seller_id = ?'];
  const args: unknown[] = [auth.seller.id];
  if (state && STATES.includes(state)) { where.push('order_state = ?'); args.push(state); }
  const db = getDb();
  const total = (db.prepare(`SELECT count(*) c FROM orders WHERE ${where.join(' AND ')}`).get(...args) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Order[];
  return NextResponse.json({ object: 'list', total, limit, offset, data: rows.map(publicOrder) });
}

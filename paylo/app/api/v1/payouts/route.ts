import { NextResponse } from 'next/server';
import { authenticate, pagination } from '@/lib/api';
import { getDb } from '@/lib/db';
import { sellerBalances } from '@/lib/orders';
import type { Payout } from '@/lib/types';

export async function GET(req: Request) {
  const auth = authenticate(req);
  if ('response' in auth) return auth.response;
  const { limit, offset } = pagination(req);
  const rows = getDb().prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(auth.seller.id, limit, offset) as Payout[];
  return NextResponse.json({
    object: 'list', limit, offset, balances: sellerBalances(auth.seller.id), currency: 'SYP',
    data: rows.map((p) => ({ id: p.id, period: p.period_label, cutoff_at: p.cutoff_at, orders: p.order_count,
      gross: p.gross, commission: p.commission, amount: p.amount, status: p.status, reference: p.reference, paid_at: p.paid_at })),
  });
}

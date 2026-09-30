import { NextResponse } from 'next/server';
import { getCurrentSeller } from '@/lib/auth';
import { sellerEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

/** Same numbers as the page, for the seller's accountant. Session-scoped to the own store. */
export async function GET(req: Request) {
  const s = getCurrentSeller();
  if (!s || s.seller.status !== 'approved') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const m = new URL(req.url).searchParams.get('m') || undefined;
  const { rows } = sellerEarnings(s.seller.id, m);
  // Quote every field; neutralise leading =,+,-,@ so a spreadsheet never runs a product title as a formula.
  const cell = (v: unknown) => { let x = String(v ?? ''); if (/^[=+\-@]/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
  const head = ['date', 'order', 'product', 'qty', 'list_price', 'discount', 'paid', 'commission_rate', 'commission', 'refunded', 'refund_borne_by_seller', 'net', 'delivery_fee_not_commissioned', 'status', 'payout_reference', 'payout_date'];
  const lines = rows.map((r) => [r.created_at, r.code, r.product, r.qty, r.listPrice, r.discount, r.paid, r.commissionRate, r.commission, r.refunded, r.sellerRefund, r.net, r.deliveryFee, r.status, r.payoutRef, r.payoutDate].map(cell).join(','));
  return new NextResponse([head.join(','), ...lines].join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="paylo-earnings${m ? '-' + m : ''}.csv"` },
  });
}

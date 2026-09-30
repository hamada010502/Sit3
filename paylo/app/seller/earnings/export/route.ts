import { NextResponse } from 'next/server';
import { getCurrentSeller } from '@/lib/auth';
import { EARNING_COLUMNS, sellerEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

/** Same numbers as the page, for the seller's accountant. Session-scoped to the own store. */
export async function GET(req: Request) {
  const s = getCurrentSeller();
  if (!s || s.seller.status !== 'approved') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const m = new URL(req.url).searchParams.get('m') || undefined;
  const { rows } = sellerEarnings(s.seller.id, m);
  // Quote every field; neutralise leading =,+,-,@ so a spreadsheet never runs a product title as a formula.
  const cell = (v: unknown) => { let x = String(v ?? ''); if (/^[=+\-@]/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
  // Same columns, same order as the page (EARNING_COLUMNS); amounts as plain integers.
  const head = EARNING_COLUMNS.map((c) => c.key);
  const lines = rows.map((r) => EARNING_COLUMNS.map((c) => cell(c.value(r))).join(','));
  return new NextResponse([head.join(','), ...lines].join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="paylo-earnings${m ? '-' + m : ''}.csv"` },
  });
}

import Link from 'next/link';
import { requireApprovedSeller } from '@/lib/guards';
import { earningMonths, sellerEarnings } from '@/lib/earnings';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';

export default function EarningsPage({ searchParams }: { searchParams: { m?: string } }) {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const months = earningMonths(seller.id);
  const month = searchParams.m && months.includes(searchParams.m) ? searchParams.m : undefined;
  const { rows, totals } = sellerEarnings(seller.id, month);
  const f = (n: number) => formatSYP(n, lang);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">{t('earnings_title')}</h1>
          <p className="text-sm text-ink-soft mt-1">{t('earnings_sub')}</p>
        </div>
        <a href={`/seller/earnings/export${month ? `?m=${month}` : ''}`} className="btn-secondary btn-sm" data-testid="earnings-csv">{t('export_csv')}</a>
      </div>
      <div className="flex flex-wrap gap-2 my-4">
        <Link href="/seller/payouts" className="badge border px-3 py-1 bg-white border-ink/15 text-ink-soft">← {t('nav_payouts')}</Link>
        <Link href="/seller/earnings" className={`badge border px-3 py-1 ${!month ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>{t('all')}</Link>
        {months.map((m) => <Link key={m} href={`/seller/earnings?m=${m}`} className={`badge border px-3 py-1 ${month === m ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`} dir="ltr">{m}</Link>)}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="earnings-totals">
        <div className="stat"><div className="stat-label">{t('earn_paid_by_buyers')}</div><div className="stat-value text-lg">{f(totals.paid)}</div></div>
        <div className="stat"><div className="stat-label">{t('commission')}</div><div className="stat-value text-lg">− {f(totals.commission)}</div></div>
        <div className="stat"><div className="stat-label">{t('earn_refunds_you_bore')}</div><div className="stat-value text-lg">− {f(totals.sellerRefund)}</div></div>
        <div className="stat"><div className="stat-label">{t('earn_net')}</div><div className="stat-value text-lg text-success" data-testid="earnings-net">{f(totals.net)}</div></div>
      </div>
      {rows.length === 0 ? <div className="card-pad text-center text-ink-soft">{t('none')}</div> : (
        <div className="card overflow-x-auto"><table className="table text-sm" data-testid="earnings-table">
          <thead><tr><th>{t('date')}</th><th>{t('order')}</th><th>{t('product')}</th><th>{t('earn_list_price')}</th><th>{t('discount')}</th><th>{t('commission')}</th><th>{t('refunded_so_far')}</th><th>{t('earn_net')}</th><th>{t('status')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-code={r.code}>
              <td className="text-xs text-ink-soft whitespace-nowrap" dir="ltr">{r.created_at.slice(0, 10)}</td>
              <td><Link href={`/seller/orders/${r.id}`} className="font-mono text-cherry" dir="ltr">{r.code}</Link></td>
              <td>{r.product} × {r.qty}</td>
              <td>{f(r.listPrice)}</td>
              <td>{r.discount ? `− ${f(r.discount)}` : '—'}</td>
              <td>{r.commission ? `− ${f(r.commission)}` : '—'}<div className="text-xs text-ink-soft">{r.commissionRate}%</div></td>
              <td>{r.refunded ? `− ${f(r.refunded)}` : '—'}{r.sellerRefund > 0 && <div className="text-xs text-cherry">{t('earn_you_bore', { n: f(r.sellerRefund) })}</div>}</td>
              <td className="font-semibold">{f(r.net)}</td>
              <td><span className="badge bg-ink/8 text-ink-soft">{t(`earn_st_${r.status}` as const)}</span>
                {r.payoutRef && <div className="text-xs text-ink-soft mt-1" dir="ltr">{r.payoutRef} · {r.payoutDate?.slice(0, 10)}</div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="text-xs text-ink-soft mt-3">{t('earn_footnote')}</p>
    </div>
  );
}

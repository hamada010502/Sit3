import Link from 'next/link';
import { requireApprovedSeller } from '@/lib/guards';
import { EmptyState } from '@/components/EmptyState';
import { OrderStateBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { EARNING_COLUMNS, earningMonths, sellerEarnings } from '@/lib/earnings';
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
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6" data-testid="earnings-totals">
        <div className="stat"><div className="stat-label">{t('earn_gross_goods')}</div><div className="stat-value text-lg">{f(totals.paid)}</div></div>
        <div className="stat"><div className="stat-label">{t('commission')}</div><div className="stat-value text-lg">− {f(totals.commissionExVat)}</div>
          {totals.commissionVat > 0 && <p className="mt-1 text-xs text-ink-soft">{t('earn_commission_vat')}: − {f(totals.commissionVat)}</p>}</div>
        <div className="stat"><div className="stat-label">{t('earn_refunds_you_bore')}</div><div className="stat-value text-lg">− {f(totals.sellerRefund)}</div></div>
        <div className="stat"><div className="stat-label">{t('earn_net')}</div><div className="stat-value text-lg text-success" data-testid="earnings-net">{f(totals.net)}</div></div>
        <div className="stat" data-testid="earnings-delivery"><div className="stat-label">{t('earn_delivery_held')}</div><div className="stat-value text-lg text-ink-soft">{f(totals.deliveryFee)}</div>
          <p className="mt-1 text-xs text-ink-soft">{t('earn_delivery_held_d')}</p></div>
      </div>
      {rows.length === 0 ? <EmptyState icon="receipt" title={t('earn_empty')} body={t('earn_empty_body')} action={{ href: '/seller/products', label: t('nav_products') }} /> : (
        <div className="card overflow-x-auto"><table className="table text-sm" data-testid="earnings-table">
          <thead><tr>{EARNING_COLUMNS.map((c) => <th key={c.key} data-col={c.key} className="whitespace-nowrap">{t(c.label)}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-code={r.code}>{EARNING_COLUMNS.map((c) => {
              const v = c.value(r);
              const cell = c.key === 'order' ? <Link href={`/seller/orders/${r.id}`} className="tap-inline font-mono text-cherry" dir="ltr">{r.code}</Link>
                : c.key === 'order_state' ? <OrderStateBadge state={r.orderState} t={t} />
                : c.key === 'fulfilment_status' ? <OrderStatusBadge status={r.orderStatus} t={t} />
                : c.key === 'payout_status' ? <span className="badge bg-ink/8 text-ink-soft">{t(`earn_st_${r.status}` as const)}</span>
                : c.key === 'commission_rate' ? `${v}%`
                : c.money ? (v ? `${c.negative ? '− ' : ''}${f(Number(v))}` : '—')
                : (v ?? '—');
              return <td key={c.key} className={c.key === 'net' ? 'font-semibold whitespace-nowrap' : c.key === 'date' ? 'text-xs text-ink-soft whitespace-nowrap' : c.money ? 'whitespace-nowrap' : ''} dir={c.key === 'date' || c.key === 'payout_reference' ? 'ltr' : undefined}>{cell}</td>;
            })}</tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="text-xs text-ink-soft mt-3">{t('earn_footnote')}</p>
    </div>
  );
}

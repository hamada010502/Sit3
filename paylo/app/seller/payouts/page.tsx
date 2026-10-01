import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { sellerBalances } from '@/lib/orders';
import type { Payout } from '@/lib/types';
import { EmptyState } from '@/components/EmptyState';
import { payoutBreakdowns } from '@/lib/earnings';

export default function SellerPayoutsPage() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const bal = sellerBalances(seller.id);
  const breakdown = payoutBreakdowns(seller.id);
  const payouts = getDb().prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Payout[];
  return (
    <div>
      <h1 className="section-title">{t('payouts_title')}</h1>
      <p className="text-sm text-ink-soft mt-1 mb-2">{t('payouts_sub')}</p>
      <Link href="/seller/earnings" className="link text-sm inline-block mb-6" data-testid="earnings-link">{t('earnings_title')} →</Link>
      {seller.kyc_status !== 'approved' && <div className="alert-warn mb-5">{t('kyc_blocked_note')}</div>}
      <div className="grid sm:grid-cols-4 gap-3 mb-8">
        <div className="stat"><div className="stat-label">{t('bal_available')}</div><div className="stat-value text-lg text-success">{formatSYP(bal.available, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_pending')}</div><div className="stat-value text-lg">{formatSYP(bal.pending, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_lifetime')}</div><div className="stat-value text-lg">{formatSYP(bal.lifetime, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_next_payout')}</div><div className="stat-value text-lg" dir="ltr">{bal.nextPayout}</div></div>
      </div>
      {payouts.length === 0 ? <EmptyState icon="receipt" title={t('payouts_empty')} body={t('payouts_empty_body')} action={{ href: '/seller/earnings', label: t('earnings_title') }} /> : (
        <div className="card overflow-x-auto"><table className="table text-sm" data-testid="payouts-table">
          <thead><tr><th>{t('period')}</th><th>{t('orders_count')}</th><th>{t('earn_gross_goods')}</th><th>{t('commission')}</th><th>{t('earn_commission_vat')}</th><th>{t('earn_refunds_you_bore')}</th><th>{t('amount')}</th><th>{t('earn_delivery_held')}</th><th>{t('status')}</th><th>{t('reference')}</th></tr></thead>
          <tbody>{payouts.map((p) => {
            const b = breakdown.get(p.id);
            const f = (n: number | undefined) => (n ? formatSYP(n, lang) : '—');
            return (
            <tr key={p.id} data-payout={p.id}>
              <td className="whitespace-nowrap"><Link href={`/seller/earnings`} className="tap-inline">{p.period_label}</Link></td><td>{p.order_count}</td>
              <td className="whitespace-nowrap">{f(b?.gross ?? p.gross)}</td><td className="whitespace-nowrap">− {f(b?.commissionExVat ?? p.commission)}</td>
              <td className="whitespace-nowrap">{b?.commissionVat ? `− ${f(b.commissionVat)}` : '—'}</td>
              <td className="whitespace-nowrap">{b?.refundsBorne ? `− ${f(b.refundsBorne)}` : '—'}</td>
              <td className="font-semibold whitespace-nowrap" data-testid="payout-amount">{formatSYP(p.amount, lang)}</td>
              <td className="whitespace-nowrap text-ink-soft">{f(b?.deliveryHeld)}</td>
              <td><span className={`badge ${p.status === 'paid' ? 'bg-success/12 text-success' : p.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-warn/12 text-warn'}`}>
                {p.status === 'paid' ? t('payout_paid') : p.status === 'failed' ? t('mark_failed') : t('payout_pending')}</span></td>
              <td className="text-xs" dir="ltr">{p.reference ?? '—'}<div className="text-ink-soft">{p.paid_at ?? ''}</div></td>
            </tr>);
          })}</tbody>
        </table>
        <p className="text-xs text-ink-soft px-5 py-3">{t('earn_delivery_held_d')}</p></div>
      )}
    </div>
  );
}

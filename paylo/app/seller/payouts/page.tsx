import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { sellerBalances } from '@/lib/orders';
import type { Payout } from '@/lib/types';

export default function SellerPayoutsPage() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const bal = sellerBalances(seller.id);
  const payouts = getDb().prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Payout[];
  return (
    <div>
      <h1 className="section-title">{t('payouts_title')}</h1>
      <p className="text-sm text-ink-soft mt-1 mb-6">{t('payouts_sub')}</p>
      {seller.kyc_status !== 'approved' && <div className="alert-warn mb-5">{t('kyc_blocked_note')}</div>}
      <div className="grid sm:grid-cols-4 gap-3 mb-8">
        <div className="stat"><div className="stat-label">{t('bal_available')}</div><div className="stat-value text-lg text-success">{formatSYP(bal.available, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_pending')}</div><div className="stat-value text-lg">{formatSYP(bal.pending, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_lifetime')}</div><div className="stat-value text-lg">{formatSYP(bal.lifetime, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_next_payout')}</div><div className="stat-value text-lg" dir="ltr">{bal.nextPayout}</div></div>
      </div>
      {payouts.length === 0 ? <div className="card-pad text-center text-ink-soft">{t('payouts_empty')}</div> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>{t('period')}</th><th>{t('orders_count')}</th><th>{t('gross')}</th><th>{t('commission')}</th><th>{t('amount')}</th><th>{t('status')}</th><th>{t('reference')}</th></tr></thead>
          <tbody>{payouts.map((p) => (
            <tr key={p.id}>
              <td>{p.period_label}</td><td>{p.order_count}</td><td>{formatSYP(p.gross, lang)}</td><td>− {formatSYP(p.commission, lang)}</td>
              <td className="font-semibold">{formatSYP(p.amount, lang)}</td>
              <td><span className={`badge ${p.status === 'paid' ? 'bg-success/12 text-success' : p.status === 'failed' ? 'bg-cherry/8 text-cherry' : 'bg-warn/12 text-warn'}`}>
                {p.status === 'paid' ? t('payout_paid') : p.status === 'failed' ? t('mark_failed') : t('payout_pending')}</span></td>
              <td className="text-xs" dir="ltr">{p.reference ?? '—'}<div className="text-ink-soft">{p.paid_at ?? ''}</div></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

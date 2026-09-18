import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { heldOrders, payoutEligibleOrders } from '@/lib/orders';
import type { Payout } from '@/lib/types';

export default function SellerPayoutsPage() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const eligible = payoutEligibleOrders(seller.id).reduce((s, o) => s + o.seller_net, 0);
  const held = heldOrders(seller.id).reduce((s, o) => s + o.seller_net, 0);
  const payouts = getDb().prepare('SELECT * FROM payouts WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Payout[];
  const paidTotal = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  return (
    <div>
      <h1 className="text-2xl font-bold">{t('payouts_title')}</h1>
      <p className="text-sm text-bluewood/70 mt-1 mb-6">{t('payouts_sub')}</p>
      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        <div className="stat"><div className="stat-label">{t('payout_eligible')}</div><div className="stat-value text-lg text-crusta">{formatSYP(eligible, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('payout_held')}</div><div className="stat-value text-lg">{formatSYP(held, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('payout_paid_total')}</div><div className="stat-value text-lg">{formatSYP(paidTotal, lang)}</div></div>
      </div>
      {payouts.length === 0 ? <div className="card-pad text-center text-bluewood/60">{t('payouts_empty')}</div> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>{t('period')}</th><th>{t('orders_count')}</th><th>{t('gross')}</th><th>{t('commission')}</th><th>{t('amount')}</th><th>{t('status')}</th><th>{t('reference')}</th></tr></thead>
          <tbody>{payouts.map((p) => (
            <tr key={p.id}><td>{p.period_label}</td><td>{p.order_count}</td><td>{formatSYP(p.gross, lang)}</td><td>− {formatSYP(p.commission, lang)}</td><td className="font-semibold">{formatSYP(p.amount, lang)}</td>
              <td><span className={`badge ${p.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-tangerine/30 text-blossom'}`}>{p.status === 'paid' ? t('payout_paid') : t('payout_pending')}</span></td>
              <td className="text-xs" dir="ltr">{p.reference ?? '—'}<div className="text-bluewood/50">{p.paid_at ?? ''}</div></td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

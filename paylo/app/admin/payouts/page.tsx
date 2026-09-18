import { SubmitButton } from '@/components/SubmitButton';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { payoutEligibleOrders } from '@/lib/orders';
import type { Payout } from '@/lib/types';
import { generatePayoutsAction, markPaidAction } from './actions';

export default function AdminPayoutsPage({ searchParams }: { searchParams: { generated?: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const eligible = payoutEligibleOrders();
  const bySeller = new Map<string, { n: number; net: number }>();
  for (const o of eligible) { const c = bySeller.get(o.seller_id) ?? { n: 0, net: 0 }; c.n++; c.net += o.seller_net; bySeller.set(o.seller_id, c); }
  const sellers = Object.fromEntries((db.prepare('SELECT id, store_name, payout_details FROM sellers').all() as { id: string; store_name: string; payout_details: string | null }[]).map((s) => [s.id, s]));
  const payouts = db.prepare("SELECT * FROM payouts ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC").all() as Payout[];
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('a_payouts_title')}</h1>
      {searchParams.generated !== undefined && <div className="alert-success mb-4">{t('a_generated', { n: searchParams.generated })}</div>}
      <div className="card-pad mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1"><h2 className="font-semibold">{t('a_generate_payouts')}</h2><p className="text-sm text-bluewood/60">{t('a_generate_hint')}</p></div>
          <form action={generatePayoutsAction}><SubmitButton className="btn-primary" >{t('a_generate_payouts')}</SubmitButton></form>
        </div>
        {bySeller.size === 0 ? <p className="mt-3 text-sm text-bluewood/50">{t('a_none_eligible')}</p> : (
          <ul className="mt-3 text-sm divide-y divide-bluewood/5">
            {[...bySeller.entries()].map(([sid, c]) => <li key={sid} className="py-1.5 flex justify-between"><span>{sellers[sid]?.store_name} · {c.n} {t('orders_count').toLowerCase()}</span><span className="font-semibold">{formatSYP(c.net, lang)}</span></li>)}
          </ul>
        )}
      </div>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t('seller')}</th><th>{t('period')}</th><th>{t('orders_count')}</th><th>{t('gross')}</th><th>{t('commission')}</th><th>{t('amount')}</th><th>{t('status')}</th><th>{t('reference')}</th></tr></thead>
        <tbody>{payouts.map((p) => (
          <tr key={p.id}>
            <td><div className="font-semibold">{sellers[p.seller_id]?.store_name}</div><div className="text-xs text-bluewood/50 whitespace-pre-line max-w-xs">{sellers[p.seller_id]?.payout_details ?? '—'}</div></td>
            <td>{p.period_label}</td><td>{p.order_count}</td><td>{formatSYP(p.gross, lang)}</td><td>{formatSYP(p.commission, lang)}</td><td className="font-semibold">{formatSYP(p.amount, lang)}</td>
            <td><span className={`badge ${p.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-tangerine/30 text-blossom'}`}>{p.status === 'paid' ? t('payout_paid') : t('payout_pending')}</span></td>
            <td>{p.status === 'paid' ? <span className="text-xs" dir="ltr">{p.reference ?? '—'}<div className="text-bluewood/50">{p.paid_at}</div></span> : (
              <form action={markPaidAction.bind(null, p.id)} className="flex gap-1"><input name="reference" className="input py-1 text-xs" placeholder={t('reference')} /><SubmitButton className="btn-primary btn-sm shrink-0">{t('mark_paid')}</SubmitButton></form>
            )}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

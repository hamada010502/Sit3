import { SubmitButton } from '@/components/SubmitButton';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { payoutEligibleOrders } from '@/lib/orders';
import { nextCutoff, nextTransferDate } from '@/lib/payouts-schedule';
import type { Payout } from '@/lib/types';
import { generatePayoutsAction, markFailedAction, markPaidAction, reopenPayoutAction } from './actions';

export default function AdminPayoutsPage({ searchParams }: { searchParams: { generated?: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const eligible = payoutEligibleOrders();
  const bySeller = new Map<string, { n: number; net: number }>();
  for (const o of eligible) { const c = bySeller.get(o.seller_id) ?? { n: 0, net: 0 }; c.n++; c.net += o.seller_net; bySeller.set(o.seller_id, c); }
  const sellers = Object.fromEntries((db.prepare('SELECT id, store_name, payout_details, kyc_status FROM sellers').all() as
    { id: string; store_name: string; payout_details: string | null; kyc_status: string }[]).map((s) => [s.id, s]));
  const payouts = db.prepare("SELECT * FROM payouts ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, created_at DESC").all() as Payout[];

  return (
    <div>
      <h1 className="section-title mb-4">{t('a_payouts_title')}</h1>
      {searchParams.generated !== undefined && <div className="alert-success mb-4">{t('a_generated', { n: searchParams.generated })}</div>}

      <div className="card-pad mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="font-bold">{t('a_generate_payouts')}</h2>
            <p className="text-sm text-ink-soft">{t('a_generate_hint')}</p>
            <p className="mt-1 text-xs text-ink-soft" dir="ltr">
              {t('payout_cutoff_day')}: {nextCutoff().toISOString().slice(0, 16).replace('T', ' ')} UTC · {t('payout_transfer_day')}: {nextTransferDate().toISOString().slice(0, 10)}
            </p>
          </div>
          <form action={generatePayoutsAction}><SubmitButton className="btn-primary">{t('a_generate_payouts')}</SubmitButton></form>
        </div>
        {bySeller.size === 0 ? <p className="mt-3 text-sm text-ink-soft">{t('a_none_eligible')}</p> : (
          <ul className="mt-3 text-sm divide-y divide-ink/5">
            {[...bySeller.entries()].map(([sid, c]) => (
              <li key={sid} className="py-1.5 flex justify-between"><span>{sellers[sid]?.store_name} · {c.n}</span><span className="font-semibold">{formatSYP(c.net, lang)}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t('seller')}</th><th>{t('period')}</th><th>{t('orders_count')}</th><th>{t('gross')}</th><th>{t('commission')}</th><th>{t('amount')}</th><th>{t('status')}</th><th>{t('reference')}</th></tr></thead>
        <tbody>{payouts.map((p) => (
          <tr key={p.id}>
            <td><div className="font-semibold">{sellers[p.seller_id]?.store_name}</div>
              <div className="text-xs text-ink-soft whitespace-pre-line max-w-xs">{sellers[p.seller_id]?.payout_details ?? t('not_set')}</div></td>
            <td className="text-xs">{p.period_label}</td><td>{p.order_count}</td><td>{formatSYP(p.gross, lang)}</td><td>{formatSYP(p.commission, lang)}</td>
            <td className="font-semibold">{formatSYP(p.amount, lang)}</td>
            <td><span className={`badge ${p.status === 'paid' ? 'bg-success/12 text-success' : p.status === 'failed' ? 'bg-cherry/8 text-cherry' : 'bg-warn/12 text-warn'}`}>
              {p.status === 'paid' ? t('payout_paid') : p.status === 'failed' ? t('mark_failed') : t('payout_pending')}</span>
              {p.failure_reason && <div className="text-xs text-cherry mt-1">{p.failure_reason}</div>}</td>
            <td>
              {p.status === 'paid' ? <span className="text-xs" dir="ltr">{p.reference ?? '—'}<div className="text-ink-soft">{p.paid_at}</div></span> : (
                <form action={markPaidAction.bind(null, p.id)} className="flex flex-wrap gap-1">
                  <input name="reference" className="input py-1 text-xs w-28" placeholder={t('reference')} />
                  <SubmitButton className="btn-primary btn-sm shrink-0">{t('mark_paid')}</SubmitButton>
                  <button formAction={markFailedAction.bind(null, p.id)} className="btn-secondary btn-sm shrink-0">{t('mark_failed')}</button>
                  <button formAction={reopenPayoutAction.bind(null, p.id)} className="btn-ghost btn-sm shrink-0">{t('reopen_payout')}</button>
                </form>
              )}
            </td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

import Link from 'next/link';
import { requireOwner } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { OVERVIEW_KEY, readCache, type OwnerOverview } from '@/lib/analytics';
import { growthSummary, latestRegistrations, moneySummary, queueCounts } from '@/lib/dashboard';
import { refreshAnalyticsAction } from './actions';

/**
 * Owner home: registrations, high-level money and growth. Live counts at the top (cheap,
 * never stale); the heavier per-store aggregates below come from the analytics cache.
 * Day-to-day operations (confirming transfers, payouts, disputes) live in /admin.
 */
export default function OwnerOverviewPage() {
  requireOwner();
  const { t, lang } = getT();
  const f = (n: number) => formatSYP(n, lang);
  const q = queueCounts(), m = moneySummary(), g = growthSummary(), regs = latestRegistrations();
  const cached = readCache<OwnerOverview>(OVERVIEW_KEY);
  const Tile = ({ label, value, href, alert, testid, sub }: { label: string; value: number | string; href?: string; alert?: boolean; testid: string; sub?: string }) => {
    const inner = (<><div className="stat-label">{label}</div><div className={`stat-value text-lg ${alert ? 'text-cherry' : ''}`}>{value}</div>{sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}</>);
    return href ? <Link href={href} className="stat hover:border-cherry" data-testid={testid} data-value={String(value)}>{inner}</Link>
      : <div className="stat" data-testid={testid} data-value={String(value)}>{inner}</div>;
  };
  const stateLabel = { open: t('os_open'), closed: t('os_closed'), cancelled: t('os_cancelled'), returned: t('os_returned') } as const;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="section-title">{t('ow_title')}</h1>
        <p className="text-sm text-ink-soft mt-1">{t('ow_sub')}</p>
      </div>

      <section data-testid="ow-queues">
        <h2 className="font-semibold mb-3">{t('ow_queues')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Tile testid="q-registrations" label={t('ow_q_regs')} value={q.pendingRegistrations} href="/owner/registrations" alert={q.pendingRegistrations > 0} />
          <Tile testid="q-kyc" label={t('ops_kyc_waiting')} value={q.kycWaiting} href="/admin/ops" alert={q.kycWaiting > 0} />
          <Tile testid="q-transfers" label={t('ops_awaiting_transfer')} value={q.transfersToConfirm} href="/admin/ops" alert={q.transfersToConfirm > 0} sub={t('ow_q_awaiting_proof', { n: q.transfersAwaitingProof })} />
          <Tile testid="q-disputes" label={t('ow_q_disputes')} value={q.openDisputes} href="/admin/disputes" alert={q.openDisputes > 0} />
          <Tile testid="q-failures" label={t('ow_q_failures')} value={q.webhooksDead + q.pushFailed7d + q.notifyFailed7d} href="/admin/ops"
            alert={q.webhooksDead + q.notifyFailed7d > 0} sub={t('ow_q_failures_d', { w: q.webhooksDead, p: q.pushFailed7d, n: q.notifyFailed7d })} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section data-testid="ow-money">
          <h2 className="font-semibold mb-3">{t('ow_money')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Tile testid="m-held" label={t('ow_m_held')} value={f(m.heldForSellers)} sub={t('ow_m_held_d')} />
            <Tile testid="m-commission" label={t('ow_m_commission')} value={f(m.commissionThisMonth)} />
            <Tile testid="m-next-payout" label={t('bal_next_payout')} value={m.nextPayoutDate} href="/admin/payouts" />
            <Tile testid="m-failed-payouts" label={t('ops_failed_payouts')} value={q.failedPayouts} href="/admin/payouts" alert={q.failedPayouts > 0} sub={q.failedPayouts ? f(m.failedPayoutAmount) : undefined} />
          </div>
        </section>
        <section data-testid="ow-growth">
          <h2 className="font-semibold mb-3">{t('ow_growth')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Tile testid="g-today" label={t('ow_g_today')} value={g.today.n} sub={f(g.today.gmv)} />
            <Tile testid="g-7d" label={t('ow_g_7d')} value={g.d7.n} sub={f(g.d7.gmv)} />
            <Tile testid="g-30d" label={t('ow_g_30d')} value={g.d30.n} sub={f(g.d30.gmv)} />
            <Tile testid="g-sellers" label={t('oa_new_sellers_30')} value={g.newSellers30d} href="/owner/analytics" />
          </div>
        </section>
      </div>

      <section data-testid="ow-latest-regs">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{t('ow_latest_regs', { n: q.pendingRegistrations })}</h2>
          <Link href="/owner/registrations" className="link text-sm">{t('all')} →</Link>
        </div>
        {regs.length === 0 ? <div className="alert-success">{t('ow_no_regs')}</div> : (
          <div className="card overflow-x-auto"><table className="table">
            <thead><tr><th>{t('store_name')}</th><th>{t('full_name')}</th><th>{t('governorate')}</th><th>{t('status')}</th><th>{t('rg_submitted')}</th><th></th></tr></thead>
            <tbody>{regs.map((r) => (
              <tr key={r.id}><td className="font-semibold">{r.store_name}</td><td>{r.full_name}</td><td>{r.governorate}</td>
                <td className="text-xs">{r.status === 'PENDING_REVIEW' ? t('ow_reg_pending') : t('ow_reg_more_info')}</td>
                <td className="text-xs text-ink-soft whitespace-nowrap">{r.submitted_at}</td>
                <td><Link href={`/owner/registrations/${r.id}`} className="link text-sm">{t('ow_review')}</Link></td></tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t('ow_stores_title')}</h2>
            <p className="text-xs text-ink-soft">{cached ? t('oa_as_of', { at: cached.computedAt }) : t('oa_empty_body')}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/owner/analytics" className="btn-secondary btn-sm">{t('oa_title')} →</Link>
            <form action={refreshAnalyticsAction}><button className="btn-secondary btn-sm">{cached ? t('oa_refresh') : t('oa_compute')}</button></form>
          </div>
        </div>
        {cached && (<>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['open', 'closed', 'cancelled', 'returned'] as const).map((k) => (
              <div key={k} className="stat"><div className="stat-label">{stateLabel[k]}</div><div className="stat-value">{cached.data.orderVolumeByState[k]}</div></div>
            ))}
          </div>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('oa_store')}</th><th>{t('oa_products')}</th><th>{t('oa_orders_col')}</th><th>GMV</th><th>{t('commission')}</th><th>{t('ow_last_activity')}</th></tr></thead>
              <tbody>{cached.data.stores.map((s) => {
                const gm = cached.data.gmvByStore.find((x) => x.store_name === s.store_name);
                return (
                  <tr key={s.id}><td className="font-semibold">{s.store_name}</td><td>{s.product_count}</td><td>{s.order_count}</td>
                    <td className="whitespace-nowrap">{f(gm?.gmv ?? 0)}</td><td className="whitespace-nowrap">{f(gm?.commission ?? 0)}</td>
                    <td className="text-xs text-ink-soft whitespace-nowrap">{s.last_activity ?? '—'}</td></tr>
                );
              })}</tbody>
            </table>
          </div>
          {cached.data.flaggedOrders.length > 0 && (
            <div className="card overflow-x-auto">
              <h3 className="font-semibold px-4 pt-4 pb-1 text-sm">{t('ow_flagged')}</h3>
              <table className="table">
                <thead><tr><th>{t('order')}</th><th>{t('oa_store')}</th><th>{t('total')}</th><th>{t('ow_reason')}</th><th>{t('ow_since')}</th></tr></thead>
                <tbody>{cached.data.flaggedOrders.map((o) => (
                  <tr key={o.id + o.reason}><td className="font-mono font-semibold" dir="ltr">{o.code}</td><td>{o.store_name}</td>
                    <td className="whitespace-nowrap">{f(o.total)}</td><td className="text-cherry">{o.reason}</td>
                    <td className="text-xs text-ink-soft whitespace-nowrap">{o.since ?? '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>)}
      </section>
    </div>
  );
}

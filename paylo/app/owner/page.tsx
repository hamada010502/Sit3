import Link from 'next/link';
import { requireOwner } from '@/lib/guards';
import { formatSYP } from '@/lib/money';
import { OVERVIEW_KEY, readCache, type OwnerOverview } from '@/lib/analytics';
import { refreshAnalyticsAction } from './actions';

const STATE_LABEL: Record<string, string> = { open: 'Open', closed: 'Closed', cancelled: 'Cancelled', returned: 'Returned' };

export default function OwnerOverviewPage() {
  requireOwner();
  const cached = readCache<OwnerOverview>(OVERVIEW_KEY);

  if (!cached) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <h1 className="text-xl font-semibold">No data computed yet</h1>
        <p className="mt-2 text-sm text-ink-soft">This page reads from a cache, not a live query. Compute it once to populate it.</p>
        <form action={refreshAnalyticsAction} className="mt-6"><button className="btn-primary">Compute now</button></form>
      </div>
    );
  }
  const d = cached.data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Owner overview</h1>
          <p className="text-xs text-ink-soft mt-1">Data as of {cached.computedAt} UTC · read from cache, not computed on this page load</p>
        </div>
        <form action={refreshAnalyticsAction}><button className="btn-secondary btn-sm">Refresh now</button></form>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat"><div className="stat-label">Active stores</div><div className="stat-value">{d.storeCount}</div></div>
        <div className="stat"><div className="stat-label">Pending payout total</div><div className="stat-value text-lg">{formatSYP(d.pendingPayoutTotal)}</div></div>
        <div className="stat"><div className="stat-label">Next payout run</div><div className="stat-value text-lg">{d.nextPayoutDate}</div></div>
        <div className="stat"><div className="stat-label">Flagged orders</div><div className="stat-value text-cherry">{d.flaggedOrders.length}</div></div>
      </div>

      <section>
        <h2 className="font-semibold mb-3">Order volume by state</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['open', 'closed', 'cancelled', 'returned'] as const).map((k) => (
            <div key={k} className="stat"><div className="stat-label">{STATE_LABEL[k]}</div><div className="stat-value">{d.orderVolumeByState[k]}</div></div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Income — commission collected (closed orders only)</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {([['Last 30 days', d.incomeByDay], ['Last 12 weeks', d.incomeByWeek], ['Last 12 months', d.incomeByMonth]] as const).map(([title, rows]) => (
            <div key={title} className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-ink/8 text-sm font-semibold">{title}</div>
              <div className="max-h-56 overflow-y-auto">
                <table className="table text-xs">
                  <thead><tr><th>Period</th><th>Commission</th><th>GMV</th></tr></thead>
                  <tbody>{rows.length === 0 ? <tr><td colSpan={3} className="text-ink-soft text-center py-4">No closed orders yet</td></tr> :
                    rows.map((r) => <tr key={r.period}><td>{r.period}</td><td>{formatSYP(r.commission)}</td><td>{formatSYP(r.gmv)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Stores</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Store</th><th>Products</th><th>Orders</th><th>GMV</th><th>Commission</th><th>Last activity</th></tr></thead>
            <tbody>{d.stores.map((s) => {
              const gmv = d.gmvByStore.find((g) => g.store_name === s.store_name);
              return (
                <tr key={s.id}>
                  <td className="font-semibold">{s.store_name}</td><td>{s.product_count}</td><td>{s.order_count}</td>
                  <td>{formatSYP(gmv?.gmv ?? 0)}</td><td>{formatSYP(gmv?.commission ?? 0)}</td>
                  <td className="text-xs text-ink-soft whitespace-nowrap">{s.last_activity ?? '—'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Flagged &amp; stuck orders — every store, one view</h2>
        {d.flaggedOrders.length === 0 ? <div className="alert-success">Nothing flagged right now.</div> : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Order</th><th>Store</th><th>Buyer</th><th>Total</th><th>Reason</th><th>Since</th></tr></thead>
              <tbody>{d.flaggedOrders.map((o) => (
                <tr key={o.id + o.reason}>
                  <td className="font-mono font-semibold">{o.code}</td><td>{o.store_name}</td><td>{o.buyer_name}</td>
                  <td>{formatSYP(o.total)}</td><td className="text-cherry">{o.reason}</td>
                  <td className="text-xs text-ink-soft whitespace-nowrap">{o.since ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-ink-soft"><Link href="/owner/analytics" className="link">Market analytics →</Link></p>
    </div>
  );
}

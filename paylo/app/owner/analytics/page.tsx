import { requireOwner } from '@/lib/guards';
import { formatSYP } from '@/lib/money';
import { MARKET_KEY, readCache, type MarketAnalytics } from '@/lib/analytics';
import { refreshAnalyticsAction } from '../actions';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PM_LABEL: Record<string, string> = { cod: 'Cash on delivery', bank_transfer: 'Bank transfer', card: 'Card' };

export default function MarketAnalyticsPage({ searchParams }: { searchParams: { store?: string } }) {
  requireOwner();
  const cached = readCache<MarketAnalytics>(MARKET_KEY);

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
  const storeId = searchParams.store && d.topProductsByStore[searchParams.store] ? searchParams.store : null;
  const products = storeId ? d.topProductsByStore[storeId] : d.topProductsOverall;
  const maxHour = Math.max(1, ...d.byHour.map((h) => h.orders));
  const maxWeekday = Math.max(1, ...d.byWeekday.map((w) => w.orders));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Market analytics</h1>
          <p className="text-xs text-ink-soft mt-1">Data as of {cached.computedAt} UTC · read from cache, not computed on this page load</p>
        </div>
        <form action={refreshAnalyticsAction}><button className="btn-secondary btn-sm">Refresh now</button></form>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat"><div className="stat-label">Average order value</div><div className="stat-value text-lg">{formatSYP(d.aov)}</div></div>
        <div className="stat"><div className="stat-label">Avg. spend per buyer</div><div className="stat-value text-lg">{formatSYP(d.avgSpendPerBuyer)}</div></div>
        <div className="stat"><div className="stat-label">Repeat-buyer rate</div><div className="stat-value">{(d.repeatBuyerRate * 100).toFixed(1)}%</div></div>
        <div className="stat"><div className="stat-label">Avg. orders / buyer</div><div className="stat-value">{d.avgOrdersPerBuyer.toFixed(2)}</div></div>
      </div>
      <p className="text-xs text-ink-soft -mt-4">Buyers are identified by phone number — there is no buyer account system (guest checkout only), so this is the best available identity signal. {d.distinctBuyers} distinct buyers in the dataset.</p>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Top-selling products</h2>
          <form method="get" className="flex items-center gap-2 text-sm">
            <select name="store" className="input py-1.5 text-xs w-auto" defaultValue={storeId ?? ''}>
              <option value="">All stores</option>
              {d.stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
            <button className="btn-secondary btn-sm">Filter</button>
          </form>
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Product</th><th>Store</th><th>Units sold</th><th>Revenue</th></tr></thead>
            <tbody>{products.length === 0 ? <tr><td colSpan={4} className="text-ink-soft text-center py-6">No sales data yet</td></tr> :
              products.map((p) => <tr key={p.product_id}><td className="font-semibold">{p.title}</td><td>{p.store_name}</td><td>{p.qty}</td><td>{formatSYP(p.revenue)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-3">Geographic distribution (governorate)</h2>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Governorate</th><th>Orders</th><th>Total</th></tr></thead>
              <tbody>{d.geo.map((g) => <tr key={g.governorate}><td>{g.governorate}</td><td>{g.orders}</td><td>{formatSYP(g.total)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-ink-soft mt-1.5">By governorate only — the free-text street address isn&apos;t structured enough to aggregate reliably below that level.</p>
        </section>

        <section>
          <h2 className="font-semibold mb-3">Payment method mix</h2>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Method</th><th>Orders</th><th>Total</th><th>Share</th></tr></thead>
              <tbody>{d.paymentMix.map((p) => {
                const totalOrders = d.paymentMix.reduce((s, x) => s + x.orders, 0) || 1;
                return <tr key={p.payment_method}><td>{PM_LABEL[p.payment_method] ?? p.payment_method}</td><td>{p.orders}</td><td>{formatSYP(p.total)}</td><td>{((p.orders / totalOrders) * 100).toFixed(0)}%</td></tr>;
              })}</tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-3">Orders by hour of day</h2>
          <div className="card-pad space-y-1">
            {d.byHour.map((h) => (
              <div key={h.hour} className="flex items-center gap-2 text-xs">
                <span className="w-8 text-ink-soft tabular-nums">{String(h.hour).padStart(2, '0')}h</span>
                <div className="flex-1 bg-cream-deep rounded h-3 overflow-hidden"><div className="h-full bg-cherry" style={{ width: `${(h.orders / maxHour) * 100}%` }} /></div>
                <span className="w-8 text-end tabular-nums">{h.orders}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h2 className="font-semibold mb-3">Orders by day of week</h2>
          <div className="card-pad space-y-1.5">
            {d.byWeekday.map((w) => (
              <div key={w.weekday} className="flex items-center gap-2 text-xs">
                <span className="w-8 text-ink-soft">{WEEKDAY[w.weekday]}</span>
                <div className="flex-1 bg-cream-deep rounded h-3 overflow-hidden"><div className="h-full bg-cherry" style={{ width: `${(w.orders / maxWeekday) * 100}%` }} /></div>
                <span className="w-8 text-end tabular-nums">{w.orders}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

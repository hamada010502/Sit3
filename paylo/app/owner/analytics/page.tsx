import Link from 'next/link';
import { requireOwner } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { MARKET_KEY, readCache, type MarketAnalytics } from '@/lib/analytics';
import { SalesChart } from '@/components/SalesChart';
import { refreshAnalyticsAction } from '../actions';

/** Bars for a small labelled distribution (hour / weekday). One series, one colour, values printed. */
function Bars({ rows, testId }: { rows: { label: string; value: number }[]; testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="card-pad space-y-1" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs" data-label={r.label} data-value={r.value}>
          <span className="w-10 text-ink-soft tabular-nums" dir="ltr">{r.label}</span>
          <div className="flex-1 bg-cream-deep rounded h-3 overflow-hidden"><div className="h-full bg-brand rounded-e" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="w-10 text-end tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function MarketAnalyticsPage({ searchParams }: { searchParams: { store?: string; range?: string } }) {
  requireOwner();
  const { t, lang } = getT();
  const f = (n: number) => formatSYP(n, lang);
  const cached = readCache<MarketAnalytics>(MARKET_KEY);

  if (!cached || !cached.data.daily) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <h1 className="text-xl font-extrabold">{t('oa_empty_title')}</h1>
        <p className="mt-2 text-sm text-ink-soft">{t('oa_empty_body')}</p>
        <form action={refreshAnalyticsAction} className="mt-6"><button className="btn-primary">{t('oa_compute')}</button></form>
      </div>
    );
  }
  const d = cached.data;
  const range = searchParams.range === '90' ? 90 : 30;
  const days = d.daily.slice(-range);
  const gmv = days.reduce((s, x) => s + x.gmv, 0), orders = days.reduce((s, x) => s + x.orders, 0);
  const storeId = searchParams.store && d.topProductsByStore[searchParams.store] ? searchParams.store : null;
  const byUnits = storeId ? d.topProductsByStore[storeId] : d.topProductsOverall;
  const byRevenue = storeId ? [...d.topProductsByStore[storeId]].sort((a, b) => b.revenue - a.revenue) : d.topByRevenue;
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
  const pm = (m: string) => (m === 'cod' ? t('pm_cod') : m === 'bank_transfer' ? t('pm_bank_transfer') : m === 'card' ? t('pm_card') : m);
  const WEEKDAY = lang === 'ar' ? ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const edges = d.priceBucketEdges;
  const bucketLabel = (i: number) => (i === 0 ? `< ${edges[0] / 1000}k` : i === edges.length ? `≥ ${edges[i - 1] / 1000}k` : `${edges[i - 1] / 1000}k–${edges[i] / 1000}k`);
  const exp = (kind: string, extra = '') => `/owner/analytics/export?kind=${kind}${extra}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">{t('oa_title')}</h1>
          <p className="text-xs text-ink-soft mt-1">{t('oa_as_of', { at: cached.computedAt })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="?range=30" className={`btn-sm ${range === 30 ? 'btn-primary' : 'btn-secondary'}`}>{t('oa_30d')}</Link>
          <Link href="?range=90" className={`btn-sm ${range === 90 ? 'btn-primary' : 'btn-secondary'}`}>{t('oa_90d')}</Link>
          <form action={refreshAnalyticsAction}><button className="btn-secondary btn-sm">{t('oa_refresh')}</button></form>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="oa-kpis">
        <div className="stat"><div className="stat-label">{t('oa_gmv', { n: range })}</div><div className="stat-value text-lg" data-testid="oa-gmv">{f(gmv)}</div></div>
        <div className="stat"><div className="stat-label">{t('oa_orders', { n: range })}</div><div className="stat-value text-lg" data-testid="oa-orders">{orders}</div></div>
        <div className="stat"><div className="stat-label">{t('oa_aov')}</div><div className="stat-value text-lg">{f(orders ? Math.round(gmv / orders) : 0)}</div></div>
        <div className="stat"><div className="stat-label">{t('oa_repeat')}</div><div className="stat-value text-lg">{(d.repeatBuyerRate * 100).toFixed(1)}%</div>
          <p className="mt-1 text-xs text-ink-soft">{t('oa_buyers_note', { n: d.distinctBuyers })}</p></div>
      </div>

      <SalesChart data={days.map((x) => ({ day: x.day, sales: x.gmv, orders: x.orders }))} t={t} lang={lang} testId="oa-daily"
        title={t('oa_daily_title', { n: range })} sub={t('oa_daily_sub')} empty={t('oa_no_data')} />
      <a href={exp('daily', `&days=${range}`)} className="link text-sm -mt-4 inline-block" data-testid="csv-daily">{t('oa_csv')} →</a>

      <section data-testid="oa-funnel">
        <h2 className="font-bold mb-1">{t('oa_funnel_title')}</h2>
        <p className="text-xs text-ink-soft mb-3">{t('oa_funnel_sub')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="stat"><div className="stat-label">{t('oa_f_view')}</div><div className="stat-value text-lg" data-testid="funnel-views">{d.funnel.viewSessions}</div>
            <p className="mt-1 text-xs text-ink-soft">{t('oa_f_events', { n: d.funnel.views })}</p></div>
          <div className="stat"><div className="stat-label">{t('oa_f_checkout')}</div><div className="stat-value text-lg" data-testid="funnel-starts">{d.funnel.startSessions}</div>
            <p className="mt-1 text-xs text-ink-soft">{t('oa_f_rate', { r: pct(d.funnel.startSessions, d.funnel.viewSessions) })}</p></div>
          <div className="stat"><div className="stat-label">{t('oa_f_order')}</div><div className="stat-value text-lg" data-testid="funnel-orders">{d.funnel.orderSessions}</div>
            <p className="mt-1 text-xs text-ink-soft">{t('oa_f_rate', { r: pct(d.funnel.orderSessions, d.funnel.startSessions) })} · {t('oa_f_overall', { r: pct(d.funnel.orderSessions, d.funnel.viewSessions) })}</p></div>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-bold">{t('oa_top_products')}</h2>
          <form method="get" className="flex items-center gap-2 text-sm">
            <input type="hidden" name="range" value={range} />
            <select name="store" className="input py-1.5 text-xs w-auto" defaultValue={storeId ?? ''}>
              <option value="">{t('oa_all_stores')}</option>
              {d.stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
            <button className="btn-secondary btn-sm">{t('oa_filter')}</button>
          </form>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {([['oa_by_revenue', byRevenue, 'top-revenue'], ['oa_by_units', byUnits, 'top-units']] as const).map(([title, rows, testid]) => (
            <div key={testid} className="card overflow-x-auto" data-testid={testid}>
              <h3 className="font-bold px-4 pt-4 pb-1 text-sm">{t(title)}</h3>
              <table className="table">
                <thead><tr><th>{t('product')}</th><th>{t('oa_store')}</th><th>{t('oa_units')}</th><th>{t('oa_revenue')}</th></tr></thead>
                <tbody>{rows.length === 0 ? <tr><td colSpan={4} className="text-ink-soft text-center py-6">{t('oa_no_data')}</td></tr> :
                  rows.slice(0, 10).map((p) => <tr key={p.product_id}><td className="font-semibold">{p.title}</td><td>{p.store_name}</td><td>{p.qty}</td><td className="whitespace-nowrap">{f(p.revenue)}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
        <a href={exp('products')} className="link text-sm mt-2 inline-block" data-testid="csv-products">{t('oa_csv')} →</a>
      </section>

      <section data-testid="oa-prices">
        <h2 className="font-bold mb-1">{t('oa_prices_title')}</h2>
        <p className="text-xs text-ink-soft mb-3">{t('oa_prices_sub')}</p>
        <div className="card overflow-x-auto">
          <table className="table text-sm">
            <thead><tr><th>{t('oa_category')}</th><th>{t('oa_products')}</th><th>{t('oa_min')}</th><th>{t('oa_median')}</th><th>{t('oa_max')}</th>
              {Array.from({ length: edges.length + 1 }, (_, i) => <th key={i} className="whitespace-nowrap" dir="ltr">{bucketLabel(i)}</th>)}</tr></thead>
            <tbody>{d.priceByCategory.map((c) => (
              <tr key={c.category} data-category={c.category}>
                <td className="font-semibold">{c.category === 'physical' ? t('oa_cat_physical') : c.category === 'digital' ? t('oa_cat_digital') : c.category}</td>
                <td>{c.products}</td><td className="whitespace-nowrap">{f(c.min)}</td><td className="whitespace-nowrap">{f(c.median)}</td><td className="whitespace-nowrap">{f(c.max)}</td>
                {c.buckets.map((n, i) => <td key={i} className={n ? 'font-semibold' : 'text-ink-soft'}>{n}</td>)}
              </tr>))}</tbody>
          </table>
        </div>
        <a href={exp('prices')} className="link text-sm mt-2 inline-block">{t('oa_csv')} →</a>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-bold mb-3">{t('oa_geo')}</h2>
          <div className="card overflow-x-auto" data-testid="oa-geo">
            <table className="table">
              <thead><tr><th>{t('governorate')}</th><th>{t('oa_orders_col')}</th><th>{t('total')}</th></tr></thead>
              <tbody>{d.geo.map((g) => <tr key={g.governorate}><td>{g.governorate}</td><td>{g.orders}</td><td className="whitespace-nowrap">{f(g.total)}</td></tr>)}</tbody>
            </table>
          </div>
          <a href={exp('geo')} className="link text-sm mt-2 inline-block">{t('oa_csv')} →</a>
        </section>
        <section>
          <h2 className="font-bold mb-3">{t('oa_pm_mix')}</h2>
          <div className="card overflow-x-auto" data-testid="oa-pm">
            <table className="table">
              <thead><tr><th>{t('payment_method')}</th><th>{t('oa_orders_col')}</th><th>{t('total')}</th><th>{t('oa_share')}</th></tr></thead>
              <tbody>{d.paymentMix.map((p) => {
                const all = d.paymentMix.reduce((s, x) => s + x.orders, 0) || 1;
                return <tr key={p.payment_method}><td>{pm(p.payment_method)}</td><td>{p.orders}</td><td className="whitespace-nowrap">{f(p.total)}</td><td>{((p.orders / all) * 100).toFixed(0)}%</td></tr>;
              })}</tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-bold mb-3">{t('oa_by_hour')}</h2>
          <Bars testId="oa-hours" rows={d.byHour.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}h`, value: h.orders }))} />
        </section>
        <section>
          <h2 className="font-bold mb-3">{t('oa_by_weekday')}</h2>
          <Bars testId="oa-weekdays" rows={d.byWeekday.map((w) => ({ label: WEEKDAY[w.weekday], value: w.orders }))} />
        </section>
      </div>

      <section data-testid="oa-growth">
        <h2 className="font-bold mb-3">{t('oa_growth')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="stat"><div className="stat-label">{t('oa_sellers_live')}</div><div className="stat-value text-lg">{d.growth.approvedSellers}</div></div>
          <div className="stat"><div className="stat-label">{t('oa_new_sellers_7')}</div><div className="stat-value text-lg">{d.growth.newSellers7d}</div></div>
          <div className="stat"><div className="stat-label">{t('oa_new_sellers_30')}</div><div className="stat-value text-lg">{d.growth.newSellers30d}</div></div>
          <Link href="/owner/registrations" className="stat hover:border-brand"><div className="stat-label">{t('oa_pending_regs')}</div><div className="stat-value text-lg text-brand">{d.growth.pendingRegistrations}</div></Link>
        </div>
      </section>

      <section className="card-pad" data-testid="oa-raw">
        <h2 className="font-bold">{t('oa_raw_title')}</h2>
        <p className="text-xs text-ink-soft mt-1 mb-3">{t('oa_raw_sub')}</p>
        <form method="get" action="/owner/analytics/export" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="kind" value="events" />
          <label className="text-sm flex items-center gap-2">{t('oa_last_days')}
            <input name="days" type="number" min={1} max={365} defaultValue={30} className="input w-24" dir="ltr" /></label>
          <button className="btn-secondary btn-sm">{t('oa_download')}</button>
        </form>
      </section>
    </div>
  );
}

/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OnboardingChecklist, type ChecklistStep } from './onboarding/Checklist';
import { subscriptionCount } from '@/lib/push';
import { CopyButton } from '@/components/CopyButton';
import { OrderStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/notify';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { sellerBalances } from '@/lib/orders';
import { nextCutoff, nextTransferDate } from '@/lib/payouts-schedule';
import { SalesChart } from '@/components/SalesChart';
import { dailySales } from '@/lib/sales';
import type { Order } from '@/lib/types';

/** Small inline icons (24px grid, stroke = currentColor). */
const ICON = {
  arrow: 'M7 17 17 7M9 7h8v8',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Zm14 7h.01',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 21h16',
  pie: 'M21 12a9 9 0 1 1-9-9v9h9Z',
  bars: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  refund: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  check: 'm5 12 5 5L20 7',
};
function Icon({ d, className = 'h-5 w-5' }: { d: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
/** Round icon badge used as a card's title glyph and on list rows. */
function Badge({ d, tone = 'cream' }: { d: string; tone?: 'cream' | 'brand' | 'accent' | 'danger' | 'warn' }) {
  const c = { cream: 'bg-cream text-brand', brand: 'bg-brand text-white', accent: 'bg-accent/20 text-brand', danger: 'bg-danger/10 text-danger', warn: 'bg-warn/12 text-warn' }[tone];
  return <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${c}`}><Icon d={d} /></span>;
}

export default function SellerDashboard() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const f = (n: number) => formatSYP(n, lang);
  const db = getDb();
  const bal = sellerBalances(seller.id);
  const count = (sql: string) => (db.prepare(`SELECT count(*) c FROM orders WHERE seller_id = ? AND ${sql}`).get(seller.id) as { c: number }).c;
  const toFulfil = count("order_state = 'open' AND status = 'confirmed'");
  const awaitingPayment = count("status = 'awaiting_payment'");
  const today = count("date(created_at) = date('now')");
  const week = count("created_at >= datetime('now','-7 days')");
  const openReturns = (db.prepare("SELECT count(*) c FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.seller_id = ? AND d.status IN ('open','investigating')").get(seller.id) as { c: number }).c;
  const recent = db.prepare('SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 5').all(seller.id) as Order[];
  const storeUrl = appUrl(`/s/${seller.slug}`);
  const totalOrders = count('1 = 1');
  const productCount = (db.prepare("SELECT count(*) c FROM products WHERE seller_id = ? AND status != 'removed'").get(seller.id) as { c: number }).c;
  const steps: ChecklistStep[] = [
    { key: 'ob_product', done: productCount > 0, href: '/seller/products/new' },
    { key: 'ob_copy_link', done: !!seller.onboarding_link_copied },
    { key: 'ob_notifications', done: subscriptionCount(seller.id) > 0, href: '/seller/settings#notifications' },
    { key: 'ob_kyc', done: seller.kyc_status === 'approved', href: '/seller/verification', note: seller.kyc_status === 'submitted' ? t('ob_kyc_waiting') : undefined },
  ];
  const showChecklist = (productCount === 0 || totalOrders === 0) && !seller.onboarding_dismissed && steps.some((s) => !s.done);

  // Last 30 days, same order columns the payout run uses (excludes cancelled, failed and refunded).
  const m = db.prepare(`SELECT coalesce(sum(subtotal),0) gross, coalesce(sum(commission_amount + commission_vat),0) commission,
      coalesce(sum(delivery_fee),0) delivery, coalesce(sum(seller_net),0) net, count(*) n FROM orders
    WHERE seller_id = ? AND status NOT IN ('cancelled','payment_failed','refunded','awaiting_payment') AND created_at >= datetime('now','-30 days')`).get(seller.id) as
    { gross: number; commission: number; delivery: number; net: number; n: number };
  const sales = dailySales(seller.id, 14);
  const thisWeek = sales.slice(7).reduce((s, d) => s + d.sales, 0), lastWeek = sales.slice(0, 7).reduce((s, d) => s + d.sales, 0);
  const trend = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  // Payout calendar is UTC (lib/payouts-schedule.ts), so dates render in UTC too.
  const cutoff = nextCutoff();
  const transfer = nextTransferDate();
  const locale = lang === 'ar' ? 'ar-SY' : 'en-GB';
  const fmtDay = (d: Date) => d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtCutoff = (d: Date) => `${d.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`;
  const hoursLeft = Math.max(0, Math.round((cutoff.getTime() - Date.now()) / 3_600_000));
  const leftText = hoursLeft >= 48 ? t('payout_days_left', { n: Math.floor(hoursLeft / 24) }) : t('payout_hours_left', { n: hoursLeft });
  const fmtWhen = (iso: string) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Damascus' });

  // Ring: share of goods value the seller keeps vs Paylo's commission.
  const R = 52, C = 2 * Math.PI * R;
  const netShare = m.gross ? m.net / m.gross : 0;
  const card = 'rounded-3xl bg-paper border border-ink/5 shadow-hair p-5 sm:p-6 min-w-0';
  const tabs: [string, string, boolean][] = [['/seller', t('sd_tab_overview'), true], ['/seller/earnings', t('earnings_title'), false], ['/seller/orders', t('nav_orders'), false]];

  return (
    <div className="space-y-5" data-testid="seller-dashboard">
      <AutoRefresh seconds={10} />

      {/* Header: avatar + greeting · tab switcher (real pages) · notifications */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {seller.logo_path
            ? <img src={seller.logo_path} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
            : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white font-extrabold">{seller.store_name.slice(0, 1)}</span>}
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">{t('sd_hello', { name: seller.store_name })}</h1>
        </div>
        <nav className="order-3 w-full sm:order-none sm:w-auto flex gap-1 rounded-full bg-paper border border-ink/5 p-1 overflow-x-auto" aria-label={t('sd_tabs')} data-testid="dash-tabs">
          {tabs.map(([href, label, on]) => (
            <Link key={href} href={href} aria-current={on ? 'page' : undefined}
              className={`tap whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${on ? 'bg-accent/25 text-brand' : 'text-ink-soft hover:text-brand'}`}>{label}</Link>
          ))}
        </nav>
        <Link href="/seller/orders?state=open" className="relative flex h-11 w-11 items-center justify-center rounded-full bg-paper border border-ink/5 text-brand" aria-label={t('sd_to_fulfil_n', { n: toFulfil })} data-testid="dash-bell">
          <Icon d={ICON.bell} />
          {toFulfil > 0 && <span className="absolute -top-1 -end-1 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">{toFulfil}</span>}
        </Link>
      </header>

      {showChecklist && <OnboardingChecklist storeUrl={storeUrl} steps={steps} />}
      {openReturns > 0 && <Link href="/seller/returns" className="alert-warn block rounded-2xl" data-testid="returns-alert">{t('returns_open_alert', { n: openReturns })} →</Link>}

      {/* Top row: balance card + accent highlight (next payout) */}
      <div className="grid gap-5 lg:grid-cols-12">
        <section className={`${card} lg:col-span-7 flex flex-col`} data-testid="balance-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="inline-flex rounded-full bg-cream px-3 py-1 text-xs font-semibold text-brand">{t('bal_available')}</span>
            <div className="text-end min-w-0 max-w-full">
              <div className="text-xs text-ink-soft">{t('dash_store_link')}</div>
              <div className="flex items-center justify-end gap-2 min-w-0">
                <code className="font-semibold text-sm truncate" dir="ltr">/s/{seller.slug}</code>
                <CopyButton text={storeUrl} className="btn-ghost btn-sm" />
              </div>
            </div>
          </div>
          <div className="mt-5 text-4xl sm:text-5xl font-extrabold tracking-[-0.03em] break-words" data-testid="balance-available">{f(bal.available)}</div>
          <p className="mt-1 text-sm text-ink-soft">{t('bal_available_d')}</p>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div><dt className="inline text-ink-soft">{t('bal_pending')}: </dt><dd className="inline font-semibold">{f(bal.pending)}</dd></div>
            <div><dt className="inline text-ink-soft">{t('bal_lifetime')}: </dt><dd className="inline font-semibold">{f(bal.lifetime)}</dd></div>
          </dl>
          <div className="mt-auto pt-6 flex flex-wrap items-center gap-3">
            <Link href="/seller/payouts" className="btn-primary rounded-full"><Icon d={ICON.wallet} className="h-4 w-4" />{t('nav_payouts')}</Link>
            <a href="/seller/earnings/export" className="btn-secondary rounded-full"><Icon d={ICON.download} className="h-4 w-4" />{t('sd_statement')}</a>
            <Link href={`/s/${seller.slug}`} target="_blank" className="ms-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-brand hover:bg-accent/80" aria-label={t('sd_open_store')} data-testid="open-store">
              <Icon d={ICON.arrow} className="h-6 w-6 rtl:-scale-x-100" />
            </Link>
          </div>
        </section>

        <section className="rounded-3xl bg-accent text-ink p-5 sm:p-6 lg:col-span-5 flex flex-col min-w-0" data-testid="next-payout">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white"><Icon d={ICON.clock} className="h-4 w-4" />{t('bal_next_payout')}</span>
          </div>
          <div className="mt-5 text-2xl sm:text-3xl font-extrabold tracking-tight">{fmtDay(transfer)}</div>
          <p className="text-sm mt-1">{t('payout_cutoff_note', { cutoff: fmtCutoff(cutoff), left: leftText })}</p>
          <div className="mt-auto pt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/55 p-3 min-w-0">
              <div className="text-xs font-semibold">{t('payout_in_next_run')}</div>
              <div className="mt-1 text-lg font-extrabold break-words">{f(bal.available)}</div>
            </div>
            <div className="rounded-2xl bg-white/55 p-3 min-w-0" data-testid="sales-trend">
              <div className="text-xs font-semibold">{t('sd_sales_7d')}</div>
              <div className="mt-1 text-lg font-extrabold break-words">{f(thisWeek)}</div>
              {trend !== null && <span className={`mt-1 inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-bold ${trend >= 0 ? 'text-success' : 'text-danger'}`}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% {t('sd_vs_prev')}</span>}
            </div>
          </div>
          <Link href="/seller/payouts" className="mt-3 tap self-start text-sm font-semibold underline-offset-4 hover:underline">{t('nav_payouts')} →</Link>
        </section>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([['dash_to_fulfill', toFulfil, true], ['st_awaiting_payment', awaitingPayment, false], ['orders_today', today, false], ['orders_week', week, false]] as const).map(([k, v, hi]) => (
          <div key={k} className="rounded-2xl bg-paper border border-ink/5 px-4 py-3">
            <div className="stat-label">{t(k)}</div><div className={`stat-value ${hi && v > 0 ? 'text-brand' : ''}`}>{v}</div>
          </div>
        ))}
      </div>

      {/* Three-column row */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <section className={card} data-testid="keep-ring">
          <div className="flex items-center gap-3"><Badge d={ICON.pie} /><h2 className="font-bold">{t('sd_keep_title')}</h2></div>
          {m.gross === 0 ? <p className="mt-6 text-sm text-ink-soft">{t('sd_no_sales_30')}</p> : (<>
            <div className="relative mx-auto mt-4 h-40 w-40">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={t('sd_keep_aria', { pct: Math.round(netShare * 100) })}>
                <circle cx="60" cy="60" r={R} fill="none" stroke="#ECE6DA" strokeWidth="12" />
                <circle cx="60" cy="60" r={R} fill="none" stroke="#00BD3E" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * netShare} ${C}`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-extrabold" data-testid="ring-pct">{Math.round(netShare * 100)}%</span>
                <span className="text-[11px] text-ink-soft">{t('sd_you_keep')}</span>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-accent" /><span className="text-ink-soft">{t('earn_net')}</span></li>
              <li className="text-end font-semibold">{f(m.net)}</li>
              <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-cream-deep border border-ink/10" /><span className="text-ink-soft">{t('commission')}</span></li>
              <li className="text-end font-semibold">{f(m.commission)}</li>
            </ul>
          </>)}
        </section>

        <section className={card} data-testid="earning-breakdown">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><Badge d={ICON.bars} /><h2 className="font-bold">{t('sd_earn_title')}</h2></div>
            <span className="text-xs text-ink-soft">{t('sd_30d')}</span>
          </div>
          <div className="mt-4 text-3xl font-extrabold tracking-tight break-words">{f(m.net)}</div>
          <p className="text-xs text-ink-soft">{t('sd_net_from_orders', { n: m.n })}</p>
          <ul className="mt-5 space-y-3">
            {([['earn_gross_goods', m.gross, 'bg-brand'], ['commission', m.commission, 'bg-danger/70'], ['earn_delivery_held', m.delivery, 'bg-ink/25'], ['earn_net', m.net, 'bg-accent']] as const).map(([k, v, bar]) => (
              <li key={k} data-row={k}>
                <div className="flex justify-between gap-2 text-sm"><span className="text-ink-soft">{t(k)}</span><span className="font-semibold whitespace-nowrap">{k === 'commission' && v ? '− ' : ''}{f(v)}</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-cream-deep overflow-hidden"><div className={`h-full rounded-full ${bar}`} style={{ width: `${m.gross ? Math.min(100, (v / m.gross) * 100) : 0}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-ink-soft">{t('earn_delivery_held_d')}</p>
        </section>

        <section className={`${card} md:col-span-2 lg:col-span-1`} data-testid="recent-orders">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><Badge d={ICON.box} /><h2 className="font-bold">{t('dash_recent')}</h2></div>
            <Link href="/seller/orders" className="link text-sm">{t('all')} →</Link>
          </div>
          {recent.length === 0 ? <p className="mt-6 text-sm text-ink-soft">{t('dash_empty')}</p> : (
            <ul className="mt-3 divide-y divide-ink/5">
              {recent.map((o) => {
                const neg = o.status === 'refunded' || o.status === 'cancelled' || o.status === 'payment_failed';
                const waiting = o.status === 'awaiting_payment';
                return (
                  <li key={o.id}>
                    <Link href={`/seller/orders/${o.id}`} className="flex items-center gap-3 py-3 min-w-0" data-code={o.code}>
                      <Badge d={neg ? ICON.refund : waiting ? ICON.clock : o.status === 'delivered' ? ICON.check : ICON.box} tone={neg ? 'danger' : waiting ? 'warn' : 'accent'} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate">{o.product_title}</span>
                        <span className="block text-xs text-ink-soft truncate"><span dir="ltr">{o.code}</span> · {fmtWhen(o.created_at)}</span>
                      </span>
                      <span className="text-end shrink-0">
                        <span className={`block text-sm font-bold whitespace-nowrap ${neg ? 'text-danger line-through decoration-1' : waiting ? 'text-ink-soft' : 'text-success'}`}>{neg ? '−' : '+'}{f(o.total)}</span>
                        <span className="block mt-0.5"><OrderStatusBadge status={o.status} t={t} /></span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <SalesChart data={dailySales(seller.id)} t={t} lang={lang} />
    </div>
  );
}

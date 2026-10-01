import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { TransferQueue } from '@/components/TransferQueue';
import { getDb } from '@/lib/db';
import { queueCounts, moneySummary, growthSummary } from '@/lib/dashboard';
import { configChecks } from '@/lib/health';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Order } from '@/lib/types';

/**
 * Admin home = day-to-day operations. Bank transfers to confirm come first: with COD off by
 * policy, every order waits on that decision. Counts are live (lib/dashboard.ts).
 */
export default function AdminDashboard() {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const q = queueCounts(), m = moneySummary(), g = growthSummary();
  const health = configChecks();
  const healthErrors = health.filter((c) => c.level === 'error').length;
  const pendingSellers = (db.prepare("SELECT count(*) c FROM sellers WHERE status = 'pending'").get() as { c: number }).c;
  const recent = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10').all() as Order[];
  const sellerNames = Object.fromEntries((db.prepare('SELECT id, store_name FROM sellers').all() as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]));
  const Tile = ({ href, label, value, alert, testid, sub }: { href: string; label: string; value: number | string; alert?: boolean; testid: string; sub?: string }) => (
    <Link href={href} className="stat hover:border-brand" data-testid={testid} data-value={String(value)}>
      <div className="stat-label">{label}</div><div className={`stat-value ${alert ? 'text-danger' : ''}`}>{value}</div>{sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
    </Link>
  );

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="section-title">{t('admin_title')}</h1>
        <span className="text-sm text-ink-soft">{t('bal_next_payout')}: <strong dir="ltr">{m.nextPayoutDate}</strong></span>
      </div>

      {healthErrors > 0 && <Link href="/admin/ops" className="alert-error block" data-testid="health-alert">{t('ad_health_errors', { n: healthErrors })} →</Link>}

      <TransferQueue t={t} lang={lang} limit={20} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="admin-queues">
        <Tile testid="a-kyc" href="/admin/sellers?kyc=submitted" label={t('ops_kyc_waiting')} value={q.kycWaiting} alert={q.kycWaiting > 0} />
        <Tile testid="a-disputes" href="/admin/disputes" label={t('ops_open_returns')} value={q.openDisputes} alert={q.openDisputes > 0} />
        <Tile testid="a-payouts" href="/admin/payouts" label={t('ad_payouts_to_pay')} value={q.pendingPayouts} sub={q.failedPayouts ? t('ad_failed_n', { n: q.failedPayouts }) : undefined} alert={q.failedPayouts > 0} />
        <Tile testid="a-failed-msgs" href="/admin/ops" label={t('ops_notify_failed')} value={q.notifyFailed7d} alert={q.notifyFailed7d > 0} sub={t('ad_webhooks_dead', { n: q.webhooksDead })} />
        <Tile testid="a-pending-sellers" href="/admin/sellers?status=pending" label={t('a_pending_sellers')} value={pendingSellers} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="stat" data-testid="a-orders-30"><div className="stat-label">{t('a_orders_today')}</div><div className="stat-value">{g.d30.n}</div><p className="mt-1 text-xs text-ink-soft">{t('ow_g_today')}: {g.today.n}</p></div>
        <div className="stat" data-testid="a-held"><div className="stat-label">{t('ow_m_held')}</div><div className="stat-value text-lg">{formatSYP(m.heldForSellers, lang)}</div><p className="mt-1 text-xs text-ink-soft">{t('ow_m_held_d')}</p></div>
        <div className="stat"><div className="stat-label">{t('ow_m_commission')}</div><div className="stat-value text-lg">{formatSYP(m.commissionThisMonth, lang)}</div></div>
      </div>

      {q.codUncollected > 0 && <Link href="/admin/ops#cod" className="text-sm link">{t('ad_cod_legacy', { n: q.codUncollected })} →</Link>}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">{t('dash_recent')}</h2>
          <Link href="/admin/orders" className="link text-sm">{t('all')} →</Link>
        </div>
        <OrdersTable orders={recent} t={t} lang={lang} base="/admin/orders" sellerNames={sellerNames} />
      </section>
    </div>
  );
}

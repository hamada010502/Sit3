import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrderStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { configChecks, deliveryStats, workerLastRun } from '@/lib/health';
import { formatSYP } from '@/lib/money';
import { SubmitButton } from '@/components/SubmitButton';
import { codCollectedAction } from '../orders/[id]/actions';
import { TransferQueue } from '@/components/TransferQueue';
import type { Order, Payout, Seller } from '@/lib/types';

/**
 * Operations view (v2 §6): the cross-seller queues nothing in a seller dashboard exposes —
 * orders stuck on Paylo, money not yet accounted for, and accounts waiting on a decision.
 */
export default function AdminOpsPage() {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const q = <T,>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];

  const awaitingTransfer = q<Order & { bt_status: string }>(
    `SELECT o.*, b.status bt_status FROM orders o JOIN bank_transfers b ON b.order_id = o.id
     WHERE b.status IN ('awaiting_proof','submitted') AND o.status = 'awaiting_payment' ORDER BY b.submitted_at IS NULL, o.created_at ASC`);
  const unfulfilled = q<Order>(
    `SELECT * FROM orders WHERE status = 'confirmed' AND created_at <= datetime('now','-2 days') ORDER BY created_at ASC`);
  const stuckTransit = q<Order>(
    `SELECT * FROM orders WHERE status IN ('handed_off','in_transit','ready_for_pickup') AND coalesce(handed_off_at, created_at) <= datetime('now','-7 days') ORDER BY handed_off_at ASC`);
  const codUncollected = q<Order>(
    `SELECT * FROM orders WHERE payment_method = 'cod' AND status = 'delivered' AND payment_status NOT IN ('collected_cod','refunded') ORDER BY delivered_at ASC`);
  const failedPayments = q<Order>(`SELECT * FROM orders WHERE status = 'payment_failed' ORDER BY created_at DESC LIMIT 25`);
  const addressReqs = q<Order & { req_id: string }>(
    `SELECT o.*, a.id req_id FROM orders o JOIN address_change_requests a ON a.order_id = o.id WHERE a.status = 'pending' ORDER BY a.created_at ASC`);
  const kyc = q<Seller>(`SELECT * FROM sellers WHERE kyc_status = 'submitted' ORDER BY created_at ASC`);
  const failedPayouts = q<Payout & { store_name: string }>(
    `SELECT p.*, s.store_name FROM payouts p JOIN sellers s ON s.id = p.seller_id WHERE p.status = 'failed' ORDER BY p.created_at DESC`);

  const health = configChecks();
  const stats = deliveryStats();
  const lastRun = workerLastRun();
  const deadWebhooks = q<{ id: number; event: string; error: string | null; response_code: number | null; attempts: number; created_at: string; url: string; store_name: string | null }>(
    `SELECT d.id, d.event, d.error, d.response_code, d.attempts, d.created_at, e.url, s.store_name FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id LEFT JOIN sellers s ON s.id = e.seller_id
      WHERE d.status = 'dead' ORDER BY d.id DESC LIMIT 25`);
  const pushFails = q<{ id: number; store_name: string | null; endpoint_host: string | null; status_code: number | null; error: string | null; removed: number; created_at: string }>(
    `SELECT f.*, s.store_name FROM push_failures f LEFT JOIN sellers s ON s.id = f.seller_id ORDER BY f.id DESC LIMIT 15`);
  const failedMsgs = q<{ id: number; channel: string; recipient: string; event: string; status: string; created_at: string }>(
    `SELECT id, channel, recipient, event, status, created_at FROM notifications WHERE status LIKE 'failed%' ORDER BY id DESC LIMIT 15`);
  const lvl = { ok: 'bg-success/12 text-success', warn: 'bg-amber-100 text-amber-800', error: 'bg-danger/10 text-danger' } as const;
  const Stat = ({ label, value, sub, warn, id }: { label: string; value: number; sub?: string; warn?: boolean; id: string }) => (
    <div className="stat" data-testid={id}><div className="stat-label">{label}</div>
      <div className={`stat-value text-lg ${warn ? 'text-danger' : ''}`}>{value}</div>{sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}</div>);

  const age = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 86400000) : 0);
  const total = awaitingTransfer.length + unfulfilled.length + stuckTransit.length + codUncollected.length
    + failedPayments.length + addressReqs.length + kyc.length + failedPayouts.length;

  const OrderQueue = ({ title, rows, stamp }: { title: string; rows: Order[]; stamp?: (o: Order) => string | null }) =>
    rows.length === 0 ? null : (
      <div className="card overflow-x-auto">
        <h2 className="font-bold px-5 pt-5 pb-2">{title} <span className="text-ink-soft font-normal">({rows.length})</span></h2>
        <table className="table">
          <thead><tr><th>{t('order')}</th><th>{t('buyer')}</th><th>{t('total')}</th><th>{t('payment_method')}</th><th>{t('fulfillment_state')}</th><th>{t('date')}</th><th></th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td className="font-mono font-semibold" dir="ltr">{o.code}</td>
              <td>{o.buyer_name}<div className="text-xs text-ink-soft">{o.governorate}</div></td>
              <td className="whitespace-nowrap">{formatSYP(o.total, lang)}</td>
              <td className="text-xs">{t(`pm_${o.payment_method}` as const)}</td>
              <td><OrderStatusBadge status={o.status} t={t} /></td>
              <td className="text-xs text-ink-soft whitespace-nowrap">{stamp?.(o) ?? o.created_at.slice(0, 10)}</td>
              <td><Link href={`/admin/orders/${o.id}`} className="link text-sm">{t('view')}</Link></td>
            </tr>))}</tbody>
        </table>
      </div>
    );

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={20} />
      <div>
        <h1 className="section-title">{t('ops_title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t('ops_sub')}</p>
      </div>
      {total === 0 && <div className="alert-success">{t('ops_all_clear')}</div>}

      <TransferQueue t={t} lang={lang} />

      <section className="card overflow-x-auto" data-testid="ops-health">
        <h2 className="font-bold px-5 pt-5">{t('ops_health')}</h2>
        <p className="px-5 pb-2 text-xs text-ink-soft">{t('ops_health_sub')} {t('ops_worker_last', { when: lastRun ? lastRun.replace('T', ' ').slice(0, 19) + ' UTC' : t('ops_never') })}</p>
        <table className="table"><tbody>{health.map((c) => (
          <tr key={c.name} data-check={c.name} data-level={c.level}>
            <td className="font-mono text-xs" dir="ltr">{c.name}</td>
            <td><span className={`badge ${lvl[c.level]}`}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'}</span></td>
            <td className="text-sm">{t(c.note)}</td>
          </tr>))}</tbody></table>
      </section>

      <section>
        <h2 className="font-bold mb-2">{t('ops_delivery')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat id="stat-push-subs" label={t('ops_push_subs')} value={stats.pushSubscriptions} sub={t('ops_push_sellers', { n: stats.pushSellers })} />
          <Stat id="stat-push-failed" label={t('ops_push_failed')} value={stats.pushFailed7d} sub={t('ops_push_removed', { n: stats.pushRemoved7d })} />
          <Stat id="stat-notify-failed" label={t('ops_notify_failed')} value={stats.notifyFailed7d} warn={stats.notifyFailed7d > 0} />
          <Stat id="stat-wh-delivered" label={t('ops_wh_delivered')} value={stats.webhooksDelivered24h} />
          <Stat id="stat-wh-retrying" label={t('ops_wh_retrying')} value={stats.webhooksRetrying} warn={stats.webhooksOverdue > 0} sub={stats.webhooksOverdue > 0 ? t('ops_wh_overdue', { n: stats.webhooksOverdue }) : undefined} />
          <Stat id="stat-wh-dead" label={t('ops_wh_dead')} value={stats.webhooksDead} warn={stats.webhooksDead > 0} />
        </div>
      </section>

      {deadWebhooks.length > 0 && (
        <div className="card overflow-x-auto" data-testid="ops-dead-webhooks">
          <h2 className="font-bold px-5 pt-5 pb-2">{t('ops_dead_webhooks')} <span className="text-ink-soft font-normal">({stats.webhooksDead})</span></h2>
          <table className="table">
            <thead><tr><th>{t('seller')}</th><th>{t('ops_event')}</th><th>{t('ops_endpoint')}</th><th>{t('ops_attempts')}</th><th>{t('ops_error')}</th><th>{t('date')}</th></tr></thead>
            <tbody>{deadWebhooks.map((d) => (
              <tr key={d.id}><td>{d.store_name ?? 'Paylo'}</td><td className="font-mono text-xs" dir="ltr">{d.event}</td>
                <td className="font-mono text-xs break-all max-w-xs" dir="ltr">{d.url}</td><td>{d.attempts}</td>
                <td className="text-xs">{d.response_code ? `HTTP ${d.response_code}` : ''} {d.error}</td><td className="text-xs text-ink-soft whitespace-nowrap">{d.created_at}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      {pushFails.length > 0 && (
        <div className="card overflow-x-auto" data-testid="ops-push-failures">
          <h2 className="font-bold px-5 pt-5 pb-2">{t('ops_failed_pushes')}</h2>
          <table className="table">
            <thead><tr><th>{t('seller')}</th><th>{t('ops_endpoint')}</th><th>{t('ops_error')}</th><th>{t('ops_removed')}</th><th>{t('date')}</th></tr></thead>
            <tbody>{pushFails.map((f) => (
              <tr key={f.id}><td>{f.store_name ?? '—'}</td><td className="font-mono text-xs" dir="ltr">{f.endpoint_host}</td>
                <td className="text-xs">{f.status_code ? `HTTP ${f.status_code} ` : ''}{f.error}</td><td>{f.removed ? t('yes') : t('no')}</td>
                <td className="text-xs text-ink-soft whitespace-nowrap">{f.created_at}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      {failedMsgs.length > 0 && (
        <div className="card overflow-x-auto" data-testid="ops-failed-messages">
          <h2 className="font-bold px-5 pt-5 pb-2">{t('ops_failed_notifications')}</h2>
          <table className="table">
            <thead><tr><th>{t('ops_channel')}</th><th>{t('ops_recipient')}</th><th>{t('ops_event')}</th><th>{t('ops_error')}</th><th>{t('date')}</th></tr></thead>
            <tbody>{failedMsgs.map((m) => (
              <tr key={m.id}><td>{m.channel}</td><td className="text-xs" dir="ltr">{m.recipient}</td><td className="font-mono text-xs" dir="ltr">{m.event}</td>
                <td className="text-xs">{m.status}</td><td className="text-xs text-ink-soft whitespace-nowrap">{m.created_at}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <OrderQueue title={t('ops_unfulfilled')} rows={unfulfilled} stamp={(o) => `${age(o.created_at)} ${t('days_open')}`} />
      <OrderQueue title={t('ops_stuck_transit')} rows={stuckTransit} stamp={(o) => `${age(o.handed_off_at)} ${t('days_open')}`} />
      <OrderQueue title={t('ops_address_requests')} rows={addressReqs} />
      <OrderQueue title={t('ops_failed_payments')} rows={failedPayments} />

      {kyc.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="font-bold px-5 pt-5 pb-2">{t('ops_kyc_waiting')} <span className="text-ink-soft font-normal">({kyc.length})</span></h2>
          <table className="table">
            <thead><tr><th>{t('store_name')}</th><th>{t('kyc_legal_name')}</th><th>{t('date')}</th><th></th></tr></thead>
            <tbody>{kyc.map((s) => (
              <tr key={s.id}><td>{s.store_name}</td><td>{s.kyc_legal_name}</td><td className="text-xs text-ink-soft">{s.created_at.slice(0, 10)}</td>
                <td><Link href={`/admin/sellers/${s.id}`} className="link text-sm">{t('view')}</Link></td></tr>))}</tbody>
          </table>
        </div>
      )}

      {failedPayouts.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="font-bold px-5 pt-5 pb-2">{t('ops_failed_payouts')} <span className="text-ink-soft font-normal">({failedPayouts.length})</span></h2>
          <table className="table">
            <thead><tr><th>{t('seller')}</th><th>{t('amount')}</th><th>{t('note')}</th><th></th></tr></thead>
            <tbody>{failedPayouts.map((p) => (
              <tr key={p.id}><td>{p.store_name}</td><td>{formatSYP(p.amount, lang)}</td><td className="text-xs">{p.failure_reason}</td>
                <td><Link href="/admin/payouts" className="link text-sm">{t('view')}</Link></td></tr>))}</tbody>
          </table>
        </div>
      )}
      {codUncollected.length > 0 && (
        <div className="card overflow-x-auto opacity-90" data-testid="ops-cod-queue" id="cod">
          <h2 className="font-bold px-5 pt-5">{t('ops_cod_uncollected')} <span className="text-ink-soft font-normal">({codUncollected.length})</span></h2>
          <p className="px-5 pb-2 text-xs text-ink-soft">{t('ops_cod_uncollected_d')}</p>
          <table className="table">
            <thead><tr><th>{t('order')}</th><th>{t('buyer')}</th><th>{t('total')}</th><th>{t('date')}</th><th>{t('mark_cod_collected')}</th></tr></thead>
            <tbody>{codUncollected.map((o) => (
              <tr key={o.id} data-code={o.code}>
                <td><Link href={`/admin/orders/${o.id}`} className="tap-inline font-mono font-semibold text-brand" dir="ltr">{o.code}</Link></td>
                <td>{o.buyer_name}<div className="text-xs text-ink-soft">{o.governorate}</div></td>
                <td className="whitespace-nowrap">{formatSYP(o.total, lang)}</td>
                <td className="text-xs text-ink-soft whitespace-nowrap">{age(o.delivered_at)} {t('days_open')}</td>
                <td>
                  <form action={codCollectedAction.bind(null, o.id)} className="flex gap-2 min-w-[14rem]">
                    <input name="note" className="input" placeholder={t('reference')} aria-label={t('reference')} />
                    <SubmitButton className="btn-primary btn-sm shrink-0">{t('confirm')}</SubmitButton>
                  </form>
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

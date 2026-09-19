import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrderStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
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
     WHERE b.status IN ('awaiting_proof','submitted') ORDER BY b.submitted_at IS NULL, o.created_at ASC`);
  const unfulfilled = q<Order>(
    `SELECT * FROM orders WHERE status = 'confirmed' AND created_at <= datetime('now','-2 days') ORDER BY created_at ASC`);
  const stuckTransit = q<Order>(
    `SELECT * FROM orders WHERE status IN ('handed_off','in_transit','ready_for_pickup') AND coalesce(handed_off_at, created_at) <= datetime('now','-7 days') ORDER BY handed_off_at ASC`);
  const codUncollected = q<Order>(
    `SELECT * FROM orders WHERE payment_method = 'cod' AND status = 'delivered' AND payment_status != 'collected_cod' ORDER BY delivered_at ASC`);
  const failedPayments = q<Order>(`SELECT * FROM orders WHERE status = 'payment_failed' ORDER BY created_at DESC LIMIT 25`);
  const addressReqs = q<Order & { req_id: string }>(
    `SELECT o.*, a.id req_id FROM orders o JOIN address_change_requests a ON a.order_id = o.id WHERE a.status = 'pending' ORDER BY a.created_at ASC`);
  const kyc = q<Seller>(`SELECT * FROM sellers WHERE kyc_status = 'submitted' ORDER BY created_at ASC`);
  const failedPayouts = q<Payout & { store_name: string }>(
    `SELECT p.*, s.store_name FROM payouts p JOIN sellers s ON s.id = p.seller_id WHERE p.status = 'failed' ORDER BY p.created_at DESC`);

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

      <OrderQueue title={t('ops_awaiting_transfer')} rows={awaitingTransfer} />
      <OrderQueue title={t('ops_unfulfilled')} rows={unfulfilled} stamp={(o) => `${age(o.created_at)} ${t('days_open')}`} />
      <OrderQueue title={t('ops_stuck_transit')} rows={stuckTransit} stamp={(o) => `${age(o.handed_off_at)} ${t('days_open')}`} />
      <OrderQueue title={t('ops_cod_uncollected')} rows={codUncollected} stamp={(o) => `${age(o.delivered_at)} ${t('days_open')}`} />
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
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrderSummary } from '@/components/OrderSummary';
import { DisputeStatusBadge, OrderStateBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { Timeline } from '@/components/Timeline';
import { getDb, getSetting } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { getAddressRequest, getBankTransfer, getOrder, getOrderDisputes, getOrderEvents, getOrderPayments } from '@/lib/orders';
import { DAMASCUS, type Payout, type Seller } from '@/lib/types';
import {
  cancelAction, codCollectedAction, refundAction, reviewAddressAction, reviewTransferAction,
  setDeliveredAction, setFulfillmentAction, setInTransitAction, setReadyAction,
} from './actions';

export default function AdminOrderPage({ params }: { params: { id: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const order = getOrder(params.id);
  if (!order) notFound();
  const db = getDb();
  const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(order.seller_id) as Seller;
  const events = getOrderEvents(order.id);
  const payments = getOrderPayments(order.id);
  const disputes = getOrderDisputes(order.id);
  const transfer = getBankTransfer(order.id);
  const addressReq = getAddressRequest(order.id);
  const payout = order.payout_id ? db.prepare('SELECT * FROM payouts WHERE id = ?').get(order.payout_id) as Payout : null;

  const shipped = ['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const active = ['confirmed', ...['handed_off', 'in_transit', 'ready_for_pickup']].includes(order.status);
  const isDmc = order.governorate === DAMASCUS;
  const yalla = getSetting('yalla_go_enabled') === '1';
  const refundable = !order.payout_id && ['confirmed', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status) && order.payment_status !== 'pending';
  const cancellable = ['awaiting_payment', 'confirmed'].includes(order.status);
  const codOutstanding = order.payment_method === 'cod' && order.payment_status === 'pending' && order.status === 'delivered';

  return (
    <div>
      <AutoRefresh seconds={15} />
      <Link href="/admin/orders" className="text-sm text-ink-soft hover:text-cherry">← {t('a_orders_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-2">
        <h1 className="text-2xl font-bold font-mono" dir="ltr">{order.code}</h1>
        <OrderStateBadge state={order.order_state} t={t} />
        <OrderStatusBadge status={order.status} t={t} />
      </div>
      <p className="text-sm text-ink-soft mb-6">
        {t('seller')}: <Link href={`/admin/sellers/${seller.id}`} className="link">{seller.store_name}</Link>
        {' · '}<Link href={`/track/${order.code}`} target="_blank" className="link">{t('nav_track')}</Link>
      </p>

      {transfer && transfer.status !== 'confirmed' && (
        <div className="card-pad mb-6 border-warn/30 bg-warn/5">
          <h2 className="text-lg font-bold">{t('bt_review_title')}</h2>
          <p className="text-sm text-ink-soft mt-1">{t(`bt_${transfer.status}` as const)}{transfer.reference ? ` · ${transfer.reference}` : ''}</p>
          {transfer.proof_path && <a href={transfer.proof_path} target="_blank" rel="noreferrer" className="link text-sm block mt-1">{t('bt_view_proof')} →</a>}
          {/* Confirmable with or without a receipt: transfers are often matched straight off the bank statement. */}
          {transfer.status !== 'rejected' && (
            <div className="mt-3 grid sm:grid-cols-2 gap-2">
              <form action={reviewTransferAction.bind(null, order.id, true)} className="flex gap-2">
                <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-primary shrink-0">{t('bt_confirm')}</SubmitButton>
              </form>
              <form action={reviewTransferAction.bind(null, order.id, false)} className="flex gap-2">
                <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-danger shrink-0">{t('bt_reject')}</SubmitButton>
              </form>
            </div>
          )}
        </div>
      )}

      {addressReq?.status === 'pending' && (
        <div className="card-pad mb-6 border-warn/30 bg-warn/5">
          <h2 className="text-lg font-bold">{t('ac_review_title')}</h2>
          <p className="text-sm mt-1">{addressReq.new_governorate} — {addressReq.new_address}</p>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            <form action={reviewAddressAction.bind(null, order.id, true)} className="flex gap-2">
              <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-primary shrink-0">{t('ac_approve')}</SubmitButton>
            </form>
            <form action={reviewAddressAction.bind(null, order.id, false)} className="flex gap-2">
              <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-secondary shrink-0">{t('ac_reject')}</SubmitButton>
            </form>
          </div>
        </div>
      )}

      <div className="mb-6"><OrderSummary order={order} t={t} lang={lang} admin /></div>

      {active && order.product_type !== 'digital' && (
        <div className="card-pad mb-6 border-cherry/30">
          <h2 className="text-lg font-bold mb-3">{t('a_update_delivery')}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {isDmc && yalla && order.fulfillment_method === 'platform_rider' && (
              <form action={setFulfillmentAction.bind(null, order.id, 'yalla_go')} className="flex gap-2">
                <input name="ref" className="input" placeholder={t('a_ref_ph')} /><SubmitButton className="btn-secondary shrink-0">{t('switch_yalla')}</SubmitButton></form>
            )}
            {isDmc && order.fulfillment_method === 'yalla_go' && (
              <form action={setFulfillmentAction.bind(null, order.id, 'platform_rider')} className="flex gap-2">
                <input name="ref" className="input" placeholder={t('a_ref_ph')} /><SubmitButton className="btn-secondary shrink-0">{t('switch_rider')}</SubmitButton></form>
            )}
            {shipped && order.status !== 'in_transit' && order.fulfillment_method !== 'logistics_pickup' && (
              <form action={setInTransitAction.bind(null, order.id)} className="flex gap-2">
                <input name="ref" className="input" placeholder={t('a_ref_ph')} /><SubmitButton className="btn-dark shrink-0">{t('set_in_transit')}</SubmitButton></form>
            )}
            {shipped && order.fulfillment_method === 'logistics_pickup' && order.status !== 'ready_for_pickup' && (
              <form action={setReadyAction.bind(null, order.id)} className="flex gap-2">
                <input name="pickup_location" className="input" placeholder={t('a_pickup_ph')} required defaultValue={order.pickup_location ?? ''} />
                <SubmitButton className="btn-dark shrink-0">{t('set_ready')}</SubmitButton></form>
            )}
            {shipped && (
              <form action={setDeliveredAction.bind(null, order.id)} className="flex gap-2">
                <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-primary shrink-0">{t('set_delivered')}</SubmitButton></form>
            )}
          </div>
        </div>
      )}

      {codOutstanding && (
        <form action={codCollectedAction.bind(null, order.id)} className="card-pad mb-6 border-warn/40 bg-warn/5 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1"><h2 className="font-bold">{t('mark_cod_collected')}</h2><p className="text-sm text-ink-soft mt-1">{t('cod_collected_note')}</p></div>
          <input name="note" className="input sm:w-56" placeholder={t('reference')} />
          <SubmitButton className="btn-primary shrink-0">{t('confirm')}</SubmitButton>
        </form>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm">
          <h2 className="font-bold mb-2">{t('payment')}</h2>
          {payments.map((p) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 border-b border-ink/5 py-1.5 last:border-0">
              <span>
                <span className={`badge ${p.status === 'captured' ? 'bg-success/12 text-success' : p.status === 'failed' ? 'bg-cherry/8 text-cherry' : 'bg-ink/8 text-ink-soft'}`}>{p.status}</span>{' '}
                {t(`pm_${p.method}` as 'pm_cod')}{p.card_last4 ? ` •••• ${p.card_last4}` : ''}
                {p.failure_reason && <span className="text-cherry"> · {p.failure_reason}</span>}
              </span>
              <span dir="ltr" className="text-xs text-ink-soft">{formatSYP(p.amount, lang)} · {p.provider}:{p.provider_ref ?? '—'}</span>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            {refundable && (
              <form action={refundAction.bind(null, order.id)} className="flex gap-2 flex-1">
                <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-danger shrink-0">{t('st_refunded')}</SubmitButton></form>
            )}
            {cancellable && (
              <form action={cancelAction.bind(null, order.id)} className="flex gap-2 flex-1">
                <input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-secondary shrink-0">{t('st_cancelled')}</SubmitButton></form>
            )}
          </div>
        </div>
        <div className="card-pad text-sm space-y-2">
          <div><span className="text-ink-soft">{t('payout')}: </span>{payout ? `${payout.period_label} — ${payout.status === 'paid' ? t('payout_paid') : t('payout_pending')}` : t('unpaid')}</div>
          {disputes.length > 0 && (
            <div><h3 className="font-bold">{t('nav_disputes')}</h3>
              {disputes.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 py-1">
                  <DisputeStatusBadge status={d.status} t={t} /><span>{t(`dr_${d.reason}` as 'dr_other')}</span>
                  <Link href={`/admin/disputes#${d.id}`} className="link text-xs">{t('view')}</Link>
                </div>))}
            </div>
          )}
        </div>
      </div>

      <div className="card-pad"><h2 className="font-bold mb-4">{t('timeline')}</h2><Timeline events={events} t={t} /></div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrderSummary } from '@/components/OrderSummary';
import { OrderStateBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { Timeline } from '@/components/Timeline';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { getOrder, getOrderEvents } from '@/lib/orders';
import type { Payout } from '@/lib/types';
import { HandOffForm } from './HandOffForm';
import { sellerCancelAction, sellerRefundAction, updateTrackingAction } from './actions';

export default function SellerOrderPage({ params }: { params: { id: string } }) {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const order = getOrder(params.id);
  if (!order || order.seller_id !== seller.id) notFound();
  const events = getOrderEvents(order.id);
  const payout = order.payout_id ? getDb().prepare('SELECT * FROM payouts WHERE id = ?').get(order.payout_id) as Payout : null;
  const canHandOff = order.status === 'confirmed' && order.product_type !== 'digital';
  const shipped = ['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const canCancel = ['awaiting_payment', 'confirmed'].includes(order.status);
  const canRefund = !order.payout_id && ['confirmed', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status) && order.payment_status !== 'pending';

  return (
    <div>
      <AutoRefresh seconds={10} />
      <Link href="/seller/orders" className="text-sm text-ink-soft hover:text-cherry">← {t('orders_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold font-mono" dir="ltr">{order.code}</h1>
        <OrderStateBadge state={order.order_state} t={t} />
        <OrderStatusBadge status={order.status} t={t} />
      </div>

      {order.status === 'awaiting_payment' && <div className="alert-warn mb-6">{t('st_awaiting_payment')} — {t('pm_bank_transfer_d')}</div>}
      {canHandOff && <div className="mb-6"><HandOffForm orderId={order.id} pickup={order.fulfillment_method === 'logistics_pickup'} /></div>}

      {shipped && (
        <form action={updateTrackingAction.bind(null, order.id)} className="card-pad mb-6 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="label">{t('tracking_number')}</label>
            <input name="tracking" className="input" dir="ltr" defaultValue={order.tracking_number ?? ''} placeholder={t('tracking_number_hint')} />
          </div>
          <SubmitButton className="btn-secondary shrink-0">{t('save')}</SubmitButton>
        </form>
      )}

      <div className="mb-6"><OrderSummary order={order} t={t} lang={lang} /></div>

      <div className="card-pad mb-6 text-sm flex flex-wrap items-center justify-between gap-3">
        <div><span className="text-ink-soft">{t('payout')}: </span>
          {payout ? `${payout.period_label} — ${payout.status === 'paid' ? t('payout_paid') : t('payout_pending')}` : t('unpaid')}</div>
        <div className="flex flex-wrap gap-2">
          {canCancel && (
            <form action={sellerCancelAction.bind(null, order.id)} className="flex gap-2">
              <input name="reason" className="input py-1.5 text-xs" placeholder={t('note')} />
              <SubmitButton className="btn-secondary btn-sm shrink-0">{t('st_cancelled')}</SubmitButton>
            </form>
          )}
          {canRefund && (
            <form action={sellerRefundAction.bind(null, order.id)} className="flex gap-2">
              <input name="reason" className="input py-1.5 text-xs" placeholder={t('note')} />
              <SubmitButton className="btn-danger btn-sm shrink-0">{t('st_refunded')}</SubmitButton>
            </form>
          )}
        </div>
      </div>

      <div className="card-pad"><h2 className="font-bold mb-4">{t('timeline')}</h2><Timeline events={events} t={t} /></div>
    </div>
  );
}

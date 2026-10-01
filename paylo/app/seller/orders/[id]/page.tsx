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
import { HandedOffCard } from './HandedOffCard';
import { appUrl } from '@/lib/notify';
import { sellerCancelAction, sellerRefundAction } from './actions';

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
      <Link href="/seller/orders" className="tap text-sm text-ink-soft hover:text-brand">← {t('orders_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-extrabold font-mono" dir="ltr">{order.code}</h1>
        <OrderStateBadge state={order.order_state} t={t} />
        <OrderStatusBadge status={order.status} t={t} />
      </div>

      {order.status === 'awaiting_payment' && <div className="alert-warn mb-6">{t('st_awaiting_payment')} — {t('pm_bank_transfer_d')}</div>}
      {canHandOff && ['platform_rider', 'yalla_go'].includes(order.fulfillment_method) && (
        <div className="alert-info mb-3 text-sm" data-testid="courier-autoclose">{t('courier_autoclose_note')}</div>
      )}
      {canHandOff && <div className="mb-6"><HandOffForm orderId={order.id} pickup={order.fulfillment_method === 'logistics_pickup'} /></div>}

      {(shipped || order.status === 'delivered') && order.handed_off_at && (
        <div className="mb-6"><HandedOffCard order={order} trackUrl={appUrl('/track/' + order.code)} t={t} /></div>
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

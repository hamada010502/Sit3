import { Shell } from '@/components/Shell';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Timeline } from '@/components/Timeline';
import { DisputeStatusBadge, OrderStateBadge, OrderStatusBadge, PaymentStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { getAllSettings, getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { getAddressRequest, getBankTransfer, getOrderByCode, getOrderDisputes, getOrderEvents } from '@/lib/orders';
import type { OrderStatus, Seller } from '@/lib/types';
import { confirmReceivedAction } from './actions';
import { AddressPanel, ReturnPanel, TransferPanel } from './BuyerPanels';

const STEPS = ['confirmed', 'handed_off', 'in_transit', 'delivered'] as const;

export default function TrackPage({ params, searchParams }: { params: { code: string }; searchParams: { new?: string } }) {
  const { t, lang } = getT();
  const order = getOrderByCode(decodeURIComponent(params.code));
  if (!order) return <Shell><div className="alert-error text-center py-10">{t('tracking_not_found')}</div></Shell>;

  const db = getDb();
  const settings = getAllSettings();
  const seller = db.prepare('SELECT store_name, slug FROM sellers WHERE id = ?').get(order.seller_id) as Pick<Seller, 'store_name' | 'slug'>;
  const events = getOrderEvents(order.id);
  const disputes = getOrderDisputes(order.id);
  const transfer = getBankTransfer(order.id);
  const addressReq = getAddressRequest(order.id);
  const openD = disputes.find((d) => d.status === 'open' || d.status === 'investigating');

  const effective = (order.status === 'disputed' ? order.pre_dispute_status ?? 'confirmed' : order.status) as OrderStatus;
  const stepIdx = effective === 'ready_for_pickup' ? 2 : STEPS.indexOf(effective as typeof STEPS[number]);
  const isPickup = order.fulfillment_method === 'logistics_pickup';
  const closed = ['refunded', 'cancelled', 'payment_failed'].includes(order.status);
  const canConfirm = ['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const canReturn = ['confirmed', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status) && !order.payout_id && !openD;
  const canChangeAddress = ['awaiting_payment', 'confirmed'].includes(order.status) && !addressReq;
  const needsTransfer = order.payment_method === 'bank_transfer' && transfer && transfer.status !== 'confirmed';

  return (
    <Shell>
      <AutoRefresh seconds={5} />
      {searchParams.new && <div className="alert-success mb-4">{t('tracking_hint')}</div>}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-soft">{t('tracking_title')}</p>
          <h1 className="text-3xl font-bold font-mono" dir="ltr">{order.code}</h1>
          <p className="text-xs text-ink-soft mt-1">{t('tracking_sub')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OrderStateBadge state={order.order_state} t={t} />
          <OrderStatusBadge status={order.status} t={t} />
        </div>
      </div>

      {!closed && (
        <div className="card-pad mb-6">
          <ol className="grid grid-cols-4 gap-2 text-center text-xs">
            {STEPS.map((s, i) => (
              <li key={s} className={`flex flex-col items-center gap-2 ${i <= stepIdx ? 'text-cherry font-semibold' : 'text-ink-soft/60'}`}>
                <span className={`h-3 w-3 rounded-full ${i <= stepIdx ? 'bg-cherry' : 'bg-ink/15'}`} />
                <span>{s === 'in_transit' && isPickup ? t('st_ready_for_pickup') : t(`st_${s}` as const)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {needsTransfer && transfer && (
        <TransferPanel code={order.code} status={transfer.status} total={formatSYP(order.total, lang)}
          bank={{ name: settings.bank_name, account: settings.bank_account_name, iban: settings.bank_iban, note: settings.bank_note }} />
      )}
      {order.status === 'ready_for_pickup' && order.pickup_location && (
        <div className="alert-info mb-6"><strong>{t('pickup_ready_note')}</strong><div className="mt-1 whitespace-pre-line">{order.pickup_location}</div></div>
      )}
      {order.status === 'refunded' && <div className="alert-success mb-6">{t('refund_note')}</div>}
      {openD && <div className="alert-error mb-6">{t('dispute_open_note')} <DisputeStatusBadge status={openD.status} t={t} /></div>}
      {addressReq && (
        <div className={`mb-6 ${addressReq.status === 'pending' ? 'alert-warn' : addressReq.status === 'approved' ? 'alert-success' : 'alert-error'}`}>
          {t(`ac_${addressReq.status}` as const)}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1">
          <div className="flex justify-between gap-3"><span className="text-ink-soft">{t('product')}</span>
            <span className="font-semibold text-end">{order.product_title}{order.variant_label ? ` · ${order.variant_label}` : ''} × {order.quantity}</span></div>
          <div className="flex justify-between gap-3"><span className="text-ink-soft">{t('store_by')}</span><span>{seller.store_name}</span></div>
          <div className="flex justify-between gap-3"><span className="text-ink-soft">{t('subtotal')}</span><span>{formatSYP(order.subtotal, lang)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-ink-soft">{t('delivery_fee')}</span><span>{formatSYP(order.delivery_fee, lang)}</span></div>
          <div className="flex justify-between gap-3 font-bold border-t border-ink/10 pt-1"><span>{t('total')}</span><span>{formatSYP(order.total, lang)}</span></div>
        </div>
        <div className="card-pad text-sm space-y-1">
          <div><span className="text-ink-soft">{t('buyer')}: </span>{order.buyer_name}</div>
          <div><span className="text-ink-soft">{t('governorate')}: </span>{order.governorate}</div>
          <div><span className="text-ink-soft">{t('address')}: </span>{order.address}</div>
          <div><span className="text-ink-soft">{t('fulfillment')}: </span>{t(`fm_${order.fulfillment_method}` as const)}</div>
          {order.tracking_number && <div><span className="text-ink-soft">{t('tracking_number')}: </span><span dir="ltr">{order.tracking_number}</span></div>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-ink-soft">{t('payment_method')}: </span>{t(`pm_${order.payment_method}` as const)}
            <PaymentStatusBadge status={order.payment_status} t={t} />
          </div>
        </div>
      </div>

      {canConfirm && (
        <form action={confirmReceivedAction.bind(null, order.code)} className="card-pad mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-ink-soft flex-1">{t('confirm_received_hint')}</p>
          <SubmitButton className="btn-dark">{t('confirm_received')}</SubmitButton>
        </form>
      )}
      {canChangeAddress && <AddressPanel code={order.code} governorate={order.governorate} address={order.address} />}
      {canReturn && <ReturnPanel code={order.code} delivered={order.status === 'delivered'} />}

      {disputes.length > 0 && (
        <div className="card-pad mb-6 text-sm space-y-2">
          <h2 className="font-bold">{t('dispute_status')}</h2>
          {disputes.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2">
              <DisputeStatusBadge status={d.status} t={t} /><span>{t(`dr_${d.reason}` as 'dr_other')}</span>
              <span className="text-ink-soft text-xs">{d.created_at}</span>
              {d.admin_note && d.status.startsWith('resolved') && <span className="text-ink-soft">— {d.admin_note}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="card-pad"><h2 className="font-bold mb-4">{t('timeline')}</h2><Timeline events={events} t={t} showActor={false} /></div>
    </Shell>
  );
}

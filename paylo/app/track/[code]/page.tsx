import { Shell } from '@/components/Shell';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Timeline } from '@/components/Timeline';
import { DisputeStatusBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { getOrderByCode, getOrderDisputes, getOrderEvents } from '@/lib/orders';
import { getDb } from '@/lib/db';
import type { Seller } from '@/lib/types';
import { confirmReceivedAction, openDisputeAction } from './actions';
import { SubmitButton } from '@/components/SubmitButton';

const STEPS = ['paid', 'handed_off', 'in_transit', 'delivered'] as const;

export default function TrackPage({ params, searchParams }: { params: { code: string }; searchParams: { new?: string } }) {
  const { t, lang } = getT();
  const order = getOrderByCode(decodeURIComponent(params.code));
  if (!order) return <Shell><div className="alert-error text-center py-10">{t('tracking_not_found')}</div></Shell>;
  const seller = getDb().prepare('SELECT store_name, slug FROM sellers WHERE id = ?').get(order.seller_id) as Pick<Seller, 'store_name' | 'slug'>;
  const events = getOrderEvents(order.id);
  const disputes = getOrderDisputes(order.id);
  const openD = disputes.find((d) => d.status === 'open' || d.status === 'investigating');
  const effective = order.status === 'disputed' ? order.pre_dispute_status ?? 'paid' : order.status;
  const stepIdx = effective === 'ready_for_pickup' ? 2 : STEPS.indexOf(effective as typeof STEPS[number]);
  const canConfirm = ['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const canDispute = ['paid', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status) && !order.payout_id;
  const disputeReasons = ['not_received', 'damaged', 'wrong_item', 'other'] as const;

  return (
    <Shell>
      <AutoRefresh seconds={5} />
      {searchParams.new && <div className="alert-success mb-4">{t('st_paid')} ✓ — {t('tracking_hint')}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-bluewood/50">{t('tracking_title')}</p>
          <h1 className="text-3xl font-bold font-mono" dir="ltr">{order.code}</h1>
          <p className="text-xs text-bluewood/50 mt-1">{t('tracking_sub')}</p>
        </div>
        <OrderStatusBadge status={order.status} t={t} />
      </div>

      {order.status !== 'refunded' && order.status !== 'cancelled' && order.status !== 'payment_failed' && (
        <div className="card-pad mb-6">
          <ol className="grid grid-cols-4 gap-2 text-center text-xs">
            {STEPS.map((s, i) => (
              <li key={s} className={`flex flex-col items-center gap-2 ${i <= stepIdx ? 'text-crusta font-semibold' : 'text-bluewood/40'}`}>
                <span className={`h-3 w-3 rounded-full ${i <= stepIdx ? 'bg-crusta' : 'bg-bluewood/15'}`} />
                <span>{s === 'in_transit' && order.fulfillment_method === 'logistics_pickup' ? t('st_ready_for_pickup') : t(`st_${s}` as const)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {order.status === 'ready_for_pickup' && order.pickup_location && (
        <div className="alert-info mb-6"><strong>{t('pickup_ready_note')}</strong><div className="mt-1 whitespace-pre-line">{order.pickup_location}</div></div>
      )}
      {order.status === 'refunded' && <div className="alert-success mb-6">{t('refund_note')}</div>}
      {openD && <div className="alert-error mb-6">{t('dispute_open_note')} <DisputeStatusBadge status={openD.status} t={t} /></div>}

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm space-y-1">
          <div className="flex justify-between gap-3"><span className="text-bluewood/60">{t('product')}</span><span className="font-semibold text-end">{order.product_title} × {order.quantity}</span></div>
          <div className="flex justify-between gap-3"><span className="text-bluewood/60">{t('store_by')}</span><span>{seller.store_name}</span></div>
          <div className="flex justify-between gap-3"><span className="text-bluewood/60">{t('subtotal')}</span><span>{formatSYP(order.subtotal, lang)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-bluewood/60">{t('delivery_fee')}</span><span>{formatSYP(order.delivery_fee, lang)}</span></div>
          <div className="flex justify-between gap-3 font-bold border-t border-bluewood/10 pt-1"><span>{t('total')}</span><span>{formatSYP(order.total, lang)}</span></div>
        </div>
        <div className="card-pad text-sm space-y-1">
          <div><span className="text-bluewood/60">{t('buyer')}: </span>{order.buyer_name}</div>
          <div><span className="text-bluewood/60">{t('governorate')}: </span>{order.governorate}</div>
          <div><span className="text-bluewood/60">{t('address')}: </span>{order.address}</div>
          <div><span className="text-bluewood/60">{t('fulfillment')}: </span>{t(`fm_${order.fulfillment_method}` as const)}</div>
        </div>
      </div>

      {canConfirm && (
        <form action={confirmReceivedAction.bind(null, order.code)} className="card-pad mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm text-bluewood/70 flex-1">{t('confirm_received_hint')}</p>
          <SubmitButton className="btn-dark">{t('confirm_received')}</SubmitButton>
        </form>
      )}

      {canDispute && !openD && (
        <details className="card-pad mb-6">
          <summary className="cursor-pointer font-semibold text-blossom">{t('open_dispute')}</summary>
          <form action={openDisputeAction.bind(null, order.code)} className="mt-4 space-y-3">
            <div>
              <label className="label">{t('dispute_reason')}</label>
              <select name="reason" className="input">{disputeReasons.map((r) => <option key={r} value={r}>{t(`dr_${r}` as const)}</option>)}</select>
            </div>
            <div><label className="label">{t('dispute_desc')}</label><textarea name="description" className="input" rows={3} /></div>
            <SubmitButton className="btn-danger">{t('dispute_submit')}</SubmitButton>
          </form>
        </details>
      )}

      {disputes.length > 0 && (
        <div className="card-pad mb-6 text-sm space-y-2">
          <h2 className="font-semibold">{t('dispute_status')}</h2>
          {disputes.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2">
              <DisputeStatusBadge status={d.status} t={t} /><span>{t(`dr_${d.reason}` as 'dr_other')}</span>
              <span className="text-bluewood/50 text-xs">{d.created_at}</span>
              {d.admin_note && d.status.startsWith('resolved') && <span className="text-bluewood/70">— {d.admin_note}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="card-pad">
        <h2 className="font-semibold mb-4">{t('timeline')}</h2>
        <Timeline events={events} t={t} showActor={false} />
      </div>
    </Shell>
  );
}

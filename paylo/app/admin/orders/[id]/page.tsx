import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrderSummary } from '@/components/OrderSummary';
import { DisputeStatusBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { Timeline } from '@/components/Timeline';
import { getDb, getSetting } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { getOrder, getOrderDisputes, getOrderEvents, getOrderPayments } from '@/lib/orders';
import { DAMASCUS, type Payout, type Seller } from '@/lib/types';
import { refundAction, setDeliveredAction, setFulfillmentAction, setInTransitAction, setReadyAction } from './actions';

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
  const payout = order.payout_id ? db.prepare('SELECT * FROM payouts WHERE id = ?').get(order.payout_id) as Payout : null;
  const active = ['paid', 'handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const shipped = ['handed_off', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const isDmc = order.governorate === DAMASCUS;
  const yalla = getSetting('yalla_go_enabled') === '1';
  const refundable = ['paid', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered'].includes(order.status) && !order.payout_id;

  return (
    <div>
      <AutoRefresh seconds={15} />
      <Link href="/admin/orders" className="text-sm text-bluewood/60 hover:text-crusta">← {t('a_orders_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-2"><h1 className="text-2xl font-bold font-mono" dir="ltr">{order.code}</h1><OrderStatusBadge status={order.status} t={t} /></div>
      <p className="text-sm text-bluewood/60 mb-6">{t('seller')}: <Link href={`/admin/sellers/${seller.id}`} className="text-crusta font-semibold">{seller.store_name}</Link> · <Link href={`/track/${order.code}`} target="_blank" className="text-crusta">{t('nav_track')}</Link></p>

      <div className="mb-6"><OrderSummary order={order} t={t} lang={lang} admin /></div>

      {active && (
        <div className="card-pad mb-6 border-crusta/40">
          <h2 className="font-semibold text-lg mb-3">{t('a_update_delivery')}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {isDmc && yalla && order.fulfillment_method === 'platform_rider' && (
              <form action={setFulfillmentAction.bind(null, order.id, 'yalla_go')} className="flex gap-2"><input name="ref" className="input" placeholder={t('a_ref_ph')} /><SubmitButton className="btn-secondary shrink-0">{t('switch_yalla')}</SubmitButton></form>
            )}
            {isDmc && order.fulfillment_method === 'yalla_go' && (
              <form action={setFulfillmentAction.bind(null, order.id, 'platform_rider')} className="flex gap-2"><input name="ref" className="input" placeholder={t('a_ref_ph')} /><SubmitButton className="btn-secondary shrink-0">{t('switch_rider')}</SubmitButton></form>
            )}
            {shipped && order.status !== 'in_transit' && order.fulfillment_method !== 'logistics_pickup' && (
              <form action={setInTransitAction.bind(null, order.id)} className="flex gap-2"><input name="ref" className="input" placeholder={t('a_ref_ph')} /><SubmitButton className="btn-dark shrink-0">{t('set_in_transit')}</SubmitButton></form>
            )}
            {shipped && order.fulfillment_method === 'logistics_pickup' && order.status !== 'ready_for_pickup' && (
              <form action={setReadyAction.bind(null, order.id)} className="flex gap-2"><input name="pickup_location" className="input" placeholder={t('a_pickup_ph')} required defaultValue={order.pickup_location ?? ''} /><SubmitButton className="btn-dark shrink-0">{t('set_ready')}</SubmitButton></form>
            )}
            {shipped && (
              <form action={setDeliveredAction.bind(null, order.id)} className="flex gap-2"><input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-primary shrink-0">{t('set_delivered')}</SubmitButton></form>
            )}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card-pad text-sm">
          <h2 className="font-semibold mb-2">{t('payment')}</h2>
          {payments.map((p) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 border-b border-bluewood/5 py-1.5 last:border-0">
              <span><span className={`badge ${p.status === 'captured' ? 'bg-emerald-100 text-emerald-800' : p.status === 'failed' ? 'bg-blossom/10 text-blossom' : 'bg-bluewood/10'}`}>{p.status}</span> {p.card_brand} •••• {p.card_last4}{p.failure_reason && <span className="text-blossom"> · {p.failure_reason}</span>}</span>
              <span dir="ltr" className="text-xs text-bluewood/60">{formatSYP(p.amount, lang)} · {p.provider}:{p.provider_ref ?? '—'}</span>
            </div>
          ))}
          {refundable && (
            <form action={refundAction.bind(null, order.id)} className="mt-3 flex gap-2"><input name="note" className="input" placeholder={t('note')} /><SubmitButton className="btn-danger shrink-0">{t('a_resolve_refund')}</SubmitButton></form>
          )}
        </div>
        <div className="card-pad text-sm space-y-2">
          <div><span className="text-bluewood/60">{t('payout')}: </span>{payout ? `${payout.period_label} — ${payout.status === 'paid' ? t('payout_paid') : t('payout_pending')}` : t('unpaid')}</div>
          {disputes.length > 0 && <div><h3 className="font-semibold">{t('nav_disputes')}</h3>{disputes.map((d) => <div key={d.id} className="flex flex-wrap items-center gap-2 py-1"><DisputeStatusBadge status={d.status} t={t} /><span>{t(`dr_${d.reason}` as 'dr_other')}</span><Link href={`/admin/disputes#${d.id}`} className="text-crusta text-xs font-semibold">{t('view')}</Link></div>)}</div>}
        </div>
      </div>

      <div className="card-pad"><h2 className="font-semibold mb-4">{t('timeline')}</h2><Timeline events={events} t={t} /></div>
    </div>
  );
}

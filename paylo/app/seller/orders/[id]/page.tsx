import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrderSummary } from '@/components/OrderSummary';
import { OrderStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { Timeline } from '@/components/Timeline';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { getOrder, getOrderEvents } from '@/lib/orders';
import type { Payout } from '@/lib/types';
import { handOffAction } from './actions';

export default function SellerOrderPage({ params }: { params: { id: string } }) {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const order = getOrder(params.id);
  if (!order || order.seller_id !== seller.id) notFound();
  const events = getOrderEvents(order.id);
  const payout = order.payout_id ? getDb().prepare('SELECT * FROM payouts WHERE id = ?').get(order.payout_id) as Payout : null;
  return (
    <div>
      <AutoRefresh seconds={10} />
      <Link href="/seller/orders" className="text-sm text-bluewood/60 hover:text-crusta">← {t('orders_title')}</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6"><h1 className="text-2xl font-bold font-mono" dir="ltr">{order.code}</h1><OrderStatusBadge status={order.status} t={t} /></div>
      {order.status === 'paid' && (
        <form action={handOffAction.bind(null, order.id)} className="card-pad mb-6 border-crusta/40 bg-karry/50">
          <h2 className="font-semibold text-lg">{t('hand_off_title')}</h2>
          <p className="text-sm text-bluewood/70 mt-1 mb-3">{order.fulfillment_method === 'logistics_pickup' ? t('hand_off_hint_out') : t('hand_off_hint_dmc')}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input name="ref" className="input" placeholder={t('hand_off_ref')} />
            <SubmitButton className="btn-primary shrink-0">{t('hand_off_btn')}</SubmitButton>
          </div>
        </form>
      )}
      <div className="mb-6"><OrderSummary order={order} t={t} lang={lang} /></div>
      <div className="card-pad mb-6 text-sm">
        <span className="text-bluewood/60">{t('payout')}: </span>
        {payout ? <span>{payout.period_label} — {payout.status === 'paid' ? t('payout_paid') : t('payout_pending')}</span> : <span>{t('unpaid')}</span>}
      </div>
      <div className="card-pad"><h2 className="font-semibold mb-4">{t('timeline')}</h2><Timeline events={events} t={t} /></div>
    </div>
  );
}

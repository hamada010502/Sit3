import type { Lang, TFn } from '@/lib/i18n';
import { formatSYP } from '@/lib/money';
import type { Order } from '@/lib/types';
import { PaymentStatusBadge } from './StatusBadge';

export function OrderSummary({ order, t, lang, showNet = true, admin = false }: { order: Order; t: TFn; lang: Lang; showNet?: boolean; admin?: boolean }) {
  const Row = ({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) => (
    <div className={`flex justify-between gap-3 ${bold ? 'font-bold border-t border-ink/10 pt-1' : ''}`}><span className="text-ink-soft">{k}</span><span className="text-end">{v}</span></div>
  );
  const commissionTotal = order.commission_amount + order.commission_vat;
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="card-pad text-sm space-y-1">
        <Row k={t('product')} v={<>{order.product_title}{order.variant_label ? ` · ${order.variant_label}` : ''} × {order.quantity}</>} />
        <Row k={t('subtotal')} v={formatSYP(order.subtotal, lang)} />
        <Row k={t('delivery_fee')} v={formatSYP(order.delivery_fee, lang)} />
        <Row k={t('total')} v={formatSYP(order.total, lang)} bold />
        {showNet && <>
          <Row k={`${t('commission')} (${order.commission_rate}%${order.commission_fixed ? ' + ' + formatSYP(order.commission_fixed, lang) : ''})`} v={'− ' + formatSYP(commissionTotal, lang)} />
          <Row k={t(admin ? 'seller_net_admin' : 'seller_net')} v={formatSYP(order.seller_net, lang)} bold />
        </>}
      </div>
      <div className="card-pad text-sm space-y-1">
        <div><span className="text-ink-soft">{t('buyer')}: </span>{order.buyer_name}</div>
        <div><span className="text-ink-soft">{t('phone')}: </span><span dir="ltr">{order.buyer_phone}</span></div>
        {order.buyer_email && <div><span className="text-ink-soft">{t('email')}: </span><span dir="ltr">{order.buyer_email}</span></div>}
        <div><span className="text-ink-soft">{t('governorate')}: </span>{order.governorate}</div>
        <div><span className="text-ink-soft">{t('address')}: </span>{order.address}</div>
        {order.note && <div><span className="text-ink-soft">{t('note')}: </span>{order.note}</div>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-ink-soft">{t('payment_method')}: </span>{t(`pm_${order.payment_method}` as const)}
          <PaymentStatusBadge status={order.payment_status} t={t} />
        </div>
        <div><span className="text-ink-soft">{t('fulfillment')}: </span>{t(`fm_${order.fulfillment_method}` as const)}{order.fulfillment_ref && <span className="text-ink-soft"> · {order.fulfillment_ref}</span>}</div>
        {order.tracking_number && <div><span className="text-ink-soft">{t('tracking_number')}: </span><span dir="ltr">{order.tracking_number}</span></div>}
        {order.pickup_location && <div><span className="text-ink-soft">{t('pickup_location')}: </span>{order.pickup_location}</div>}
      </div>
    </div>
  );
}

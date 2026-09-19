import Link from 'next/link';
import type { Lang, TFn } from '@/lib/i18n';
import { formatSYP } from '@/lib/money';
import type { Order } from '@/lib/types';
import { OrderStateBadge, OrderStatusBadge } from './StatusBadge';

export function OrdersTable({ orders, t, lang, base, sellerNames }: { orders: Order[]; t: TFn; lang: Lang; base: string; sellerNames?: Record<string, string> }) {
  if (orders.length === 0) return <div className="card-pad text-center text-ink-soft">{t('orders_empty')}</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr>
          <th>{t('order')}</th>{sellerNames && <th>{t('seller')}</th>}<th>{t('product')}</th><th>{t('buyer')}</th>
          <th>{t('total')}</th><th>{t('payment_method')}</th><th>{t('order_state')}</th><th>{t('fulfillment_state')}</th><th>{t('date')}</th><th></th>
        </tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="font-mono font-semibold" dir="ltr">{o.code}</td>
              {sellerNames && <td>{sellerNames[o.seller_id] ?? '—'}</td>}
              <td>{o.product_title}{o.variant_label && <span className="text-ink-soft"> · {o.variant_label}</span>} × {o.quantity}</td>
              <td>{o.buyer_name}<div className="text-xs text-ink-soft">{o.governorate}</div></td>
              <td className="whitespace-nowrap">{formatSYP(o.total, lang)}</td>
              <td className="text-xs">{t(`pm_${o.payment_method}` as const)}</td>
              <td><OrderStateBadge state={o.order_state} t={t} /></td>
              <td><OrderStatusBadge status={o.status} t={t} /></td>
              <td className="text-xs text-ink-soft whitespace-nowrap">{o.created_at.slice(0, 16)}</td>
              <td><Link href={`${base}/${o.id}`} className="link text-sm">{t('view')}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

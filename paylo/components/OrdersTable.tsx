import Link from 'next/link';
import type { TFn, Lang } from '@/lib/i18n';
import { formatSYP } from '@/lib/money';
import type { Order } from '@/lib/types';
import { OrderStatusBadge } from './StatusBadge';

export function OrdersTable({ orders, t, lang, base, sellerNames }: { orders: Order[]; t: TFn; lang: Lang; base: string; sellerNames?: Record<string, string> }) {
  if (orders.length === 0) return <div className="card-pad text-center text-bluewood/60">{t('orders_empty')}</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>{t('order')}</th>{sellerNames && <th>{t('seller')}</th>}<th>{t('product')}</th><th>{t('buyer')}</th><th>{t('total')}</th><th>{t('status')}</th><th>{t('date')}</th><th></th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="font-mono" dir="ltr">{o.code}</td>
              {sellerNames && <td>{sellerNames[o.seller_id] ?? '—'}</td>}
              <td>{o.product_title} × {o.quantity}</td>
              <td>{o.buyer_name}<div className="text-xs text-bluewood/50">{o.governorate}</div></td>
              <td className="whitespace-nowrap">{formatSYP(o.total, lang)}</td>
              <td><OrderStatusBadge status={o.status} t={t} /></td>
              <td className="text-xs text-bluewood/60 whitespace-nowrap">{o.created_at.slice(0, 16)}</td>
              <td><Link href={`${base}/${o.id}`} className="text-crusta font-semibold text-sm">{t('view')}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

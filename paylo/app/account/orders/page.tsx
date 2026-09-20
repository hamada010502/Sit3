import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { OrderStateBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { requireCustomer } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { ordersForCustomer } from '@/lib/customer';

export default function AccountOrdersPage() {
  const user = requireCustomer();
  const { t, lang } = getT();
  const orders = ordersForCustomer(user.id);

  return (
    <Shell wide>
      <h1 className="section-title mb-6">{t('account_orders')}</h1>
      {orders.length === 0 ? <div className="alert-info">{t('account_no_orders')}</div> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>{t('order')}</th><th>{t('date')}</th><th>{t('product')}</th><th>{t('total')}</th><th></th><th></th><th></th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}>
                <td className="font-mono text-sm">{o.code}</td>
                <td className="text-xs text-ink-soft whitespace-nowrap">{o.created_at}</td>
                <td className="text-sm">{o.product_title}{o.variant_label ? ` · ${o.variant_label}` : ''} × {o.quantity}</td>
                <td>{formatSYP(o.total, lang)}</td>
                <td><OrderStateBadge state={o.order_state} t={t} /></td>
                <td><OrderStatusBadge status={o.status} t={t} /></td>
                <td><Link href={`/track/${o.code}`} className="link text-sm">{t('account_view_order')}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

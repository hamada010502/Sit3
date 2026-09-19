import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { CopyButton } from '@/components/CopyButton';
import { OrderStateBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/notify';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { sellerBalances } from '@/lib/orders';
import type { Order } from '@/lib/types';

export default function SellerDashboard() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const db = getDb();
  const bal = sellerBalances(seller.id);
  const count = (sql: string) => (db.prepare(`SELECT count(*) c FROM orders WHERE seller_id = ? AND ${sql}`).get(seller.id) as { c: number }).c;
  const toFulfil = count("order_state = 'open' AND status = 'confirmed'");
  const awaitingPayment = count("status = 'awaiting_payment'");
  const today = count("date(created_at) = date('now')");
  const week = count("created_at >= datetime('now','-7 days')");
  const recent = db.prepare('SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 8').all(seller.id) as Order[];
  const storeUrl = appUrl(`/s/${seller.slug}`);

  return (
    <div>
      <AutoRefresh seconds={10} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="section-title">{seller.store_name}</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">{t('dash_store_link')}:</span>
          <code className="bg-white border border-ink/10 rounded px-2 py-1" dir="ltr">{storeUrl}</code>
          <CopyButton text={storeUrl} />
          <Link href={`/s/${seller.slug}`} target="_blank" className="btn-secondary btn-sm">{t('open')}</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="stat"><div className="stat-label">{t('bal_available')}</div><div className="stat-value text-lg text-success">{formatSYP(bal.available, lang)}</div><p className="mt-1 text-xs text-ink-soft">{t('bal_available_d')}</p></div>
        <div className="stat"><div className="stat-label">{t('bal_pending')}</div><div className="stat-value text-lg">{formatSYP(bal.pending, lang)}</div><p className="mt-1 text-xs text-ink-soft">{t('bal_pending_d')}</p></div>
        <div className="stat"><div className="stat-label">{t('bal_lifetime')}</div><div className="stat-value text-lg">{formatSYP(bal.lifetime, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('bal_next_payout')}</div><div className="stat-value text-lg" dir="ltr">{bal.nextPayout}</div></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <div className="stat"><div className="stat-label">{t('dash_to_fulfill')}</div><div className="stat-value text-rose-600">{toFulfil}</div></div>
        <div className="stat"><div className="stat-label">{t('st_awaiting_payment')}</div><div className="stat-value">{awaitingPayment}</div></div>
        <div className="stat"><div className="stat-label">{t('orders_today')}</div><div className="stat-value">{today}</div></div>
        <div className="stat"><div className="stat-label">{t('orders_week')}</div><div className="stat-value">{week}</div></div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="font-bold">{t('dash_recent')}</h2>
          <Link href="/seller/orders" className="link text-sm">{t('all')} →</Link>
        </div>
        {recent.length === 0 ? <p className="px-5 pb-6 text-sm text-ink-soft">{t('dash_empty')}</p> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>{t('order')}</th><th>{t('product')}</th><th>{t('buyer')}</th><th>{t('total')}</th><th>{t('order_state')}</th><th>{t('fulfillment_state')}</th><th></th></tr></thead>
            <tbody>{recent.map((o) => (
              <tr key={o.id}>
                <td className="font-mono font-semibold" dir="ltr">{o.code}</td>
                <td>{o.product_title}{o.variant_label && <span className="text-ink-soft"> · {o.variant_label}</span>}</td>
                <td>{o.buyer_name}<div className="text-xs text-ink-soft">{o.governorate}</div></td>
                <td>{formatSYP(o.total, lang)}</td>
                <td><OrderStateBadge state={o.order_state} t={t} /></td>
                <td><OrderStatusBadge status={o.status} t={t} /></td>
                <td><Link href={`/seller/orders/${o.id}`} className="link text-sm">{t('view')}</Link></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

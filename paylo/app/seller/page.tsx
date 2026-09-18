import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { CopyButton } from '@/components/CopyButton';
import { OrderStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/email';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { payoutEligibleOrders } from '@/lib/orders';
import type { Order } from '@/lib/types';

export default function SellerDashboard() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const db = getDb();
  const count = (sql: string) => (db.prepare(`SELECT count(*) c FROM orders WHERE seller_id = ? AND ${sql}`).get(seller.id) as { c: number }).c;
  const toFulfill = count("status = 'paid'");
  const inDelivery = count("status IN ('handed_off','in_transit','ready_for_pickup')");
  const delivered = count("status = 'delivered'");
  const totalSales = (db.prepare("SELECT coalesce(sum(subtotal),0) s FROM orders WHERE seller_id = ? AND status IN ('paid','handed_off','in_transit','ready_for_pickup','delivered','disputed')").get(seller.id) as { s: number }).s;
  const pendingPayout = payoutEligibleOrders(seller.id).reduce((s, o) => s + o.seller_net, 0);
  const recent = db.prepare("SELECT * FROM orders WHERE seller_id = ? AND status != 'pending_payment' ORDER BY created_at DESC LIMIT 8").all(seller.id) as Order[];
  const storeUrl = appUrl(`/s/${seller.slug}`);
  return (
    <div>
      <AutoRefresh seconds={10} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">{seller.store_name}</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-bluewood/60">{t('dash_store_link')}:</span>
          <code className="bg-white border border-bluewood/10 rounded px-2 py-1" dir="ltr">{storeUrl}</code>
          <CopyButton text={storeUrl} />
          <Link href={`/s/${seller.slug}`} target="_blank" className="btn-secondary btn-sm">{t('open')}</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <div className="stat"><div className="stat-label">{t('dash_to_fulfill')}</div><div className="stat-value text-crusta">{toFulfill}</div></div>
        <div className="stat"><div className="stat-label">{t('dash_in_delivery')}</div><div className="stat-value">{inDelivery}</div></div>
        <div className="stat"><div className="stat-label">{t('dash_delivered')}</div><div className="stat-value">{delivered}</div></div>
        <div className="stat"><div className="stat-label">{t('dash_total_sales')}</div><div className="stat-value text-lg">{formatSYP(totalSales, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('dash_pending_payout')}</div><div className="stat-value text-lg">{formatSYP(pendingPayout, lang)}</div></div>
      </div>
      <div className="card">
        <div className="flex items-center justify-between px-5 pt-5 pb-2"><h2 className="font-semibold">{t('dash_recent')}</h2><Link href="/seller/orders" className="text-sm text-crusta font-semibold">{t('all')} →</Link></div>
        {recent.length === 0 ? <p className="px-5 pb-6 text-sm text-bluewood/60">{t('dash_empty')}</p> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>{t('order')}</th><th>{t('product')}</th><th>{t('buyer')}</th><th>{t('total')}</th><th>{t('status')}</th><th></th></tr></thead>
            <tbody>{recent.map((o) => (
              <tr key={o.id}>
                <td className="font-mono" dir="ltr">{o.code}</td><td>{o.product_title} × {o.quantity}</td><td>{o.buyer_name}<div className="text-xs text-bluewood/50">{o.governorate}</div></td>
                <td>{formatSYP(o.total, lang)}</td><td><OrderStatusBadge status={o.status} t={t} /></td>
                <td><Link href={`/seller/orders/${o.id}`} className="text-crusta font-semibold text-sm">{t('view')}</Link></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

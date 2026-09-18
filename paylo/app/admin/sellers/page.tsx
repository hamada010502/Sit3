import Link from 'next/link';
import { SellerStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Seller } from '@/lib/types';

type Row = Seller & { email: string; user_name: string; product_count: number; order_count: number };
const TABS = ['all', 'pending', 'approved', 'suspended', 'rejected'] as const;

export default function AdminSellersPage({ searchParams }: { searchParams: { status?: string } }) {
  requireAdmin();
  const { t } = getT();
  const status = searchParams.status || 'all';
  const rows = getDb().prepare(`
    SELECT s.*, u.email, u.name user_name,
      (SELECT count(*) FROM products p WHERE p.seller_id = s.id AND p.status != 'removed') product_count,
      (SELECT count(*) FROM orders o WHERE o.seller_id = s.id AND o.status NOT IN ('pending_payment','payment_failed')) order_count
    FROM sellers s JOIN users u ON u.id = s.user_id
    ${status === 'all' ? '' : 'WHERE s.status = ?'}
    ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC`).all(...(status === 'all' ? [] : [status])) as Row[];
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('a_sellers_title')}</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((f) => <Link key={f} href={f === 'all' ? '/admin/sellers' : `/admin/sellers?status=${f}`} className={`badge border ${status === f ? 'bg-bluewood text-white border-bluewood' : 'bg-white border-bluewood/15 text-bluewood/70'}`}>{f === 'all' ? t('all') : t(`st_seller_${f}` as const)}</Link>)}
      </div>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t('store_name')}</th><th>{t('full_name')}</th><th>{t('governorate')}</th><th>{t('products_of')}</th><th>{t('orders_count')}</th><th>{t('status')}</th><th>{t('date')}</th><th></th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id}>
            <td><div className="font-semibold">{s.store_name}</div><div className="text-xs text-bluewood/50" dir="ltr">/s/{s.slug}{s.instagram ? ` · @${s.instagram}` : ''}</div></td>
            <td>{s.user_name}<div className="text-xs text-bluewood/50" dir="ltr">{s.email}</div></td>
            <td>{s.governorate}</td><td>{s.product_count}</td><td>{s.order_count}</td>
            <td><SellerStatusBadge status={s.status} t={t} /></td>
            <td className="text-xs text-bluewood/60">{s.created_at.slice(0, 10)}</td>
            <td><Link href={`/admin/sellers/${s.id}`} className="text-crusta font-semibold text-sm">{t('view')}</Link></td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

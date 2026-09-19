import Link from 'next/link';
import { KycBadge, SellerStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Seller } from '@/lib/types';

type Row = Seller & { email: string; user_name: string; totp_enabled: number; product_count: number; order_count: number };
const TABS = ['all', 'pending', 'approved', 'suspended', 'rejected'] as const;

export default function AdminSellersPage({ searchParams }: { searchParams: { status?: string; kyc?: string } }) {
  requireAdmin();
  const { t } = getT();
  const status = searchParams.status || 'all';
  const kyc = searchParams.kyc;
  const where: string[] = [];
  const args: string[] = [];
  if (status !== 'all') { where.push('s.status = ?'); args.push(status); }
  if (kyc) { where.push('s.kyc_status = ?'); args.push(kyc); }
  const rows = getDb().prepare(`
    SELECT s.*, u.email, u.name user_name, u.totp_enabled,
      (SELECT count(*) FROM products p WHERE p.seller_id = s.id AND p.status != 'removed') product_count,
      (SELECT count(*) FROM orders o WHERE o.seller_id = s.id) order_count
    FROM sellers s JOIN users u ON u.id = s.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC`).all(...args) as Row[];

  return (
    <div>
      <h1 className="section-title mb-4">{t('a_sellers_title')}</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((f) => (
          <Link key={f} href={f === 'all' ? '/admin/sellers' : `/admin/sellers?status=${f}`}
            className={`badge border px-3 py-1 ${status === f && !kyc ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>
            {f === 'all' ? t('all') : t(`st_seller_${f}` as const)}
          </Link>
        ))}
        <Link href="/admin/sellers?kyc=submitted" className={`badge border px-3 py-1 ${kyc ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>{t('ops_kyc_waiting')}</Link>
      </div>
      <div className="card overflow-x-auto"><table className="table">
        <thead><tr><th>{t('store_name')}</th><th>{t('full_name')}</th><th>{t('governorate')}</th><th>{t('products_of')}</th><th>{t('orders_count')}</th>
          <th>{t('status')}</th><th>{t('nav_kyc')}</th><th>2FA</th><th></th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id}>
            <td><div className="font-semibold">{s.store_name}</div><div className="text-xs text-ink-soft" dir="ltr">/s/{s.slug}{s.instagram ? ` · @${s.instagram}` : ''}</div></td>
            <td>{s.user_name}<div className="text-xs text-ink-soft" dir="ltr">{s.email}</div></td>
            <td>{s.governorate}</td><td>{s.product_count}</td><td>{s.order_count}</td>
            <td><SellerStatusBadge status={s.status} t={t} /></td>
            <td><KycBadge status={s.kyc_status} t={t} /></td>
            <td><span className={`badge ${s.totp_enabled ? 'bg-success/12 text-success' : 'bg-cherry/8 text-cherry'}`}>{s.totp_enabled ? t('yes') : t('no')}</span></td>
            <td><Link href={`/admin/sellers/${s.id}`} className="link text-sm">{t('view')}</Link></td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

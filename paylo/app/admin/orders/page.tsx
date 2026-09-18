import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { StatusFilter } from '@/components/StatusFilter';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Order } from '@/lib/types';

export default function AdminOrdersPage({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const status = searchParams.status || 'all';
  const q = (searchParams.q || '').trim();
  const where: string[] = []; const args: string[] = [];
  if (status !== 'all') { where.push('status = ?'); args.push(status); } else where.push("status != 'pending_payment'");
  if (q) { where.push('(upper(code) LIKE upper(?) OR buyer_name LIKE ? OR buyer_phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const orders = getDb().prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`).all(...args) as Order[];
  const sellerNames = Object.fromEntries((getDb().prepare('SELECT id, store_name FROM sellers').all() as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]));
  return (
    <div>
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">{t('a_orders_title')}</h1>
        <form className="flex gap-2"><input name="q" defaultValue={q} className="input" placeholder={t('search')} />{status !== 'all' && <input type="hidden" name="status" value={status} />}<button className="btn-secondary">{t('search')}</button></form>
      </div>
      <StatusFilter current={status} t={t} base="/admin/orders" />
      <OrdersTable orders={orders} t={t} lang={lang} base="/admin/orders" sellerNames={sellerNames} />
    </div>
  );
}

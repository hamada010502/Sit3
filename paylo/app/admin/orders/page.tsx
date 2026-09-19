import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { StatusFilter } from '@/components/StatusFilter';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Order } from '@/lib/types';

const STATES = ['open', 'closed', 'cancelled', 'returned'];

export default function AdminOrdersPage({ searchParams }: { searchParams: { state?: string; q?: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const state = searchParams.state && STATES.includes(searchParams.state) ? searchParams.state : 'all';
  const q = (searchParams.q || '').trim();
  const where: string[] = []; const args: string[] = [];
  if (state !== 'all') { where.push('order_state = ?'); args.push(state); }
  if (q) { where.push('(upper(code) LIKE upper(?) OR buyer_name LIKE ? OR buyer_phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const orders = getDb().prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).all(...args) as Order[];
  const sellerNames = Object.fromEntries((getDb().prepare('SELECT id, store_name FROM sellers').all() as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]));
  return (
    <div>
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="section-title">{t('a_orders_title')}</h1>
        <form className="flex gap-2"><input name="q" defaultValue={q} className="input" placeholder={t('search')} />{state !== 'all' && <input type="hidden" name="state" value={state} />}<button className="btn-secondary">{t('search')}</button></form>
      </div>
      <StatusFilter current={state} t={t} base="/admin/orders" />
      <OrdersTable orders={orders} t={t} lang={lang} base="/admin/orders" sellerNames={sellerNames} />
    </div>
  );
}

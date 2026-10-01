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
  if (q) {
    // Code, name, email, or phone in any format (09…, +963 9…, spaces): phones are compared on
    // their last 9 digits, since guest orders keep the number exactly as the buyer typed it.
    const digits = q.replace(/\D/g, '');
    const tail = digits.length >= 6 ? digits.slice(-9) : null;
    where.push(`(upper(code) LIKE upper(?) OR buyer_name LIKE ? OR lower(coalesce(buyer_email,'')) LIKE lower(?)${tail ? " OR replace(replace(replace(buyer_phone,' ',''),'-',''),'+','') LIKE ?" : ''})`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`); if (tail) args.push(`%${tail}`);
  }
  const orders = getDb().prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).all(...args) as Order[];
  const sellerNames = Object.fromEntries((getDb().prepare('SELECT id, store_name FROM sellers').all() as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]));
  return (
    <div>
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="section-title">{t('a_orders_title')}</h1>
        <form className="flex gap-2"><input name="q" defaultValue={q} className="input" placeholder={t('ad_order_search_ph')} data-testid="order-search" />{state !== 'all' && <input type="hidden" name="state" value={state} />}<button className="btn-secondary">{t('search')}</button></form>
      </div>
      <StatusFilter current={state} t={t} base="/admin/orders" />
      <OrdersTable orders={orders} t={t} lang={lang} base="/admin/orders" sellerNames={sellerNames} />
    </div>
  );
}

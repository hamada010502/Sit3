import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { StatusFilter } from '@/components/StatusFilter';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Order } from '@/lib/types';

const STATES = ['open', 'closed', 'cancelled', 'returned'];

export default function SellerOrdersPage({ searchParams }: { searchParams: { state?: string } }) {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const state = searchParams.state && STATES.includes(searchParams.state) ? searchParams.state : 'all';
  const orders = (state === 'all'
    ? getDb().prepare('SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id)
    : getDb().prepare('SELECT * FROM orders WHERE seller_id = ? AND order_state = ? ORDER BY created_at DESC').all(seller.id, state)) as Order[];
  return (
    <div>
      <AutoRefresh seconds={10} />
      <h1 className="section-title mb-4">{t('orders_title')}</h1>
      <StatusFilter current={state} t={t} base="/seller/orders" />
      <OrdersTable orders={orders} t={t} lang={lang} base="/seller/orders" />
    </div>
  );
}

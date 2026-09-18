import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { StatusFilter } from '@/components/StatusFilter';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Order } from '@/lib/types';

export default function SellerOrdersPage({ searchParams }: { searchParams: { status?: string } }) {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const status = searchParams.status || 'all';
  const orders = (status === 'all'
    ? getDb().prepare("SELECT * FROM orders WHERE seller_id = ? AND status NOT IN ('pending_payment','payment_failed') ORDER BY created_at DESC").all(seller.id)
    : getDb().prepare('SELECT * FROM orders WHERE seller_id = ? AND status = ? ORDER BY created_at DESC').all(seller.id, status)) as Order[];
  return (
    <div>
      <AutoRefresh seconds={10} />
      <h1 className="text-2xl font-bold mb-4">{t('orders_title')}</h1>
      <StatusFilter current={status} t={t} base="/seller/orders" />
      <OrdersTable orders={orders} t={t} lang={lang} base="/seller/orders" />
    </div>
  );
}

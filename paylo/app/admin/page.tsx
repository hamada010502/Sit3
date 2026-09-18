import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Order } from '@/lib/types';

export default function AdminDashboard() {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const one = <T,>(sql: string) => db.prepare(sql).get() as T;
  const pendingSellers = one<{ c: number }>("SELECT count(*) c FROM sellers WHERE status = 'pending'").c;
  const openDisputes = one<{ c: number }>("SELECT count(*) c FROM disputes WHERE status IN ('open','investigating')").c;
  const orders30 = one<{ c: number }>("SELECT count(*) c FROM orders WHERE status NOT IN ('pending_payment','payment_failed') AND created_at >= datetime('now','-30 days')").c;
  const held = one<{ s: number }>("SELECT coalesce(sum(seller_net),0) s FROM orders WHERE payout_id IS NULL AND status IN ('paid','handed_off','in_transit','ready_for_pickup','disputed','delivered')").s;
  const commission = one<{ s: number }>("SELECT coalesce(sum(commission_amount),0) s FROM orders WHERE status = 'delivered' OR payout_id IS NOT NULL").s;
  const recent = db.prepare("SELECT * FROM orders WHERE status NOT IN ('pending_payment') ORDER BY created_at DESC LIMIT 10").all() as Order[];
  const sellerNames = Object.fromEntries((db.prepare('SELECT id, store_name FROM sellers').all() as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]));
  return (
    <div>
      <AutoRefresh seconds={15} />
      <h1 className="text-2xl font-bold mb-6">{t('admin_title')}</h1>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <Link href="/admin/sellers?status=pending" className="stat hover:border-crusta"><div className="stat-label">{t('a_pending_sellers')}</div><div className="stat-value text-crusta">{pendingSellers}</div></Link>
        <Link href="/admin/disputes" className="stat hover:border-crusta"><div className="stat-label">{t('a_open_disputes')}</div><div className="stat-value text-blossom">{openDisputes}</div></Link>
        <div className="stat"><div className="stat-label">{t('a_orders_today')}</div><div className="stat-value">{orders30}</div></div>
        <div className="stat"><div className="stat-label">{t('a_held_funds')}</div><div className="stat-value text-lg">{formatSYP(held, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('a_commission_earned')}</div><div className="stat-value text-lg">{formatSYP(commission, lang)}</div></div>
      </div>
      <h2 className="font-semibold mb-3">{t('dash_recent')}</h2>
      <OrdersTable orders={recent} t={t} lang={lang} base="/admin/orders" sellerNames={sellerNames} />
    </div>
  );
}

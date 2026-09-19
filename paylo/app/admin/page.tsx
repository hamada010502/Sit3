import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { OrdersTable } from '@/components/OrdersTable';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { nextTransferDate } from '@/lib/payouts-schedule';
import type { Order } from '@/lib/types';

export default function AdminDashboard() {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const n = (sql: string) => (db.prepare(`SELECT count(*) c FROM ${sql}`).get() as { c: number }).c;
  const pendingSellers = n("sellers WHERE status = 'pending'");
  const kycWaiting = n("sellers WHERE kyc_status = 'submitted'");
  const openReturns = n("disputes WHERE status IN ('open','investigating')");
  const awaitingTransfer = n("bank_transfers WHERE status IN ('awaiting_proof','submitted')");
  const orders30 = n("orders WHERE created_at >= datetime('now','-30 days')");
  const held = (db.prepare("SELECT coalesce(sum(seller_net),0) s FROM orders WHERE payout_id IS NULL AND order_state IN ('open','closed')").get() as { s: number }).s;
  const commission = (db.prepare("SELECT coalesce(sum(commission_amount + commission_vat),0) s FROM orders WHERE order_state = 'closed'").get() as { s: number }).s;
  const recent = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10').all() as Order[];
  const sellerNames = Object.fromEntries((db.prepare('SELECT id, store_name FROM sellers').all() as { id: string; store_name: string }[]).map((s) => [s.id, s.store_name]));

  return (
    <div>
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="section-title">{t('admin_title')}</h1>
        <span className="text-sm text-ink-soft">{t('bal_next_payout')}: <strong dir="ltr">{nextTransferDate().toISOString().slice(0, 10)}</strong></span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Link href="/admin/sellers?status=pending" className="stat hover:border-rose"><div className="stat-label">{t('a_pending_sellers')}</div><div className="stat-value text-rose-600">{pendingSellers}</div></Link>
        <Link href="/admin/sellers?kyc=submitted" className="stat hover:border-rose"><div className="stat-label">{t('ops_kyc_waiting')}</div><div className="stat-value">{kycWaiting}</div></Link>
        <Link href="/admin/ops" className="stat hover:border-rose"><div className="stat-label">{t('ops_awaiting_transfer')}</div><div className="stat-value">{awaitingTransfer}</div></Link>
        <Link href="/admin/disputes" className="stat hover:border-rose"><div className="stat-label">{t('ops_open_returns')}</div><div className="stat-value text-danger">{openReturns}</div></Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <div className="stat"><div className="stat-label">{t('a_orders_today')}</div><div className="stat-value">{orders30}</div></div>
        <div className="stat"><div className="stat-label">{t('a_held_funds')}</div><div className="stat-value text-lg">{formatSYP(held, lang)}</div></div>
        <div className="stat"><div className="stat-label">{t('a_commission_earned')}</div><div className="stat-value text-lg">{formatSYP(commission, lang)}</div></div>
      </div>
      <h2 className="font-bold mb-3">{t('dash_recent')}</h2>
      <OrdersTable orders={recent} t={t} lang={lang} base="/admin/orders" sellerNames={sellerNames} />
    </div>
  );
}

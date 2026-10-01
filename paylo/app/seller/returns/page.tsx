import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DisputeStatusBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Dispute, Order } from '@/lib/types';

type Row = Dispute & Pick<Order, 'code' | 'product_title' | 'variant_label' | 'buyer_name' | 'total' | 'refunded_amount' | 'seller_net'> & { order_status: Order['status'] };
const FILTERS = ['open', 'resolved', 'all'] as const;

/**
 * The seller's own returns and disputes. Read-only: resolution stays with Paylo admin,
 * but sellers see what is open against them, why, and how it ended (liability included).
 * Scoped by o.seller_id in SQL — never by anything the client sends.
 */
export default function SellerReturnsPage({ searchParams }: { searchParams: { f?: string } }) {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const f = (FILTERS as readonly string[]).includes(searchParams.f || '') ? searchParams.f as typeof FILTERS[number] : 'open';
  const where = f === 'open' ? "AND d.status IN ('open','investigating')" : f === 'resolved' ? "AND d.status NOT IN ('open','investigating')" : '';
  const rows = getDb().prepare(`
    SELECT d.*, o.code, o.product_title, o.variant_label, o.buyer_name, o.total, o.refunded_amount, o.seller_net, o.status AS order_status
      FROM disputes d JOIN orders o ON o.id = d.order_id
     WHERE o.seller_id = ? ${where}
     ORDER BY d.created_at DESC`).all(seller.id) as Row[];
  const openCount = (getDb().prepare("SELECT count(*) c FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.seller_id = ? AND d.status IN ('open','investigating')").get(seller.id) as { c: number }).c;

  return (
    <div>
      <AutoRefresh seconds={20} />
      <h1 className="section-title">{t('returns_title')}</h1>
      <p className="mt-1 mb-4 text-sm text-ink-soft">{t('returns_sub')}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((x) => (
          <Link key={x} href={`/seller/returns?f=${x}`} className={`badge border px-3 py-1 ${f === x ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>
            {x === 'open' ? `${t('ds_open')} (${openCount})` : x === 'resolved' ? t('returns_resolved') : t('all')}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (f === 'open'
        ? <EmptyState icon="return" title={t('empty_returns_open')} body={t('empty_returns_open_body')} />
        : <EmptyState icon="return" title={t('returns_none')} body={t('empty_returns_body')} />) : (
        <div className="card overflow-x-auto"><table className="table" data-testid="seller-returns">
          <thead><tr><th>{t('order')}</th><th>{t('product')}</th><th>{t('buyer')}</th><th>{t('dispute_reason')}</th><th>{t('status')}</th><th>{t('liability')}</th><th>{t('date')}</th></tr></thead>
          <tbody>{rows.map((d) => {
            const resolved = !['open', 'investigating'].includes(d.status);
            return (
              <tr key={d.id}>
                <td><Link href={`/seller/orders/${d.order_id}`} className="tap-inline font-mono font-semibold text-brand" dir="ltr">{d.code}</Link>
                  <div className="mt-1"><OrderStatusBadge status={d.order_status} t={t} /></div></td>
                <td>{d.product_title}{d.variant_label && <span className="text-ink-soft"> · {d.variant_label}</span>}<div className="text-xs text-ink-soft">{formatSYP(d.total, lang)}</div></td>
                <td>{d.buyer_name}</td>
                <td><strong>{t(`dr_${d.reason}` as 'dr_other')}</strong>{d.description && <div className="text-xs text-ink-soft whitespace-pre-line max-w-xs">{d.description}</div>}</td>
                <td><DisputeStatusBadge status={d.status} t={t} />
                  {resolved && d.admin_note && <div className="text-xs text-ink-soft mt-1 max-w-xs">{d.admin_note}</div>}</td>
                <td>{d.liability ? t(`li_${d.liability}` as const) : '—'}
                  {d.refunded_amount > 0 && <div className="text-xs mt-1" data-testid="return-refunded">{t('refunded_so_far')}: <strong>{formatSYP(d.refunded_amount, lang)}</strong><div className="text-ink-soft">{t('seller_net')}: {formatSYP(d.seller_net, lang)}</div></div>}</td>
                <td className="text-xs text-ink-soft whitespace-nowrap">{d.created_at}{d.resolved_at && <div>→ {d.resolved_at}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

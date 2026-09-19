import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DisputeStatusBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { SubmitButton } from '@/components/SubmitButton';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Dispute, Order } from '@/lib/types';
import { investigateAction, resolveAction } from './actions';

type Row = Dispute & { order: Order; store_name: string };

export default function AdminDisputesPage({ searchParams }: { searchParams: { all?: string } }) {
  requireAdmin();
  const { t, lang } = getT();
  const db = getDb();
  const showAll = searchParams.all === '1';
  const disputes = db.prepare(`SELECT d.*, s.store_name FROM disputes d JOIN orders o ON o.id = d.order_id JOIN sellers s ON s.id = o.seller_id ${showAll ? '' : "WHERE d.status IN ('open','investigating')"} ORDER BY d.created_at DESC`).all() as (Dispute & { store_name: string })[];
  const rows: Row[] = disputes.map((d) => ({ ...d, order: db.prepare('SELECT * FROM orders WHERE id = ?').get(d.order_id) as Order }));
  const liabilities = ['seller', 'logistics', 'platform', 'none'] as const;
  return (
    <div>
      <AutoRefresh seconds={15} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="section-title">{t('a_disputes_title')}</h1>
        <Link href={showAll ? '/admin/disputes' : '/admin/disputes?all=1'} className="btn-secondary btn-sm">{showAll ? t('ds_open') : t('all')}</Link>
      </div>
      {rows.length === 0 && <div className="card-pad text-center text-ink-soft">{t('none')}</div>}
      <div className="space-y-4">
        {rows.map((d) => {
          const neverLeft = (d.order.pre_dispute_status ?? d.order.status) === 'confirmed';
          const defaultLiability = neverLeft ? 'seller' : d.order.fulfillment_method === 'logistics_pickup' ? 'logistics' : 'platform';
          const open = d.status === 'open' || d.status === 'investigating';
          return (
            <div key={d.id} id={d.id} className="card-pad">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <DisputeStatusBadge status={d.status} t={t} />
                <span className="font-semibold">{t('a_dispute_for')} <Link href={`/admin/orders/${d.order.id}`} className="font-mono text-cherry" dir="ltr">{d.order.code}</Link></span>
                <OrderStatusBadge status={d.order.status} t={t} />
                <span className="text-xs text-ink-soft">{d.created_at}</span>
              </div>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <div><span className="text-ink-soft">{t('dispute_reason')}: </span><strong>{t(`dr_${d.reason}` as 'dr_other')}</strong></div>
                  {d.description && <div className="text-ink whitespace-pre-line">{d.description}</div>}
                  <div><span className="text-ink-soft">{t('seller')}: </span>{d.store_name} · <span className="text-ink-soft">{t('buyer')}: </span>{d.order.buyer_name} (<span dir="ltr">{d.order.buyer_phone}</span>)</div>
                  <div><span className="text-ink-soft">{t('total')}: </span>{formatSYP(d.order.total, lang)} · <span className="text-ink-soft">{t('fulfillment')}: </span>{t(`fm_${d.order.fulfillment_method}` as const)}{d.order.fulfillment_ref ? ` (${d.order.fulfillment_ref})` : ''}</div>
                  <div className="text-xs text-ink-soft">{neverLeft ? t('li_seller') : d.order.handed_off_at ? `${t('hand_off_done')}: ${d.order.handed_off_at}` : ''}</div>
                  {d.admin_note && <div className="alert-info mt-2"><strong>{t('admin_note')}:</strong> {d.admin_note}{d.liability && <div className="text-xs mt-1">{t('liability')}: {t(`li_${d.liability}` as const)}</div>}</div>}
                </div>
                {open && (
                  <div className="space-y-3">
                    {d.status === 'open' && (
                      <form action={investigateAction.bind(null, d.id)} className="flex gap-2"><input name="note" className="input" placeholder={t('admin_note')} /><SubmitButton className="btn-secondary shrink-0">{t('a_investigate')}</SubmitButton></form>
                    )}
                    <form action={resolveAction.bind(null, d.id)} className="space-y-2 rounded-xl bg-cream p-3">
                      <label className="label">{t('resolve')}</label>
                      <select name="resolution" className="input">
                        <option value="refund">{t('a_resolve_refund')}</option>
                        {!neverLeft && <option value="found">{t('a_resolve_found')}</option>}
                        <option value="dismiss">{t('a_resolve_dismiss')}</option>
                      </select>
                      <label className="label">{t('liability')}</label>
                      <select name="liability" className="input" defaultValue={defaultLiability}>{liabilities.map((l) => <option key={l} value={l}>{t(`li_${l}` as const)}</option>)}</select>
                      <p className="text-xs text-ink-soft">{t('liability_hint')}</p>
                      <textarea name="note" className="input" rows={2} placeholder={t('admin_note')} />
                      <SubmitButton className="btn-primary w-full">{t('resolve')}</SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

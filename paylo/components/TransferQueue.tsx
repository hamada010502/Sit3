import Link from 'next/link';
import { SubmitButton } from '@/components/SubmitButton';
import { reviewTransferAction } from '@/app/admin/orders/[id]/actions';
import { getDb } from '@/lib/db';
import { formatSYP } from '@/lib/money';
import type { Lang, TFn } from '@/lib/i18n';

interface Row { order_id: string; code: string; store_name: string; buyer_name: string; total: number; reference: string | null; proof_path: string | null; submitted_at: string | null; created_at: string; status: string }

/**
 * The primary admin queue under the transfers-only policy: bank transfers whose receipt is in
 * and waiting for a decision, confirmable or rejectable right here (same reviewTransfer() path
 * as the order page). Below it, orders still waiting for a receipt, oldest first.
 */
export function TransferQueue({ t, lang, limit = 50 }: { t: TFn; lang: Lang; limit?: number }) {
  const rows = getDb().prepare(`SELECT b.order_id, o.code, s.store_name, o.buyer_name, o.total, b.reference, b.proof_path, b.submitted_at, o.created_at, b.status
    FROM bank_transfers b JOIN orders o ON o.id = b.order_id JOIN sellers s ON s.id = o.seller_id
    WHERE b.status IN ('submitted','awaiting_proof') AND o.status = 'awaiting_payment'
    ORDER BY b.status = 'awaiting_proof', coalesce(b.submitted_at, o.created_at) ASC LIMIT ?`).all(limit) as Row[];
  const review = rows.filter((r) => r.status === 'submitted');
  const waiting = rows.filter((r) => r.status === 'awaiting_proof');
  const f = (n: number) => formatSYP(n, lang);
  const hours = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 36e5)) : 0);
  return (
    <section className="card overflow-x-auto border-brand/30" data-testid="transfer-queue">
      <div className="px-5 pt-5 pb-2">
        <h2 className="font-bold text-lg">{t('tq_title')} <span className="text-brand" data-testid="tq-count">({review.length})</span></h2>
        <p className="text-xs text-ink-soft">{t('tq_sub')}</p>
      </div>
      {review.length === 0 ? <p className="px-5 pb-4 text-sm text-ink-soft" data-testid="tq-empty">{t('tq_empty')}</p> : (
        <table className="table">
          <thead><tr><th>{t('order')}</th><th>{t('seller')}</th><th>{t('buyer')}</th><th>{t('total')}</th><th>{t('reference')}</th><th>{t('tq_waiting')}</th><th>{t('tq_decide')}</th></tr></thead>
          <tbody>{review.map((r) => (
            <tr key={r.order_id} data-code={r.code}>
              <td><Link href={`/admin/orders/${r.order_id}`} className="tap-inline font-mono font-semibold text-brand" dir="ltr">{r.code}</Link>
                {r.proof_path && <div><a href={r.proof_path} target="_blank" rel="noreferrer" className="link text-xs">{t('bt_view_proof')}</a></div>}</td>
              <td>{r.store_name}</td><td>{r.buyer_name}</td><td className="whitespace-nowrap font-semibold">{f(r.total)}</td>
              <td className="text-xs" dir="ltr">{r.reference ?? '—'}</td>
              <td className="text-xs text-ink-soft whitespace-nowrap">{t('tq_hours', { n: hours(r.submitted_at) })}</td>
              <td>
                <div className="flex flex-col gap-1 min-w-[15rem]">
                  <form action={reviewTransferAction.bind(null, r.order_id, true)} className="flex gap-1">
                    <input name="note" className="input py-1" placeholder={t('note')} aria-label={t('note')} />
                    <SubmitButton className="btn-primary btn-sm shrink-0">{t('bt_confirm')}</SubmitButton>
                  </form>
                  <form action={reviewTransferAction.bind(null, r.order_id, false)} className="flex gap-1">
                    <input name="note" className="input py-1" placeholder={t('tq_reject_reason')} aria-label={t('tq_reject_reason')} />
                    <SubmitButton className="btn-danger btn-sm shrink-0">{t('bt_reject')}</SubmitButton>
                  </form>
                </div>
              </td>
            </tr>))}</tbody>
        </table>
      )}
      {waiting.length > 0 && (
        <details className="px-5 pb-4" data-testid="tq-awaiting-proof">
          <summary className="cursor-pointer text-sm font-semibold py-2">{t('tq_no_receipt', { n: waiting.length })}</summary>
          <ul className="text-sm divide-y divide-ink/5">{waiting.map((r) => (
            <li key={r.order_id} className="py-1.5 flex flex-wrap gap-3">
              <Link href={`/admin/orders/${r.order_id}`} className="font-mono text-brand" dir="ltr">{r.code}</Link>
              <span>{r.store_name}</span><span className="whitespace-nowrap">{f(r.total)}</span>
              <span className="text-xs text-ink-soft">{t('tq_hours', { n: hours(r.created_at) })}</span>
            </li>))}</ul>
        </details>
      )}
    </section>
  );
}

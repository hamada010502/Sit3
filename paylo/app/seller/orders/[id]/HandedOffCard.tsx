import { CopyButton } from '@/components/CopyButton';
import { SubmitButton } from '@/components/SubmitButton';
import type { TFn } from '@/lib/i18n';
import type { Order } from '@/lib/types';
import { updateTrackingAction } from './actions';

/** The hand-off success state: what happened, when, and the tracking number front and centre. */
export function HandedOffCard({ order, trackUrl, t }: { order: Order; trackUrl: string; t: TFn }) {
  return (
    <section className="card-pad border-success/30 bg-success/5 space-y-4" data-testid="handoff-done">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-white text-lg" aria-hidden="true">✓</span>
        <div>
          <h2 className="font-bold text-lg">{t('hand_off_done')}</h2>
          <p className="text-sm text-ink-soft">
            {order.handed_off_at && <span dir="ltr">{order.handed_off_at} UTC</span>}
            {order.fulfillment_ref && <> · {order.fulfillment_ref}</>}
          </p>
          <p className="text-sm text-ink-soft mt-1">{t('hand_off_buyer_told')}</p>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-ink/10 p-4">
        <div className="stat-label">{t('tracking_number')}</div>
        {order.tracking_number ? (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="text-2xl font-extrabold font-mono tracking-wide break-all" dir="ltr" data-testid="tracking-number">{order.tracking_number}</span>
            <CopyButton text={order.tracking_number} />
          </div>
        ) : <p className="mt-1 text-sm text-ink-soft">{t('tracking_none_yet')}</p>}
        <form action={updateTrackingAction.bind(null, order.id)} className="mt-3 flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor="edit-tracking">{t('tracking_number')}</label>
          <input id="edit-tracking" name="tracking" className="input font-mono" dir="ltr" defaultValue={order.tracking_number ?? ''} placeholder={t('tracking_number_hint')} />
          <SubmitButton className="btn-secondary shrink-0">{order.tracking_number ? t('tracking_update') : t('tracking_add')}</SubmitButton>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">{t('buyer_tracking_link')}:</span>
        <code className="bg-white border border-ink/10 rounded px-2 py-1 truncate max-w-full min-w-0" dir="ltr">{trackUrl}</code>
        <CopyButton text={trackUrl} />
      </div>
    </section>
  );
}

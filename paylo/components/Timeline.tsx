import type { TFn } from '@/lib/i18n';
import type { OrderEvent, OrderStatus } from '@/lib/types';
import { OrderStatusBadge } from './StatusBadge';

export function Timeline({ events, t, showActor = true }: { events: OrderEvent[]; t: TFn; showActor?: boolean }) {
  return (
    <ol className="relative border-s border-ink/15 ms-2 space-y-4">
      {events.map((e) => (
        <li key={e.id} className="ms-5">
          <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full bg-rose ring-4 ring-white" />
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={e.to_status as OrderStatus} t={t} />
            <span className="text-xs text-ink-soft">{e.created_at} UTC</span>
            {showActor && <span className="text-xs text-ink-soft">· {t(`by_${e.actor}` as 'by_buyer')}</span>}
          </div>
          {e.note && <p className="mt-1 text-sm text-ink-soft">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

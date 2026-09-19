import Link from 'next/link';
import type { TFn } from '@/lib/i18n';
import type { OrderState } from '@/lib/types';

/** Seller/admin order tabs follow the commercial state set from v2 §4.2. */
const STATES: (OrderState | 'all')[] = ['all', 'open', 'closed', 'cancelled', 'returned'];

export function StatusFilter({ current, t, base }: { current: string; t: TFn; base: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {STATES.map((f) => (
        <Link key={f} href={f === 'all' ? base : `${base}?state=${f}`}
          className={`badge border px-3 py-1 ${current === f ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft hover:border-ink/35'}`}>
          {f === 'all' ? t('all') : t(`os_${f}` as const)}
        </Link>
      ))}
    </div>
  );
}

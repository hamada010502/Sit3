import Link from 'next/link';
import type { TFn } from '@/lib/i18n';
const FILTERS = ['all', 'paid', 'handed_off', 'in_transit', 'ready_for_pickup', 'delivered', 'disputed', 'refunded'] as const;
export function StatusFilter({ current, t, base }: { current: string; t: TFn; base: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {FILTERS.map((f) => (
        <Link key={f} href={f === 'all' ? base : `${base}?status=${f}`} className={`badge border ${current === f ? 'bg-bluewood text-white border-bluewood' : 'bg-white border-bluewood/15 text-bluewood/70 hover:border-bluewood/40'}`}>
          {f === 'all' ? t('all') : t(`st_${f}` as const)}
        </Link>
      ))}
    </div>
  );
}

import type { Lang, TFn } from '@/lib/i18n';
import { formatSYP } from '@/lib/money';
import type { DaySales } from '@/lib/sales';

const W = 600, H = 140, GAP = 3, PLOT_PX = 140;

const compact = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
/** A "nice" axis maximum so gridlines land on round numbers. */
function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
}

/** Daily sales, last 30 days. One series: one colour, no legend box; the title names it. */
export function SalesChart({ data, t, lang, title, sub, testId = 'sales-chart', empty }: { data: DaySales[]; t: TFn; lang: Lang; title?: string; sub?: string; testId?: string; empty?: string }) {
  const total = data.reduce((s, d) => s + d.sales, 0);
  const orders = data.reduce((s, d) => s + d.orders, 0);
  const max = niceMax(Math.max(...data.map((d) => d.sales)));
  const bw = W / data.length;
  const y = (v: number) => H - (v / max) * H;
  const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar-SY' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ticks = [0, max / 2, max];

  return (
    <section className="card-pad mb-6" data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h2 className="font-bold">{title ?? t('sales_chart_title')}</h2>
          <p className="text-xs text-ink-soft">{sub ?? t('sales_chart_sub')}</p>
        </div>
        <div className="text-end">
          <div className="text-2xl font-extrabold" data-testid="sales-total">{formatSYP(total, lang)}</div>
          <div className="text-xs text-ink-soft">{t('sales_chart_orders', { n: orders })}</div>
        </div>
      </div>
      {orders === 0 ? <p className="text-sm text-ink-soft py-6 text-center">{empty ?? t('sales_chart_empty')}</p> : (
        // Bars/gridlines scale with the width; axis labels are HTML so they stay readable at any size.
        <div dir="ltr" className="flex gap-2">
          <div className="relative w-10 shrink-0 text-[11px] text-ink-soft" style={{ height: PLOT_PX }} aria-hidden="true">
            {ticks.map((v) => (
              <span key={v} className="absolute end-0 -translate-y-1/2 leading-none" style={{ top: `${(1 - v / max) * 100}%` }}>{compact(v)}</span>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: PLOT_PX }} role="img" aria-label={t('sales_chart_title')}>
              {ticks.map((v) => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-ink/10" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              {data.map((d, i) => {
                const x = i * bw + GAP / 2, w = Math.max(1, bw - GAP), top = y(d.sales), h = H - top, r = Math.min(4, w / 2, h);
                return (
                  <g key={d.day} className="group" data-bar={d.day}>
                    <title>{`${fmtDay(d.day)} — ${formatSYP(d.sales, lang)} · ${t('sales_chart_orders', { n: d.orders })}`}</title>
                    <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
                    {d.sales > 0 && (
                      <path d={`M${x},${H} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${H} Z`}
                        fill="#04380E" className="opacity-85 group-hover:opacity-100" />
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="flex justify-between mt-1 text-[11px] text-ink-soft" aria-hidden="true">
              <span>{fmtDay(data[0].day)}</span><span>{fmtDay(data[Math.floor(data.length / 2)].day)}</span><span>{fmtDay(data[data.length - 1].day)}</span>
            </div>
          </div>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="tap cursor-pointer text-ink-soft">{t('sales_chart_table')}</summary>
        <table className="table text-xs mt-2">
          <thead><tr><th>{t('date')}</th><th>{t('sales_chart_col_sales')}</th><th>{t('orders_title')}</th></tr></thead>
          <tbody>{data.filter((d) => d.orders > 0).map((d) => (
            <tr key={d.day}><td dir="ltr">{d.day}</td><td>{formatSYP(d.sales, lang)}</td><td>{d.orders}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </section>
  );
}

/* eslint-disable @next/next/no-img-element */
import type { Lang, TFn, TKey } from '@/lib/i18n';
import { formatSYP } from '@/lib/money';

/**
 * Product-card "waterfall" for the landing hero.
 * Pure CSS keyframes on `transform` only (`.wf-*` in app/globals.css) — no JS animation,
 * honours prefers-reduced-motion, and mirrors under [dir="rtl"].
 * Swap `SHOWCASE` for real seller products; the layout does not change.
 */
export interface ShowcaseItem { key: string; price: number; tone: '' | 'tint' | 'blush' }

export const SHOWCASE: ShowcaseItem[] = [
  { key: 'candle', price: 85000, tone: '' },
  { key: 'cup', price: 140000, tone: 'tint' },
  { key: 'tote', price: 95000, tone: 'blush' },
  { key: 'soap', price: 30000, tone: '' },
  { key: 'perfume', price: 260000, tone: 'tint' },
  { key: 'shirt', price: 175000, tone: 'blush' },
  { key: 'earrings', price: 120000, tone: '' },
  { key: 'basket', price: 68000, tone: 'tint' },
  { key: 'honey', price: 54000, tone: 'blush' },
  { key: 'plant', price: 72000, tone: '' },
  { key: 'gift', price: 110000, tone: 'tint' },
  { key: 'sun', price: 195000, tone: 'blush' },
];

const COLUMNS = 4;
const CARDS_PER_COLUMN = 6;               // each loop half must exceed the viewport height for a seamless join
const SPEEDS_S = [30, 38, 46, 34];        // varied speeds give the grid depth
const OFFSETS_PX = [0, -150, -64, -224];  // vertical stagger per column

function Card({ item, t, lang }: { item: ShowcaseItem; t: TFn; lang: Lang }) {
  return (
    <div className={`wf-card${item.tone ? ' wf-card--' + item.tone : ''}`}>
      <div className="wf-figure"><img src={`/hero/${item.key}.svg`} alt="" decoding="async" draggable={false} /></div>
      <div className="wf-meta">
        <div className="wf-name">{t(`prod_${item.key}` as TKey)}</div>
        <div className="wf-price">{formatSYP(item.price, lang)}</div>
      </div>
    </div>
  );
}

/** Desktop / tablet: tilted columns scrolling downward forever. Hidden below `md`. */
export function HeroCardWaterfall({ t, lang, items = SHOWCASE }: { t: TFn; lang: Lang; items?: ShowcaseItem[] }) {
  const columns = Array.from({ length: COLUMNS }, (_, c) =>
    Array.from({ length: CARDS_PER_COLUMN }, (_, k) => items[(c + k * COLUMNS) % items.length]),
  );
  return (
    <div className="wf-wrap" aria-hidden="true">
      <div className="wf-grid">
        {columns.map((col, i) => (
          <div key={i} className="wf-col" style={{ animationDuration: `${SPEEDS_S[i]}s`, marginTop: OFFSETS_PX[i] }}>
            {[...col, ...col].map((item, j) => <Card key={j} item={item} t={t} lang={lang} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mobile: one sideways strip using the same seamless technique. */
export function HeroCardStrip({ t, lang, items = SHOWCASE }: { t: TFn; lang: Lang; items?: ShowcaseItem[] }) {
  return (
    <div className="wf-strip-wrap" aria-hidden="true">
      <div className="wf-strip">{[...items, ...items].map((item, j) => <Card key={j} item={item} t={t} lang={lang} />)}</div>
    </div>
  );
}

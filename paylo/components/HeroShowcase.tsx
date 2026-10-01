/* eslint-disable @next/next/no-img-element */
import fs from 'fs';
import path from 'path';
import type { Lang, TFn, TKey } from '@/lib/i18n';
import { formatSYP } from '@/lib/money';

/**
 * Landing hero: a phone showing a real Paylo storefront (built from the same UI pieces as
 * /s/<slug>), with a "new order" and a "transfer confirmed" notification arriving beside it.
 * Transform/opacity-only CSS animation (`.hs-*` in app/globals.css), off under
 * prefers-reduced-motion.
 *
 * Product tiles show real photography from public/hero/products/<key>.jpg when the file is
 * present. Without it a tile is a plain neutral block with the product name — never an
 * illustration standing in for a product.
 */
export interface ShowcaseItem { key: string; price: number }
export const SHOWCASE: ShowcaseItem[] = [
  { key: 'seal', price: 85000 }, { key: 'wave', price: 195000 }, { key: 'count', price: 140000 },
  { key: 'peak', price: 54000 }, { key: 'axis', price: 260000 }, { key: 'arch', price: 68000 },
];

const DIR = path.join(process.cwd(), 'public', 'hero', 'products');
function photo(key: string): string | null {
  for (const ext of ['jpg', 'jpeg', 'webp', 'png']) {
    try { if (fs.existsSync(path.join(DIR, `${key}.${ext}`))) return `/hero/products/${key}.${ext}`; } catch { /* no photo */ }
  }
  return null;
}

function Tile({ item, t, lang }: { item: ShowcaseItem; t: TFn; lang: Lang }) {
  const src = photo(item.key);
  const name = t(`prod_${item.key}` as TKey);
  return (
    <div className="hs-tile" data-photo={src ? '1' : '0'}>
      <div className="hs-img">{src ? <img src={src} alt={name} loading="lazy" decoding="async" /> : <span className="hs-img-name">{name}</span>}</div>
      <div className="hs-tname">{name}</div>
      <div className="hs-tprice">{formatSYP(item.price, lang)}</div>
    </div>
  );
}

export function HeroShowcase({ t, lang, items = SHOWCASE }: { t: TFn; lang: Lang; items?: ShowcaseItem[] }) {
  return (
    <div className="hs-stage" data-testid="hero-showcase" aria-hidden="true">
      <div className="hs-phone">
        <div className="hs-notch" />
        <div className="hs-screen">
          <div className="hs-store">
            <div className="hs-avatar">D</div>
            <div className="min-w-0">
              <div className="hs-sname">{t('hs_store_name')}</div>
              <div className="hs-shandle" dir="ltr">paylo.sy/s/damascus-spice</div>
            </div>
          </div>
          <div className="hs-chips"><span className="hs-chip hs-chip-on">{t('all')}</span><span className="hs-chip">{t('hs_chip_gifts')}</span><span className="hs-chip">{t('hs_chip_home')}</span></div>
          <div className="hs-scroll">
            <div className="hs-grid">{[...items, ...items].map((it, i) => <Tile key={i} item={it} t={t} lang={lang} />)}</div>
          </div>
          <div className="hs-buy">{t('hs_buy')}</div>
        </div>
      </div>
      <div className="hs-note hs-note-1">
        <span className="hs-dot" />
        <div><div className="hs-note-t">{t('hs_new_order')}</div><div className="hs-note-s">{t(`prod_${items[0].key}` as TKey)} · {formatSYP(items[0].price, lang)}</div></div>
      </div>
      <div className="hs-note hs-note-2">
        <span className="hs-check">✓</span>
        <div><div className="hs-note-t">{t('hs_paid')}</div><div className="hs-note-s">{t('hs_paid_sub')}</div></div>
      </div>
    </div>
  );
}

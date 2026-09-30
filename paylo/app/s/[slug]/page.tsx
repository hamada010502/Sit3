/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { ProductImage } from '@/components/ProductImage';
import { getDb } from '@/lib/db';
import { visibleCollections } from '@/lib/collections';
import { aboutSections } from '@/lib/store-page';
import { Announcement } from '@/components/Announcement';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product, Seller } from '@/lib/types';

export default function StorePage({ params, searchParams }: { params: { slug: string }; searchParams: { c?: string } }) {
  const { t, lang } = getT();
  const db = getDb();
  const seller = db.prepare('SELECT * FROM sellers WHERE slug = ?').get(params.slug) as Seller | undefined;
  if (!seller || seller.status !== 'approved' || !seller.visible) {
    return <Shell><div className="alert-info text-center py-10">{t('store_unavailable')}</div></Shell>;
  }
  const collections = visibleCollections(seller.id);
  const active = collections.find((c) => c.slug === searchParams.c);
  const products = db.prepare(`SELECT * FROM products WHERE seller_id = ? AND status IN ('active','out_of_stock') ${active ? 'AND collection_id = ?' : ''} ORDER BY created_at DESC`)
    .all(...(active ? [seller.id, active.id] : [seller.id])) as Product[];
  const minPrices = Object.fromEntries((db.prepare(
    'SELECT product_id, min(price) p, sum(stock) s FROM product_variants GROUP BY product_id').all() as { product_id: string; p: number; s: number }[])
    .map((r) => [r.product_id, r]));

  return (
    <Shell wide>
      <Announcement text={seller.announcement} />
      {seller.banner_path && <img src={seller.banner_path} alt="" className="w-full h-40 sm:h-56 object-cover rounded-2xl mb-4" />}
      <div className="card-pad mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
        {seller.logo_path
          ? <img src={seller.logo_path} alt="" className="h-16 w-16 rounded-full object-cover shrink-0" />
          : <div className="h-16 w-16 rounded-full bg-ink text-white flex items-center justify-center text-2xl font-bold shrink-0">{seller.store_name.slice(0, 1).toUpperCase()}</div>}
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-ink-soft">{t('store_by')}</p>
          <h1 className="text-2xl font-bold">{seller.store_name}</h1>
          {seller.bio && <p className="text-sm text-ink-soft mt-1">{seller.bio}</p>}
          <div className="flex flex-wrap gap-3 items-center">
            {seller.instagram && <a href={`https://instagram.com/${seller.instagram}`} target="_blank" rel="noreferrer" className="link text-sm" dir="ltr">@{seller.instagram}</a>}
            {aboutSections(seller).length > 0 && <Link href={`/s/${seller.slug}/about`} className="link text-sm" data-testid="about-link">{t('store_about')} →</Link>}
          </div>
        </div>
      </div>

      {collections.length > 0 && (
        <nav className="flex gap-2 overflow-x-auto pb-2 mb-4" data-testid="collection-chips" aria-label={t('nav_collections')}>
          <Link href={`/s/${seller.slug}`} className={`badge border px-3 py-1.5 whitespace-nowrap ${!active ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>{t('all_products')}</Link>
          {collections.map((c) => (
            <Link key={c.id} href={`/s/${seller.slug}?c=${encodeURIComponent(c.slug)}`} aria-current={active?.id === c.id ? 'page' : undefined}
              className={`badge border px-3 py-1.5 whitespace-nowrap ${active?.id === c.id ? 'bg-ink text-white border-ink' : 'bg-white border-ink/15 text-ink-soft'}`}>{c.name}</Link>
          ))}
        </nav>
      )}
      {products.length === 0 ? <div className="alert-info text-center py-10">{t('store_empty')}</div> : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => {
            const v = minPrices[p.id];
            const price = v ? v.p : p.price;
            const out = p.type === 'physical' && (v ? v.s <= 0 : p.stock <= 0);
            return (
              <Link key={p.id} href={`/p/${p.id}`} className="card overflow-hidden group hover:shadow-lift transition">
                <ProductImage images={p.images} alt={p.title} className="w-full aspect-square" />
                <div className="p-3">
                  <h2 className="font-semibold text-sm line-clamp-2 group-hover:text-cherry">{p.title}</h2>
                  <p className="mt-1 text-sm font-bold">{v ? `${t('from_price')} ` : ''}{formatSYP(price, lang)}</p>
                  {out ? <span className="badge bg-ink/10 text-ink-soft mt-2">{t('sold_out')}</span> : <span className="btn-primary btn-sm mt-2">{t('buy')}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {seller.about && !seller.about_sections && (
        <div className="card-pad mt-8">
          <h2 className="font-bold mb-2">{t('store_about')}</h2>
          <p className="text-sm text-ink-soft whitespace-pre-line leading-relaxed">{seller.about}</p>
        </div>
      )}
    </Shell>
  );
}

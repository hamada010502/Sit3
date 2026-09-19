/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { ProductImage } from '@/components/ProductImage';
import { getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product, Seller } from '@/lib/types';

export default function StorePage({ params }: { params: { slug: string } }) {
  const { t, lang } = getT();
  const db = getDb();
  const seller = db.prepare('SELECT * FROM sellers WHERE slug = ?').get(params.slug) as Seller | undefined;
  if (!seller || seller.status !== 'approved' || !seller.visible) {
    return <Shell><div className="alert-info text-center py-10">{t('store_unavailable')}</div></Shell>;
  }
  const products = db.prepare("SELECT * FROM products WHERE seller_id = ? AND status IN ('active','out_of_stock') ORDER BY created_at DESC").all(seller.id) as Product[];
  const minPrices = Object.fromEntries((db.prepare(
    'SELECT product_id, min(price) p, sum(stock) s FROM product_variants GROUP BY product_id').all() as { product_id: string; p: number; s: number }[])
    .map((r) => [r.product_id, r]));

  return (
    <Shell wide>
      {seller.banner_path && <img src={seller.banner_path} alt="" className="w-full h-40 sm:h-56 object-cover rounded-2xl mb-4" />}
      <div className="card-pad mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
        {seller.logo_path
          ? <img src={seller.logo_path} alt="" className="h-16 w-16 rounded-full object-cover shrink-0" />
          : <div className="h-16 w-16 rounded-full bg-tide text-white flex items-center justify-center text-2xl font-bold shrink-0">{seller.store_name.slice(0, 1).toUpperCase()}</div>}
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-ink-soft">{t('store_by')}</p>
          <h1 className="text-2xl font-bold">{seller.store_name}</h1>
          {seller.bio && <p className="text-sm text-ink-soft mt-1">{seller.bio}</p>}
          {seller.instagram && <a href={`https://instagram.com/${seller.instagram}`} target="_blank" rel="noreferrer" className="link text-sm" dir="ltr">@{seller.instagram}</a>}
        </div>
      </div>

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
                  <h2 className="font-semibold text-sm line-clamp-2 group-hover:text-rose-600">{p.title}</h2>
                  <p className="mt-1 text-sm font-bold">{v ? `${t('from_price')} ` : ''}{formatSYP(price, lang)}</p>
                  {out ? <span className="badge bg-ink/10 text-ink-soft mt-2">{t('sold_out')}</span> : <span className="btn-primary btn-sm mt-2">{t('buy')}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {seller.about && (
        <div className="card-pad mt-8">
          <h2 className="font-bold mb-2">{t('store_about')}</h2>
          <p className="text-sm text-ink-soft whitespace-pre-line leading-relaxed">{seller.about}</p>
        </div>
      )}
    </Shell>
  );
}

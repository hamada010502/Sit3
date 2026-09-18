import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { ProductImage } from '@/components/ProductImage';
import { getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product, Seller } from '@/lib/types';

export default function StorePage({ params }: { params: { slug: string } }) {
  const { t, lang } = getT();
  const seller = getDb().prepare('SELECT * FROM sellers WHERE slug = ?').get(params.slug) as Seller | undefined;
  if (!seller || seller.status !== 'approved') {
    return <Shell><div className="alert-info text-center py-10">{t('store_unavailable')}</div></Shell>;
  }
  const products = getDb().prepare("SELECT * FROM products WHERE seller_id = ? AND status IN ('active','out_of_stock') ORDER BY created_at DESC").all(seller.id) as Product[];
  return (
    <Shell wide>
      <div className="card-pad mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-bluewood text-white flex items-center justify-center text-2xl font-bold shrink-0">{seller.store_name.slice(0, 1).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-bluewood/50">{t('store_by')}</p>
          <h1 className="text-2xl font-bold">{seller.store_name}</h1>
          {seller.bio && <p className="text-sm text-bluewood/70 mt-1">{seller.bio}</p>}
          {seller.instagram && <a href={`https://instagram.com/${seller.instagram}`} target="_blank" rel="noreferrer" className="text-sm text-crusta font-semibold" dir="ltr">@{seller.instagram}</a>}
        </div>
      </div>
      {products.length === 0 ? <div className="alert-info text-center py-10">{t('store_empty')}</div> : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`} className="card overflow-hidden group">
              <ProductImage images={p.images} alt={p.title} className="w-full aspect-square" />
              <div className="p-3">
                <h2 className="font-semibold text-sm line-clamp-2 group-hover:text-crusta">{p.title}</h2>
                <p className="mt-1 text-sm font-bold">{formatSYP(p.price, lang)}</p>
                {p.status === 'out_of_stock' || p.stock <= 0 ? <span className="badge bg-bluewood/10 text-bluewood mt-2">{t('sold_out')}</span> : <span className="btn-primary btn-sm mt-2">{t('buy')}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

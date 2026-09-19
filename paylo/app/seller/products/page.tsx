import Link from 'next/link';
import { CopyButton } from '@/components/CopyButton';
import { ProductImage } from '@/components/ProductImage';
import { ProductStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/notify';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product } from '@/lib/types';
import { toggleProductAction } from './actions';

export default function ProductsPage() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const db = getDb();
  const products = db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Product[];
  const variantCounts = Object.fromEntries((db.prepare(
    'SELECT product_id, count(*) c FROM product_variants GROUP BY product_id').all() as { product_id: string; c: number }[]).map((r) => [r.product_id, r.c]));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="section-title">{t('products_title')}</h1>
        <Link href="/seller/products/new" className="btn-primary">+ {t('products_new')}</Link>
      </div>
      {products.length === 0 ? <div className="card-pad text-center text-ink-soft">{t('products_empty')}</div> : (
        <div className="space-y-3">
          {products.map((p) => {
            const link = appUrl(`/p/${p.id}`);
            return (
              <div key={p.id} className="card p-3 flex flex-col sm:flex-row sm:items-center gap-4">
                <ProductImage images={p.images} alt={p.title} className="h-20 w-20 rounded-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold">{p.title}</h2>
                    <ProductStatusBadge status={p.status} t={t} />
                    <span className="badge bg-ink/8 text-ink-soft">{t(`pt_${p.type}` as const)}</span>
                  </div>
                  <p className="text-sm text-ink-soft mt-0.5">
                    {formatSYP(p.price, lang)}
                    {p.type === 'physical' && ` · ${t('stock')}: ${p.stock}`}
                    {variantCounts[p.id] ? ` · ${variantCounts[p.id]} ${t('variants_title').toLowerCase()}` : ''}
                  </p>
                  {p.status !== 'removed' && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-ink-soft">{t('checkout_link')}:</span>
                      <code className="bg-mist rounded px-1.5 py-0.5 truncate max-w-[220px] sm:max-w-xs" dir="ltr">{link}</code>
                      <CopyButton text={link} />
                    </div>
                  )}
                </div>
                {p.status !== 'removed' && (
                  <div className="flex gap-2 shrink-0">
                    <Link href={`/seller/products/${p.id}`} className="btn-secondary btn-sm">{t('edit')}</Link>
                    <form action={toggleProductAction.bind(null, p.id)}><button className="btn-secondary btn-sm">{p.status === 'inactive' ? t('set_active') : t('set_inactive')}</button></form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

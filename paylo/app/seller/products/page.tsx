import Link from 'next/link';
import { CopyButton } from '@/components/CopyButton';
import { ProductImage } from '@/components/ProductImage';
import { ProductStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/email';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product } from '@/lib/types';
import { toggleProductAction } from './actions';

export default function ProductsPage() {
  const { seller } = requireApprovedSeller();
  const { t, lang } = getT();
  const products = getDb().prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC').all(seller.id) as Product[];
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('products_title')}</h1>
        <Link href="/seller/products/new" className="btn-primary">+ {t('products_new')}</Link>
      </div>
      {products.length === 0 ? <div className="card-pad text-center text-bluewood/60">{t('products_empty')}</div> : (
        <div className="space-y-3">
          {products.map((p) => {
            const link = appUrl(`/p/${p.id}`);
            return (
              <div key={p.id} className="card p-3 flex flex-col sm:flex-row sm:items-center gap-4">
                <ProductImage images={p.images} alt={p.title} className="h-20 w-20 rounded-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{p.title}</h2><ProductStatusBadge status={p.status} t={t} /></div>
                  <p className="text-sm text-bluewood/70 mt-0.5">{formatSYP(p.price, lang)} · {t('stock')}: {p.stock}</p>
                  {p.status !== 'removed' && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-bluewood/50">{t('checkout_link')}:</span>
                      <code className="bg-karry/60 rounded px-1.5 py-0.5 truncate max-w-[220px] sm:max-w-xs" dir="ltr">{link}</code>
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

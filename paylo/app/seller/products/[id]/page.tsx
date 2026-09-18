import { notFound } from 'next/navigation';
import { CopyButton } from '@/components/CopyButton';
import { parseImages } from '@/components/ProductImage';
import { ProductStatusBadge } from '@/components/StatusBadge';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/email';
import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import type { Product } from '@/lib/types';
import { ProductForm } from '../ProductForm';
import { deleteProductAction } from '../actions';

export default function EditProductPage({ params, searchParams }: { params: { id: string }; searchParams: { saved?: string } }) {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  const product = getDb().prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(params.id, seller.id) as Product | undefined;
  if (!product) notFound();
  const link = appUrl(`/p/${product.id}`);
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3 mb-4"><h1 className="text-2xl font-bold">{t('edit')}: {product.title}</h1><ProductStatusBadge status={product.status} t={t} /></div>
      {searchParams.saved && <div className="alert-success mb-4">{t('product_saved')}</div>}
      {product.status === 'removed' ? <div className="alert-error">{t('product_removed')}</div> : (
        <>
          <div className="card-pad mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-bluewood/60">{t('checkout_link')}:</span>
            <code className="bg-karry/60 rounded px-2 py-1 truncate max-w-full" dir="ltr">{link}</code>
            <CopyButton text={link} />
          </div>
          <ProductForm product={product} images={parseImages(product.images)} />
          <form action={deleteProductAction.bind(null, product.id)} className="mt-4 text-end">
            <button className="text-sm text-blossom font-semibold">{t('delete')}</button>
          </form>
        </>
      )}
    </div>
  );
}

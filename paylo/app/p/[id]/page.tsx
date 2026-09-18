import { Shell } from '@/components/Shell';
import { ProductImage, parseImages } from '@/components/ProductImage';
import { getAllSettings, getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import type { Product, Seller } from '@/lib/types';
import Link from 'next/link';
import { CheckoutForm } from './CheckoutForm';

export default function ProductPage({ params }: { params: { id: string } }) {
  const { t, lang } = getT();
  const product = getDb().prepare('SELECT * FROM products WHERE id = ?').get(params.id) as Product | undefined;
  const seller = product ? getDb().prepare('SELECT * FROM sellers WHERE id = ?').get(product.seller_id) as Seller | undefined : undefined;
  if (!product || !seller || seller.status !== 'approved' || product.status === 'removed' || product.status === 'inactive') {
    return <Shell><div className="alert-info text-center py-10">{t('product_unavailable')}</div></Shell>;
  }
  const settings = getAllSettings();
  const images = parseImages(product.images);
  const available = product.status === 'active' && product.stock > 0;
  return (
    <Shell wide>
      <div className="grid lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2">
          <ProductImage images={product.images} alt={product.title} className="w-full aspect-square rounded-2xl" />
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {images.slice(0, 5).map((src, i) => <img key={i} src={src} alt="" className="aspect-square object-cover rounded-lg border border-bluewood/10" />)}
            </div>
          )}
          <div className="mt-5">
            <Link href={`/s/${seller.slug}`} className="text-xs uppercase tracking-wide text-bluewood/50 hover:text-crusta">{t('store_by')} · {seller.store_name}</Link>
            <h1 className="text-2xl font-bold mt-1">{product.title}</h1>
            <p className="text-2xl font-bold text-crusta mt-2">{formatSYP(product.price, lang)}</p>
            {product.description && <p className="mt-4 text-sm text-bluewood/70 whitespace-pre-line">{product.description}</p>}
          </div>
        </div>
        <div className="lg:col-span-3">
          {available ? (
            <CheckoutForm
              productId={product.id}
              price={product.price}
              stock={product.stock}
              feeDamascus={parseInt(settings.delivery_fee_damascus, 10) || 0}
              feeOther={parseInt(settings.delivery_fee_other, 10) || 0}
              mock={(process.env.PAYMENT_PROVIDER || 'mock') === 'mock'}
            />
          ) : <div className="alert-info text-center py-10">{t('sold_out')}</div>}
        </div>
      </div>
    </Shell>
  );
}

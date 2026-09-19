import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { ProductImage, parseImages } from '@/components/ProductImage';
import { getAllSettings, getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { enabledPaymentMethods } from '@/lib/orders';
import type { Product, ProductVariant, Seller } from '@/lib/types';
import { CheckoutForm } from './CheckoutForm';

export default function ProductPage({ params }: { params: { id: string } }) {
  const { t, lang } = getT();
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(params.id) as Product | undefined;
  const seller = product ? db.prepare('SELECT * FROM sellers WHERE id = ?').get(product.seller_id) as Seller | undefined : undefined;
  if (!product || !seller || seller.status !== 'approved' || !seller.visible || product.status === 'removed' || product.status === 'inactive') {
    return <Shell><div className="alert-info text-center py-10">{t('product_unavailable')}</div></Shell>;
  }
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY position').all(product.id) as ProductVariant[];
  const settings = getAllSettings();
  const images = parseImages(product.images);
  const isDigital = product.type === 'digital';
  const inStock = isDigital || (product.status === 'active' && (variants.length ? variants.some((v) => v.stock > 0) : product.stock > 0));
  const methods = enabledPaymentMethods(isDigital);
  const display = variants.length ? Math.min(...variants.map((v) => v.price)) : product.price;

  return (
    <Shell wide>
      <div className="grid lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2">
          <ProductImage images={product.images} alt={product.title} className="w-full aspect-square rounded-2xl bg-white" />
          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {images.slice(0, 5).map((src, i) => <img key={i} src={src} alt="" className="aspect-square object-cover rounded-lg border border-ink/10" />)}
            </div>
          )}
          <div className="mt-5">
            <Link href={`/s/${seller.slug}`} className="text-xs uppercase tracking-wide text-ink-soft hover:text-cherry">{t('store_by')} · {seller.store_name}</Link>
            <h1 className="text-2xl font-bold mt-1">{product.title}</h1>
            <p className="text-2xl font-extrabold text-cherry mt-2">
              {variants.length ? `${t('from_price')} ` : ''}{formatSYP(display, lang)}
            </p>
            <span className="badge bg-ink/8 text-ink-soft mt-2">{t(`pt_${product.type}` as const)}</span>
            {product.description && <p className="mt-4 text-sm text-ink-soft whitespace-pre-line leading-relaxed">{product.description}</p>}
          </div>
        </div>
        <div className="lg:col-span-3">
          {!inStock ? <div className="alert-info text-center py-10">{t('sold_out')}</div>
            : methods.length === 0 ? <div className="alert-warn text-center py-10">{t('payment_method_unavailable')}</div>
            : (
              <CheckoutForm
                productId={product.id} basePrice={product.price} stock={product.stock} isDigital={isDigital}
                variants={variants} option1={product.option1_name} option2={product.option2_name}
                feeDamascus={parseInt(settings.delivery_fee_damascus, 10) || 0}
                feeOther={parseInt(settings.delivery_fee_other, 10) || 0}
                methods={methods}
                bank={{ name: settings.bank_name, account: settings.bank_account_name, iban: settings.bank_iban, note: settings.bank_note }}
              />
            )}
        </div>
      </div>
    </Shell>
  );
}

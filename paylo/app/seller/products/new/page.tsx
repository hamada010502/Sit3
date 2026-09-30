import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { ProductForm } from '../ProductForm';
import { sellerCollections } from '@/lib/collections';
export default function NewProductPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  return <div className="max-w-2xl"><h1 className="section-title mb-6">{t('products_new')}</h1><ProductForm images={[]} collections={sellerCollections(seller.id)} /></div>;
}

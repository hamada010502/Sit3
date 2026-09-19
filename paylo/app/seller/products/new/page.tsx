import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { ProductForm } from '../ProductForm';
export default function NewProductPage() {
  requireApprovedSeller();
  const { t } = getT();
  return <div className="max-w-2xl"><h1 className="section-title mb-6">{t('products_new')}</h1><ProductForm images={[]} /></div>;
}

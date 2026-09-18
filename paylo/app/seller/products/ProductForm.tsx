'use client';
/* eslint-disable @next/next/no-img-element */
import { useFormState } from 'react-dom';
import { saveProductAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { Product } from '@/lib/types';

export function ProductForm({ product, images }: { product?: Product; images: string[] }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveProductAction.bind(null, product?.id ?? null), null);
  return (
    <form action={action} className="card-pad space-y-4" encType="multipart/form-data">
      {state?.error && <div className="alert-error">{t('product_error')}</div>}
      <Field label={t('title')}><input name="title" className="input" required defaultValue={product?.title} /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('price')}><input name="price" type="number" min={1} step={1} className="input" dir="ltr" required defaultValue={product?.price} /></Field>
        <Field label={t('stock')}><input name="stock" type="number" min={0} step={1} className="input" dir="ltr" required defaultValue={product?.stock ?? 1} /></Field>
      </div>
      <Field label={t('description')}><textarea name="description" className="input" rows={5} defaultValue={product?.description ?? ''} /></Field>
      {images.length > 0 && (
        <div>
          <label className="label">{t('existing_images')}</label>
          <div className="flex flex-wrap gap-3">
            {images.map((src) => (
              <label key={src} className="relative cursor-pointer">
                <img src={src} alt="" className="h-20 w-20 object-cover rounded-lg border border-bluewood/10" />
                <input type="checkbox" name="keep_image" value={src} defaultChecked className="absolute top-1 start-1 h-4 w-4 accent-crusta" />
              </label>
            ))}
          </div>
        </div>
      )}
      <Field label={t('add_images')} hint={t('images_hint')}><input name="images" type="file" multiple accept="image/jpeg,image/png,image/webp" className="input" /></Field>
      <SubmitButton className="btn-primary">{t('save')}</SubmitButton>
    </form>
  );
}

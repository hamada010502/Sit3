'use client';
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { saveProductAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { Product, ProductVariant } from '@/lib/types';

interface Row { option1_value: string; option2_value: string; price: number; stock: number }

export function ProductForm({ product, images, variants = [] }: { product?: Product; images: string[]; variants?: ProductVariant[] }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveProductAction.bind(null, product?.id ?? null), null);
  const [type, setType] = useState(product?.type ?? 'physical');
  const [opt1, setOpt1] = useState(product?.option1_name ?? '');
  const [opt2, setOpt2] = useState(product?.option2_name ?? '');
  const [rows, setRows] = useState<Row[]>(
    variants.map((v) => ({ option1_value: v.option1_value ?? '', option2_value: v.option2_value ?? '', price: v.price, stock: v.stock })),
  );
  const isDigital = type === 'digital';
  const hasOptions = opt1.trim().length > 0;

  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form action={action} className="space-y-5" encType="multipart/form-data">
      {state?.error && <div className="alert-error">{t('product_error')}</div>}

      <div className="card-pad space-y-4">
        <Field label={t('product_type')}>
          <div className="flex gap-2">
            {(['physical', 'digital'] as const).map((v) => (
              <label key={v} className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-sm font-semibold text-center ${type === v ? 'border-cherry bg-cherry/8 text-cherry-dark' : 'border-ink/15 text-ink-soft'}`}>
                <input type="radio" name="type" value={v} checked={type === v} onChange={() => setType(v)} className="sr-only" />
                {t(`pt_${v}` as const)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('title')}><input name="title" className="input" required defaultValue={product?.title} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('price')}><input name="price" type="number" min={1} step={1} className="input" dir="ltr" required defaultValue={product?.price} /></Field>
          {!isDigital && !hasOptions && (
            <Field label={t('stock')}><input name="stock" type="number" min={0} step={1} className="input" dir="ltr" required defaultValue={product?.stock ?? 1} /></Field>
          )}
        </div>
        <Field label={t('description')}><textarea name="description" className="input" rows={4} defaultValue={product?.description ?? ''} /></Field>
        {isDigital && (
          <Field label={t('digital_note')} hint={t('digital_note_hint')}>
            <textarea name="digital_note" className="input" rows={3} defaultValue={product?.digital_note ?? ''} />
          </Field>
        )}
      </div>

      {!isDigital && (
        <div className="card-pad space-y-4">
          <div>
            <h2 className="font-bold">{t('options_title')}</h2>
            <p className="text-sm text-ink-soft mt-1">{t('options_hint')}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('option1_name')}><input name="option1_name" className="input" value={opt1} onChange={(e) => setOpt1(e.target.value)} placeholder="Size" /></Field>
            <Field label={t('option2_name')}><input name="option2_name" className="input" value={opt2} onChange={(e) => setOpt2(e.target.value)} placeholder="Colour" disabled={!hasOptions} /></Field>
          </div>

          {hasOptions && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">{t('variants_title')}</h3>
                <button type="button" className="btn-secondary btn-sm"
                  onClick={() => setRows((r) => [...r, { option1_value: '', option2_value: '', price: product?.price ?? 0, stock: 0 }])}>
                  + {t('variant_add')}
                </button>
              </div>
              <p className="text-xs text-ink-soft mb-3">{t('variants_hint')}</p>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} data-variant-row className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[110px]"><label className="label">{opt1}</label>
                      <input type="text" className="input" value={r.option1_value} onChange={(e) => setRow(i, { option1_value: e.target.value })} required /></div>
                    {opt2.trim() && <div className="flex-1 min-w-[110px]"><label className="label">{opt2}</label>
                      <input type="text" className="input" value={r.option2_value} onChange={(e) => setRow(i, { option2_value: e.target.value })} /></div>}
                    <div className="w-32"><label className="label">{t('price')}</label>
                      <input type="number" min={1} dir="ltr" className="input" value={r.price} onChange={(e) => setRow(i, { price: Number(e.target.value) })} /></div>
                    <div className="w-24"><label className="label">{t('stock')}</label>
                      <input type="number" min={0} dir="ltr" className="input" value={r.stock} onChange={(e) => setRow(i, { stock: Number(e.target.value) })} /></div>
                    <button type="button" className="btn-ghost btn-sm text-cherry" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>{t('variant_remove')}</button>
                  </div>
                ))}
              </div>
              <input type="hidden" name="variants" value={JSON.stringify(rows)} />
            </div>
          )}
        </div>
      )}

      <div className="card-pad space-y-4">
        {images.length > 0 && (
          <div>
            <label className="label">{t('existing_images')}</label>
            <div className="flex flex-wrap gap-3">
              {images.map((src) => (
                <label key={src} className="relative cursor-pointer">
                  <img src={src} alt="" className="h-20 w-20 object-cover rounded-lg border border-ink/10" />
                  <input type="checkbox" name="keep_image" value={src} defaultChecked className="absolute top-1 start-1 h-4 w-4 accent-cherry" />
                </label>
              ))}
            </div>
          </div>
        )}
        <Field label={t('add_images')} hint={t('images_hint')}>
          <input name="images" type="file" multiple accept="image/jpeg,image/png,image/webp" className="input" />
        </Field>
      </div>

      <SubmitButton className="btn-primary">{t('save')}</SubmitButton>
    </form>
  );
}

'use client';
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { saveProductAction } from './actions';
import { ImageManager } from './ImageManager';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { Collection, Product, ProductVariant, VariationPreset } from '@/lib/types';

interface Row { uid: string; option1_value: string; option2_value: string; price: number; stock: number; image: string | null }
const uid = () => Math.random().toString(36).slice(2, 10);

export function ProductForm({ product, images, variants = [], collections = [], presets = [] }: { product?: Product; images: string[]; variants?: ProductVariant[]; collections?: Collection[]; presets?: VariationPreset[] }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveProductAction.bind(null, product?.id ?? null), null);
  const [type, setType] = useState(product?.type ?? 'physical');
  const [opt1, setOpt1] = useState(product?.option1_name ?? '');
  const [opt2, setOpt2] = useState(product?.option2_name ?? '');
  const [rows, setRows] = useState<Row[]>(
    variants.map((v) => ({ uid: uid(), option1_value: v.option1_value ?? '', option2_value: v.option2_value ?? '', price: v.price, stock: v.stock, image: v.image_path })),
  );
  const isDigital = type === 'digital';
  const hasOptions = opt1.trim().length > 0;

  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  // Fills option names and generates every combination; rows that already existed keep
  // their price, stock and photo so re-applying never wipes a seller's work.
  const applyPresets = () => {
    const a = presets.find((p) => p.id === p1);
    if (!a) return;
    const b = presets.find((p) => p.id === p2 && p.id !== p1);
    setOpt1(a.name);
    setOpt2(b?.name ?? '');
    const base = Number((document.querySelector('input[name=price]') as HTMLInputElement | null)?.value) || product?.price || 0;
    const combos = b ? a.values.flatMap((x) => b.values.map((y) => [x, y])) : a.values.map((x) => [x, '']);
    setRows((prev) => combos.slice(0, 30).map(([x, y]) => {
      const old = prev.find((r) => r.option1_value === x && r.option2_value === y);
      return old ?? { uid: uid(), option1_value: x, option2_value: y, price: base, stock: 0, image: null };
    }));
  };

  return (
    <form action={action} className="space-y-5" encType="multipart/form-data">
      {state?.error && <div className="alert-error">{t('product_error')}</div>}

      <div className="card-pad space-y-4">
        <Field label={t('product_type')}>
          <div className="flex gap-2">
            {(['physical', 'digital'] as const).map((v) => (
              <label key={v} className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-sm font-semibold text-center ${type === v ? 'border-brand bg-danger/10 text-danger-dark' : 'border-ink/15 text-ink-soft'}`}>
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
        {collections.length > 0 && (
          <Field label={t('nav_collections')}>
            <select name="collection_id" className="input" defaultValue={product?.collection_id ?? ''}>
              <option value="">{t('collection_none_opt')}</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
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
          {presets.length > 0 && (
            <div className="rounded-lg bg-cream p-3 space-y-2" data-testid="preset-picker">
              <label className="label">{t('variation_pick')}</label>
              <div className="flex flex-wrap gap-2">
                <select className="input flex-1 min-w-[120px]" value={p1} onChange={(e) => setP1(e.target.value)} aria-label={t('option1_name')}>
                  <option value="">—</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="input flex-1 min-w-[120px]" value={p2} onChange={(e) => setP2(e.target.value)} aria-label={t('option2_name')}>
                  <option value="">—</option>{presets.filter((p) => p.id !== p1).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" className="btn-secondary shrink-0" onClick={applyPresets} disabled={!p1}>{t('variation_apply')}</button>
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('option1_name')}><input name="option1_name" className="input" value={opt1} onChange={(e) => setOpt1(e.target.value)} placeholder="Size" /></Field>
            <Field label={t('option2_name')}><input name="option2_name" className="input" value={opt2} onChange={(e) => setOpt2(e.target.value)} placeholder="Colour" disabled={!hasOptions} /></Field>
          </div>

          {hasOptions && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm">{t('variants_title')}</h3>
                <button type="button" className="btn-secondary btn-sm"
                  onClick={() => setRows((r) => [...r, { uid: uid(), option1_value: '', option2_value: '', price: product?.price ?? 0, stock: 0, image: null }])}>
                  + {t('variant_add')}
                </button>
              </div>
              <p className="text-xs text-ink-soft mb-3">{t('variants_hint')}</p>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={r.uid} data-variant-row className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[110px]"><label className="label">{opt1}</label>
                      <input type="text" className="input" value={r.option1_value} onChange={(e) => setRow(i, { option1_value: e.target.value })} required /></div>
                    {opt2.trim() && <div className="flex-1 min-w-[110px]"><label className="label">{opt2}</label>
                      <input type="text" className="input" value={r.option2_value} onChange={(e) => setRow(i, { option2_value: e.target.value })} /></div>}
                    <div className="w-32"><label className="label">{t('price')}</label>
                      <input type="number" min={1} dir="ltr" className="input" value={r.price} onChange={(e) => setRow(i, { price: Number(e.target.value) })} /></div>
                    <div className="w-24"><label className="label">{t('stock')}</label>
                      <input type="number" min={0} dir="ltr" className="input" value={r.stock} onChange={(e) => setRow(i, { stock: Number(e.target.value) })} /></div>
                    <div className="w-40"><label className="label">{t('variant_image')}</label>
                      {r.image ? (
                        <div className="flex items-center gap-2">
                          <img src={r.image} alt="" className="h-10 w-10 rounded object-cover border border-ink/10" data-testid="variant-thumb" />
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setRow(i, { image: null })}>×</button>
                        </div>
                      ) : <input type="file" name={`variant_image_${r.uid}`} accept="image/jpeg,image/png,image/webp" className="text-xs w-full" />}
                    </div>
                    <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>{t('variant_remove')}</button>
                  </div>
                ))}
              </div>
              <input type="hidden" name="variants" value={JSON.stringify(rows)} />
            </div>
          )}
        </div>
      )}

      <div className="card-pad space-y-3">
        <h2 className="font-bold">{t('images_title')}</h2>
        <ImageManager initial={images} />
      </div>

      <SubmitButton className="btn-primary">{t('save')}</SubmitButton>
    </form>
  );
}

'use client';
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { checkoutAction, type CheckoutState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { formatSYP } from '@/lib/money';
import { DAMASCUS, GOVERNORATES, type PaymentMethod, type ProductVariant } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

interface Props {
  productId: string; basePrice: number; stock: number; isDigital: boolean;
  variants: ProductVariant[]; option1: string | null; option2: string | null;
  feeDamascus: number; feeOther: number; methods: PaymentMethod[];
  bank: { name: string; account: string; iban: string; note: string };
}

const KNOWN_FAILS = ['invalid_card', 'expired_card', 'insufficient_funds', 'provider_not_configured'];

/** Two steps at most (v2 §5.1): details, then payment. */
export function CheckoutForm({ productId, basePrice, stock, isDigital, variants, option1, option2, feeDamascus, feeOther, methods, bank }: Props) {
  const { t, lang } = useI18n();
  const [state, action] = useFormState(checkoutAction.bind(null, productId), null as CheckoutState | null);
  const [step, setStep] = useState<1 | 2>(1);
  const [qty, setQty] = useState(1);
  const [gov, setGov] = useState<string>(DAMASCUS);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cod');

  const variant = variants.find((v) => v.id === variantId);
  const unit = variant ? variant.price : basePrice;
  const available = variant ? variant.stock : stock;
  const fee = isDigital ? 0 : gov === DAMASCUS ? feeDamascus : feeOther;
  const subtotal = unit * qty;
  const err = (k: string) => (state?.fields?.[k] ? t('required') : undefined);
  const failMsg = !state?.error || state.error === 'checkout_error' ? null
    : state.error === 'qty_exceeds' ? t('qty_exceeds', { n: available })
    : state.error === 'variant_required' ? t('variant_required')
    : state.error === 'product_unavailable' ? t('product_unavailable')
    : state.error === 'payment_method_unavailable' ? t('payment_method_unavailable')
    : KNOWN_FAILS.includes(state.error) ? t(`fail_${state.error}` as TKey) : t('fail_generic');

  return (
    <form action={action} className="card-pad space-y-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {([1, 2] as const).map((n) => (
          <span key={n} className={`flex items-center gap-2 ${step === n ? 'text-rose-600' : 'text-ink-soft'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === n ? 'bg-rose text-white' : 'bg-ink/10'}`}>{n}</span>
            {t(n === 1 ? 'checkout_step1' : 'checkout_step2')}
            {n === 1 && <span className="text-ink-soft/50 mx-1">→</span>}
          </span>
        ))}
      </div>

      {state?.error === 'checkout_error' && <div className="alert-error">{t('checkout_error')}</div>}
      {failMsg && <div className="alert-error"><strong>{t('payment_declined')}</strong> — {failMsg}</div>}

      {/* Step 1 stays mounted so its values still post with the final submit. */}
      <section className={`space-y-4 ${step === 1 ? '' : 'hidden'}`}>
        {variants.length > 0 && (
          <Field label={`${option1 ?? t('choose_variant')}${option2 ? ' / ' + option2 : ''}`}>
            <select name="variant_id" className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {variants.map((v) => <option key={v.id} value={v.id} disabled={v.stock <= 0}>{v.label} — {formatSYP(v.price, lang)}{v.stock <= 0 ? ` (${t('sold_out')})` : ''}</option>)}
            </select>
          </Field>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('full_name')} error={err('buyer_name')}><input name="buyer_name" className="input" required /></Field>
          <Field label={t('phone')} error={err('buyer_phone')}><input name="buyer_phone" className="input" dir="ltr" required placeholder="09xxxxxxxx" /></Field>
        </div>
        <Field label={t('buyer_email_opt')} error={err('buyer_email')}><input name="buyer_email" type="email" className="input" dir="ltr" required={isDigital} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          {!isDigital && (
            <Field label={t('governorate')} error={err('governorate')}>
              <select name="governorate" className="input" value={gov} onChange={(e) => setGov(e.target.value)}>
                {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('quantity')}>
            <input name="quantity" type="number" min={1} max={isDigital ? 99 : available} className="input" dir="ltr"
              value={qty} onChange={(e) => setQty(Math.max(1, Math.min(isDigital ? 99 : available, parseInt(e.target.value) || 1)))} />
          </Field>
        </div>
        {/* A digital order has nowhere to ship to, so it posts placeholders instead of asking. */}
        {isDigital ? (
          <>
            <input type="hidden" name="governorate" value={DAMASCUS} />
            <input type="hidden" name="address" value="Digital delivery — no shipping address" />
          </>
        ) : (
          <Field label={t('address')} error={err('address')}>
            <textarea name="address" className="input" rows={2} required />
          </Field>
        )}
        <Field label={t('note')}><input name="note" className="input" /></Field>
        {!isDigital && <p className="text-xs text-ink-soft">{gov === DAMASCUS ? t('delivery_note_dmc') : t('delivery_note_out')}</p>}
        <button type="button" className="btn-cta w-full" onClick={() => setStep(2)}>{t('checkout_continue')}</button>
      </section>

      <section className={`space-y-4 ${step === 2 ? '' : 'hidden'}`}>
        <div className="space-y-2">
          {methods.map((m) => (
            <label key={m} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${method === m ? 'border-rose bg-rose-50' : 'border-ink/15'}`}>
              <input type="radio" name="payment_method" value={m} checked={method === m} onChange={() => setMethod(m)} className="accent-rose mt-0.5" />
              <span><strong className="text-sm">{t(`pm_${m}` as const)}</strong><span className="block text-xs text-ink-soft">{t(`pm_${m}_d` as const)}</span></span>
            </label>
          ))}
        </div>

        {method === 'bank_transfer' && (
          <div className="rounded-lg bg-mist p-4 text-sm">
            <h3 className="font-bold mb-2">{t('bank_details')}</h3>
            {bank.iban ? (
              <ul className="space-y-1" dir="ltr">
                {bank.name && <li><span className="text-ink-soft">{t('bank_name')}: </span>{bank.name}</li>}
                {bank.account && <li><span className="text-ink-soft">{t('bank_account_name')}: </span>{bank.account}</li>}
                <li><span className="text-ink-soft">{t('bank_iban')}: </span><code>{bank.iban}</code></li>
              </ul>
            ) : <p className="text-ink-soft">{t('bank_details_none')}</p>}
            {bank.note && <p className="mt-2 text-ink-soft">{bank.note}</p>}
          </div>
        )}

        {method === 'card' && (
          <div className="space-y-4">
            <Field label={t('card_number')} error={err('card_number')}><input name="card_number" className="input" dir="ltr" inputMode="numeric" autoComplete="cc-number" /></Field>
            <Field label={t('card_holder')} error={err('card_holder')}><input name="card_holder" className="input" autoComplete="cc-name" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('card_exp')} error={err('card_exp')}><input name="card_exp" className="input" dir="ltr" placeholder="12/29" autoComplete="cc-exp" /></Field>
              <Field label={t('card_cvc')} error={err('card_cvc')}><input name="card_cvc" className="input" dir="ltr" inputMode="numeric" maxLength={4} autoComplete="cc-csc" /></Field>
            </div>
            <p className="text-xs text-ink-soft">{t('secure_note')}</p>
          </div>
        )}

        <div className="rounded-lg bg-mist p-4 text-sm space-y-1">
          <h3 className="font-bold mb-1">{t('order_summary')}</h3>
          {variant && <div className="flex justify-between"><span>{t('variant_label')}</span><span>{variant.label}</span></div>}
          <div className="flex justify-between"><span>{t('subtotal')} ({qty})</span><span>{formatSYP(subtotal, lang)}</span></div>
          <div className="flex justify-between"><span>{t('delivery_fee')}</span><span>{formatSYP(fee, lang)}</span></div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-ink/10"><span>{t('total')}</span><span>{formatSYP(subtotal + fee, lang)}</span></div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" className="btn-secondary sm:w-auto" onClick={() => setStep(1)}>{t('checkout_back')}</button>
          <SubmitButton className="btn-cta flex-1 whitespace-nowrap" pendingText="…">{t('place_order')} · {formatSYP(subtotal + fee, lang)}</SubmitButton>
        </div>
      </section>
    </form>
  );
}

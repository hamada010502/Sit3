'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useFormState } from 'react-dom';
import { checkoutAction, previewCouponAction, type CheckoutState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { formatSYP } from '@/lib/money';
import { DAMASCUS, GOVERNORATES, type PaymentMethod, type ProductVariant } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

interface Account {
  name: string; phone: string; email: string;
  address: { governorate: string; address: string } | null;
}
interface Props {
  productId: string; basePrice: number; stock: number; isDigital: boolean;
  variants: ProductVariant[]; option1: string | null; option2: string | null;
  feeDamascus: number; feeOther: number; methods: PaymentMethod[];
  bank: { name: string; account: string; iban: string; note: string };
  /** Signed-in customer's saved info, purely to pre-fill — see spec §7/§11. Guests (the
   * default) get this as null and every field below just starts empty; nothing here
   * gates submission either way. */
  account: Account | null;
}

const KNOWN_FAILS = ['invalid_card', 'expired_card', 'insufficient_funds', 'provider_not_configured'];

/** Two steps at most (v2 §5.1): details, then payment. */
export function CheckoutForm({ productId, basePrice, stock, isDigital, variants, option1, option2, feeDamascus, feeOther, methods, bank, account }: Props) {
  const { t, lang } = useI18n();
  const [state, action] = useFormState(checkoutAction.bind(null, productId), null as CheckoutState | null);
  const detailsRef = useRef<HTMLElement>(null);
  // Fields live on step 1. If the server rejects one, go back there and focus it —
  // otherwise the buyer is left on step 2 with the problem hidden.
  useEffect(() => {
    const bad = state?.fields ? Object.keys(state.fields).filter((k) => k !== 'payment_method' && !k.startsWith('card_')) : [];
    if (bad.length) {
      setStep(1);
      requestAnimationFrame(() => (detailsRef.current?.querySelector(`[name="${bad[0]}"]`) as HTMLElement | null)?.focus());
    }
  }, [state]);
  // "Continue" validates step 1 first: a hidden invalid field would otherwise block
  // "Place order" with no visible reason.
  const continueToPayment = () => {
    const fields = Array.from(detailsRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select') ?? []);
    const firstBad = fields.find((f) => !f.checkValidity());
    if (firstBad) { firstBad.reportValidity(); firstBad.focus(); return; }
    setStep(2);
  };
  const [step, setStep] = useState<1 | 2>(1);
  const [qty, setQty] = useState(1);
  const [gov, setGov] = useState<string>(account?.address?.governorate ?? DAMASCUS);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cod');

  const variant = variants.find((v) => v.id === variantId);
  const unit = variant ? variant.price : basePrice;
  const available = variant ? variant.stock : stock;
  const fee = isDigital ? 0 : gov === DAMASCUS ? feeDamascus : feeOther;
  const subtotal = unit * qty;
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  // A discount depends on the goods value, so a change of quantity or variant needs a re-check.
  useEffect(() => { setCoupon(null); }, [qty, variantId]);
  const discount = coupon?.discount ?? 0;
  const applyCoupon = () => startCheck(async () => {
    const r = await previewCouponAction(productId, couponInput, variantId || null, qty);
    if (r.error) { setCoupon(null); setCouponErr(r.error); } else { setCoupon({ code: r.code!, discount: r.discount! }); setCouponErr(null); }
  });
  const err = (k: string) => (state?.fields?.[k] ? t('required') : undefined);
  const failMsg = !state?.error || state.error === 'checkout_error' ? null
    : state.error === 'qty_exceeds' ? t('qty_exceeds', { n: available })
    : state.error === 'variant_required' ? t('variant_required')
    : state.error === 'product_unavailable' ? t('product_unavailable')
    : state.error === 'coupon_invalid' || state.error === 'coupon_min' ? null
    : state.error === 'payment_method_unavailable' ? t('payment_method_unavailable')
    : KNOWN_FAILS.includes(state.error) ? t(`fail_${state.error}` as TKey) : t('fail_generic');

  return (
    <form action={action} className="card-pad space-y-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {([1, 2] as const).map((n) => (
          <span key={n} className={`flex items-center gap-2 ${step === n ? 'text-cherry' : 'text-ink-soft'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step === n ? 'bg-cherry text-white' : 'bg-ink/10'}`}>{n}</span>
            {t(n === 1 ? 'checkout_step1' : 'checkout_step2')}
            {n === 1 && <span className="text-ink-soft/50 mx-1">→</span>}
          </span>
        ))}
      </div>

      {state?.error === 'checkout_error' && <div className="alert-error">{t('checkout_error')}</div>}
      {failMsg && <div className="alert-error"><strong>{t('payment_declined')}</strong> — {failMsg}</div>}

      {account ? (
        <div className="alert-info text-sm">{t('checkout_signed_in_as', { name: account.name })}</div>
      ) : (
        <div className="rounded-lg border border-ink/10 bg-cream p-4 text-sm space-y-2">
          <p className="text-ink-soft">{t('checkout_guest_hint')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className="btn-secondary btn-sm">{t('login_btn')}</Link>
            <Link href="/account/register" className="btn-secondary btn-sm">{t('create_account_btn')}</Link>
            <span className="text-ink-soft self-center">{t('checkout_guest_or')}</span>
          </div>
        </div>
      )}

      {/* Step 1 stays mounted so its values still post with the final submit. */}
      <section ref={detailsRef} className={`space-y-4 ${step === 1 ? '' : 'hidden'}`}>
        {variant?.image_path && (
          <img src={variant.image_path} alt={variant.label} className="w-full max-h-64 object-contain rounded-xl bg-white border border-ink/10" data-testid="variant-image" />
        )}
        {variants.length > 0 && (
          <Field label={`${option1 ?? t('choose_variant')}${option2 ? ' / ' + option2 : ''}`}>
            <select name="variant_id" className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {variants.map((v) => <option key={v.id} value={v.id} disabled={v.stock <= 0}>{v.label} — {formatSYP(v.price, lang)}{v.stock <= 0 ? ` (${t('sold_out')})` : ''}</option>)}
            </select>
          </Field>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('full_name')} error={err('buyer_name')}><input name="buyer_name" className="input" required autoComplete="name" defaultValue={account?.name} /></Field>
          <Field label={t('phone')} error={err('buyer_phone')}><input name="buyer_phone" className="input" dir="ltr" required inputMode="tel" autoComplete="tel" pattern="\+?[0-9\s\-]{8,15}" title={t('phone_format_hint')} placeholder="09xxxxxxxx" defaultValue={account?.phone} /></Field>
        </div>
        <Field label={t('buyer_email_opt')} error={err('buyer_email')}><input name="buyer_email" type="email" className="input" dir="ltr" autoComplete="email" inputMode="email" required={isDigital} defaultValue={account?.email} /></Field>
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
            <textarea name="address" className="input" rows={2} required autoComplete="street-address" defaultValue={account?.address?.address} />
          </Field>
        )}
        <Field label={t('note')}><input name="note" className="input" /></Field>
        {!isDigital && <p className="text-xs text-ink-soft">{gov === DAMASCUS ? t('delivery_note_dmc') : t('delivery_note_out')}</p>}
        <button type="button" className="btn-cta w-full" onClick={continueToPayment}>{t('checkout_continue')}</button>
      </section>

      <section className={`space-y-4 ${step === 2 ? '' : 'hidden'}`}>
        <div className="space-y-2">
          {methods.map((m) => (
            <label key={m} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${method === m ? 'border-cherry bg-cherry/8' : 'border-ink/15'}`}>
              <input type="radio" name="payment_method" value={m} checked={method === m} onChange={() => setMethod(m)} className="accent-cherry mt-0.5" />
              <span><strong className="text-sm">{t(`pm_${m}` as const)}</strong><span className="block text-xs text-ink-soft">{t(`pm_${m}_d` as const)}</span></span>
            </label>
          ))}
        </div>

        {method === 'bank_transfer' && (
          <div className="rounded-lg bg-cream p-4 text-sm">
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

        <div className="space-y-2" data-testid="coupon-box">
          {(couponErr || state?.error === 'coupon_invalid' || state?.error === 'coupon_min') && (
            <div className="alert-error text-sm">{t((couponErr || state?.error) === 'coupon_min' ? 'coupon_min' : 'coupon_invalid')}</div>
          )}
          <div className="flex gap-2">
            <input className="input" dir="ltr" placeholder={t('coupon_placeholder')} value={couponInput} aria-label={t('coupon_placeholder')}
              onChange={(e) => setCouponInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }} />
            <button type="button" className="btn-secondary shrink-0" onClick={applyCoupon} disabled={checking || !couponInput.trim()}>{t('coupon_apply')}</button>
          </div>
        </div>

        <div className="rounded-lg bg-cream p-4 text-sm space-y-1">
          <h3 className="font-bold mb-1">{t('order_summary')}</h3>
          {discount > 0 && <input type="hidden" name="coupon_code" value={coupon!.code} />}
          {variant && <div className="flex justify-between"><span>{t('variant_label')}</span><span>{variant.label}</span></div>}
          <div className="flex justify-between"><span>{t('subtotal')} ({qty})</span><span>{formatSYP(subtotal, lang)}</span></div>
          {discount > 0 && <div className="flex justify-between text-success" data-testid="discount-line"><span>{t('discount')} ({coupon!.code})</span><span>− {formatSYP(discount, lang)}</span></div>}
          <div className="flex justify-between"><span>{t('delivery_fee')}</span><span>{formatSYP(fee, lang)}</span></div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-ink/10"><span>{t('total')}</span><span>{formatSYP(subtotal - discount + fee, lang)}</span></div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" className="btn-secondary sm:w-auto" onClick={() => setStep(1)}>{t('checkout_back')}</button>
          <SubmitButton className="btn-cta flex-1 whitespace-nowrap" pendingText="…">{t('place_order')} · {formatSYP(subtotal - discount + fee, lang)}</SubmitButton>
        </div>
      </section>
    </form>
  );
}

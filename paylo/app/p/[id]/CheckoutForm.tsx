'use client';
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { checkoutAction, type CheckoutState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { formatSYP } from '@/lib/money';
import { DAMASCUS, GOVERNORATES } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

interface Props { productId: string; price: number; stock: number; feeDamascus: number; feeOther: number; mock: boolean }

export function CheckoutForm({ productId, price, stock, feeDamascus, feeOther, mock }: Props) {
  const { t, lang } = useI18n();
  const [state, action] = useFormState(checkoutAction.bind(null, productId), null as CheckoutState | null);
  const [qty, setQty] = useState(1);
  const [gov, setGov] = useState<string>(DAMASCUS);
  const fee = gov === DAMASCUS ? feeDamascus : feeOther;
  const subtotal = price * qty;
  const err = (k: string) => (state?.fields?.[k] ? t('required') : undefined);
  const KNOWN_FAILS = ['invalid_card', 'expired_card', 'insufficient_funds', 'provider_not_configured'];
  const failMsg = !state?.error || state.error === 'checkout_error' ? null
    : state.error === 'qty_exceeds' ? t('qty_exceeds', { n: stock })
    : state.error === 'product_unavailable' ? t('product_unavailable')
    : KNOWN_FAILS.includes(state.error) ? t(`fail_${state.error}` as TKey) : t('fail_generic');

  return (
    <form action={action} className="card-pad space-y-6">
      <h2 className="text-xl font-bold">{t('checkout_title')}</h2>
      {state?.error === 'checkout_error' && <div className="alert-error">{t('checkout_error')}</div>}
      {failMsg && (
        <div className="alert-error">
          <strong>{t('payment_declined')}</strong> — {failMsg}
          <div className="mt-1 text-xs opacity-70">{t('try_again')}</div>
        </div>
      )}

      <section className="space-y-4">
        <h3 className="font-semibold text-bluewood/80">{t('delivery_info')}</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('full_name')} error={err('buyer_name')}><input name="buyer_name" className="input" required /></Field>
          <Field label={t('phone')} error={err('buyer_phone')}><input name="buyer_phone" className="input" dir="ltr" required placeholder="09xxxxxxxx" /></Field>
        </div>
        <Field label={t('buyer_email_opt')} error={err('buyer_email')}><input name="buyer_email" type="email" className="input" dir="ltr" /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('governorate')} error={err('governorate')}>
            <select name="governorate" className="input" value={gov} onChange={(e) => setGov(e.target.value)}>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
          </Field>
          <Field label={t('quantity')}>
            <input name="quantity" type="number" min={1} max={stock} className="input" value={qty} onChange={(e) => setQty(Math.min(stock, Math.max(1, parseInt(e.target.value) || 1)))} />
          </Field>
        </div>
        <Field label={t('address')} error={err('address')}><textarea name="address" className="input" rows={2} required /></Field>
        <Field label={t('note')}><input name="note" className="input" /></Field>
        <p className="text-xs text-bluewood/60">{gov === DAMASCUS ? t('delivery_note_dmc') : t('delivery_note_out')}</p>
      </section>

      <section className="space-y-4">
        <h3 className="font-semibold text-bluewood/80">{t('card_details')}</h3>
        {mock && <div className="alert-info text-xs">{t('mock_hint')}</div>}
        <Field label={t('card_number')} error={err('card_number')}><input name="card_number" className="input" dir="ltr" inputMode="numeric" autoComplete="cc-number" placeholder="5555 5555 5555 4444" required /></Field>
        <Field label={t('card_holder')} error={err('card_holder')}><input name="card_holder" className="input" autoComplete="cc-name" required /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('card_exp')} error={err('card_exp')}><input name="card_exp" className="input" dir="ltr" placeholder="12/28" autoComplete="cc-exp" required /></Field>
          <Field label={t('card_cvc')} error={err('card_cvc')}><input name="card_cvc" className="input" dir="ltr" inputMode="numeric" autoComplete="cc-csc" maxLength={4} required /></Field>
        </div>
        <p className="text-xs text-bluewood/50">{t('secure_note')}</p>
      </section>

      <section className="rounded-xl bg-karry/60 p-4 text-sm space-y-1">
        <div className="flex justify-between"><span>{t('subtotal')}</span><span>{formatSYP(subtotal, lang)}</span></div>
        <div className="flex justify-between"><span>{t('delivery_fee')}</span><span>{formatSYP(fee, lang)}</span></div>
        <div className="flex justify-between font-bold text-base pt-1 border-t border-bluewood/10"><span>{t('total')}</span><span>{formatSYP(subtotal + fee, lang)}</span></div>
      </section>
      <SubmitButton className="btn-primary w-full text-base py-3" pendingText="…">{t('pay_btn')} {formatSYP(subtotal + fee, lang)}</SubmitButton>
    </form>
  );
}

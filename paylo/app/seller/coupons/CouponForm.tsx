'use client';
import { useRef } from 'react';
import { useFormState } from 'react-dom';
import { createCouponAction, type CouponFormState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function CouponForm() {
  const { t } = useI18n();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useFormState(async (p: CouponFormState | null, fd: FormData) => {
    const r = await createCouponAction(p, fd);
    if (r.ok) ref.current?.reset();
    return r;
  }, null);
  return (
    <form ref={ref} action={action} className="card-pad space-y-4" data-testid="coupon-form">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label={t('coupon_code')}><input name="code" className="input uppercase" dir="ltr" required placeholder="EID20" /></Field>
        <Field label={t('coupon_kind')}>
          <select name="kind" className="input"><option value="percent">{t('coupon_percent')}</option><option value="fixed">{t('coupon_fixed')}</option></select>
        </Field>
        <Field label={t('coupon_value')}><input name="value" className="input" inputMode="numeric" dir="ltr" required /></Field>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label={t('coupon_min_subtotal')}><input name="min_subtotal" className="input" inputMode="numeric" dir="ltr" /></Field>
        <Field label={t('coupon_max_uses')}><input name="max_uses" className="input" inputMode="numeric" dir="ltr" /></Field>
        <Field label={t('coupon_expires')}><input name="expires_at" type="date" className="input" dir="ltr" /></Field>
      </div>
      <SubmitButton className="btn-primary">{t('coupon_create')}</SubmitButton>
    </form>
  );
}

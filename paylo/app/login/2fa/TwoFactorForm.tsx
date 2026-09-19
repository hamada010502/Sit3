'use client';
import { useFormState } from 'react-dom';
import { twoFactorAction } from '../actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';

export function TwoFactorForm() {
  const { t } = useI18n();
  const [state, action] = useFormState(twoFactorAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t('tfa_invalid')}</div>}
      <Field label={t('tfa_code')} hint={t('tfa_or_recovery')}>
        <input name="code" className="input font-mono tracking-[0.3em] text-center text-lg" dir="ltr" autoComplete="one-time-code" autoFocus required />
      </Field>
      <SubmitButton className="btn-primary w-full">{t('login_btn')}</SubmitButton>
    </form>
  );
}

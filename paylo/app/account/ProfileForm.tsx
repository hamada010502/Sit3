'use client';
import { useFormState } from 'react-dom';
import { updateProfileAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function ProfileForm({ name, phone, email }: { name: string; phone: string; email: string }) {
  const { t } = useI18n();
  const [state, action] = useFormState(updateProfileAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      {state?.ok && <div className="alert-success">{t('account_save_profile')}</div>}
      <Field label={t('full_name')}><input name="name" className="input" defaultValue={name} required /></Field>
      <Field label={t('phone')}><input name="phone" className="input" dir="ltr" defaultValue={phone} placeholder="09xxxxxxxx" /></Field>
      <Field label={t('email')}><input className="input bg-ink/5" value={email} disabled /></Field>
      <SubmitButton className="btn-primary">{t('account_save_profile')}</SubmitButton>
    </form>
  );
}

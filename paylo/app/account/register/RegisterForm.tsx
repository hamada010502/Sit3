'use client';
import { useFormState } from 'react-dom';
import Link from 'next/link';
import { registerAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function RegisterForm() {
  const { t } = useI18n();
  const [state, action] = useFormState(registerAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      <Field label={t('full_name')}><input name="name" className="input" required /></Field>
      <Field label={t('email')}><input name="email" type="email" className="input" required autoComplete="email" /></Field>
      <Field label={t('phone')}><input name="phone" className="input" dir="ltr" placeholder="09xxxxxxxx" autoComplete="tel" /></Field>
      <Field label={t('password')} hint={t('password_hint')}><input name="password" type="password" className="input" required minLength={8} autoComplete="new-password" /></Field>
      <SubmitButton className="btn-primary w-full">{t('register_btn')}</SubmitButton>
      <p className="text-sm text-center text-ink-soft">
        {t('register_already')} <Link href="/login" className="text-cherry font-semibold">{t('login_btn')}</Link>
      </p>
    </form>
  );
}

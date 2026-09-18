'use client';
import Link from 'next/link';
import { useFormState } from 'react-dom';
import { loginAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';

export function LoginForm() {
  const { t } = useI18n();
  const [state, action] = useFormState(loginAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t('login_error')}</div>}
      <Field label={t('email')}><input name="email" type="email" className="input" required autoComplete="email" /></Field>
      <Field label={t('password')}><input name="password" type="password" className="input" required autoComplete="current-password" /></Field>
      <SubmitButton className="btn-primary w-full">{t('login_btn')}</SubmitButton>
      <p className="text-sm text-center text-bluewood/60">
        <Link href="/apply" className="text-crusta font-semibold">{t('nav_apply')}</Link>
      </p>
    </form>
  );
}

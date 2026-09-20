'use client';
import { useFormState } from 'react-dom';
import { applyAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { GOVERNORATES } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

export function ApplyForm() {
  const { t } = useI18n();
  const [state, action] = useFormState(applyAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('full_name')}><input name="name" className="input" required /></Field>
        <Field label={t('email')}><input name="email" type="email" className="input" required /></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('phone')}><input name="phone" className="input" dir="ltr" required placeholder="09xxxxxxxx" /></Field>
        <Field label={t('national_id')} hint={t('national_id_hint')}><input name="national_id" className="input" dir="ltr" required /></Field>
      </div>
      <Field label={t('password')} hint={t('password_hint')}><input name="password" type="password" className="input" required minLength={8} /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('store_name')}><input name="store_name" className="input" required /></Field>
        <Field label={t('store_slug')} hint="paylo.sy/s/your-store"><input name="slug" className="input" dir="ltr" pattern="[A-Za-z0-9\-]+" /></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('instagram')}><input name="instagram" className="input" dir="ltr" placeholder="@yourstore" /></Field>
        <Field label={t('governorate')}>
          <select name="governorate" className="input" required defaultValue="Damascus">{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        </Field>
      </div>
      <Field label={t('bio')}><textarea name="bio" className="input" rows={3} /></Field>
      <SubmitButton className="btn-primary w-full">{t('apply_btn')}</SubmitButton>
    </form>
  );
}

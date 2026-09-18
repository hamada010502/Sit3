'use client';
import { useFormState } from 'react-dom';
import { saveSettingsAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { GOVERNORATES, type Seller } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

export function SettingsForm({ seller }: { seller: Seller }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveSettingsAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      {state?.ok && <div className="alert-success">{t('settings_saved')}</div>}
      <Field label={t('store_name')}><input name="store_name" className="input" required defaultValue={seller.store_name} /></Field>
      <Field label={t('store_slug')}><input className="input bg-bluewood/5" dir="ltr" value={seller.slug} readOnly /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('instagram')}><input name="instagram" className="input" dir="ltr" defaultValue={seller.instagram ?? ''} /></Field>
        <Field label={t('phone')}><input name="phone" className="input" dir="ltr" required defaultValue={seller.phone} /></Field>
      </div>
      <Field label={t('governorate')}><select name="governorate" className="input" defaultValue={seller.governorate}>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
      <Field label={t('bio')}><textarea name="bio" className="input" rows={3} defaultValue={seller.bio ?? ''} /></Field>
      <Field label={t('payout_details')} hint={t('payout_details_hint')}><textarea name="payout_details" className="input" rows={3} defaultValue={seller.payout_details ?? ''} /></Field>
      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}

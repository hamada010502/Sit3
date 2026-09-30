'use client';
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
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
    <form action={action} className="card-pad space-y-4" encType="multipart/form-data" data-testid="store-settings-form">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      {state?.ok && <div className="alert-success">{t('settings_saved')}</div>}
      <Field label={t('store_name')}><input name="store_name" className="input" required defaultValue={seller.store_name} /></Field>
      <Field label={t('store_slug')}><input className="input" dir="ltr" value={seller.slug} readOnly disabled /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('instagram')}><input name="instagram" className="input" dir="ltr" defaultValue={seller.instagram ?? ''} /></Field>
        <Field label={t('phone')}><input name="phone" className="input" dir="ltr" required defaultValue={seller.phone} /></Field>
      </div>
      <Field label={t('governorate')}>
        <select name="governorate" className="input" defaultValue={seller.governorate}>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
      </Field>
      <Field label={t('bio')}><textarea name="bio" className="input" rows={2} defaultValue={seller.bio ?? ''} /></Field>
      <Field label={t('store_announcement')} hint={t('store_announcement_hint')}>
        <input name="announcement" className="input" maxLength={160} defaultValue={seller.announcement ?? ''} placeholder={t('store_announcement_ph')} />
      </Field>
      <Field label={t('thank_you_label')} hint={t('thank_you_hint')}>
        <textarea name="thank_you_message" className="input" rows={3} maxLength={500} defaultValue={seller.thank_you_message ?? ''} placeholder={t('thank_you_ph')} />
      </Field>
      <Field label={t('store_about')} hint={t('store_about_builder_hint')}>
        <textarea name="about" className="input" rows={3} defaultValue={seller.about ?? ''} />
      </Field>
      <Link href="/seller/settings/about" className="link text-sm inline-block">{t('about_builder_open')} →</Link>
      <div className="grid sm:grid-cols-2 gap-4">
        {(['logo', 'banner'] as const).map((k) => {
          const cur = k === 'logo' ? seller.logo_path : seller.banner_path;
          return (
            <Field key={k} label={t(k === 'logo' ? 'store_logo' : 'store_banner')}>
              {cur && (
                <div className="flex items-center gap-3 mb-2">
                  <img src={cur} alt="" className={k === 'logo' ? 'h-12 w-12 rounded-full object-cover' : 'h-12 w-28 rounded object-cover'} data-testid={`${k}-preview`} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`remove_${k}`} className="accent-cherry" />{t('remove')}</label>
                </div>
              )}
              <input name={k} type="file" accept="image/jpeg,image/png,image/webp" className="input" />
            </Field>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="visible" defaultChecked={!!seller.visible} className="accent-cherry h-4 w-4" />
        <span><strong>{t('store_visible')}</strong> — <span className="text-ink-soft">{t('store_visible_hint')}</span></span>
      </label>
      <Field label={t('payout_details')} hint={t('payout_details_hint')}><textarea name="payout_details" className="input" rows={3} defaultValue={seller.payout_details ?? ''} /></Field>
      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}

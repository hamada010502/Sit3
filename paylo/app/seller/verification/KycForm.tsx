'use client';
import { useFormState } from 'react-dom';
import { submitKycAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function KycForm({ seller }: { seller: { legal_name: string | null; national_id: string | null; has_doc: boolean; status: string } }) {
  const { t } = useI18n();
  const [state, action] = useFormState(submitKycAction, null);
  return (
    <form action={action} className="card-pad space-y-4" encType="multipart/form-data">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      {(state?.ok || seller.status === 'submitted') && <div className="alert-info">{t('kyc_submitted_note')}</div>}
      <Field label={t('kyc_legal_name')}><input name="legal_name" className="input" required defaultValue={seller.legal_name ?? ''} /></Field>
      <Field label={t('kyc_national_id')}><input name="national_id" className="input" dir="ltr" required defaultValue={seller.national_id ?? ''} /></Field>
      <Field label={t('kyc_doc')} hint={seller.has_doc ? t('kyc_submitted') : undefined}>
        <input name="doc" type="file" accept="image/jpeg,image/png,image/webp" className="input" />
      </Field>
      <SubmitButton className="btn-primary">{t('kyc_submit')}</SubmitButton>
    </form>
  );
}

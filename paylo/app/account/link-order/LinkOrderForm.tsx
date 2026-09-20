'use client';
import { useFormState } from 'react-dom';
import { confirmClaimAction, requestClaimAction, type ClaimState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function LinkOrderForm() {
  const { t } = useI18n();
  const [requestState, requestAction] = useFormState(requestClaimAction, null as ClaimState | null);
  const [confirmState, confirmAction] = useFormState(confirmClaimAction, null as ClaimState | null);

  if (confirmState?.ok) return <div className="alert-success">{t('account_link_order_success')}</div>;

  if (requestState?.codeSent) {
    return (
      <form action={confirmAction} className="card-pad space-y-4">
        <input type="hidden" name="code" value={requestState.code} />
        {confirmState?.error && <div className="alert-error">{t(confirmState.error as TKey)}</div>}
        <p className="text-sm text-ink-soft">{t('account_link_order_code_sent')}</p>
        <Field label={t('account_link_order_code_label')}><input name="verify_code" className="input" dir="ltr" inputMode="numeric" maxLength={6} required /></Field>
        <SubmitButton className="btn-primary">{t('account_link_order_confirm')}</SubmitButton>
      </form>
    );
  }

  return (
    <form action={requestAction} className="card-pad space-y-4">
      {requestState?.error && <div className="alert-error">{t(requestState.error as TKey)}</div>}
      <p className="text-sm text-ink-soft">{t('account_link_order_intro')}</p>
      <Field label={t('account_link_order_code')}><input name="code" className="input" dir="ltr" required placeholder="PL-XXXXXXXX" /></Field>
      <Field label={t('account_link_order_contact')}><input name="contact" className="input" dir="ltr" required /></Field>
      <SubmitButton className="btn-primary">{t('account_link_order_send_code')}</SubmitButton>
    </form>
  );
}

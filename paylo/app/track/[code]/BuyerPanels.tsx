'use client';
import { useFormState } from 'react-dom';
import { openDisputeAction, requestAddressAction, submitTransferAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { GOVERNORATES } from '@/lib/types';

const REASONS = ['not_received', 'damaged', 'wrong_item', 'other'] as const;

export function TransferPanel({ code, total, bank, status }: { code: string; total: string; status: string; bank: { name: string; account: string; iban: string; note: string } }) {
  const { t } = useI18n();
  const [state, action] = useFormState(submitTransferAction.bind(null, code), null);
  return (
    <form action={action} className="card-pad mb-6 border-warn/30 bg-warn/5 space-y-4" encType="multipart/form-data">
      <div>
        <h2 className="text-lg font-bold">{t('bt_title')}</h2>
        <p className="text-sm text-ink-soft mt-1">{t('bt_instructions')}</p>
      </div>
      {state?.error && <div className="alert-error">{state.error}</div>}
      {status === 'submitted' && <div className="alert-info">{t('bt_submitted')}</div>}
      {status === 'rejected' && <div className="alert-error">{t('bt_rejected')}</div>}
      <div className="rounded-lg bg-white p-3 text-sm" dir="ltr">
        <div className="font-bold">{total}</div>
        {bank.name && <div><span className="text-ink-soft">{t('bank_name')}: </span>{bank.name}</div>}
        {bank.account && <div><span className="text-ink-soft">{t('bank_account_name')}: </span>{bank.account}</div>}
        {bank.iban ? <div><span className="text-ink-soft">{t('bank_iban')}: </span><code>{bank.iban}</code></div> : <div className="text-ink-soft">{t('bank_details_none')}</div>}
        {bank.note && <p className="mt-1 text-ink-soft">{bank.note}</p>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('bt_reference')}><input name="reference" className="input" dir="ltr" /></Field>
        <Field label={t('bt_proof')}><input name="proof" type="file" accept="image/jpeg,image/png,image/webp" className="input" /></Field>
      </div>
      <SubmitButton className="btn-primary">{t('bt_submit')}</SubmitButton>
    </form>
  );
}

export function AddressPanel({ code, governorate, address }: { code: string; governorate: string; address: string }) {
  const { t } = useI18n();
  const [state, action] = useFormState(requestAddressAction.bind(null, code), null);
  return (
    <details className="card-pad mb-6">
      <summary className="cursor-pointer font-semibold">{t('ac_title')}</summary>
      <form action={action} className="mt-4 space-y-3">
        {state?.error && <div className="alert-error">{state.error}</div>}
        {state?.ok && <div className="alert-success">{t('ac_pending')}</div>}
        <p className="text-sm text-ink-soft">{t('ac_hint')}</p>
        <Field label={t('governorate')}>
          <select name="governorate" className="input" defaultValue={governorate}>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        </Field>
        <Field label={t('address')}><textarea name="address" className="input" rows={2} defaultValue={address} required /></Field>
        <SubmitButton className="btn-secondary">{t('ac_submit')}</SubmitButton>
      </form>
    </details>
  );
}

export function ReturnPanel({ code, delivered }: { code: string; delivered: boolean }) {
  const { t } = useI18n();
  const [state, action] = useFormState(openDisputeAction.bind(null, code), null);
  return (
    <details className="card-pad mb-6">
      <summary className="cursor-pointer font-semibold text-cherry">{delivered ? t('return_open') : t('return_open_pre')}</summary>
      <form action={action} className="mt-4 space-y-3">
        {state?.error && <div className="alert-error">{state.error}</div>}
        <Field label={t('dispute_reason')}>
          <select name="reason" className="input">{REASONS.map((r) => <option key={r} value={r}>{t(`dr_${r}` as const)}</option>)}</select>
        </Field>
        <Field label={t('dispute_desc')}><textarea name="description" className="input" rows={3} /></Field>
        <SubmitButton className="btn-danger">{t('dispute_submit')}</SubmitButton>
      </form>
    </details>
  );
}

'use client';
import { useEffect } from 'react';
import { useFormState } from 'react-dom';
import { addAddressAction, updateAddressAction, type AddressState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import { GOVERNORATES, type CustomerAddress } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

export function AddressForm({ existing, onDone }: { existing?: CustomerAddress; onDone?: () => void }) {
  const { t } = useI18n();
  const boundAction = existing ? updateAddressAction.bind(null, existing.id) : addAddressAction;
  const [state, action] = useFormState(boundAction, null as AddressState | null);
  // Close/collapse the form once the save actually succeeds, instead of leaving it open
  // to be resubmitted with stale field values on a second click.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone is a stable close-form callback, not reactive state
  useEffect(() => { if (state?.ok) onDone?.(); }, [state]);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      <Field label={t('address_label')} hint={t('address_label_hint')}><input name="label" className="input" defaultValue={existing?.label ?? ''} /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('full_name')}><input name="full_name" className="input" required defaultValue={existing?.full_name} /></Field>
        <Field label={t('phone')}><input name="phone" className="input" dir="ltr" required defaultValue={existing?.phone} placeholder="09xxxxxxxx" /></Field>
      </div>
      <Field label={t('governorate')}>
        <select name="governorate" className="input" required defaultValue={existing?.governorate ?? 'Damascus'}>
          {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </Field>
      <Field label={t('address')}><textarea name="address" className="input" rows={2} required defaultValue={existing?.address} /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="make_default" className="accent-cherry h-4 w-4" defaultChecked={!!existing?.is_default} />
        {t('make_default_address')}
      </label>
      <div className="flex gap-3">
        <SubmitButton className="btn-primary">{existing ? t('account_edit_address') : t('account_add_address')}</SubmitButton>
        {onDone && <button type="button" className="btn-secondary" onClick={onDone}>{t('checkout_back')}</button>}
      </div>
    </form>
  );
}

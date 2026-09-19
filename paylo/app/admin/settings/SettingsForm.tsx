'use client';
import { useFormState } from 'react-dom';
import { saveAdminSettingsAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function AdminSettingsForm({ s, cardEnvEnabled }: { s: Record<string, string>; cardEnvEnabled: boolean }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveAdminSettingsAction, null);
  const Check = ({ name, label, disabled, hint }: { name: string; label: string; disabled?: boolean; hint?: string }) => (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" name={name} defaultChecked={s[name] === '1'} disabled={disabled} className="accent-cherry h-4 w-4 mt-0.5" />
      <span>{label}{hint && <span className="block text-xs text-ink-soft">{hint}</span>}</span>
    </label>
  );

  return (
    <form action={action} className="space-y-5">
      {state?.ok && <div className="alert-success">{t('settings_saved')}</div>}

      <div className="card-pad space-y-4">
        <h2 className="font-bold">{t('commission')}</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label={t('commission_rate')}><input name="commission_rate" type="number" step="0.01" min={0} max={100} className="input" dir="ltr" defaultValue={s.commission_rate} /></Field>
          <Field label={t('commission_fixed_fee')}><input name="commission_fixed_fee" type="number" min={0} className="input" dir="ltr" defaultValue={s.commission_fixed_fee} /></Field>
          <Field label={t('commission_vat_rate')}><input name="commission_vat_rate" type="number" step="0.01" min={0} max={100} className="input" dir="ltr" defaultValue={s.commission_vat_rate} /></Field>
        </div>
      </div>

      <div className="card-pad space-y-4">
        <h2 className="font-bold">{t('payment_methods')}</h2>
        <Check name="cod_enabled" label={t('cod_enabled')} />
        <Check name="bank_transfer_enabled" label={t('bank_transfer_enabled')} />
        <Check name="card_enabled" label={t('card_enabled')} disabled={!cardEnvEnabled} hint={t('card_gate_note')} />
        <div className="grid sm:grid-cols-2 gap-4 pt-2">
          <Field label={t('bank_name')}><input name="bank_name" className="input" defaultValue={s.bank_name} /></Field>
          <Field label={t('bank_account_name')}><input name="bank_account_name" className="input" defaultValue={s.bank_account_name} /></Field>
        </div>
        <Field label={t('bank_iban')}><input name="bank_iban" className="input" dir="ltr" defaultValue={s.bank_iban} /></Field>
        <Field label={t('bank_note')}><textarea name="bank_note" className="input" rows={2} defaultValue={s.bank_note} /></Field>
      </div>

      <div className="card-pad space-y-4">
        <h2 className="font-bold">{t('fulfillment')}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('delivery_fee_damascus')}><input name="delivery_fee_damascus" type="number" min={0} className="input" dir="ltr" defaultValue={s.delivery_fee_damascus} /></Field>
          <Field label={t('delivery_fee_other')}><input name="delivery_fee_other" type="number" min={0} className="input" dir="ltr" defaultValue={s.delivery_fee_other} /></Field>
        </div>
        <Field label={t('logistics_partner_name')}><input name="logistics_partner_name" className="input" defaultValue={s.logistics_partner_name} /></Field>
        <Check name="yalla_go_enabled" label={t('yalla_go_enabled')} />
        <Field label={t('address_change_window_hours')}><input name="address_change_window_hours" type="number" min={0} max={720} className="input" dir="ltr" defaultValue={s.address_change_window_hours} /></Field>
      </div>

      <div className="card-pad space-y-4">
        <h2 className="font-bold">{t('payouts_title')}</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label={t('payout_cutoff_day')}>
            <select name="payout_cutoff_day" className="input" defaultValue={s.payout_cutoff_day}>
              {DAYS.map((d) => <option key={d} value={d}>{t(`weekday_${d}` as TKey)}</option>)}</select>
          </Field>
          <Field label={t('payout_cutoff_hour')}><input name="payout_cutoff_hour" type="number" min={0} max={23} className="input" dir="ltr" defaultValue={s.payout_cutoff_hour} /></Field>
          <Field label={t('payout_transfer_day')}>
            <select name="payout_transfer_day" className="input" defaultValue={s.payout_transfer_day}>
              {DAYS.map((d) => <option key={d} value={d}>{t(`weekday_${d}` as TKey)}</option>)}</select>
          </Field>
        </div>
        <Field label={t('payout_eligibility')}>
          <select name="payout_eligibility" className="input" defaultValue={s.payout_eligibility}>
            <option value="on_close">{t('pe_on_close')}</option>
            <option value="on_delivery">{t('pe_on_delivery')}</option>
          </select>
        </Field>
      </div>

      <div className="card-pad space-y-3">
        <h2 className="font-bold">{t('notif_title')}</h2>
        <Check name="notify_email" label={t('notify_email')} />
        <Check name="notify_sms" label={t('notify_sms')} />
      </div>

      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}

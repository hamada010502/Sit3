'use client';
import { useFormState } from 'react-dom';
import { saveAdminSettingsAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { Field } from '@/components/Field';
import { SubmitButton } from '@/components/SubmitButton';

export function AdminSettingsForm({ s }: { s: Record<string, string> }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveAdminSettingsAction, null);
  return (
    <form action={action} className="card-pad space-y-4">
      {state?.ok && <div className="alert-success">{t('settings_saved')}</div>}
      <Field label={t('commission_rate')}><input name="commission_rate" type="number" step="0.1" min={0} max={100} className="input" dir="ltr" defaultValue={s.commission_rate} /></Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={t('delivery_fee_damascus')}><input name="delivery_fee_damascus" type="number" min={0} className="input" dir="ltr" defaultValue={s.delivery_fee_damascus} /></Field>
        <Field label={t('delivery_fee_other')}><input name="delivery_fee_other" type="number" min={0} className="input" dir="ltr" defaultValue={s.delivery_fee_other} /></Field>
      </div>
      <Field label={t('payout_hold_days')}><input name="payout_hold_days" type="number" min={0} max={60} className="input" dir="ltr" defaultValue={s.payout_hold_days} /></Field>
      <Field label={t('logistics_partner_name')}><input name="logistics_partner_name" className="input" defaultValue={s.logistics_partner_name} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="yalla_go_enabled" defaultChecked={s.yalla_go_enabled === '1'} className="accent-crusta h-4 w-4" />{t('yalla_go_enabled')}</label>
      <SubmitButton>{t('save')}</SubmitButton>
    </form>
  );
}

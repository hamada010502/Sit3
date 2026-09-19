'use client';
import { useFormState } from 'react-dom';
import { handOffAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';

export function HandOffForm({ orderId, pickup }: { orderId: string; pickup: boolean }) {
  const { t } = useI18n();
  const [state, action] = useFormState(handOffAction.bind(null, orderId), null);
  return (
    <form action={action} className="card-pad border-cherry/30 bg-cherry/8/60">
      <h2 className="text-lg font-bold">{t('hand_off_title')}</h2>
      <p className="text-sm text-ink-soft mt-1 mb-3">{pickup ? t('hand_off_hint_out') : t('hand_off_hint_dmc')}</p>
      {state?.error && <div className="alert-error mb-3">{state.error}</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">{t('hand_off_ref')}</label><input name="ref" className="input" /></div>
        <div><label className="label">{t('tracking_number')}</label><input name="tracking" className="input" dir="ltr" /></div>
      </div>
      <SubmitButton className="btn-primary mt-4">{t('hand_off_btn')}</SubmitButton>
    </form>
  );
}

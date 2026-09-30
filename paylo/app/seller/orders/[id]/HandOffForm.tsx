'use client';
import { useFormState } from 'react-dom';
import { handOffAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';

export function HandOffForm({ orderId, pickup }: { orderId: string; pickup: boolean }) {
  const { t } = useI18n();
  const [state, action] = useFormState(handOffAction.bind(null, orderId), null);
  return (
    <form action={action} className="card-pad border-cherry/30 bg-cherry/5" data-testid="handoff-form">
      <h2 className="text-lg font-bold">{t('hand_off_title')}</h2>
      <p className="text-sm text-ink-soft mt-1 mb-4">{pickup ? t('hand_off_hint_out') : t('hand_off_hint_dmc')}</p>
      {state?.error && <div className="alert-error mb-3" role="alert">{state.error === 'tracking_required' ? t('tracking_required') : state.error}</div>}
      <label className="label" htmlFor="ho-tracking">{t('tracking_cargo_number')}</label>
      <input id="ho-tracking" name="tracking" required maxLength={80} className="input font-mono text-lg" dir="ltr" autoComplete="off" inputMode="text" />
      <p className="text-xs text-ink-soft mt-1">{pickup ? t('tracking_cargo_hint_out') : t('tracking_cargo_hint_dmc')}</p>
      <SubmitButton className="btn-primary mt-4 w-full sm:w-auto">{t('hand_off_btn')}</SubmitButton>
    </form>
  );
}

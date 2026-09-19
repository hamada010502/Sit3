'use client';
/* eslint-disable @next/next/no-img-element */
import { useFormState } from 'react-dom';
import { disableTfaAction, enableTfaAction, type TfaState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function TwoFactorPanel({ enabled, secret, qr }: { enabled: boolean; secret: string | null; qr: string | null }) {
  const { t } = useI18n();
  const [onState, enable] = useFormState(enableTfaAction, null as TfaState | null);
  const [offState, disable] = useFormState(disableTfaAction, null as TfaState | null);
  const state = enabled ? offState : onState;

  return (
    <div className="space-y-5">
      <div className="card-pad flex items-center justify-between gap-4">
        <span className="font-semibold">{enabled ? t('tfa_on') : t('tfa_off')}</span>
        <span className={`badge ${enabled ? 'bg-success/12 text-success' : 'bg-warn/12 text-warn'}`}>{enabled ? t('yes') : t('no')}</span>
      </div>

      {onState?.recovery && (
        <div className="card-pad border-success/30 bg-success/5">
          <h2 className="font-bold">{t('tfa_recovery')}</h2>
          <p className="text-sm text-ink-soft mt-1 mb-3">{t('tfa_recovery_note')}</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm" dir="ltr">
            {onState.recovery.map((c) => <li key={c} className="rounded bg-white border border-ink/10 px-2 py-1.5 text-center">{c}</li>)}
          </ul>
        </div>
      )}

      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      {state?.ok && !onState?.recovery && <div className="alert-success">{t(state.ok as TKey)}</div>}

      {!enabled ? (
        <form action={enable} className="card-pad space-y-4">
          <h2 className="font-bold">{t('tfa_step1')}</h2>
          {qr && <img src={qr} alt="" width={220} height={220} className="rounded-lg border border-ink/10" />}
          {secret && (
            <div>
              <label className="label">{t('tfa_manual')}</label>
              <code className="block break-all rounded bg-mist px-3 py-2 text-sm" dir="ltr">{secret}</code>
            </div>
          )}
          <div>
            <label className="label">{t('tfa_code')}</label>
            <input name="code" className="input font-mono tracking-[0.3em] text-center" dir="ltr" inputMode="numeric" maxLength={6} required />
          </div>
          <SubmitButton className="btn-primary">{t('tfa_verify')}</SubmitButton>
        </form>
      ) : (
        <form action={disable} className="card-pad space-y-4">
          <div>
            <label className="label">{t('tfa_code')}</label>
            <input name="code" className="input font-mono tracking-[0.3em] text-center" dir="ltr" inputMode="numeric" maxLength={6} required />
          </div>
          <SubmitButton className="btn-danger">{t('tfa_disable')}</SubmitButton>
        </form>
      )}
    </div>
  );
}

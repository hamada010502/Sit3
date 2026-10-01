'use client';
import { useFormState } from 'react-dom';
import { approveAction, rejectAction, requestInfoAction, type RegActionState } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
import { useI18n } from '@/lib/i18n/client';
import type { TKey } from '@/lib/i18n';
import type { RegistrationStatus } from '@/lib/types';

export function RegistrationActions({ id, status, reviewReady }: { id: string; status: RegistrationStatus; reviewReady: boolean }) {
  const { t } = useI18n();
  const [approveState, approve] = useFormState(approveAction.bind(null, id), null as RegActionState | null);
  const [rejectState, reject] = useFormState(rejectAction.bind(null, id), null as RegActionState | null);
  const [infoState, requestInfo] = useFormState(requestInfoAction.bind(null, id), null as RegActionState | null);
  const err = (e?: string) => (e ? t((`rg_err_${e}`) as TKey) : null);

  if (status === 'APPROVED' || status === 'REJECTED') {
    return <div className="alert-info">{t('rg_closed')}</div>;
  }

  return (
    <div className="space-y-5">
      {approveState?.error && <div className="alert-error">{err(approveState.error)}</div>}
      <form action={approve} className="card-pad border-success/25 bg-success/5" data-testid="approve-form">
        <h3 className="font-bold">{t('rg_approve')}</h3>
        <p className="text-sm text-ink-soft mt-1 mb-3">{t('rg_approve_d')}</p>
        {!reviewReady && <p className="text-sm text-warn font-medium mb-3" data-testid="review-needed">{t('rg_review_needed')}</p>}
        <SubmitButton className="btn-primary">{t('rg_approve_btn')}</SubmitButton>
      </form>

      {infoState?.error && <div className="alert-error">{err(infoState.error)}</div>}
      <form action={requestInfo} className="card-pad border-warn/25 bg-warn/5 space-y-3">
        <h3 className="font-bold">{t('rg_more_info')}</h3>
        <p className="text-sm text-ink-soft">{t('rg_more_info_d')}</p>
        <textarea name="note" className="input" rows={3} required placeholder={t('rg_more_info_ph')} />
        <SubmitButton className="btn-secondary">{t('rg_more_info_btn')}</SubmitButton>
      </form>

      {rejectState?.error && <div className="alert-error">{err(rejectState.error)}</div>}
      <form action={reject} className="card-pad border-danger/25 bg-danger/5 space-y-3">
        <h3 className="font-bold">{t('rg_reject')}</h3>
        <textarea name="note" className="input" rows={3} required placeholder={t('rg_reject_ph')} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notify" className="accent-brand h-4 w-4" defaultChecked />
          {t('rg_notify_applicant')}
        </label>
        <SubmitButton className="btn-danger">{t('rg_reject')}</SubmitButton>
      </form>
    </div>
  );
}

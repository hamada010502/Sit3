'use client';
import { useFormState } from 'react-dom';
import { setSellerStatusAction, type SellerActionState } from '../actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';
import type { SellerStatus } from '@/lib/types';
import type { TKey } from '@/lib/i18n';

export function SellerDecision({ sellerId, status, reviewNote }: { sellerId: string; status: SellerStatus; reviewNote: string | null }) {
  const { t } = useI18n();
  const primary: SellerStatus = status === 'approved' ? 'suspended' : 'approved';
  const [state, act] = useFormState(setSellerStatusAction.bind(null, sellerId, primary), null as SellerActionState | null);
  const [rejState, reject] = useFormState(setSellerStatusAction.bind(null, sellerId, 'rejected'), null as SellerActionState | null);
  const err = state?.error || rejState?.error;

  return (
    <div className="card-pad space-y-3">
      {reviewNote && <div className="alert-info text-sm"><strong>{t('review_note')}:</strong> {reviewNote}</div>}
      {err && <div className="alert-error">{t(err as TKey)}</div>}
      <label className="label">{t('admin_note')}</label>
      <form action={act} className="flex gap-2">
        <input name="note" className="input" placeholder={t('a_note_ph')} />
        <SubmitButton className={`${primary === 'approved' ? 'btn-primary' : 'btn-danger'} shrink-0`}>
          {primary === 'approved' ? (status === 'pending' ? t('approve') : t('reinstate')) : t('suspend')}
        </SubmitButton>
      </form>
      {status === 'pending' && (
        <form action={reject} className="flex gap-2">
          <input name="note" className="input" placeholder={t('a_note_ph')} />
          <SubmitButton className="btn-danger shrink-0">{t('reject')}</SubmitButton>
        </form>
      )}
    </div>
  );
}

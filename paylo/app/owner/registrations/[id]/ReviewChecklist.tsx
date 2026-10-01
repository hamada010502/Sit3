'use client';
import { useFormState } from 'react-dom';
import { saveReviewAction } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
import { useI18n } from '@/lib/i18n/client';
import type { RegistrationReview, ReviewCheck } from '@/lib/registration';

const CHECKS: ReviewCheck[] = ['photo_readable', 'name_matches', 'id_matches', 'face_visible', 'not_duplicate'];

/** The owner's manual checklist. Approval is refused until every item is Yes (or N/A where allowed). */
export function ReviewChecklist({ id, review, closed }: { id: string; review: RegistrationReview; closed: boolean }) {
  const { t } = useI18n();
  const [state, action] = useFormState(saveReviewAction.bind(null, id), null);
  return (
    <form action={action} className="card-pad space-y-3" data-testid="review-checklist">
      <h2 className="font-semibold">{t('rv_title')}</h2>
      <p className="text-xs text-ink-soft">{t('rv_sub')}</p>
      {state?.ok && <div className="alert-success">{t('settings_saved')}</div>}
      <fieldset disabled={closed} className="space-y-2">
        {CHECKS.map((k) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/5 pb-2" data-check={k}>
            <span className="text-sm">{t(`rv_${k}`)}</span>
            <span className="flex gap-3 text-sm">
              {(['yes', 'no', 'na'] as const).filter((v) => !(k === 'not_duplicate' && v === 'na')).map((v) => (
                <label key={v} className="flex items-center gap-1 tap-inline">
                  <input type="radio" name={k} value={v} defaultChecked={review.checks[k] === v} className="accent-cherry" />{t(`rv_${v}`)}
                </label>
              ))}
            </span>
          </div>
        ))}
        <label className="block text-sm">
          <span className="text-ink-soft">{t('rv_notes')}</span>
          <textarea name="review_notes" className="input mt-1" rows={3} defaultValue={review.notes ?? ''} />
        </label>
        {!closed && <SubmitButton className="btn-secondary">{t('rv_save')}</SubmitButton>}
      </fieldset>
      {review.updated_at && <p className="text-xs text-ink-soft" dir="ltr">{t('rv_saved_at', { at: review.updated_at })}</p>}
    </form>
  );
}

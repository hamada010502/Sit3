'use client';
import { useRef } from 'react';
import { useFormState } from 'react-dom';
import { createCollectionAction } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

export function CollectionForm() {
  const { t } = useI18n();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useFormState(async (p: { error?: string } | null, fd: FormData) => {
    const r = await createCollectionAction(p, fd);
    if (!r.error) ref.current?.reset();
    return r;
  }, null);
  return (
    <form ref={ref} action={action} className="card-pad space-y-3" data-testid="collection-form">
      {state?.error && <div className="alert-error">{t(state.error as TKey)}</div>}
      <div className="flex gap-2">
        <input name="name" className="input" required maxLength={40} placeholder={t('collection_name_ph')} aria-label={t('collection_name')} />
        <SubmitButton className="btn-primary shrink-0">{t('collection_add')}</SubmitButton>
      </div>
    </form>
  );
}

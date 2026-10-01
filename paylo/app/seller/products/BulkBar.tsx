'use client';
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { bulkProductsAction, type BulkState } from './actions';
import { useI18n } from '@/lib/i18n/client';
import { SubmitButton } from '@/components/SubmitButton';
import type { TKey } from '@/lib/i18n';

/** Checkboxes on each product row post into this form via form="bulk-form". */
export function BulkBar() {
  const { t } = useI18n();
  const [state, action] = useFormState(bulkProductsAction, null as BulkState | null);
  const [act, setAct] = useState('price_pct');
  const needsValue = ['price_set', 'price_pct', 'stock_set'].includes(act);
  const toggleAll = (on: boolean) => document.querySelectorAll<HTMLInputElement>('input[form="bulk-form"][name="ids"]').forEach((c) => { c.checked = on; });
  return (
    <form id="bulk-form" action={action} className="card-pad mb-4 space-y-3" data-testid="bulk-bar">
      {state?.error && <div className="alert-error text-sm">{t(state.error as TKey)}</div>}
      {state?.result && (
        <div className="alert-success text-sm" data-testid="bulk-result">
          {t('bulk_updated', { n: state.result.updated })}
          {state.result.skipped.length > 0 && <div className="text-xs mt-1">{t('bulk_skipped')}: {state.result.skipped.map((s) => `${s.title} (${t(`bulk_skip_${s.reason}` as TKey)})`).join(', ')}</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="tap flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" onChange={(e) => toggleAll(e.target.checked)} data-testid="bulk-all" />{t('bulk_select_all')}</label>
        <select name="bulk_action" className="input w-auto" value={act} onChange={(e) => setAct(e.target.value)} aria-label={t('bulk_action')}>
          <option value="price_pct">{t('bulk_price_pct')}</option>
          <option value="price_set">{t('bulk_price_set')}</option>
          <option value="stock_set">{t('bulk_stock_set')}</option>
          <option value="activate">{t('set_active')}</option>
          <option value="deactivate">{t('set_inactive')}</option>
        </select>
        {needsValue && <input name="bulk_value" className="input w-28" inputMode="decimal" dir="ltr" required aria-label={t('bulk_value')} placeholder={act === 'price_pct' ? '+10 / -15' : '0'} />}
        <SubmitButton className="btn-primary btn-sm">{t('bulk_apply')}</SubmitButton>
      </div>
      <p className="text-xs text-ink-soft">{t('bulk_hint')}</p>
    </form>
  );
}

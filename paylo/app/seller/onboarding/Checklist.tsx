'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { dismissOnboardingAction, markLinkCopiedAction } from './actions';

export interface ChecklistStep { key: 'ob_product' | 'ob_copy_link' | 'ob_notifications' | 'ob_kyc'; done: boolean; href?: string; note?: string }

/**
 * First-run checklist for a store with no products or no orders yet. Every step links to
 * where it is done; it hides itself once all are done, or when the seller dismisses it.
 */
export function OnboardingChecklist({ steps, storeUrl }: { steps: ChecklistStep[]; storeUrl: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const copy = async () => {
    await navigator.clipboard.writeText(storeUrl).catch(() => {});
    setCopied(true);
    start(() => markLinkCopiedAction());
  };
  return (
    <section className="card-pad mb-4" data-testid="onboarding">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">{t('ob_title')}</h2>
          <p className="text-sm text-ink-soft mb-3">{t('ob_sub')}</p>
        </div>
        <button type="button" className="tap text-sm text-ink-soft hover:text-brand" data-testid="onboarding-dismiss" disabled={pending}
          onClick={() => start(() => dismissOnboardingAction())}>{t('ob_dismiss')}</button>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const done = s.done || (s.key === 'ob_copy_link' && copied);
          return (
            <li key={s.key} data-step={s.key} data-done={done ? '1' : '0'} className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-success text-white' : 'bg-ink/8 text-ink'}`}>{done ? '✓' : i + 1}</span>
              <span className={`flex-1 min-w-0 ${done ? 'text-ink-soft line-through' : 'font-medium'}`}>{t(s.key)}</span>
              {done ? <span className="text-xs text-success font-semibold">{t('ob_done')}</span>
                : s.note ? <span className="text-xs text-ink-soft">{s.note}</span>
                : s.key === 'ob_copy_link' ? <button type="button" className="btn-primary btn-sm" onClick={copy}>{t('ob_copy')}</button>
                : s.href ? <Link href={s.href} className="btn-primary btn-sm">{t('ob_do')}</Link> : null}
            </li>);
        })}
      </ol>
    </section>
  );
}

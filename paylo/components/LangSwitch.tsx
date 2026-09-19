'use client';
import { useI18n } from '@/lib/i18n/client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = lang === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      disabled={pending}
      className={className || 'text-sm font-semibold text-ink-soft hover:text-cherry'}
      onClick={() => start(async () => {
        await fetch('/api/lang', { method: 'POST', body: JSON.stringify({ lang: next }), headers: { 'content-type': 'application/json' } });
        router.refresh();
      })}
    >
      {t('lang_switch')}
    </button>
  );
}

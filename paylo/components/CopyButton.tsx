'use client';
import { useI18n } from '@/lib/i18n/client';
import { useState } from 'react';
export function CopyButton({ text, className = 'btn-secondary btn-sm' }: { text: string; className?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? t('copied') : t('copy')}
    </button>
  );
}

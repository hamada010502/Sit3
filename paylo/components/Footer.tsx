import { getT } from '@/lib/i18n/server';
export function Footer() {
  const { t } = getT();
  return (
    <footer className="mt-auto border-t border-ink/10 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-soft flex flex-col sm:flex-row gap-2 justify-between">
        <span>{t('footer')}</span>
        <span>© {new Date().getFullYear()} Paylo</span>
      </div>
    </footer>
  );
}

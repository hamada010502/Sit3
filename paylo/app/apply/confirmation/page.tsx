import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { getT } from '@/lib/i18n/server';

/** Static — no session exists at this point, since approval (not submission) is what creates one. */
export default function ApplyConfirmationPage() {
  const { t } = getT();
  return (
    <Shell>
      <div className="max-w-lg mx-auto text-center py-10">
        <h1 className="section-title">{t('reg_confirm_title')}</h1>
        <p className="mt-4 text-ink-soft leading-relaxed">{t('reg_confirm_body')}</p>
        <ul className="mt-6 text-start text-sm text-ink-soft space-y-2 inline-block">
          <li>• {t('reg_confirm_point1')}</li>
          <li>• {t('reg_confirm_point2')}</li>
          <li>• {t('reg_confirm_point3')}</li>
        </ul>
        <Link href="/" className="btn-secondary mt-8 inline-flex">{t('nav_home')}</Link>
      </div>
    </Shell>
  );
}

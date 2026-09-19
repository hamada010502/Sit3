import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { getCurrentUser, getPendingTwoFactorUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { TwoFactorForm } from './TwoFactorForm';

export default function TwoFactorPage() {
  if (getCurrentUser()) redirect('/seller');
  if (!getPendingTwoFactorUser()) redirect('/login');
  const { t } = getT();
  return (
    <Shell>
      <div className="max-w-md mx-auto">
        <h1 className="section-title">{t('tfa_login_title')}</h1>
        <p className="mt-2 mb-6 text-sm text-ink-soft">{t('tfa_login_sub')}</p>
        <TwoFactorForm />
      </div>
    </Shell>
  );
}

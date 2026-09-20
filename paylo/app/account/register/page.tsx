import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { RegisterForm } from './RegisterForm';

export default function RegisterPage() {
  const user = getCurrentUser();
  if (user) redirect(user.role === 'customer' ? '/account' : '/');
  const { t } = getT();
  return (
    <Shell>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-2">{t('register_title')}</h1>
        <ul className="text-sm text-ink-soft space-y-1 mb-6">
          <li>• {t('register_benefit1')}</li>
          <li>• {t('register_benefit2')}</li>
          <li>• {t('register_benefit3')}</li>
        </ul>
        <RegisterForm />
      </div>
    </Shell>
  );
}

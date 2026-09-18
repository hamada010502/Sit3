import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  const user = getCurrentUser();
  if (user) redirect(user.role === 'admin' ? '/admin' : '/seller');
  const { t } = getT();
  return (
    <Shell>
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-6">{t('login_title')}</h1>
        <LoginForm />
      </div>
    </Shell>
  );
}

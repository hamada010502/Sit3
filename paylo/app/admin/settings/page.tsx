import { getAllSettings } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { AdminSettingsForm } from './SettingsForm';
export default function AdminSettingsPage() {
  requireAdmin();
  const { t } = getT();
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('a_settings_title')}</h1>
      <AdminSettingsForm s={getAllSettings()} />
      <div className="alert-info mt-6 text-xs" dir="ltr">
        <strong>Payment provider:</strong> {process.env.PAYMENT_PROVIDER || 'mock'} · <strong>Email transport:</strong> {process.env.EMAIL_TRANSPORT || 'log'} — set via environment variables (see .env.example).
      </div>
    </div>
  );
}

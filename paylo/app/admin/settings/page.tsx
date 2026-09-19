import { getAllSettings } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { AdminSettingsForm } from './SettingsForm';

export default function AdminSettingsPage() {
  requireAdmin();
  const { t } = getT();
  const cardEnv = (process.env.PAYMENT_CARD_ENABLED || '0') === '1';
  return (
    <div className="max-w-3xl">
      <h1 className="section-title mb-6">{t('a_settings_title')}</h1>
      <AdminSettingsForm s={getAllSettings()} cardEnvEnabled={cardEnv} />
      <div className="alert-info mt-6 text-xs" dir="ltr">
        <strong>Card rail:</strong> {cardEnv ? 'enabled in env' : 'disabled (PAYMENT_CARD_ENABLED=0)'} ·{' '}
        <strong>Provider:</strong> {process.env.PAYMENT_PROVIDER || 'mock'} ·{' '}
        <strong>Email:</strong> {process.env.EMAIL_TRANSPORT || 'log'} ·{' '}
        <strong>SMS:</strong> {process.env.SMS_TRANSPORT || 'log'}
      </div>
    </div>
  );
}

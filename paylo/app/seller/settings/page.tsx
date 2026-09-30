import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { SettingsForm } from './SettingsForm';
import { NotificationSettings } from './notifications/NotificationSettings';
import { subscriptionCount } from '@/lib/push';
export default function SellerSettingsPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{t('settings_title')}</h1>
      <NotificationSettings prefs={seller} devices={subscriptionCount(seller.id)} />
      <SettingsForm seller={seller} />
    </div>
  );
}

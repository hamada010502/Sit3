import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { SettingsForm } from './SettingsForm';
export default function SellerSettingsPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  return <div className="max-w-2xl"><h1 className="text-2xl font-bold mb-6">{t('settings_title')}</h1><SettingsForm seller={seller} /></div>;
}

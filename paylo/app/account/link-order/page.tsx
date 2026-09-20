import { Shell } from '@/components/Shell';
import { requireCustomer } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { LinkOrderForm } from './LinkOrderForm';

export default function LinkOrderPage() {
  requireCustomer();
  const { t } = getT();
  return (
    <Shell>
      <h1 className="section-title mb-6">{t('account_link_order')}</h1>
      <LinkOrderForm />
    </Shell>
  );
}

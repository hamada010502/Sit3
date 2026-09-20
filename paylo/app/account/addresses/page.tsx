import { Shell } from '@/components/Shell';
import { requireCustomer } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { listAddresses } from '@/lib/customer';
import { AddressList } from './AddressList';

export default function AddressesPage() {
  const user = requireCustomer();
  const { t } = getT();
  const addresses = listAddresses(user.id);
  return (
    <Shell>
      <h1 className="section-title mb-6">{t('account_addresses')}</h1>
      <AddressList addresses={addresses} />
    </Shell>
  );
}

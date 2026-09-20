import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { OrderStateBadge, OrderStatusBadge } from '@/components/StatusBadge';
import { requireCustomer } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { formatSYP } from '@/lib/money';
import { listAddresses, ordersForCustomer } from '@/lib/customer';
import { ProfileForm } from './ProfileForm';

export default function AccountPage() {
  const user = requireCustomer();
  const { t, lang } = getT();
  const addresses = listAddresses(user.id);
  const orders = ordersForCustomer(user.id).slice(0, 5);

  return (
    <Shell>
      <h1 className="section-title mb-6">{t('account_title')}</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-bold mb-3">{t('account_profile')}</h2>
          <ProfileForm name={user.name} phone={user.phone || ''} email={user.email} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">{t('account_addresses')}</h2>
            <Link href="/account/addresses" className="link text-sm">{t('account_add_address')}</Link>
          </div>
          {addresses.length === 0 ? (
            <div className="alert-info text-sm">{t('account_no_addresses')}</div>
          ) : (
            <div className="card-pad text-sm space-y-2">
              {addresses.slice(0, 2).map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-2 border-b border-ink/8 pb-2 last:border-0 last:pb-0">
                  <div>
                    <div className="font-semibold">{a.label || a.governorate}{a.is_default ? <span className="badge bg-ink/8 text-ink-soft ms-2">{t('account_default_address')}</span> : null}</div>
                    <div className="text-ink-soft">{a.address}, {a.governorate}</div>
                  </div>
                </div>
              ))}
              <Link href="/account/addresses" className="link text-sm inline-block mt-1">{t('account_addresses')} →</Link>
            </div>
          )}
        </section>
      </div>

      {/* Saved payment methods (spec §3): intentionally not built yet — no card provider
          is live, and a saved method must reference the provider's own secure token,
          never anything we'd store ourselves. This stays a one-line placeholder, not a
          stubbed-in fake tokenization flow, until that provider exists. */}
      <p className="mt-6 text-xs text-ink-soft">{t('saved_payment_coming_soon')}</p>

      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">{t('account_orders')}</h2>
          <Link href="/account/orders" className="link text-sm">{t('account_orders')} →</Link>
        </div>
        {orders.length === 0 ? (
          <div className="alert-info text-sm">{t('account_no_orders')}</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('product')}</th><th>{t('total')}</th><th></th><th></th><th></th></tr></thead>
              <tbody>{orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-sm">{o.code}</td>
                  <td>{formatSYP(o.total, lang)}</td>
                  <td><OrderStateBadge state={o.order_state} t={t} /></td>
                  <td><OrderStatusBadge status={o.status} t={t} /></td>
                  <td><Link href={`/track/${o.code}`} className="link text-sm">{t('account_view_order')}</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-8 text-sm">
        <Link href="/account/link-order" className="link">{t('account_link_order')} →</Link>
      </p>
    </Shell>
  );
}

import Link from 'next/link';
import { Logo } from './Logo';
import { LangSwitch } from './LangSwitch';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';

export function Nav() {
  const user = getCurrentUser();
  const { t } = getT();
  const home = user?.role === 'admin' ? '/admin' : user?.role === 'seller' ? '/seller' : '/';
  const links: [string, string][] = user?.role === 'admin'
    ? [['/admin', t('nav_dashboard')], ['/admin/ops', t('nav_ops')], ['/admin/sellers', t('nav_sellers')], ['/admin/orders', t('nav_orders')],
       ['/admin/disputes', t('nav_disputes')], ['/admin/payouts', t('nav_payouts')], ['/admin/audit', t('nav_audit')],
       ['/admin/notifications', t('nav_notifications')], ['/admin/settings', t('nav_settings')]]
    : user?.role === 'seller'
    ? [['/seller', t('nav_dashboard')], ['/seller/products', t('nav_products')], ['/seller/orders', t('nav_orders')],
       ['/seller/payouts', t('nav_payouts')], ['/seller/verification', t('nav_kyc')], ['/seller/security', t('nav_security')],
       ['/seller/developers', t('nav_webhooks')], ['/seller/settings', t('nav_settings')]]
    : user?.role === 'customer'
    ? [['/account', t('account_title')], ['/account/addresses', t('account_addresses')], ['/account/orders', t('account_orders')]]
    : [];
  return (
    <header className="bg-white border-b border-ink/10 sticky top-0 z-30">
      <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-3">
        <Link href={home} className="shrink-0" aria-label="Paylo">
          <span className="sm:hidden"><Logo size={28} wordmark={false} /></span>
          <span className="hidden sm:inline-flex"><Logo size={30} /></span>
        </Link>
        <nav className="hidden lg:flex items-center gap-5 text-sm font-medium text-ink-soft overflow-x-auto">
          {links.map(([href, label]) => <Link key={href} href={href} className="hover:text-cherry whitespace-nowrap">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <LangSwitch />
          {user ? (
            <form action="/logout" method="post"><button className="text-sm font-semibold text-ink-soft hover:text-cherry">{t('nav_logout')}</button></form>
          ) : (
            <>
              <Link href="/login" className="text-sm font-semibold text-ink-soft hover:text-cherry">{t('nav_login')}</Link>
              <Link href="/apply" className="btn-primary btn-sm">{t('nav_apply')}</Link>
            </>
          )}
        </div>
      </div>
      {links.length > 0 && (
        <nav className="lg:hidden flex gap-4 px-4 pb-2 text-sm font-medium text-ink-soft overflow-x-auto">
          {links.map(([href, label]) => <Link key={href} href={href} className="hover:text-cherry whitespace-nowrap">{label}</Link>)}
        </nav>
      )}
    </header>
  );
}

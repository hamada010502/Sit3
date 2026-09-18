import Link from 'next/link';
import { Logo } from './Logo';
import { LangSwitch } from './LangSwitch';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';

export function Nav() {
  const user = getCurrentUser();
  const { t } = getT();
  const home = user?.role === 'admin' ? '/admin' : user?.role === 'seller' ? '/seller' : '/';
  const links = user?.role === 'admin'
    ? [['/admin', t('nav_dashboard')], ['/admin/sellers', t('nav_sellers')], ['/admin/orders', t('nav_orders')], ['/admin/disputes', t('nav_disputes')], ['/admin/payouts', t('nav_payouts')], ['/admin/settings', t('nav_settings')], ['/admin/emails', t('nav_emails')]]
    : user?.role === 'seller'
    ? [['/seller', t('nav_dashboard')], ['/seller/products', t('nav_products')], ['/seller/orders', t('nav_orders')], ['/seller/payouts', t('nav_payouts')], ['/seller/settings', t('nav_settings')]]
    : [];
  return (
    <header className="bg-white border-b border-bluewood/10 sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-4">
        <Link href={home} className="shrink-0"><Logo size={30} /></Link>
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-bluewood/70 overflow-x-auto">
          {links.map(([href, label]) => <Link key={href} href={href} className="hover:text-crusta whitespace-nowrap">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-4 shrink-0">
          <LangSwitch />
          {user ? (
            <form action="/logout" method="post"><button className="text-sm font-semibold text-bluewood/70 hover:text-crusta">{t('nav_logout')}</button></form>
          ) : (
            <>
              <Link href="/login" className="text-sm font-semibold text-bluewood/70 hover:text-crusta">{t('nav_login')}</Link>
              <Link href="/apply" className="btn-primary btn-sm">{t('nav_apply')}</Link>
            </>
          )}
        </div>
      </div>
      {links.length > 0 && (
        <nav className="md:hidden flex gap-4 px-4 pb-2 text-sm font-medium text-bluewood/70 overflow-x-auto">
          {links.map(([href, label]) => <Link key={href} href={href} className="hover:text-crusta whitespace-nowrap">{label}</Link>)}
        </nav>
      )}
    </header>
  );
}

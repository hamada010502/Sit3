import Link from 'next/link';
import { requireOwner } from '@/lib/guards';
import { getDb } from '@/lib/db';
import { getT } from '@/lib/i18n/server';
import { LangSwitch } from '@/components/LangSwitch';

/**
 * Deliberately NOT using components/Nav.tsx or components/Shell.tsx — this keeps
 * /owner from ever being reachable through the shared navigation used by admin,
 * seller, and buyer pages, and keeps this layout free of any accidental link back
 * into it from elsewhere. Nothing in this app links here; the URL has to be known.
 */
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  requireOwner();
  const { t } = getT();
  const pending = (getDb().prepare("SELECT count(*) c FROM store_registration_requests WHERE status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED')").get() as { c: number }).c;
  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <header className="border-b border-ink/10 bg-ink text-cream">
        <div className="mx-auto max-w-7xl px-4 min-h-14 flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm py-2">
            <span className="font-semibold tracking-tight">{t('ow_brand')}</span>
            <Link href="/owner" className="text-cream/70 hover:text-cream">{t('ow_nav_overview')}</Link>
            <Link href="/owner/registrations" className="text-cream/70 hover:text-cream flex items-center gap-1.5">
              {t('rg_title')}
              {pending > 0 && <span className="badge bg-amber-400 text-ink px-1.5">{pending}</span>}
            </Link>
            <Link href="/owner/analytics" className="text-cream/70 hover:text-cream">{t('oa_title')}</Link>
          </div>
          <div className="flex items-center gap-3 text-cream">
            <LangSwitch />
            <form action="/logout" method="post">
              <button className="text-sm text-cream/70 hover:text-cream">{t('nav_logout')}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl w-full px-4 py-8 flex-1">{children}</main>
    </div>
  );
}

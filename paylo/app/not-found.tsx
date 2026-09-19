import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { getT } from '@/lib/i18n/server';
export default function NotFound() {
  const { t } = getT();
  return <Shell><div className="card-pad text-center py-16"><h1 className="text-2xl font-bold">404</h1><p className="mt-2 text-ink-soft">{t('page_not_found')}</p><Link href="/" className="btn-primary mt-6">{t('nav_home')}</Link></div></Shell>;
}

import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { getT } from '@/lib/i18n/server';

export default function TrackIndex({ searchParams }: { searchParams: { code?: string } }) {
  if (searchParams.code) redirect('/track/' + encodeURIComponent(searchParams.code.trim().toUpperCase()));
  const { t } = getT();
  return (
    <Shell>
      <h1 className="text-2xl font-bold mb-4">{t('track_title')}</h1>
      <form method="get" className="card-pad flex gap-2">
        <input name="code" className="input" placeholder={t('track_placeholder')} required autoFocus />
        <button className="btn-primary shrink-0">{t('track_btn')}</button>
      </form>
    </Shell>
  );
}

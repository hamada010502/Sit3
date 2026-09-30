import { requireApprovedSeller } from '@/lib/guards';
import { getT } from '@/lib/i18n/server';
import { aboutSections, MAX_SECTIONS } from '@/lib/store-page';
import { AboutBuilder } from './AboutBuilder';

export default function AboutBuilderPage() {
  const { seller } = requireApprovedSeller();
  const { t } = getT();
  return (
    <div className="max-w-2xl">
      <h1 className="section-title">{t('about_builder_title')}</h1>
      <p className="mt-1 mb-6 text-sm text-ink-soft">{t('about_builder_sub')}</p>
      <AboutBuilder initial={aboutSections(seller)} max={MAX_SECTIONS} previewHref={`/s/${seller.slug}/about`} />
    </div>
  );
}

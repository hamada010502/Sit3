/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { getDb } from '@/lib/db';
import { isStoreLive } from '@/lib/store-status';
import { getT } from '@/lib/i18n/server';
import { aboutSections } from '@/lib/store-page';
import type { Seller } from '@/lib/types';

/** Rendered as plain text (whitespace-pre-line), never as HTML — sellers cannot inject markup. */
export default function StoreAboutPage({ params }: { params: { slug: string } }) {
  const { t } = getT();
  const seller = getDb().prepare('SELECT * FROM sellers WHERE slug = ?').get(params.slug) as Seller | undefined;
  if (!seller || !isStoreLive(seller)) {
    return <Shell><div className="alert-info text-center py-10">{t('store_unavailable')}</div></Shell>;
  }
  const sections = aboutSections(seller);
  return (
    <Shell>
      <Link href={`/s/${seller.slug}`} className="link text-sm">← {seller.store_name}</Link>
      <h1 className="text-3xl font-bold mt-2 mb-6">{t('store_about')}</h1>
      {sections.length === 0 ? <div className="alert-info">{t('about_empty')}</div> : (
        <div className="space-y-8" data-testid="about-sections">
          {sections.map((s, i) => (
            <section key={i} className="space-y-3">
              {s.image && <img src={s.image} alt="" className="w-full max-h-80 object-cover rounded-2xl" />}
              {s.heading && <h2 className="text-xl font-bold">{s.heading}</h2>}
              {s.body && <p className="text-ink-soft leading-relaxed whitespace-pre-line">{s.body}</p>}
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}

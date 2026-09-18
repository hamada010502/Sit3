import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { LogoIcon } from '@/components/Logo';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';

export default function Home() {
  const user = getCurrentUser();
  if (user?.role === 'admin') redirect('/admin');
  if (user?.role === 'seller') redirect('/seller');
  const { t } = getT();
  const steps = [1, 2, 3, 4] as const;
  return (
    <Shell wide>
      <section className="grid md:grid-cols-2 gap-10 items-center py-8">
        <div>
          <p className="text-crusta font-semibold tracking-wide uppercase text-sm">{t('slogan')}</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-bold leading-tight">{t('hero_title')}</h1>
          <p className="mt-5 text-lg text-bluewood/70">{t('hero_sub')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/apply" className="btn-primary">{t('hero_cta')}</Link>
            <Link href="/login" className="btn-secondary">{t('hero_cta2')}</Link>
          </div>
          <p className="mt-6 text-xs text-bluewood/50">{t('no_catalog_note')}</p>
        </div>
        <div className="card-pad bg-bluewood text-white">
          <div className="flex items-center gap-3"><LogoIcon size={44} /><span className="text-2xl font-bold">Paylo</span></div>
          <p className="mt-5 text-white/80 leading-relaxed">{t('vision')}</p>
          <form action="/track" method="get" className="mt-8">
            <label className="label text-white/60">{t('track_title')}</label>
            <div className="flex gap-2">
              <input name="code" className="input text-bluewood" placeholder={t('track_placeholder')} required />
              <button className="btn-primary shrink-0">{t('track_btn')}</button>
            </div>
          </form>
        </div>
      </section>
      <section className="py-10">
        <h2 className="text-2xl font-bold mb-6">{t('how_title')}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((n) => (
            <div key={n} className="card-pad">
              <h3 className="font-semibold text-crusta">{t(`how_${n}_t` as const)}</h3>
              <p className="mt-2 text-sm text-bluewood/70">{t(`how_${n}_d` as const)}</p>
            </div>
          ))}
        </div>
      </section>
    </Shell>
  );
}

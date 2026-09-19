import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { HeroCardStrip, HeroCardWaterfall } from '@/components/HeroCardWaterfall';
import { LangSwitch } from '@/components/LangSwitch';
import { Logo } from '@/components/Logo';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';

export default function Home() {
  const user = getCurrentUser();
  if (user?.role === 'admin') redirect('/admin');
  if (user?.role === 'seller') redirect('/seller');
  const { t, lang } = getT();
  const steps = [1, 2, 3] as const;

  return (
    <>
      {/* One bar, not two: logo, audience, actions. */}
      <header className="border-b border-ink/10 bg-cream">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="Paylo"><Logo size={30} /></Link>
            <nav className="hidden sm:flex items-center gap-6 text-sm text-ink-soft">
              <span className="font-semibold text-ink">{t('aud_sellers')}</span>
              <Link href="/track" className="hover:text-cherry">{t('aud_buyers')}</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 sm:gap-5 text-sm">
            <LangSwitch className="font-medium text-ink-soft hover:text-cherry" />
            <Link href="/login" className="font-medium text-ink-soft hover:text-cherry whitespace-nowrap">{t('hero2_login')}</Link>
            <Link href="/apply" className="btn-primary btn-sm whitespace-nowrap">{t('hero2_signup')}</Link>
          </div>
        </div>
      </header>

      <section className="overflow-hidden">
        <div className="md:grid md:grid-cols-[48%_52%] md:min-h-[calc(100vh-4rem)]">
          <div className="relative z-10 px-4 sm:px-8 lg:px-14 py-16 md:py-0 flex flex-col justify-center">
            <h1 className="text-5xl sm:text-6xl xl:text-7xl font-semibold leading-[1.04] tracking-[-0.035em] max-w-[11ch]">
              {t('hero_title')}
            </h1>
            <p className="mt-7 text-lg text-ink-soft max-w-prose leading-relaxed">{t('hero_sub')}</p>
            <div className="mt-9">
              <Link href="/apply" className="btn-cta">{t('hero2_cta')}</Link>
            </div>
            <p className="mt-5 text-sm text-ink-soft/85">{t('hero_micro')}</p>
            <div className="md:hidden mt-12"><HeroCardStrip t={t} lang={lang} /></div>
          </div>
          <div className="relative hidden md:block"><HeroCardWaterfall t={t} lang={lang} /></div>
        </div>
      </section>

      <section id="how" className="border-t border-ink/10 bg-paper">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:py-24">
          <h2 className="section-title">{t('how_title')}</h2>
          <ol className="mt-12 grid md:grid-cols-3 gap-12 md:gap-10">
            {steps.map((n) => (
              <li key={n}>
                <span className="block text-sm font-semibold text-cherry tabular-nums">{String(n).padStart(2, '0')}</span>
                <h3 className="mt-3 text-lg font-semibold">{t(`step${n}_t` as const)}</h3>
                <p className="mt-2 text-ink-soft leading-relaxed max-w-prose">{t(`step${n}_d` as const)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-16 border-t border-ink/10 pt-8 text-sm text-ink-soft max-w-prose">{t('final_note')}</p>
        </div>
      </section>
      <Footer />
    </>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { HeroCardStrip, HeroCardWaterfall } from '@/components/HeroCardWaterfall';
import { LangSwitch } from '@/components/LangSwitch';
import { Logo } from '@/components/Logo';
import { getCurrentUser } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';

/** Geometric line icons for the value props — consistent 2px stroke, no fills (v2 §7.3). */
const TRUST_ICONS: Record<number, React.ReactNode> = {
  1: <><path d="M9 15a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6l-1 1" /><path d="M15 9a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6l1-1" /></>,
  2: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
  3: <><path d="M3 8h9v8H3z" /><path d="M12 11h4l3 3v2h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="16.5" cy="18" r="1.6" /></>,
  4: <><path d="M6 3h8l4 4v14H6z" /><path d="M13 3v5h5" /><path d="M9.5 13h6" /><path d="M9.5 16.5h4" /></>,
};

export default function Home() {
  const user = getCurrentUser();
  if (user?.role === 'admin') redirect('/admin');
  if (user?.role === 'seller') redirect('/seller');
  const { t, lang } = getT();
  const steps = [1, 2, 3] as const;
  const trust = [1, 2, 3, 4] as const;

  return (
    <>
      {/* Audience tabs + auth */}
      <div className="bg-tide-900 text-white text-sm">
        <div className="mx-auto max-w-7xl px-4 flex items-center justify-between gap-3 h-12">
          <div className="flex h-full">
            <Link href="/" className="px-3 sm:px-4 h-full flex items-center bg-rose text-white font-semibold whitespace-nowrap">{t('hero2_tab_sellers')}</Link>
            <Link href="/track" className="px-3 sm:px-4 h-full flex items-center text-white/75 hover:text-white hover:bg-white/10 font-medium whitespace-nowrap">{t('hero2_tab_buyers')}</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LangSwitch className="text-sm font-semibold text-white/75 hover:text-white px-1" />
            <Link href="/login" className="rounded-full border border-white/45 px-3 sm:px-4 py-1.5 font-semibold text-white hover:bg-white/10 whitespace-nowrap">{t('hero2_login')}</Link>
            <Link href="/apply" className="hidden sm:inline-flex rounded-full bg-rose px-4 py-1.5 font-semibold text-white hover:bg-rose-600 whitespace-nowrap">{t('hero2_signup')}</Link>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-tide-800 text-white overflow-hidden">
        <div className="md:grid md:grid-cols-[46%_54%] md:min-h-[calc(100vh-3rem)]">
          <div className="relative z-10 px-4 sm:px-8 lg:px-12 pt-6 pb-10 md:pb-16 flex flex-col">
            <div className="flex items-center gap-8">
              <Logo size={34} onDark />
              <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-white/70">
                <a href="#how" className="hover:text-rose">{t('hero2_nav_what')}</a>
                <a href="#pricing" className="hover:text-rose">{t('hero2_nav_pricing')}</a>
              </nav>
            </div>
            <div className="flex-1 flex flex-col justify-center py-12 md:py-10">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose">{t('hero2_seen')}</p>
              <h1 className="mt-4 text-5xl sm:text-6xl xl:text-7xl font-extrabold leading-[1.02] tracking-[-0.035em]">
                {t('hero2_h1_pre')} <span className="text-rose">{t('hero2_h1_accent')}</span>{t('hero2_h1_post') ? ' ' + t('hero2_h1_post') : ''}
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-white/75 max-w-md leading-relaxed">{t('hero2_sub2')}</p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link href="/apply" className="btn-cta">{t('hero2_cta')}</Link>
                <Link href="/track" className="text-sm font-semibold text-white/75 hover:text-white underline underline-offset-4">{t('nav_track')}</Link>
              </div>
              <p className="mt-6 text-xs text-white/50 max-w-sm leading-relaxed">{t('pay_phase_note')}</p>
            </div>
            <div className="md:hidden"><HeroCardStrip t={t} lang={lang} /></div>
          </div>
          <div className="relative hidden md:block min-h-[70vh]"><HeroCardWaterfall t={t} lang={lang} /></div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <h2 className="section-title">{t('how_title')}</h2>
          <ol className="mt-8 grid md:grid-cols-3 gap-8">
            {steps.map((n) => (
              <li key={n} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 font-extrabold">{n}</span>
                <div>
                  <h3 className="text-lg font-bold">{t(`step${n}_t` as const)}</h3>
                  <p className="mt-1.5 text-ink-soft leading-relaxed">{t(`step${n}_d` as const)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust / value props */}
      <section className="bg-mist border-y border-ink/8">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <h2 className="section-title">{t('trust_title')}</h2>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {trust.map((n) => (
              <div key={n} className="card-pad">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-tide/10 text-tide" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {TRUST_ICONS[n]}
                  </svg>
                </span>
                <h3 className="mt-4 text-base font-bold">{t(`trust_${n}_t` as const)}</h3>
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">{t(`trust_${n}_d` as const)}</p>
              </div>
            ))}
          </div>
          <p id="pricing" className="mt-10 text-sm text-ink-soft border-t border-ink/10 pt-6">{t('final_note')}</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-tide-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.03em]">{t('final_t')}</h2>
            <p className="mt-3 text-white/75 max-w-lg leading-relaxed">{t('final_sub')}</p>
          </div>
          <Link href="/apply" className="btn-cta shrink-0">{t('final_cta')}</Link>
        </div>
      </section>
      <Footer />
    </>
  );
}

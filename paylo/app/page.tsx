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
  const { t } = getT();
  const steps = [1, 2, 3] as const;
  return (
    <>
      {/* Top bar: audience tabs + auth pills */}
      <div className="bg-blossom text-karry text-sm">
        <div className="mx-auto max-w-7xl px-4 flex items-center justify-between gap-3 h-12">
          <div className="flex h-full">
            <Link href="/" className="px-3 sm:px-4 h-full flex items-center bg-crusta text-bluewood font-semibold whitespace-nowrap">{t('hero2_tab_sellers')}</Link>
            <Link href="/track" className="px-3 sm:px-4 h-full flex items-center hover:bg-white/10 font-medium whitespace-nowrap">{t('hero2_tab_buyers')}</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LangSwitch className="text-sm font-semibold text-karry/80 hover:text-white px-1" />
            <Link href="/login" className="rounded-full border border-karry px-3 sm:px-4 py-1.5 font-semibold text-karry hover:bg-karry/10 whitespace-nowrap">{t('hero2_login')}</Link>
            <Link href="/apply" className="hidden sm:inline-flex rounded-full bg-crusta px-4 py-1.5 font-semibold text-bluewood hover:bg-tangerine whitespace-nowrap">{t('hero2_signup')}</Link>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-bluewood text-karry overflow-hidden">
        <div className="md:grid md:grid-cols-[45%_55%] md:min-h-[calc(100vh-3rem)]">
          <div className="relative z-10 px-4 sm:px-8 lg:px-12 pt-6 pb-10 md:pb-16 flex flex-col">
            <div className="flex items-center gap-8">
              <Logo size={34} dark />
              <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-karry/80">
                <a href="#how" className="hover:text-crusta">{t('hero2_nav_what')}</a>
                <a href="#pricing" className="hover:text-crusta">{t('hero2_nav_pricing')}</a>
              </nav>
            </div>
            <div className="flex-1 flex flex-col justify-center py-14 md:py-10">
              <h1 className="text-5xl sm:text-6xl xl:text-7xl font-bold leading-[1.05] tracking-tight">{t('hero2_h1')}</h1>
              <p className="mt-6 text-lg sm:text-xl text-karry/80 max-w-md leading-relaxed">{t('hero2_sub')}</p>
              <div className="mt-8">
                <Link href="/apply" className="inline-flex items-center rounded-full bg-crusta px-7 py-3.5 text-base font-bold text-bluewood hover:bg-tangerine transition">{t('hero2_cta')}</Link>
              </div>
            </div>
            <div className="md:hidden"><HeroCardStrip /></div>
          </div>
          <div className="relative hidden md:block min-h-[70vh]">
            <HeroCardWaterfall />
          </div>
        </div>
      </section>

      {/* Three-step strip */}
      <section id="how" className="bg-karry text-bluewood">
        <div className="mx-auto max-w-7xl px-4 py-14">
          <ol className="grid md:grid-cols-3 gap-8">
            {steps.map((n) => (
              <li key={n} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-crusta text-bluewood font-bold">{n}</span>
                <div>
                  <h2 className="text-xl font-bold">{t(`step${n}_t` as const)}</h2>
                  <p className="mt-1 text-bluewood/70">{t(`step${n}_d` as const)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p id="pricing" className="mt-10 text-sm text-bluewood/60 border-t border-bluewood/10 pt-6">{t('pricing_note')}</p>
        </div>
      </section>
      <Footer />
    </>
  );
}

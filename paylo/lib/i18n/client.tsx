'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { makeT, type Lang, type TFn } from './index';

const Ctx = createContext<{ lang: Lang; t: TFn }>({ lang: 'en', t: makeT('en') });
export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <Ctx.Provider value={{ lang, t: makeT(lang) }}>{children}</Ctx.Provider>;
}
export function useI18n() { return useContext(Ctx); }

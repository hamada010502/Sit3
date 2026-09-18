import { en, type Dict } from './en';
import { ar } from './ar';

export type Lang = 'en' | 'ar';
export const LANG_COOKIE = 'paylo_lang';
export const dicts: Record<Lang, Dict> = { en, ar };
export type TKey = keyof Dict;

export function makeT(lang: Lang) {
  const d = dicts[lang];
  return (key: TKey, vars?: Record<string, string | number>) => {
    let s: string = d[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
export type TFn = ReturnType<typeof makeT>;
export const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');

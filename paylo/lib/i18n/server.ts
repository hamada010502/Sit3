import { cookies } from 'next/headers';
import { LANG_COOKIE, makeT, type Lang } from './index';

export function getLang(): Lang {
  const v = cookies().get(LANG_COOKIE)?.value;
  return v === 'ar' ? 'ar' : 'en';
}
export function getT() {
  const lang = getLang();
  return { lang, t: makeT(lang) };
}

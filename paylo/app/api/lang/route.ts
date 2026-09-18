import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { LANG_COOKIE } from '@/lib/i18n';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const lang = body?.lang === 'ar' ? 'ar' : 'en';
  cookies().set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return NextResponse.json({ ok: true, lang });
}

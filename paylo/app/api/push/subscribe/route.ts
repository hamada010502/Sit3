import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { removeSubscription, saveSubscription, type PushSub } from '@/lib/push';
import { getLang } from '@/lib/i18n/server';
import { liveSellerFromSession } from '@/lib/seller-session';

export async function POST(req: Request) {
  const s = liveSellerFromSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    saveSubscription(s.seller.id, (await req.json()) as PushSub, req.headers.get('user-agent'), getLang());
  } catch {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  }
  audit('seller', s.user.id, s.seller.store_name, 'seller', s.seller.id, 'push.subscribed');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = liveSellerFromSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) removeSubscription(s.seller.id, endpoint);
  return NextResponse.json({ ok: true });
}

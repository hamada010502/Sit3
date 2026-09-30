import { NextResponse } from 'next/server';
import { vapidKeys } from '@/lib/push';
import { liveSellerFromSession } from '@/lib/seller-session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!liveSellerFromSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ publicKey: vapidKeys().publicKey });
}

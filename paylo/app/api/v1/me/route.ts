import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api';
import { sellerBalances } from '@/lib/orders';

export async function GET(req: Request) {
  const auth = authenticate(req);
  if ('response' in auth) return auth.response;
  const s = auth.seller;
  return NextResponse.json({
    id: s.id, store_name: s.store_name, slug: s.slug, governorate: s.governorate,
    status: s.status, kyc_status: s.kyc_status, visible: !!s.visible,
    balances: sellerBalances(s.id), currency: 'SYP',
  });
}

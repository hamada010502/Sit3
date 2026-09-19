import { NextResponse } from 'next/server';
import { apiError, authenticate } from '@/lib/api';
import { audit } from '@/lib/audit';
import { getOrder, OrderError, publicOrder, sellerHandOff } from '@/lib/orders';

/** Hand-off over the API: the same required transition the dashboard performs. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = authenticate(req);
  if ('response' in auth) return auth.response;
  const order = getOrder(params.id);
  if (!order || order.seller_id !== auth.seller.id) return apiError('not_found', 'No such order.', 404);
  const body = await req.json().catch(() => ({}));
  try {
    await sellerHandOff(order, auth.seller.id, String(body.reference || ''), String(body.tracking_number || ''));
  } catch (e) {
    if (e instanceof OrderError) return apiError('invalid_state', e.message, 409);
    throw e;
  }
  audit('api', auth.seller.id, auth.seller.store_name, 'order', order.id, 'closed.via_api');
  return NextResponse.json(publicOrder(getOrder(order.id)!));
}

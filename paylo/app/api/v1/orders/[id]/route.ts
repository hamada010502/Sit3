import { NextResponse } from 'next/server';
import { apiError, authenticate } from '@/lib/api';
import { getOrder, getOrderEvents, publicOrder } from '@/lib/orders';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = authenticate(req);
  if ('response' in auth) return auth.response;
  const order = getOrder(params.id);
  if (!order || order.seller_id !== auth.seller.id) return apiError('not_found', 'No such order.', 404);
  return NextResponse.json({
    ...publicOrder(order),
    events: getOrderEvents(order.id).map((e) => ({ at: e.created_at, from: e.from_status, to: e.to_status, state: e.to_state, actor: e.actor, note: e.note })),
  });
}

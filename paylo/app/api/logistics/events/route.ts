import { NextResponse } from 'next/server';
import { applyCourierEvent, getOrderByCode, OrderError, type CourierEvent } from '@/lib/orders';
import { verifySignature } from '@/lib/webhooks';

const EVENTS: CourierEvent[] = ['picked_up', 'in_transit', 'delivered'];

/**
 * Inbound courier events from Paylo's rider app or the Yalla Go integration.
 * Signed with the same scheme as outbound webhooks:
 *   Paylo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * using LOGISTICS_WEBHOOK_SECRET. Body: { order_code, event, courier, reference? }.
 */
export async function POST(req: Request) {
  const secret = process.env.LOGISTICS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'LOGISTICS_WEBHOOK_SECRET is not configured' }, { status: 501 });
  const raw = await req.text();
  if (!verifySignature(secret, raw, req.headers.get('paylo-signature') || '')) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: { order_code?: string; event?: string; courier?: string; reference?: string };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const event = body.event as CourierEvent;
  if (!body.order_code || !EVENTS.includes(event) || !body.courier) {
    return NextResponse.json({ error: 'order_code, event (picked_up|in_transit|delivered) and courier are required' }, { status: 400 });
  }
  const order = getOrderByCode(body.order_code);
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  try {
    const result = await applyCourierEvent(order, event, String(body.courier).slice(0, 60), body.reference ? String(body.reference).slice(0, 80) : null);
    return NextResponse.json({ ok: true, result, status: getOrderByCode(body.order_code)!.status });
  } catch (e) {
    if (e instanceof OrderError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

import { NextResponse } from 'next/server';
import { WEBHOOK_EVENTS } from '@/lib/webhooks';

/** Service description. The only unauthenticated endpoint. */
export async function GET() {
  return NextResponse.json({
    name: 'Paylo API',
    version: '1',
    auth: 'Bearer token — create one under Seller → Webhooks & API.',
    endpoints: [
      'GET  /api/v1/me',
      'GET  /api/v1/orders?state=open|closed|cancelled|returned&limit=&offset=',
      'GET  /api/v1/orders/{id}',
      'POST /api/v1/orders/{id}/close   { reference?, tracking_number? }',
      'GET  /api/v1/products',
      'GET  /api/v1/payouts',
    ],
    webhook_events: WEBHOOK_EVENTS,
    webhook_signature: 'Paylo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">',
  });
}

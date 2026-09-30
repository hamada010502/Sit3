import { NextResponse } from 'next/server';
import { retryDueDeliveries } from '@/lib/webhooks';

/**
 * Webhook retry worker tick, for cron or `npm run worker:webhooks` — call it every minute.
 * Guarded by WEBHOOK_RETRY_SECRET (unset = disabled, 501), like refresh-analytics.
 */
export async function POST(req: Request) {
  const secret = process.env.WEBHOOK_RETRY_SECRET;
  if (!secret) return NextResponse.json({ error: 'WEBHOOK_RETRY_SECRET is not configured' }, { status: 501 });
  if (req.headers.get('x-worker-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await retryDueDeliveries()) });
}

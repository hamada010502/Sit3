import { NextResponse } from 'next/server';
import { setSetting } from '@/lib/db';
import { retryDueDeliveries } from '@/lib/webhooks';

/**
 * Webhook retry worker tick, for cron or `npm run worker:webhooks` — call it every minute.
 * Guarded by WEBHOOK_RETRY_SECRET (unset = disabled, 501), like refresh-analytics.
 */
export async function POST(req: Request) {
  const secret = process.env.WEBHOOK_RETRY_SECRET;
  if (!secret) return NextResponse.json({ error: 'WEBHOOK_RETRY_SECRET is not configured' }, { status: 501 });
  if (req.headers.get('x-worker-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Heartbeat: Admin → Operations warns when the worker has not called in for 5 minutes.
  setSetting('webhook_worker_last_run', new Date().toISOString());
  return NextResponse.json({ ok: true, ...(await retryDueDeliveries()) });
}

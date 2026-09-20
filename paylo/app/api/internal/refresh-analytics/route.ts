import { NextResponse } from 'next/server';
import { computeMarketAnalytics, computeOwnerOverview, MARKET_KEY, OVERVIEW_KEY, writeCache } from '@/lib/analytics';

/**
 * For a scheduled job (cron / Windows Task Scheduler) to call periodically, e.g. every
 * 15 minutes — see docs/technical-addendum.md. This is the ONLY automatic trigger for
 * recomputing owner-dashboard data; nothing recomputes on an ordinary page view.
 * Guarded by a shared secret rather than a session cookie, since a cron job has no
 * browser session to send.
 */
export async function POST(req: Request) {
  const secret = process.env.ANALYTICS_REFRESH_SECRET;
  if (!secret) return NextResponse.json({ error: 'ANALYTICS_REFRESH_SECRET is not configured' }, { status: 501 });
  if (req.headers.get('x-refresh-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  writeCache(OVERVIEW_KEY, computeOwnerOverview());
  writeCache(MARKET_KEY, computeMarketAnalytics());
  return NextResponse.json({ ok: true, refreshed_at: new Date().toISOString() });
}

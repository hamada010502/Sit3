import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyOwnerToken, OWNER_COOKIE } from '@/lib/owner-token';

/**
 * Runs on the Edge runtime, ahead of any page or layout code — the app's DB
 * (better-sqlite3, a native binding) is not reachable here, which is why owner
 * authorization is a signed, stateless token rather than a DB lookup. The token is
 * only ever issued in lib/auth.ts's createSession(), and only for the one hard-coded
 * account (see lib/owner.ts) with 2FA already on.
 *
 * A request that fails the check is rewritten to a path with no matching route, so
 * Next's ordinary not-found handling renders app/not-found.tsx with a plain 404 —
 * identical to hitting a route that was never built. This is deliberate: an "access
 * denied" response would confirm the route exists, which is exactly what a route this
 * sensitive should not do.
 */
export const config = { matcher: ['/owner', '/owner/:path*'] };

export async function middleware(req: NextRequest) {
  const claim = await verifyOwnerToken(req.cookies.get(OWNER_COOKIE)?.value);
  if (!claim) {
    return NextResponse.rewrite(new URL('/__route_does_not_exist__', req.url));
  }
  return NextResponse.next();
}

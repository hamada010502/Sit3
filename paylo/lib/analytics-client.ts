'use client';
/**
 * Browser side of the funnel: an anonymous session id (first-party cookie, no personal
 * data) and a fire-and-forget POST to /api/analytics/collect. Failures are ignored — this
 * must never affect the page.
 */
const SID = 'paylo_sid';

export function sessionId(): string {
  try {
    const m = document.cookie.match(/(?:^|; )paylo_sid=([^;]+)/);
    if (m) return m[1];
    const id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
    document.cookie = `${SID}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    return id;
  } catch { return ''; }
}

export function sendEvent(name: string, data: { product_id?: string; variant_id?: string | null; store_slug?: string; props?: Record<string, unknown> } = {}) {
  try {
    sessionId();
    fetch('/api/analytics/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...data }), keepalive: true }).catch(() => {});
  } catch { /* never break the page */ }
}

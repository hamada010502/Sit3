/*
 * Minimal webhook retry worker for a single server: calls the retry endpoint every
 * 60 seconds. On a host with cron, a cron job doing the same POST works too.
 * Usage: WEBHOOK_RETRY_SECRET=... APP_URL=http://localhost:3000 npm run worker:webhooks
 */
const APP = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const SECRET = process.env.WEBHOOK_RETRY_SECRET;
if (!SECRET) { console.error('Set WEBHOOK_RETRY_SECRET (same value the app uses).'); process.exit(1); }
async function tick() {
  try {
    const r = await fetch(APP + '/api/internal/webhooks/retry', { method: 'POST', headers: { 'x-worker-secret': SECRET } });
    const j = await r.json().catch(() => ({}));
    // A wrong secret (401) or an unset one on the server (501) must be loud, not silent.
    if (!r.ok) { console.error(new Date().toISOString(), `retry endpoint answered HTTP ${r.status}:`, j.error || ''); return; }
    if (j.retried) console.log(new Date().toISOString(), j);
  } catch (e) { console.error(new Date().toISOString(), 'worker tick failed:', e.message); }
}
tick();
setInterval(tick, 60_000);

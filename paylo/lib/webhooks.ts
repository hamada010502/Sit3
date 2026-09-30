import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb, newId } from './db';
import type { WebhookDelivery, WebhookEndpoint } from './types';

/**
 * Outbound webhooks (Functional Spec §5.4). Every delivery is signed:
 *
 *   Paylo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *
 * Receivers must recompute the MAC over the raw body and compare in constant time,
 * and reject timestamps outside their tolerance to stop replays.
 */
export const WEBHOOK_EVENTS = [
  'order.created', 'order.updated', 'order.closed', 'refund.created', 'refund.updated', 'payout.sent',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const TIMEOUT_MS = 4000;

export function newWebhookSecret() { return 'whsec_' + randomBytes(24).toString('hex'); }

export function signPayload(secret: string, body: string, tsSeconds: number) {
  return createHmac('sha256', secret).update(`${tsSeconds}.${body}`).digest('hex');
}

/** Verifies a `Paylo-Signature` header. Exposed so receivers (and tests) share one implementation. */
export function verifySignature(secret: string, body: string, header: string, toleranceS = 300, nowMs = Date.now()) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((x) => x.trim()) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > toleranceS) return false;
  const expected = Buffer.from(signPayload(secret, body, t));
  const given = Buffer.from(String(parts.v1 || ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function endpointsFor(event: string, sellerId: string | null): WebhookEndpoint[] {
  const rows = getDb().prepare(
    'SELECT * FROM webhook_endpoints WHERE active = 1 AND (seller_id IS NULL OR seller_id = ?)',
  ).all(sellerId) as WebhookEndpoint[];
  return rows.filter((e) => e.events === '*' || e.events.split(',').map((s) => s.trim()).includes(event));
}

/** Retry schedule after attempt n (1-based): 1m, 5m, 30m, 2h, 6h. Attempt 6 failing → dead. */
export const RETRY_DELAYS_S = [60, 300, 1800, 7200, 21600];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;
const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

async function send(ep: WebhookEndpoint, event: string, body: string): Promise<{ ok: boolean; code: number | null; error: string | null }> {
  // Fresh timestamp per attempt so a retry passes receivers' replay window; the body (and
  // its event id) is identical every time, so receivers can de-duplicate on `id`.
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'paylo-signature': `t=${ts},v1=${signPayload(ep.secret, body, ts)}`, 'paylo-event': event },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, code: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, code: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fire-and-record. Failures never surface to the caller — a broken endpoint must not fail a
 * checkout. A failed delivery is queued for retry (see retryDueDeliveries). */
export async function emitWebhook(event: WebhookEvent, data: unknown, sellerId: string | null = null) {
  const targets = endpointsFor(event, sellerId);
  if (targets.length === 0) return;
  const body = JSON.stringify({ id: newId(), event, created_at: new Date().toISOString(), data });
  const db = getDb();
  await Promise.all(targets.map(async (ep) => {
    const r = await send(ep, event, body);
    db.prepare(`INSERT INTO webhook_deliveries (endpoint_id, event, payload, status, response_code, error, attempts, last_attempt_at, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(ep.id, event, body, r.ok ? 'delivered' : 'failed', r.code, r.error, stamp(Date.now()), r.ok ? null : stamp(Date.now() + RETRY_DELAYS_S[0] * 1000));
  }));
}

/**
 * Retry worker. Picks failed deliveries whose next attempt is due and re-sends them.
 * Each one is claimed with a conditional UPDATE (pushing next_attempt_at forward by a
 * lease) before sending, so two workers running at once never send the same delivery twice.
 */
export async function retryDueDeliveries(limit = 50, nowMs = Date.now()): Promise<{ retried: number; delivered: number; dead: number }> {
  const db = getDb();
  const due = db.prepare(`SELECT d.*, e.url, e.secret, e.active FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.status = 'failed' AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= ? ORDER BY d.next_attempt_at LIMIT ?`)
    .all(stamp(nowMs), limit) as (WebhookDelivery & { url: string; secret: string; active: number; next_attempt_at: string })[];
  const out = { retried: 0, delivered: 0, dead: 0 };
  for (const d of due) {
    const claimed = db.prepare("UPDATE webhook_deliveries SET next_attempt_at = ? WHERE id = ? AND status = 'failed' AND next_attempt_at = ?")
      .run(stamp(nowMs + 120_000), d.id, d.next_attempt_at).changes === 1;
    if (!claimed) continue;
    if (!d.active) { db.prepare("UPDATE webhook_deliveries SET status = 'dead', next_attempt_at = NULL, error = 'endpoint disabled' WHERE id = ?").run(d.id); out.dead++; continue; }
    const r = await send({ id: d.endpoint_id, url: d.url, secret: d.secret } as WebhookEndpoint, d.event, d.payload);
    const attempts = d.attempts + 1;
    out.retried++;
    if (r.ok) {
      db.prepare("UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, response_code = ?, error = NULL, last_attempt_at = ?, next_attempt_at = NULL WHERE id = ?")
        .run(attempts, r.code, stamp(Date.now()), d.id);
      out.delivered++;
    } else if (attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE webhook_deliveries SET status = 'dead', attempts = ?, response_code = ?, error = ?, last_attempt_at = ?, next_attempt_at = NULL WHERE id = ?")
        .run(attempts, r.code, r.error, stamp(Date.now()), d.id);
      out.dead++;
    } else {
      db.prepare('UPDATE webhook_deliveries SET attempts = ?, response_code = ?, error = ?, last_attempt_at = ?, next_attempt_at = ? WHERE id = ?')
        .run(attempts, r.code, r.error, stamp(Date.now()), stamp(Date.now() + RETRY_DELAYS_S[attempts - 1] * 1000), d.id);
    }
  }
  return out;
}

/** Manual "retry now" from the dashboard: makes a failed or dead delivery due immediately. */
export function requeueDelivery(deliveryId: number, sellerId: string): boolean {
  return getDb().prepare(`UPDATE webhook_deliveries SET status = 'failed', next_attempt_at = ?,
      attempts = CASE WHEN status = 'dead' THEN ? ELSE attempts END
    WHERE id = ? AND status IN ('failed','dead')
      AND endpoint_id IN (SELECT id FROM webhook_endpoints WHERE seller_id = ?)`)
    .run(stamp(Date.now()), MAX_ATTEMPTS - 1, deliveryId, sellerId).changes === 1;
}

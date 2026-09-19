import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb, newId } from './db';
import type { WebhookEndpoint } from './types';

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

/** Fire-and-record. Failures never surface to the caller — a broken endpoint must not fail a checkout. */
export async function emitWebhook(event: WebhookEvent, data: unknown, sellerId: string | null = null) {
  const targets = endpointsFor(event, sellerId);
  if (targets.length === 0) return;
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: newId(), event, created_at: new Date().toISOString(), data });
  const db = getDb();
  await Promise.all(targets.map(async (ep) => {
    let status = 'failed', code: number | null = null, error: string | null = null;
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'paylo-signature': `t=${ts},v1=${signPayload(ep.secret, body, ts)}`, 'paylo-event': event },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      code = res.status;
      status = res.ok ? 'delivered' : 'failed';
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    db.prepare('INSERT INTO webhook_deliveries (endpoint_id, event, payload, status, response_code, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ep.id, event, body, status, code, error);
  }));
}

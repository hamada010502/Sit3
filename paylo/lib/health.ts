import { getDb, getSetting } from './db';
import { getPaymentProvider } from './payments';
import { ALL_METHODS, paymentMethodStatus } from './payment-methods';

export type CheckLevel = 'ok' | 'warn' | 'error';
export interface ConfigCheck { name: string; level: CheckLevel; note: HealthNote }
export type HealthNote =
  | 'hc_ok' | 'hc_default_secret' | 'hc_missing' | 'hc_localhost' | 'hc_vapid_stored' | 'hc_vapid_half'
  | 'hc_retry_off' | 'hc_http_missing' | 'hc_log_transport' | 'hc_worker_never' | 'hc_worker_stale'
  | 'hc_pay_on' | 'hc_pay_off' | 'hc_pay_none' | 'hc_card_mock_prod' | 'hc_card_blocked';

const env = (k: string) => (process.env[k] || '').trim();

/**
 * Production configuration, checked from the running server's own environment. Values are
 * never returned — only whether each is set and sane. Shown on Admin → Operations.
 */
export function configChecks(): ConfigCheck[] {
  const out: ConfigCheck[] = [];
  const add = (name: string, level: CheckLevel, note: HealthNote) => out.push({ name, level, note });

  const ss = env('SESSION_SECRET');
  add('SESSION_SECRET', !ss ? 'error' : ss === 'change-me-in-production' ? 'error' : 'ok', !ss ? 'hc_missing' : ss === 'change-me-in-production' ? 'hc_default_secret' : 'hc_ok');

  const app = env('APP_URL');
  add('APP_URL', !app ? 'error' : /localhost|127\.0\.0\.1/.test(app) ? 'warn' : 'ok', !app ? 'hc_missing' : /localhost|127\.0\.0\.1/.test(app) ? 'hc_localhost' : 'hc_ok');

  const vp = env('VAPID_PUBLIC_KEY'), vk = env('VAPID_PRIVATE_KEY');
  if (vp && vk) add('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY', 'ok', 'hc_ok');
  else if (vp || vk) add('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY', 'error', 'hc_vapid_half');
  else add('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY', 'warn', 'hc_vapid_stored');
  add('VAPID_SUBJECT', env('VAPID_SUBJECT') ? 'ok' : 'warn', env('VAPID_SUBJECT') ? 'hc_ok' : 'hc_missing');

  add('WEBHOOK_RETRY_SECRET', env('WEBHOOK_RETRY_SECRET') ? 'ok' : 'error', env('WEBHOOK_RETRY_SECRET') ? 'hc_ok' : 'hc_retry_off');

  for (const [ch, T] of [['SMS', 'SMS_TRANSPORT'], ['WHATSAPP', 'WHATSAPP_TRANSPORT'], ['EMAIL', 'EMAIL_TRANSPORT']] as const) {
    const transport = (env(T) || 'log').toLowerCase();
    if (transport === 'log') { add(T, 'warn', 'hc_log_transport'); continue; }
    if (ch === 'EMAIL') { add(T, env('SMTP_HOST') ? 'ok' : 'error', env('SMTP_HOST') ? 'hc_ok' : 'hc_http_missing'); continue; }
    const complete = env(`${ch}_HTTP_URL`) && env(`${ch}_HTTP_TOKEN`);
    add(`${T} (${ch}_HTTP_URL / ${ch}_HTTP_TOKEN)`, complete ? 'ok' : 'error', complete ? 'hc_ok' : 'hc_http_missing');
  }

  // Payment methods: state only, never provider credentials.
  const live = ALL_METHODS.filter((m) => !paymentMethodStatus(m).block);
  if (live.length === 0) add('Payment methods', 'error', 'hc_pay_none');
  for (const m of ALL_METHODS) {
    const st = paymentMethodStatus(m);
    if (m === 'card' && st.adminOn && st.block) { add('Payment: card', 'error', 'hc_card_blocked'); continue; }
    if (m === 'card' && !st.block && getPaymentProvider().name === 'mock' && process.env.NODE_ENV === 'production' && !/localhost|127\.0\.0\.1/.test(env('APP_URL'))) {
      add('Payment: card', 'error', 'hc_card_mock_prod'); continue;
    }
    add(`Payment: ${m}`, st.block ? 'warn' : 'ok', st.block ? 'hc_pay_off' : 'hc_pay_on');
  }

  const last = getSetting('webhook_worker_last_run');
  const ageMin = last ? (Date.now() - new Date(last).getTime()) / 60000 : Infinity;
  add('Webhook retry worker', !last ? 'error' : ageMin > 5 ? 'error' : 'ok', !last ? 'hc_worker_never' : ageMin > 5 ? 'hc_worker_stale' : 'hc_ok');
  return out;
}

export function workerLastRun(): string | null { return getSetting('webhook_worker_last_run') || null; }

/** Delivery counters for the ops page: push, text/email notifications, webhooks. */
export function deliveryStats() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    pushSubscriptions: one('SELECT count(*) c FROM push_subscriptions'),
    pushSellers: one('SELECT count(DISTINCT seller_id) c FROM push_subscriptions'),
    pushFailed7d: one("SELECT count(*) c FROM push_failures WHERE created_at >= datetime('now','-7 days')"),
    pushRemoved7d: one("SELECT count(*) c FROM push_failures WHERE removed = 1 AND created_at >= datetime('now','-7 days')"),
    notifyFailed7d: one("SELECT count(*) c FROM notifications WHERE status LIKE 'failed%' AND created_at >= datetime('now','-7 days')"),
    webhooksDelivered24h: one("SELECT count(*) c FROM webhook_deliveries WHERE status = 'delivered' AND created_at >= datetime('now','-1 day')"),
    webhooksRetrying: one("SELECT count(*) c FROM webhook_deliveries WHERE status = 'failed'"),
    // A retry that was due over 5 minutes ago means the worker is not running.
    webhooksOverdue: one("SELECT count(*) c FROM webhook_deliveries WHERE status = 'failed' AND next_attempt_at < datetime('now','-5 minutes')"),
    webhooksDead: one("SELECT count(*) c FROM webhook_deliveries WHERE status = 'dead'"),
  };
}

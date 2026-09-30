import { getDb, getSetting } from './db';
import type { NotificationChannel } from './types';

/**
 * Outbound notifications (Full Spec v2 §6).
 *
 * v2 prefers SMS/WhatsApp over email for this user base, but no SMS gateway is
 * contracted yet, so every channel defaults to the `log` transport: the exact message
 * is written to the `notifications` table and visible in Admin → Notifications.
 * Point SMS_TRANSPORT / EMAIL_TRANSPORT at a real provider to start sending; no
 * calling code changes.
 */
export interface NotifyInput {
  event: string;
  email?: { to?: string | null; subject: string; body: string };
  sms?: { to?: string | null; body: string };
  whatsapp?: { to?: string | null; body: string };
}

function record(channel: NotificationChannel, recipient: string, event: string, subject: string | null, body: string, transport: string, status: string) {
  getDb().prepare('INSERT INTO notifications (channel, recipient, event, subject, body, transport, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(channel, recipient, event, subject, body, transport, status);
}

async function sendEmailVia(to: string, subject: string, body: string): Promise<string> {
  const transport = (process.env.EMAIL_TRANSPORT || 'log').toLowerCase();
  if (transport !== 'smtp') return 'logged';
  try {
    const nodemailer = (await import('nodemailer')).default;
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await t.sendMail({ from: process.env.EMAIL_FROM || 'Paylo <no-reply@paylo.sy>', to, subject, text: body });
    return 'sent';
  } catch (e) {
    return 'failed: ' + (e instanceof Error ? e.message : String(e));
  }
}

/**
 * SMS / WhatsApp delivery. Transports (SMS_TRANSPORT / WHATSAPP_TRANSPORT):
 *   log  — record only (default; nothing leaves the server)
 *   http — POST {"to","body","channel"} as JSON to SMS_HTTP_URL / WHATSAPP_HTTP_URL with
 *          "Authorization: Bearer <SMS_HTTP_TOKEN / WHATSAPP_HTTP_TOKEN>". Fits the usual
 *          regional SMS HTTP APIs and WhatsApp BSPs directly or through a thin relay.
 * Returns the status string recorded in `notifications`: sent, logged, failed: …, skipped: ….
 */
async function sendTextVia(channel: 'sms' | 'whatsapp', to: string, body: string): Promise<string> {
  const P = channel === 'sms' ? 'SMS' : 'WHATSAPP';
  const transport = (process.env[`${P}_TRANSPORT`] || 'log').toLowerCase();
  if (transport === 'log') return 'logged';
  if (transport !== 'http') return `skipped: unknown transport "${transport}"`;
  const url = process.env[`${P}_HTTP_URL`];
  if (!url) return `skipped: ${P}_HTTP_URL not set`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env[`${P}_HTTP_TOKEN`] ? { authorization: `Bearer ${process.env[`${P}_HTTP_TOKEN`]}` } : {}) },
      body: JSON.stringify({ to, body, channel }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? 'sent' : `failed: HTTP ${res.status}`;
  } catch (e) {
    return 'failed: ' + (e instanceof Error ? e.message : String(e));
  }
}

export async function notify(input: NotifyInput) {
  const emailOn = getSetting('notify_email') !== '0';
  const smsOn = getSetting('notify_sms') !== '0';

  if (input.email?.to && emailOn) {
    const status = await sendEmailVia(input.email.to, input.email.subject, input.email.body);
    record('email', input.email.to, input.event, input.email.subject, input.email.body, (process.env.EMAIL_TRANSPORT || 'log').toLowerCase(), status);
  }
  // Buyer text messages go out on one channel, chosen by the admin `text_channel`
  // setting — WhatsApp is often more reliable than SMS in Syria, but never both at once.
  const textChannel = getSetting('text_channel') === 'whatsapp' ? 'whatsapp' : 'sms';
  if (input.sms?.to && smsOn) {
    const status = await sendTextVia(textChannel, input.sms.to, input.sms.body);
    const transport = (process.env[textChannel === 'sms' ? 'SMS_TRANSPORT' : 'WHATSAPP_TRANSPORT'] || 'log').toLowerCase();
    record(textChannel, input.sms.to, input.event, null, input.sms.body, transport, status);
  }
  if (input.whatsapp?.to && smsOn) {
    const status = await sendTextVia('whatsapp', input.whatsapp.to, input.whatsapp.body);
    record('whatsapp', input.whatsapp.to, input.event, null, input.whatsapp.body, (process.env.WHATSAPP_TRANSPORT || 'log').toLowerCase(), status);
  }
}

export function appUrl(path: string) {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '') + path;
}

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
 * Hook for a real SMS/WhatsApp gateway. Returns the delivery status string that gets
 * recorded. Left as `logged` until a regional provider is contracted.
 */
async function sendTextVia(channel: 'sms' | 'whatsapp', _to: string, _body: string): Promise<string> {
  const transport = (process.env[channel === 'sms' ? 'SMS_TRANSPORT' : 'WHATSAPP_TRANSPORT'] || 'log').toLowerCase();
  if (transport === 'log') return 'logged';
  return 'skipped: no gateway configured';
}

export async function notify(input: NotifyInput) {
  const emailOn = getSetting('notify_email') !== '0';
  const smsOn = getSetting('notify_sms') !== '0';

  if (input.email?.to && emailOn) {
    const status = await sendEmailVia(input.email.to, input.email.subject, input.email.body);
    record('email', input.email.to, input.event, input.email.subject, input.email.body, (process.env.EMAIL_TRANSPORT || 'log').toLowerCase(), status);
  }
  if (input.sms?.to && smsOn) {
    const status = await sendTextVia('sms', input.sms.to, input.sms.body);
    record('sms', input.sms.to, input.event, null, input.sms.body, (process.env.SMS_TRANSPORT || 'log').toLowerCase(), status);
  }
  if (input.whatsapp?.to && smsOn) {
    const status = await sendTextVia('whatsapp', input.whatsapp.to, input.whatsapp.body);
    record('whatsapp', input.whatsapp.to, input.event, null, input.whatsapp.body, (process.env.WHATSAPP_TRANSPORT || 'log').toLowerCase(), status);
  }
}

export function appUrl(path: string) {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '') + path;
}

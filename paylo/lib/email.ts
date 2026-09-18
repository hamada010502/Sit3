import { getDb } from './db';

/**
 * Email notifications. Default transport "log" writes every message to the email_log
 * table (visible under Admin → Emails) so the flow can be verified without an SMTP
 * account. Set EMAIL_TRANSPORT=smtp plus SMTP_* variables to send for real
 * (requires `npm i nodemailer`; loaded lazily so it is optional).
 */
export async function sendEmail(to: string | null | undefined, subject: string, body: string) {
  if (!to) return;
  const transport = (process.env.EMAIL_TRANSPORT || 'log').toLowerCase();
  let status = 'logged';
  if (transport === 'smtp') {
    try {
      // eslint-disable-next-line
      const nodemailer = require('nodemailer');
      const t = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      await t.sendMail({ from: process.env.EMAIL_FROM || 'Paylo <no-reply@paylo.sy>', to, subject, text: body });
      status = 'sent';
    } catch (e) {
      status = 'failed: ' + (e instanceof Error ? e.message : String(e));
    }
  }
  getDb().prepare('INSERT INTO email_log (to_email, subject, body, transport, status) VALUES (?, ?, ?, ?, ?)').run(to, subject, body, transport, status);
}

export function appUrl(path: string) {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '') + path;
}

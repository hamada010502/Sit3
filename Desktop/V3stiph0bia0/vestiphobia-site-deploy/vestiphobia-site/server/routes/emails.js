/**
 * VESTIPHOBIA — transactional email.
 *
 * Only ONE email exists: the shipping notification. No marketing, by explicit
 * scope decision.
 *
 * Mail is written to an outbox table rather than sent inline. A failing SMTP
 * provider must never roll back or block an order status change the admin has
 * already made — the order is the source of truth, the email is a side effect.
 *
 * No provider is configured, so nothing is dispatched yet. Rows sit QUEUED and
 * the admin can see exactly what would have been sent. Wire a provider in
 * `dispatch()` and the queue drains.
 */

import { getDb, newId, now, fromCents } from '../db/index.js';
import { getContent } from './settings.js';

function render(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] === undefined || vars[k] === null ? '' : String(vars[k])
  );
}

export async function queueShippedEmail(order, items) {
  if (!order.customer_email) return { queued: false, reason: 'no email on the order' };

  const db = await getDb();
  const tmpl = await db.get('SELECT * FROM email_templates WHERE key = ?', ['order_shipped']);
  if (!tmpl || !Number(tmpl.enabled)) return { queued: false, reason: 'template disabled' };

  const content = await getContent();
  const vars = {
    ORDER_ID: order.order_number,
    CUSTOMER_NAME: order.customer_name,
    ITEMS: items.map((i) => `${i.product_name} — Size ${i.size} × ${i.quantity}`).join(', '),
    TOTAL: `$${fromCents(order.total_cents)} ${order.currency}`,
    DELIVERY_ESTIMATE: content['shipping.delivery_estimate'] || '',
    CITY: order.city,
  };

  await db.run(
    `INSERT INTO email_outbox (id, to_address, subject, body, template_key, order_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
    [
      newId(),
      order.customer_email,
      render(tmpl.subject, vars),
      render(tmpl.body, vars),
      'order_shipped',
      order.order_number,
      now(),
    ]
  );
  return { queued: true };
}

export async function listOutbox(limit = 50) {
  const db = await getDb();
  return db.all('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getTemplates() {
  const db = await getDb();
  return db.all('SELECT * FROM email_templates ORDER BY key');
}

export async function updateTemplate(key, { subject, body, enabled }) {
  const db = await getDb();
  const r = await db.run(
    'UPDATE email_templates SET subject = ?, body = ?, enabled = ?, updated_at = ? WHERE key = ?',
    [String(subject ?? ''), String(body ?? ''), enabled ? 1 : 0, now(), key]
  );
  return { ok: r.changes > 0 };
}

/**
 * Drain the queue. Deliberately unimplemented: no provider is configured, and
 * pretending otherwise would mean rows silently marked SENT that never arrived.
 *
 * To enable, add a provider call here (Resend, Postmark, SES, SMTP) and mark
 * each row SENT only on a confirmed accept. Failures increment `attempts` and
 * record `last_error`, so a permanently failing address is visible rather than
 * retried forever in silence.
 */
export async function dispatch() {
  return {
    sent: 0,
    skipped: true,
    reason: 'No email provider configured. Queued mail is visible in Admin → Emails.',
  };
}

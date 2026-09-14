/**
 * VESTIPHOBIA — input validation.
 *
 * Every value crossing the API boundary is validated here. Nothing reaches a
 * query without passing through one of these, and everything is parameterised
 * at the adapter, so SQL injection has no surface to work with.
 *
 * Validators return { ok, value } or { ok: false, error } — never throw for
 * ordinary bad input, because bad input from the public internet is expected
 * traffic, not an exceptional condition.
 */

export const ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'REJECTED',
];

export const PRODUCT_STATUSES = ['DRAFT', 'PUBLISHED', 'SOLD_OUT', 'HIDDEN', 'ARCHIVED'];

/** Trim, collapse whitespace, and cap length. Also strips control characters. */
export function cleanText(v, { max = 500 } = {}) {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Like cleanText but keeps newlines — for addresses and notes. */
export function cleanMultiline(v, { max = 2000 } = {}) {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * Normalise a phone number to full international digits.
 *
 * This is the customer's identity, so it must be deterministic: 0965438999,
 * +963 965 438 999 and 00963965438999 all have to land on the same string, or
 * one person becomes three customers and the returning discount silently fails.
 */
export function normalisePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = '963' + d.slice(1); // Syrian local form
  return d.slice(0, 15);
}

export function validPhone(raw) {
  const phone = normalisePhone(raw);
  if (phone.length < 8) return { ok: false, error: 'Enter a full phone number.' };
  if (phone.length > 15) return { ok: false, error: 'That phone number is too long.' };
  return { ok: true, value: phone };
}

export function validEmail(raw, { required = false } = {}) {
  const email = cleanText(raw, { max: 254 }).toLowerCase();
  if (!email) {
    return required ? { ok: false, error: 'Email is required.' } : { ok: true, value: '' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  return { ok: true, value: email };
}

export function validEnum(raw, allowed, label = 'value') {
  const v = String(raw ?? '').toUpperCase().trim();
  if (!allowed.includes(v)) {
    return { ok: false, error: `Unknown ${label}: ${v || '(empty)'}` };
  }
  return { ok: true, value: v };
}

export function validInt(raw, { min = 0, max = 1_000_000, label = 'number' } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: `${label} must be a whole number.` };
  }
  if (n < min || n > max) {
    return { ok: false, error: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value: n };
}

/**
 * The public order payload.
 *
 * Note what is NOT taken from the client: prices, discounts and totals. Those
 * are recomputed server-side from the catalogue in routes/orders.js. A client
 * that posts `total: 1` gets an order for the real price — the number it sent
 * is simply never read.
 */
export function validOrderPayload(body) {
  const errors = {};

  const fullName = cleanText(body.fullName, { max: 120 });
  if (fullName.length < 2) errors.fullName = 'Enter your full name.';

  const phone = validPhone(body.phone);
  if (!phone.ok) errors.phone = phone.error;

  const city = cleanText(body.city, { max: 80 });
  if (city.length < 2) errors.city = 'Enter your city.';

  const address = cleanMultiline(body.address, { max: 500 });
  if (address.length < 10) errors.address = 'Enter a delivery address the courier can find.';

  const email = validEmail(body.email);
  if (!email.ok) errors.email = email.error;

  const notes = cleanMultiline(body.notes, { max: 1000 });

  // Items: slug + size + quantity only. Everything else is server-side.
  const items = [];
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.items = 'Your cart is empty.';
  } else if (body.items.length > 50) {
    errors.items = 'Too many lines in one order.';
  } else {
    for (const raw of body.items) {
      const slug = cleanText(raw?.slug, { max: 120 });
      const size = cleanText(raw?.size, { max: 12 }).toUpperCase();
      const qty = validInt(raw?.quantity, { min: 1, max: 99, label: 'Quantity' });
      if (!slug || !size || !qty.ok) {
        errors.items = 'One of the cart lines is invalid.';
        break;
      }
      items.push({ slug, size, quantity: qty.value });
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      fullName,
      phone: phone.value,
      phoneRaw: cleanText(body.phone, { max: 40 }),
      city,
      address,
      email: email.value,
      notes,
      items,
      // Attribution is optional and never trusted for anything but reporting.
      utm: {
        source: cleanText(body.utm?.source, { max: 80 }) || null,
        medium: cleanText(body.utm?.medium, { max: 80 }) || null,
        campaign: cleanText(body.utm?.campaign, { max: 120 }) || null,
      },
      referrer: cleanText(body.referrer, { max: 300 }) || null,
    },
  };
}

/** Escape for HTML interpolation in the server-rendered admin. */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * VESTIPHOBIA — settings and content.
 *
 * Settings are business configuration (WhatsApp destination, discount rates,
 * Sham Cash instructions). Content is customer-facing copy. Both are rows the
 * admin edits — never application source, so a content change can never break
 * the layout or the business logic.
 *
 * Rows flagged `secret` (the Sham Cash template, which holds the payment
 * account) are filtered out of every public read at the source.
 */

import { getDb, now, parseJson } from '../db/index.js';
import { audit } from '../lib/http.js';
import { processSiteImage } from '../lib/uploads.js';

export async function getSettings({ includeSecret = false } = {}) {
  const db = await getDb();
  const rows = await db.all(
    includeSecret ? 'SELECT key, value FROM settings' : 'SELECT key, value FROM settings WHERE secret = 0'
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSettingRows() {
  const db = await getDb();
  return db.all('SELECT * FROM settings ORDER BY group_name, key');
}

export async function setSetting(key, value, { adminId, ip } = {}) {
  const db = await getDb();
  const existing = await db.get('SELECT key FROM settings WHERE key = ?', [key]);
  if (!existing) return { ok: false, error: `Unknown setting: ${key}` };

  await db.run('UPDATE settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?', [
    String(value ?? ''),
    now(),
    adminId || null,
    key,
  ]);
  // The value itself is not logged: a setting can hold the Sham Cash account.
  await audit('setting.update', { adminId, entityType: 'setting', entityId: key, ip });
  return { ok: true };
}

/** Discount config in the exact shape the shared pricing engine expects. */
export function discountConfig(settings) {
  const tiers = parseJson(settings['discount.bundle_tiers'], []) || [];
  return {
    bundleTiers: tiers,
    returningCustomerPercent: Number(settings['discount.returning_percent'] ?? 5),
    maxPercentWithoutConfirmation: Number(settings['discount.max_percent'] ?? 20),
    freeShippingMinPieces: Number(settings['shipping.free_min_pieces'] ?? 2),
  };
}

/* ----------------------------------------------------------------- content */

export async function getContent() {
  const db = await getDb();
  const rows = await db.all('SELECT key, value, kind FROM content');
  const out = {};
  for (const r of rows) out[r.key] = r.kind === 'json' ? parseJson(r.value, null) : r.value;
  return out;
}

export async function getContentRows() {
  const db = await getDb();
  return db.all('SELECT * FROM content ORDER BY group_name, key');
}

export async function setContent(key, value, { adminId, ip } = {}) {
  const db = await getDb();
  const row = await db.get('SELECT key, kind FROM content WHERE key = ?', [key]);
  if (!row) return { ok: false, error: `Unknown content key: ${key}` };

  // A JSON field must stay valid JSON, or the page that reads it breaks.
  if (row.kind === 'json') {
    try {
      JSON.parse(value);
    } catch {
      return { ok: false, error: 'That field must be valid JSON.' };
    }
  }

  await db.run('UPDATE content SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?', [
    String(value ?? ''),
    now(),
    adminId || null,
    key,
  ]);
  await audit('content.update', { adminId, entityType: 'content', entityId: key, ip });
  return { ok: true };
}

/**
 * Upload a site image (currently just the homepage hero) and point the given
 * content key at it. Uploads before it writes the row — a failed upload
 * leaves the existing value untouched rather than pointing at nothing.
 */
export async function uploadSiteImage(key, buffer, { adminId, ip } = {}) {
  const db = await getDb();
  const row = await db.get('SELECT key FROM content WHERE key = ?', [key]);
  if (!row) return { ok: false, error: `Unknown content key: ${key}` };

  let url;
  try {
    url = await processSiteImage(buffer, `site/${key.replace(/[^a-z0-9.]+/gi, '-')}-${Date.now()}.jpg`);
  } catch (err) {
    // See the matching comment in routes/products.js's uploadProductImage():
    // this is the one place the real failure reason is written down.
    console.error(`[settings] site image upload failed for ${key}:`, err.message);
    return { ok: false, error: err.message || 'Could not process that image.' };
  }

  return setContent(key, url, { adminId, ip });
}

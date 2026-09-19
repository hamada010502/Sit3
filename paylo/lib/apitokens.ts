import { createHash, randomBytes } from 'crypto';
import { getDb, newId, nowIso } from './db';
import type { ApiToken, Seller } from './types';

/** Tokens are shown once at creation and stored only as a SHA-256 hash. */
export function createApiToken(sellerId: string, name: string): { token: string; row: ApiToken } {
  const token = 'plo_' + randomBytes(24).toString('hex');
  const id = newId();
  getDb().prepare('INSERT INTO api_tokens (id, seller_id, name, prefix, token_hash) VALUES (?, ?, ?, ?, ?)')
    .run(id, sellerId, name, token.slice(0, 12), hashToken(token));
  return { token, row: getDb().prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as ApiToken };
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Resolves a bearer token to its seller, or null. Also stamps last-used. */
export function sellerForToken(bearer: string | null): Seller | null {
  if (!bearer) return null;
  const token = bearer.replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith('plo_')) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token)) as ApiToken | undefined;
  if (!row) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  const seller = db.prepare('SELECT * FROM sellers WHERE id = ?').get(row.seller_id) as Seller | undefined;
  return seller && seller.status === 'approved' ? seller : null;
}

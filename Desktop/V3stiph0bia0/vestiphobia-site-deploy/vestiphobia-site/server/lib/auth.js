/**
 * VESTIPHOBIA — admin authentication.
 *
 * SECURITY POSTURE
 *   - Passwords are hashed with scrypt (node:crypto). No plaintext, ever.
 *   - Comparison is timing-safe.
 *   - The session cookie holds an opaque 256-bit random token. It carries no
 *     claims, so nothing a client sends can grant authority: every check is a
 *     database lookup.
 *   - Cookies are HttpOnly + SameSite=Strict, and Secure whenever the request
 *     arrived over HTTPS.
 *   - IP addresses are stored hashed, never raw.
 *   - Login is rate limited by both IP and email, so neither a single address
 *     nor a single account can be hammered.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getDb, newId, now } from '../db/index.js';

const scryptAsync = promisify(scrypt);

const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt cost. N=2^15 is the practical ceiling for an interactive login on a
// small instance; raising it further would push login past a second.
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const SESSION_DAYS = 7;
export const SESSION_COOKIE = 'vesti_admin';

/* ------------------------------------------------------------- passwords */

/**
 * Stored form: `scrypt$<salt hex>:<key hex>`.
 *
 * The algorithm prefix is there so a future move to a different KDF can be
 * made per-row: verify dispatches on the prefix and rehashes on next login,
 * instead of forcing every admin to reset their password on the day of the
 * change.
 */
const HASH_PREFIX = 'scrypt$';

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('Password must be at least 10 characters.');
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEYLEN, SCRYPT_OPTS);
  return `${HASH_PREFIX}${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const body = stored.startsWith(HASH_PREFIX) ? stored.slice(HASH_PREFIX.length) : stored;
  const [saltHex, keyHex] = body.split(':');
  let expected;
  try {
    expected = Buffer.from(keyHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN, SCRYPT_OPTS);
  // Constant-time: a wrong password must not be distinguishable by timing.
  return timingSafeEqual(actual, expected);
}

/* --------------------------------------------------------------- hashing */

/** IPs are only ever stored hashed, so a database leak does not expose them. */
export const hashIp = (ip) =>
  createHash('sha256')
    .update(String(ip || '') + (process.env.IP_SALT || 'vestiphobia-local-salt'))
    .digest('hex')
    .slice(0, 32);

/* -------------------------------------------------------------- sessions */

export async function createSession(adminId, { userAgent, ip } = {}) {
  const db = await getDb();
  const token = randomBytes(32).toString('base64url'); // 256 bits
  const created = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();

  await db.run(
    `INSERT INTO sessions (token, admin_id, created_at, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [token, adminId, created, expires, String(userAgent || '').slice(0, 250), hashIp(ip)]
  );
  return { token, expires };
}

/**
 * Resolve a session token to an admin. Returns null for anything expired,
 * unknown or malformed — the caller then treats the request as anonymous.
 */
export async function getSession(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const db = await getDb();
  const row = await db.get(
    `SELECT s.token, s.admin_id, s.expires_at, a.email, a.role
     FROM sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.token = ?`,
    [token]
  );
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  return { token: row.token, adminId: row.admin_id, email: row.email, role: row.role };
}

export async function destroySession(token) {
  if (!token) return;
  const db = await getDb();
  await db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

/** Housekeeping: drop expired rows so the table does not grow without bound. */
export async function purgeExpiredSessions() {
  const db = await getDb();
  const r = await db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
  return r.changes;
}

/* ----------------------------------------------------------------- login */

/**
 * Authenticate an email/password pair.
 *
 * The failure message is deliberately identical for "no such account" and
 * "wrong password" — telling them apart is an account-enumeration oracle.
 */
export async function login(email, password, { userAgent, ip } = {}) {
  const db = await getDb();
  const admin = await db.get('SELECT id, email, password_hash FROM admins WHERE email = ?', [
    String(email || '').toLowerCase().trim(),
  ]);

  if (!admin) {
    // Spend comparable time on a missing account so response timing does not
    // reveal whether the address exists.
    await hashPassword('timing-equalisation-placeholder').catch(() => {});
    return { ok: false, error: 'Incorrect email or password.' };
  }

  const valid = await verifyPassword(String(password || ''), admin.password_hash);
  if (!valid) return { ok: false, error: 'Incorrect email or password.' };

  await db.run('UPDATE admins SET last_login_at = ? WHERE id = ?', [now(), admin.id]);
  const session = await createSession(admin.id, { userAgent, ip });
  return { ok: true, session, admin: { id: admin.id, email: admin.email } };
}

/* --------------------------------------------------------------- cookies */

export function sessionCookie(token, { secure, expires }) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expires).toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie({ secure } = {}) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* ----------------------------------------------------------------- admins */

export async function createAdmin(email, password, role = 'owner') {
  const db = await getDb();
  const normalised = String(email).toLowerCase().trim();
  const hash = await hashPassword(password);
  const id = newId();
  await db.run(
    'INSERT INTO admins (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, normalised, hash, role, now()]
  );
  return { id, email: normalised };
}

export async function setAdminPassword(adminId, password) {
  const db = await getDb();
  const hash = await hashPassword(password);
  await db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, adminId]);
  // Every other session for this admin is invalidated: a password change must
  // log out anyone already holding a token.
  await db.run('DELETE FROM sessions WHERE admin_id = ?', [adminId]);
}

export async function adminCount() {
  const db = await getDb();
  const r = await db.get('SELECT COUNT(*) AS n FROM admins');
  return Number(r?.n ?? 0);
}

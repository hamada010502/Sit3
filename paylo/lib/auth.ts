import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from './db';
import type { Role, Seller, User } from './types';

const COOKIE = 'paylo_session';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

interface SessionPayload { uid: string; role: Role; exp: number }

function sign(data: string) {
  return createHmac('sha256', SECRET).update(data).digest('base64url');
}
function encode(p: SessionPayload) {
  const data = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${data}.${sign(data)}`;
}
function decode(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = sign(data);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
    if (p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

export function createSession(user: User) {
  const token = encode({ uid: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE, secure: process.env.NODE_ENV === 'production' });
}
export function destroySession() {
  cookies().set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export function getCurrentUser(): User | null {
  const p = decode(cookies().get(COOKIE)?.value);
  if (!p) return null;
  const u = getDb().prepare('SELECT * FROM users WHERE id = ?').get(p.uid) as User | undefined;
  return u ?? null;
}

export function getCurrentSeller(): { user: User; seller: Seller } | null {
  const user = getCurrentUser();
  if (!user || user.role !== 'seller') return null;
  const seller = getDb().prepare('SELECT * FROM sellers WHERE user_id = ?').get(user.id) as Seller | undefined;
  if (!seller) return null;
  return { user, seller };
}

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 10); }
export async function verifyPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

export function findUserByEmail(email: string): User | undefined {
  return getDb().prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as User | undefined;
}

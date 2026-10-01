import { createHash } from 'crypto';
import { headers } from 'next/headers';

/** The client IP as the proxy reports it (first X-Forwarded-For hop), or null. */
export function clientIp(): string | null {
  try {
    const h = headers();
    return (h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || '').trim() || null;
  } catch { return null; }
}

/**
 * IPs are never stored raw: salted SHA-256 (salt = SESSION_SECRET), truncated. Enough to
 * rate-limit and count distinct visitors, not enough to recover the address.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${process.env.SESSION_SECRET || 'paylo-dev'}|${ip}`).digest('hex').slice(0, 32);
}

export function userAgent(): string | null {
  try { return headers().get('user-agent')?.slice(0, 200) ?? null; } catch { return null; }
}

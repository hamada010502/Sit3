/**
 * Signs and verifies the owner-only session claim using the Web Crypto API
 * (globalThis.crypto.subtle), which is available identically in the Node.js runtime
 * (server actions, layouts) and the Edge runtime (middleware.ts) — unlike
 * node:crypto, which Edge middleware cannot use. This lets the SAME verifier run in
 * true Next.js middleware, so an unauthorized request to /owner is rejected before
 * any page code executes, not just inside a layout guard.
 *
 * This is intentionally a separate, narrower token from the main `paylo_session`
 * cookie in lib/auth.ts — the general session logic (used by every admin/seller/buyer
 * flow, covered by the existing end-to-end suite) is untouched by this feature.
 */
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 6) { out += B64URL[(value >>> (bits - 6)) & 63]; bits -= 6; }
  }
  if (bits > 0) out += B64URL[(value << (6 - bits)) & 63];
  return out;
}
function base64UrlToBytes(s: string): Uint8Array {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of s) {
    const idx = B64URL.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 6) | idx; bits += 6;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signOwnerToken(uid: string, exp: number): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ uid, exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

export async function verifyOwnerToken(token: string | undefined | null): Promise<{ uid: string; exp: number } | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(), base64UrlToBytes(sig) as BufferSource, new TextEncoder().encode(payload));
  if (!ok) return null;
  try {
    const claim = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as { uid: string; exp: number };
    if (typeof claim.uid !== 'string' || claim.exp < Date.now() / 1000) return null;
    return claim;
  } catch { return null; }
}

export const OWNER_COOKIE = 'paylo_owner';
export const OWNER_COOKIE_MAX_AGE = 60 * 60 * 12; // 12h — shorter-lived than the main session, this account is the highest-value target

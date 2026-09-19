import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP (RFC 6238, SHA-1, 30s step) implemented directly on node:crypto.
 * Verified against the RFC 6238 test vectors in scripts/test-totp.js.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function totp(secretB32: string, atMs = Date.now(), digits = 6, stepS = 30): string {
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / stepS), digits);
}

/** Accepts the current step plus one step either side, to tolerate clock drift. */
export function verifyTotp(secretB32: string, token: string, atMs = Date.now(), window = 1): boolean {
  const cleaned = token.replace(/\D/g, '');
  if (cleaned.length !== 6) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(atMs / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(secret, counter + i));
    const given = Buffer.from(cleaned);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Paylo') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Single-use recovery codes, stored hashed-at-rest as a JSON array of remaining codes. */
export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'));
}

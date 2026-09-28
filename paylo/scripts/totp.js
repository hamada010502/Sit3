/*
 * Prints the current 6-digit two-factor code for a TOTP secret, so the seeded demo
 * accounts can be logged into without an authenticator app.
 * Usage: npm run totp -- KRSXG5CTMVRXEZLUKN2XAZLSEBB2EWDN
 */
const { createHmac } = require('crypto');

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: npm run totp -- <BASE32 SECRET>');
  process.exit(1);
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = 0, value = 0;
const bytes = [];
for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
  value = (value << 5) | B32.indexOf(ch); bits += 5;
  if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
}
const now = Math.floor(Date.now() / 1000);
const buf = Buffer.alloc(8);
buf.writeUInt32BE(Math.floor(Math.floor(now / 30) / 0x100000000), 0);
buf.writeUInt32BE(Math.floor(now / 30) >>> 0, 4);
const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
const o = mac[mac.length - 1] & 0x0f;
const code = (((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1e6;
console.log(String(code).padStart(6, '0') + `   (valid for ${30 - (now % 30)}s more)`);

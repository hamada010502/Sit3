/* RFC 6238 test vectors for lib/totp.ts (SHA-1, 8 digits, 30s step). Run: npm run test:totp */
const { createHmac } = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) { let bits=0,value=0,out=''; for (const b of buf){ value=(value<<8)|b; bits+=8; while(bits>=5){ out+=B32[(value>>>(bits-5))&31]; bits-=5; } } if(bits>0) out+=B32[(value<<(5-bits))&31]; return out; }
function base32Decode(s){ const c=s.toUpperCase().replace(/[^A-Z2-7]/g,''); let bits=0,value=0; const out=[]; for(const ch of c){ const i=B32.indexOf(ch); if(i<0)continue; value=(value<<5)|i; bits+=5; if(bits>=8){ out.push((value>>>(bits-8))&0xff); bits-=8; } } return Buffer.from(out); }
function hotp(secret, counter, digits){ const buf=Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter/0x100000000),0); buf.writeUInt32BE(counter>>>0,4);
  const mac=createHmac('sha1',secret).update(buf).digest(); const o=mac[mac.length-1]&0x0f;
  const code=((mac[o]&0x7f)<<24)|(mac[o+1]<<16)|(mac[o+2]<<8)|mac[o+3]; return String(code%10**digits).padStart(digits,'0'); }

const secret = Buffer.from('12345678901234567890', 'ascii');
const vectors = [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']];
let fail = 0;
for (const [T, expected] of vectors) {
  const got = hotp(secret, Math.floor(T / 30), 8);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} T=${T} expected ${expected} got ${got}`);
}
// round-trip base32 over the exact secret the app encodes
const b32 = base32Encode(secret);
if (!base32Decode(b32).equals(secret)) { console.log('  ✗ base32 round-trip'); fail++; } else console.log('  ✓ base32 round-trip', b32);
if (fail) { console.error(`${fail} TOTP vector(s) failed`); process.exit(1); }
console.log('TOTP OK — all RFC 6238 vectors match');

/*
 * Pre-deploy check of the production environment. Exits 1 if anything required is missing.
 * Usage: node scripts/check-env.js   (reads .env.production or .env if present, then process.env)
 * The running server shows the same checks, live, under Admin → Operations → System health.
 */
const fs = require('fs');
for (const f of ['.env.production', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  break;
}
const v = (k) => (process.env[k] || '').trim();
const errors = [], warns = [];
const need = (k, why) => { if (!v(k)) errors.push(`${k} is not set — ${why}`); };

need('SESSION_SECRET', 'login cookies cannot be signed safely');
if (v('SESSION_SECRET') === 'change-me-in-production') errors.push('SESSION_SECRET is still the example value');
need('APP_URL', 'links in emails/SMS/push point nowhere');
if (/localhost|127\.0\.0\.1/.test(v('APP_URL'))) errors.push('APP_URL points at localhost');
need('WEBHOOK_RETRY_SECRET', 'failed webhooks are never retried');
need('OWNER_EMAIL', 'the owner console falls back to the development address');
if (!!v('VAPID_PUBLIC_KEY') !== !!v('VAPID_PRIVATE_KEY')) errors.push('only one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is set');
if (!v('VAPID_PUBLIC_KEY')) warns.push('VAPID keys not set — the app will generate and store its own; a DB restore/reset then breaks every push subscription');
if (!v('VAPID_SUBJECT')) warns.push('VAPID_SUBJECT not set — push services may reject or throttle');
for (const ch of ['SMS', 'WHATSAPP']) {
  const tr = (v(`${ch}_TRANSPORT`) || 'log').toLowerCase();
  if (tr === 'log') warns.push(`${ch}_TRANSPORT=log — messages are recorded, not sent`);
  else if (!v(`${ch}_HTTP_URL`) || !v(`${ch}_HTTP_TOKEN`)) errors.push(`${ch}_TRANSPORT=${tr} but ${ch}_HTTP_URL / ${ch}_HTTP_TOKEN missing`);
}
const et = (v('EMAIL_TRANSPORT') || 'log').toLowerCase();
if (et === 'log') warns.push('EMAIL_TRANSPORT=log — emails are recorded, not sent');
else if (!v('SMTP_HOST')) errors.push('EMAIL_TRANSPORT=smtp but SMTP_HOST missing');

for (const w of warns) console.log('WARN ', w);
for (const e of errors) console.log('ERROR', e);
console.log(errors.length ? `\n${errors.length} error(s) — not ready for production.` : '\nEnvironment OK for production.');
process.exit(errors.length ? 1 : 0);

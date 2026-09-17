/**
 * VESTIPHOBIA — admin shell.
 *
 * Server-rendered HTML, no build step, no client framework. Every mutation is
 * a plain <form method="post">, which means the admin keeps working with
 * JavaScript disabled and every state change is a real, auditable request
 * rather than a fetch that might silently fail.
 *
 * Colours follow the storefront contract:
 *   --red      #C41212  accents and rules only, NEVER body text (2.6:1 on black)
 *   --red-ink  #FF6169  the only red allowed to carry text (6.0:1)
 *   --muted    #A0A0A0  the dimmest text permitted (6.9:1)
 */

import { esc } from '../lib/validate.js';

export const money = (n, currency = 'USD') =>
  `$${Number(n ?? 0).toFixed(2).replace(/\.00$/, '')} ${currency}`;

export const shortDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
};

/** Phones and addresses are personal data: masked in list views, full on detail. */
export const maskPhone = (p) => {
  const s = String(p || '');
  return s.length > 6 ? `${s.slice(0, 5)}···${s.slice(-3)}` : s;
};

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#0A0A0A; --panel:#111; --panel-2:#161616; --line:#262626;
  --fg:#FFF; --muted:#A0A0A0; --red:#C41212; --red-ink:#FF6169;
  --green-ink:#5FD08A; --amber-ink:#E5B85C;
}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--fg)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
  outline:2px solid var(--red-ink); outline-offset:2px;
}
.layout{display:grid; grid-template-columns:230px 1fr; min-height:100vh}
.side{background:var(--panel); border-right:1px solid var(--line); padding:22px 0; position:sticky; top:0; height:100vh; overflow:auto}
.side__brand{padding:0 20px 18px; letter-spacing:.22em; font-size:13px; font-weight:700}
.side__brand small{display:block; letter-spacing:.12em; color:var(--muted); font-weight:400; font-size:11px; margin-top:4px}
.nav{list-style:none; margin:0; padding:0}
.nav a{display:block; padding:9px 20px; text-decoration:none; color:var(--muted); font-size:14px; border-left:2px solid transparent}
.nav a:hover{color:var(--fg); background:var(--panel-2)}
.nav a[aria-current="page"]{color:var(--fg); border-left-color:var(--red); background:var(--panel-2)}
.side__foot{padding:18px 20px 0; margin-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; word-break:break-all}
.main{padding:26px 30px 70px; max-width:1180px}
h1{font-size:26px; margin:0 0 4px; letter-spacing:.02em}
h2{font-size:16px; margin:30px 0 12px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted)}
h3{font-size:15px; margin:0 0 8px}
.sub{color:var(--muted); margin:0 0 22px; font-size:14px}
.cards{display:grid; grid-template-columns:repeat(auto-fit,minmax(165px,1fr)); gap:12px; margin-bottom:26px}
.card{background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:16px 17px; transition:border-color .15s}
.card:hover{border-color:#3A3A3A}
.card__label{color:var(--muted); font-size:11px; letter-spacing:.14em; text-transform:uppercase}
.card__value{font-size:28px; margin-top:7px; font-variant-numeric:tabular-nums; font-weight:600}
.card__note{color:var(--muted); font-size:12px; margin-top:3px}
.panel{background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:18px 18px 20px; margin-bottom:20px}
.table-wrap{overflow-x:auto; border:1px solid var(--line); border-radius:6px; background:var(--panel)}
table{border-collapse:collapse; width:100%; min-width:640px; font-size:14px}
th,td{text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); vertical-align:top}
th{color:var(--muted); font-size:11px; letter-spacing:.12em; text-transform:uppercase; font-weight:600; white-space:nowrap; background:var(--panel-2)}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--panel-2)}
.empty-state{border:1px dashed var(--line); border-radius:6px; padding:36px 20px; text-align:center; color:var(--muted)}
.empty-state p{margin:0 0 14px}
.dropzone{position:relative; border:1px dashed var(--line); border-radius:6px; padding:30px 20px; text-align:center; color:var(--muted); cursor:pointer; transition:border-color .15s, background .15s}
.dropzone:hover{border-color:#3A3A3A}
.dropzone.is-drag{border-color:var(--red-ink); background:var(--panel-2); color:var(--fg)}
.dropzone input[type=file]{position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer}
.dropzone__hint{font-size:13px}
.dropzone__file{display:block; margin-top:8px; font-size:13px; color:var(--fg)}
.num{font-variant-numeric:tabular-nums; white-space:nowrap}
.tag{display:inline-block; padding:2px 8px; border:1px solid var(--line); font-size:11px; letter-spacing:.1em; text-transform:uppercase; white-space:nowrap}
.tag--PENDING{color:var(--amber-ink); border-color:#4A3A18}
.tag--ACCEPTED,.tag--PREPARING{color:var(--fg)}
.tag--SHIPPED{color:#8FB8FF; border-color:#22344F}
.tag--DELIVERED{color:var(--green-ink); border-color:#1E4030}
.tag--REJECTED{color:var(--red-ink); border-color:#4A1616}
.tag--PUBLISHED{color:var(--green-ink); border-color:#1E4030}
.tag--DRAFT,.tag--HIDDEN,.tag--ARCHIVED{color:var(--muted)}
.tag--SOLD_OUT{color:var(--red-ink); border-color:#4A1616}
.tag--QUEUED{color:var(--amber-ink); border-color:#4A3A18}
.bar{height:6px; background:#222; overflow:hidden}
.bar span{display:block; height:100%; background:var(--red)}
.toolbar{display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px}
.field{display:block; margin-bottom:14px}
.field span{display:block; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin-bottom:5px}
input[type=text],input[type=email],input[type=password],input[type=number],input[type=search],select,textarea{
  width:100%; background:#0D0D0D; border:1px solid var(--line); color:var(--fg);
  padding:9px 11px; font:inherit; font-size:14px; border-radius:0;
}
textarea{min-height:120px; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px}
input[type=number]{width:90px}
.btn{
  display:inline-block; background:transparent; border:1px solid var(--line); color:var(--fg);
  padding:8px 14px; font:inherit; font-size:13px; letter-spacing:.06em; cursor:pointer; text-decoration:none;
  border-radius:4px; transition:border-color .15s,background .15s;
}
.btn:hover{border-color:#4A4A4A; background:var(--panel-2)}
.btn--primary{background:var(--fg); color:#000; border-color:var(--fg); font-weight:600}
.btn--primary:hover{background:#DDD; border-color:#DDD}
.btn--danger{border-color:#4A1616; color:var(--red-ink)}
.btn--danger:hover{background:#1A0B0B; border-color:var(--red)}
.btn--sm{padding:5px 10px; font-size:12px}
.inline{display:inline}
.flash{border:1px solid var(--line); border-left:3px solid var(--red); background:var(--panel); padding:11px 14px; margin-bottom:18px; font-size:14px}
.flash--ok{border-left-color:var(--green-ink)}
.note{color:var(--muted); font-size:13px}
.grid2{display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:20px}
.kv{list-style:none; margin:0; padding:0; font-size:14px}
.kv li{display:flex; gap:12px; padding:6px 0; border-bottom:1px solid var(--line)}
.kv li:last-child{border-bottom:0}
.kv b{min-width:130px; color:var(--muted); font-weight:400; font-size:13px}
.kv span{white-space:pre-wrap}
.actions{display:flex; flex-wrap:wrap; gap:8px; margin-top:14px}
.field.checkbox{display:flex; align-items:center; gap:8px}
.field.checkbox input{width:auto}
.field.checkbox span{margin:0; text-transform:none; letter-spacing:0; font-size:14px; color:var(--fg)}
.image-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; margin-bottom:20px}
.image-preview{display:flex; flex-wrap:wrap; gap:8px; margin:12px 0}
.image-card{background:var(--panel); border:1px solid var(--line); border-radius:6px; overflow:hidden; padding:0; margin:0}
.image-card--primary{border-color:var(--green-ink)}
.image-card img{display:block; width:100%; aspect-ratio:4/5; object-fit:cover; background:#000}
.image-card figcaption{padding:10px 12px; font-size:12px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px}
.login{min-height:100vh; display:grid; place-items:center; padding:24px}
.login__box{width:100%; max-width:360px}
.login__brand{letter-spacing:.24em; font-size:14px; font-weight:700; margin-bottom:6px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:820px){
  .layout{grid-template-columns:1fr}
  .side{position:static; height:auto; padding:16px 0}
  .side__brand{padding-bottom:10px}
  .nav{display:flex; flex-wrap:wrap; gap:2px; padding:0 12px}
  .nav a{padding:7px 11px; border-left:0; border-bottom:2px solid transparent}
  .nav a[aria-current="page"]{border-left:0; border-bottom-color:var(--red)}
  .main{padding:20px 16px 60px}
}
`;

const NAV = [
  ['/admin', 'Dashboard'],
  ['/admin/analytics', 'Analytics'],
  ['/admin/orders', 'Orders'],
  ['/admin/customers', 'Customers'],
  ['/admin/products', 'Products'],
  ['/admin/inventory', 'Inventory'],
  ['/admin/content', 'Content'],
  ['/admin/emails', 'Emails'],
  ['/admin/settings', 'Settings'],
  ['/admin/audit', 'Activity log'],
];

/** Full admin document. `current` is the nav path to mark. */
export function shell({ title, current, admin, body, flash = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — VESTIPHOBIA Admin</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
  <nav class="side" aria-label="Admin sections">
    <div class="side__brand">VESTIPHOBIA<small>Admin</small></div>
    <ul class="nav">
      ${NAV.map(
        ([href, label]) =>
          `<li><a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a></li>`
      ).join('\n      ')}
    </ul>
    <div class="side__foot">
      ${esc(admin?.email || '')}
      <form method="post" action="/admin/logout" style="margin-top:10px">
        <button class="btn btn--sm" type="submit">Sign out</button>
      </form>
    </div>
  </nav>
  <main class="main">
    ${flash ? flashHtml(flash) : ''}
    ${body}
  </main>
</div>
</body>
</html>`;
}

export function flashHtml(flash) {
  if (!flash) return '';
  const ok = flash.type === 'ok';
  return `<p class="flash${ok ? ' flash--ok' : ''}" role="status">${esc(flash.message)}</p>`;
}

export function loginPage({ error = null, email = '', noAdmins = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in — VESTIPHOBIA Admin</title>
<style>${CSS}</style>
</head>
<body>
<div class="login">
  <div class="login__box">
    <p class="login__brand">VESTIPHOBIA</p>
    <h1>Admin sign in</h1>
    ${error ? `<p class="flash" role="alert">${esc(error)}</p>` : ''}
    ${
      noAdmins
        ? `<p class="flash" role="alert">No admin account exists yet. Create one on the server with:
           <span class="mono">npm run admin:create -- you@example.com "a long passphrase"</span></p>`
        : ''
    }
    <form method="post" action="/admin/login">
      <div class="field">
        <label for="email"><span>Email</span></label>
        <input id="email" type="email" name="email" value="${esc(email)}" autocomplete="username" required autofocus>
      </div>
      <div class="field">
        <label for="password"><span>Password</span></label>
        <input id="password" type="password" name="password" autocomplete="current-password" required>
      </div>
      <button class="btn btn--primary" type="submit" style="width:100%">Sign in</button>
    </form>
    <p class="note" style="margin-top:18px">This area is for store staff. Sessions expire automatically.</p>
  </div>
</div>
</body>
</html>`;
}

export const statusTag = (s) => `<span class="tag tag--${esc(s)}">${esc(s).replace('_', ' ')}</span>`;

export { esc };

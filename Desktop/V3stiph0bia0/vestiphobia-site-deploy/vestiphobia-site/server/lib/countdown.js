/**
 * VESTIPHOBIA — the launch countdown.
 *
 * Before the shop opens, visitors see a countdown instead of the storefront.
 * When the moment passes, the site opens by itself: the check is made per
 * request against the clock, so nobody has to deploy anything or flip a switch
 * at midnight, and a server that was started days earlier still opens on time.
 *
 * What stays reachable behind the countdown, deliberately:
 *   /admin       so stock, prices and content can be prepared
 *   /api/health  so the host's health check does not report the site as down
 *   /assets/*    so the countdown page can use the real fonts and wordmark
 *
 * What is closed: the storefront and the ordering API. An order placed during
 * a countdown would be an order nobody is expecting.
 */

import { esc } from './validate.js';

/** True while the shop is closed. A null or past date means open. */
export function isCountingDown(opensAt, now = Date.now()) {
  if (!opensAt) return false;
  const target = new Date(opensAt).getTime();
  if (Number.isNaN(target)) {
    console.warn(`[launch] opensAt is not a valid date: ${opensAt} — the site stays open.`);
    return false;
  }
  return target > now;
}

/**
 * Paths that keep working while the countdown runs.
 *
 * The admin is here because the two days before a drop are exactly when stock
 * and copy get finished, and locking the owner out of their own shop to build
 * anticipation would be absurd.
 */
export const bypassesCountdown = (pathname) =>
  pathname === '/admin' ||
  pathname.startsWith('/admin/') ||
  pathname === '/api/health' ||
  pathname.startsWith('/assets/');

/**
 * The countdown page.
 *
 * Server-rendered with the target instant baked in, and a small script that
 * ticks it down and reloads when it reaches zero. With JavaScript off the page
 * still says when the drop opens — the date is in the markup, not only in the
 * script.
 */
export function countdownPage({ brand, opensAt, heading, body, openedText, instagram }) {
  const iso = new Date(opensAt).toISOString();
  const readable = new Date(opensAt).toUTCString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(brand)} — ${esc(heading)}</title>
<meta name="description" content="${esc(brand)} opens ${esc(readable)}.">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<link rel="icon" href="/assets/brand/vestiphobia-wordmark.png">
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%}
  body{
    background:#000; color:#fff; min-height:100svh; min-height:100vh;
    display:grid; place-items:center; text-align:center; padding:2rem 1.25rem;
    font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  .wrap{max-width:44rem}
  .mark{
    font-family:Anton,Impact,"Arial Narrow",sans-serif; letter-spacing:.22em;
    font-size:clamp(1.4rem,7vw,2.6rem); margin:0 0 2.5rem;
  }
  .eyebrow{
    font-size:.68rem; letter-spacing:.28em; text-transform:uppercase;
    color:#A0A0A0; margin:0 0 1rem;
  }
  h1{
    font-family:Anton,Impact,"Arial Narrow",sans-serif; font-weight:400;
    font-size:clamp(2.6rem,14vw,6rem); line-height:.95; letter-spacing:.02em;
    margin:0 0 1.5rem; text-transform:uppercase;
  }
  .lede{color:#A0A0A0; font-size:clamp(.95rem,3vw,1.05rem); margin:0 0 2.5rem}
  .clock{
    display:flex; justify-content:center; gap:clamp(.75rem,4vw,2.5rem);
    font-variant-numeric:tabular-nums; margin-bottom:2.5rem;
  }
  .unit{min-width:3.5rem}
  .unit b{
    display:block; font-family:Anton,Impact,sans-serif; font-weight:400;
    font-size:clamp(2rem,10vw,3.5rem); line-height:1;
  }
  .unit span{
    display:block; font-size:.6rem; letter-spacing:.2em; text-transform:uppercase;
    color:#A0A0A0; margin-top:.5rem;
  }
  .rule{width:2.5rem; height:2px; background:#FF1A1A; margin:0 auto 2.5rem}
  .when{color:#A0A0A0; font-size:.8rem; letter-spacing:.06em}
  a{
    color:#fff; text-decoration:none; border-bottom:1px solid #FF1A1A;
    padding-bottom:2px; display:inline-flex; align-items:center; min-height:44px;
  }
  @media (prefers-reduced-motion:no-preference){
    .unit b{transition:opacity .2s ease}
  }
</style>
</head>
<body>
  <div class="wrap">
    <p class="mark">${esc(brand)}</p>
    <div class="rule"></div>
    <p class="eyebrow">${esc(heading)}</p>
    <h1 data-title>${esc(body)}</h1>

    <div class="clock" data-clock aria-live="polite" aria-atomic="true">
      <div class="unit"><b data-d>--</b><span>Days</span></div>
      <div class="unit"><b data-h>--</b><span>Hours</span></div>
      <div class="unit"><b data-m>--</b><span>Minutes</span></div>
      <div class="unit"><b data-s>--</b><span>Seconds</span></div>
    </div>

    <p class="when">Opens <time datetime="${esc(iso)}">${esc(readable)}</time></p>
    ${
      instagram
        ? `<p style="margin-top:1.5rem"><a href="${esc(instagram)}" target="_blank" rel="noopener">Follow on Instagram</a></p>`
        : ''
    }
  </div>

<script>
  (function () {
    var target = new Date(${JSON.stringify(iso)}).getTime();
    var el = {
      d: document.querySelector('[data-d]'),
      h: document.querySelector('[data-h]'),
      m: document.querySelector('[data-m]'),
      s: document.querySelector('[data-s]'),
      title: document.querySelector('[data-title]'),
      clock: document.querySelector('[data-clock]'),
    };
    var pad = function (n) { return String(n).padStart(2, '0'); };

    function tick() {
      var left = target - Date.now();
      if (left <= 0) {
        el.title.textContent = ${JSON.stringify(openedText)};
        el.clock.hidden = true;
        // The server decides what is open; reloading asks it again rather
        // than this page pretending to unlock anything itself.
        setTimeout(function () { location.reload(); }, 1500);
        return;
      }
      var s = Math.floor(left / 1000);
      el.d.textContent = pad(Math.floor(s / 86400));
      el.h.textContent = pad(Math.floor(s / 3600) % 24);
      el.m.textContent = pad(Math.floor(s / 60) % 60);
      el.s.textContent = pad(s % 60);
      setTimeout(tick, 1000 - (Date.now() % 1000));
    }
    tick();
  })();
</script>
</body>
</html>`;
}

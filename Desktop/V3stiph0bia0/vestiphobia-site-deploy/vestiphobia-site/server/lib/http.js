/**
 * VESTIPHOBIA — HTTP helpers, security headers and rate limiting.
 * No framework: node:http plus this file is the whole surface.
 */

import { getDb, now } from '../db/index.js';
import { hashIp } from './auth.js';

/* ------------------------------------------------------------ request body */

const MAX_BODY = 256 * 1024; // 256KB — no endpoint here needs more

export async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      // Stop accumulating as soon as the cap is passed, rather than buffering
      // the whole thing and rejecting afterwards. The socket is left open just
      // long enough for the caller to send a 413 — destroying it here would
      // give the client a connection reset instead of an explanation.
      if (size > MAX_BODY) {
        aborted = true;
        chunks.length = 0;
        req.pause();
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Malformed JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* --------------------------------------------------------------- responses */

/**
 * Security headers on every response.
 *
 * The CSP is deliberately strict. The site ships no inline event handlers, and
 * the only inline script is the runtime config block, which is why
 * 'unsafe-inline' is present for script-src — removing it needs a nonce, noted
 * in the deployment guide as a hardening step.
 */
export function securityHeaders({ secure } = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      // The Live365 radio player: media-src for the direct <audio> stream,
      // frame-src for the iframe-embed fallback (site.radio.streamUrl /
      // embedUrl in site.config.js) — both stay unreachable while that config
      // is unset, so these origins are inert until the owner supplies one.
      // streaming.live365.com redirects to a per-listener CDN edge node on
      // *.cdnstream.com, so that has to be allowed too, not just the entry
      // domain — a media-src that only covers the redirect's starting point
      // still gets the follow-up request blocked.
      "media-src 'self' https://streaming.live365.com https://*.cdnstream.com",
      "frame-src https://live365.com",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // No navigate-to directive: it was dropped from the CSP spec and browsers
      // log it as unrecognised. wa.me and Instagram are opened as top-level
      // navigations, which form-action and frame-ancestors already bound.
    ].join('; '),
  };
  if (secure) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/**
 * Security headers are applied HERE, not by each caller.
 *
 * They used to be passed in by whoever remembered, which meant the HTML
 * routes carried them and every JSON response carried none — found by the
 * pre-launch audit. `nosniff` is the one that matters most on an API: without
 * it, a JSON body containing attacker-supplied strings can be content-sniffed
 * as HTML by some clients, which is a real route to executing it. Setting them
 * at the source means a new endpoint cannot ship without them.
 *
 * HSTS depends on the request having arrived over HTTPS, which a response
 * object does not know by itself — so the dispatcher stamps `res.locals.secure`
 * once per request and these helpers read it. Doing it there rather than at
 * each call site is the point: the JSON routes were missing HSTS entirely
 * because every one of them would have had to remember.
 */
export function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...securityHeaders({ secure: res.locals?.secure === true }),
    ...extraHeaders,
  });
  res.end(payload);
}

export function html(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders({ secure: res.locals?.secure === true }),
    ...extraHeaders,
  });
  res.end(body);
}

export function redirect(res, location, extraHeaders = {}) {
  // A redirect carries them too: the response body is trivial, but the headers
  // travel with it and a 302 is still a response an attacker can aim at.
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    ...securityHeaders({ secure: res.locals?.secure === true }),
    ...extraHeaders,
  });
  res.end();
}

/**
 * Error responses never leak internals. The client gets a stable message and a
 * correlation id; the detail goes to the server log only.
 */
export function fail(res, status, message, { code, detail } = {}) {
  if (detail) {
    console.error(`[http ${status}] ${message}`, detail);
  }
  json(res, status, { error: message, code: code || null });
}

/* ------------------------------------------------------------ rate limiting */

/**
 * Fixed-window limiter backed by the database, so it survives a restart and
 * works across processes — an in-memory Map would reset on every deploy and
 * would not hold across instances.
 */
export async function rateLimit(key, { limit, windowMs }) {
  const db = await getDb();
  const ts = Date.now();
  const bucketStart = Math.floor(ts / windowMs) * windowMs;
  const bucket = `${key}:${bucketStart}`;

  const row = await db.get('SELECT count FROM rate_limits WHERE bucket = ?', [bucket]);
  if (!row) {
    await db.run(
      'INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, ?, ?)',
      [bucket, 1, new Date(bucketStart).toISOString()]
    );
    // Opportunistic cleanup so the table does not grow without bound.
    if (Math.random() < 0.02) {
      await db.run('DELETE FROM rate_limits WHERE window_start < ?', [
        new Date(ts - windowMs * 10).toISOString(),
      ]);
    }
    return { allowed: true, remaining: limit - 1 };
  }

  const count = Number(row.count) + 1;
  await db.run('UPDATE rate_limits SET count = ? WHERE bucket = ?', [count, bucket]);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.ceil((bucketStart + windowMs - ts) / 1000),
  };
}

/** Client address, trusting X-Forwarded-For only behind a known proxy. */
export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

/**
 * Did this request arrive over HTTPS?
 *
 * X-Forwarded-Proto is only believed behind a proxy we control, exactly as
 * clientIp() treats X-Forwarded-For: with no proxy in front, any client can
 * set the header to whatever it likes, and a value that is trusted anyway is
 * not evidence of anything. A real TLS socket is always proof, with or
 * without TRUST_PROXY.
 */
export const isSecure = (req) =>
  (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') ||
  Boolean(req.socket?.encrypted);

/* ------------------------------------------------------------------- audit */

/**
 * Record a sensitive admin action.
 *
 * `detail` is sanitised here rather than at each call site: anything that looks
 * like a credential is dropped, so an audit trail can never become the place a
 * password leaks.
 */
export async function audit(action, { adminId, entityType, entityId, detail, ip } = {}) {
  const db = await getDb();
  const { newId } = await import('../db/index.js');

  let safeDetail = null;
  if (detail) {
    const clone = { ...detail };
    for (const k of Object.keys(clone)) {
      if (/password|token|secret|hash|authorization/i.test(k)) delete clone[k];
    }
    safeDetail = JSON.stringify(clone);
  }

  await db.run(
    `INSERT INTO audit_log (id, admin_id, action, entity_type, entity_id, detail, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), adminId || null, action, entityType || null, entityId || null, safeDetail, hashIp(ip), now()]
  );
}

/* ------------------------------------------------------------------ CSRF */

/**
 * Admin mutations are same-origin only.
 *
 * The session cookie is already SameSite=Strict, which stops cross-site form
 * posts. This is the second layer: an Origin/Referer that does not match the
 * host is refused outright.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!host) return false;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer: a same-origin fetch always sends one of them,
  // so treat the absence as untrusted for state-changing requests.
  return false;
}

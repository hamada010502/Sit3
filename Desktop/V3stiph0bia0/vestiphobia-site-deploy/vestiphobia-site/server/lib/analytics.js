/**
 * VESTIPHOBIA — analytics ingest.
 *
 * ===========================================================================
 * THE PII CONTRACT
 * ===========================================================================
 * Analytics answers "where did people come from and where do they stop". It
 * never needs to know who they are, so it is not given the chance:
 *
 *   - Event props are WHITELISTED per event. A key that is not on the list for
 *     that event is dropped here, at the boundary, not filtered later in a
 *     report. Adding a field to the client cannot start collecting it.
 *   - Every value is then scanned for anything phone-shaped or email-shaped
 *     and rejected if found. That is a second line of defence for the case
 *     where a whitelisted field is misused (a "size" field carrying a phone
 *     number, say).
 *   - IP addresses are never stored, not even hashed, in this table. The
 *     country is read from a proxy header when the host supplies one, and is
 *     otherwise null — no lookup is performed and no location is guessed.
 *   - visitor_id and session_id are random values the BROWSER generates for
 *     itself. They are not derived from anything about the device, so they are
 *     not a fingerprint, and clearing site data ends them.
 *   - Names, phone numbers, addresses and emails live only in `customers` and
 *     `orders`, behind the admin login. An analytics row references an order by
 *     its order number and never by a person.
 *
 * Nothing here throws into a request path. Analytics failing must never cost a
 * page view or an order, so ingest errors are logged and swallowed.
 * ===========================================================================
 */

import { getDb, newId, now } from '../db/index.js';

/* ------------------------------------------------------------ vocabulary */

/**
 * Events the API accepts, with the props each may carry.
 *
 * Anything not listed is dropped. This is the whole allow-list — there is no
 * second place where an event or a field can be introduced.
 */
export const EVENTS = {
  page_view: ['title'],
  product_view: ['slug', 'price', 'currency'],
  product_list_view: ['list', 'count'],
  product_select: ['slug', 'list', 'position'],
  gallery_interaction: ['slug', 'action', 'index'],
  size_select: ['slug', 'size'],
  size_unavailable: ['slug', 'size'],
  add_to_cart: ['slug', 'size', 'quantity', 'price', 'currency'],
  remove_from_cart: ['slug', 'size', 'quantity'],
  view_cart: ['pieces', 'subtotal', 'currency'],
  begin_checkout: ['pieces', 'subtotal', 'currency'],
  checkout_progress: ['step', 'valid'],
  checkout_error: ['reason'],
  promotion_view: ['promotion', 'percent'],
  promotion_select: ['promotion', 'percent'],
  whatsapp_click: ['order_number', 'surface'],
  order_created: ['order_number', 'pieces', 'total', 'currency', 'discount_percent'],
  order_status: ['order_number', 'status'],
  page_engagement: ['title'],
  search: ['results'],
  outbound_click: ['destination'],
};

/**
 * Events only the SERVER may write.
 *
 * A browser posting `order_status` could put an ACCEPTED or DELIVERED into the
 * stream for an order that was never touched. The reports read order state
 * from the orders table, so the damage would be limited to the raw event view
 * — but "limited damage" is not a reason to accept a lie, so ingest refuses
 * these outright.
 */
const SERVER_ONLY = new Set(['order_status']);

/** Milestones a session reaches, in funnel order. Set once, never unset. */
const MILESTONES = {
  product_view: 'saw_product',
  size_select: 'selected_size',
  add_to_cart: 'added_to_cart',
  view_cart: 'viewed_cart',
  begin_checkout: 'began_checkout',
  whatsapp_click: 'clicked_whatsapp',
  order_created: 'created_order',
};

export const FUNNEL_STEPS = [
  ['sessions', 'Visitors'],
  ['saw_product', 'Product view'],
  ['selected_size', 'Size selected'],
  ['added_to_cart', 'Added to cart'],
  ['viewed_cart', 'Viewed cart'],
  ['began_checkout', 'Began checkout'],
  ['created_order', 'Order created'],
];

/* -------------------------------------------------------- sanitisation */

// Seven or more digits in a row, allowing the separators people type.
const PHONE_LIKE = /(?:\d[\s\-().]*){7,}/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;

/** True when a value looks like it identifies a person. */
export function looksLikePii(value) {
  const s = String(value ?? '');
  if (!s) return false;
  return EMAIL_LIKE.test(s) || PHONE_LIKE.test(s);
}

const clean = (v, max = 120) =>
  String(v ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);

/**
 * Reduce one client-supplied event to the columns and props it is allowed to
 * have. Returns null for anything unrecognised — an unknown event name is
 * dropped rather than stored, so a typo cannot quietly create a new metric.
 */
export function sanitiseEvent(raw) {
  const name = clean(raw?.name, 40);
  const allowed = EVENTS[name];
  if (!allowed || SERVER_ONLY.has(name)) return null;

  const props = {};
  for (const key of allowed) {
    if (raw?.props?.[key] === undefined || raw.props[key] === null) continue;
    const value = raw.props[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      props[key] = value;
      continue;
    }
    const text = clean(value, 120);
    if (!text) continue;
    // An order number is digits-and-dashes by design; everything else that
    // looks like a phone number or an email is refused outright.
    if (key !== 'order_number' && looksLikePii(text)) continue;
    props[key] = text;
  }

  return {
    // The client supplies the id so a retry cannot double-count. The insert
    // ignores a duplicate id rather than storing the event twice.
    id: /^[A-Za-z0-9_-]{8,64}$/.test(String(raw?.id || '')) ? String(raw.id) : newId(),
    name,
    path: clean(raw?.path, 200) || null,
    props,
    engagedMs:
      Number.isFinite(Number(raw?.engagedMs)) && Number(raw.engagedMs) >= 0
        ? Math.min(Math.round(Number(raw.engagedMs)), 30 * 60 * 1000)
        : null,
    at: clean(raw?.at, 40) || null,
  };
}

/* ------------------------------------------------------ classification */

/**
 * Coarse buckets from the User-Agent.
 *
 * Deliberately coarse: enough to answer "does the mobile checkout work", not
 * enough to tell two visitors apart. No version numbers, no font or canvas
 * probing, nothing that adds up to a fingerprint.
 */
export function classifyUserAgent(ua = '') {
  const s = String(ua);

  const device = /iPad|Tablet/i.test(s)
    ? 'tablet'
    : /Mobi|Android|iPhone|iPod/i.test(s)
      ? 'mobile'
      : s
        ? 'desktop'
        : 'unknown';

  const os = /iPhone|iPad|iPod|iOS/i.test(s)
    ? 'iOS'
    : /Android/i.test(s)
      ? 'Android'
      : /Windows/i.test(s)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(s)
          ? 'macOS'
          : /Linux/i.test(s)
            ? 'Linux'
            : 'unknown';

  // Order matters: Edge and Opera both claim Chrome, Chrome claims Safari.
  const browser = /Edg\//i.test(s)
    ? 'Edge'
    : /OPR\/|Opera/i.test(s)
      ? 'Opera'
      : /SamsungBrowser/i.test(s)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/i.test(s)
          ? 'Firefox'
          : /Chrome\/|CriOS/i.test(s)
            ? 'Chrome'
            : /Safari\//i.test(s)
              ? 'Safari'
              : 'unknown';

  return { device, os, browser };
}

/** Obvious crawlers. Counting them as visitors makes every rate meaningless. */
export const isBot = (ua = '') =>
  /bot|crawler|spider|crawling|preview|facebookexternalhit|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptime/i.test(
    String(ua)
  );

/**
 * Resolve the acquisition channel.
 *
 * A UTM campaign always wins, because it was set deliberately. Otherwise the
 * referrer host decides, and an empty referrer means direct. "unknown" is a
 * real answer here, not a failure — a referrer stripped by the browser cannot
 * be recovered, and guessing would make the report worse than useless.
 */
export function resolveSource({ utm = {}, referrer = '', host = '' } = {}) {
  const utmSource = clean(utm.source, 80).toLowerCase();
  const utmMedium = clean(utm.medium, 80).toLowerCase();
  if (utmSource) {
    return { source: utmSource, medium: utmMedium || 'campaign' };
  }

  const ref = clean(referrer, 300);
  if (!ref) return { source: 'direct', medium: 'none' };

  let refHost;
  try {
    refHost = new URL(ref).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return { source: 'unknown', medium: 'unknown' };
  }

  if (host && refHost === String(host).replace(/^www\./, '').toLowerCase()) {
    return { source: 'internal', medium: 'internal' };
  }
  if (/instagram\.com|l\.instagram|ig\.me/.test(refHost)) return { source: 'instagram', medium: 'social' };
  if (/facebook\.com|fb\.me|fb\.com/.test(refHost)) return { source: 'facebook', medium: 'social' };
  if (/tiktok\.com/.test(refHost)) return { source: 'tiktok', medium: 'social' };
  if (/t\.co|twitter\.com|x\.com/.test(refHost)) return { source: 'x', medium: 'social' };
  if (/pinterest\./.test(refHost)) return { source: 'pinterest', medium: 'social' };
  if (/whatsapp|wa\.me/.test(refHost)) return { source: 'whatsapp', medium: 'messaging' };
  if (/google\.|bing\.|duckduckgo|yandex\.|search\.brave|ecosia\./.test(refHost)) {
    return { source: refHost.split('.')[0], medium: 'search' };
  }
  return { source: refHost, medium: 'referral' };
}

/** Screen width bucket, from the client. Never the exact pixel size. */
export function screenClass(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'unknown';
  if (w < 480) return 'small';
  if (w < 768) return 'medium';
  if (w < 1280) return 'large';
  return 'xlarge';
}

/**
 * Country, only if the host's proxy already resolved it.
 *
 * No GeoIP database is bundled and no lookup service is called. Where the host
 * does not supply this header the column stays null, and the Locations report
 * says so rather than showing an invented breakdown.
 */
export const countryFromHeaders = (headers = {}) => {
  const raw =
    headers['cf-ipcountry'] ||
    headers['x-vercel-ip-country'] ||
    headers['x-country-code'] ||
    headers['fly-client-country'] ||
    '';
  const code = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
};

/* ---------------------------------------------------------------- ingest */

const bool = (v) => (v ? 1 : 0);

/**
 * Record a batch of client events.
 *
 * Returns counts rather than throwing: the endpoint answers 204 whatever
 * happens, because a browser cannot do anything useful with an analytics
 * error and must not be delayed by one.
 */
export async function ingest(batch, context) {
  const db = await getDb();
  const ts = now();

  const visitorId = /^[A-Za-z0-9_-]{8,64}$/.test(String(batch?.visitorId || ''))
    ? String(batch.visitorId)
    : null;
  const sessionId = /^[A-Za-z0-9_-]{8,64}$/.test(String(batch?.sessionId || ''))
    ? String(batch.sessionId)
    : null;
  if (!visitorId || !sessionId) return { accepted: 0, rejected: 1, reason: 'bad ids' };

  const events = Array.isArray(batch?.events) ? batch.events.slice(0, 40) : [];
  const clean_ = events.map(sanitiseEvent).filter(Boolean);
  if (!clean_.length) return { accepted: 0, rejected: events.length };

  const { device, os, browser } = classifyUserAgent(context.userAgent);
  const utm = {
    source: clean(batch?.utm?.source, 80),
    medium: clean(batch?.utm?.medium, 80),
    campaign: clean(batch?.utm?.campaign, 120),
    content: clean(batch?.utm?.content, 120),
    term: clean(batch?.utm?.term, 120),
  };
  const referrer = clean(batch?.referrer, 300);
  const { source, medium } = resolveSource({ utm, referrer, host: context.host });
  const screen = screenClass(batch?.screenWidth);
  const country = context.country || null;

  let referrerHost = null;
  try {
    referrerHost = referrer ? new URL(referrer).host.replace(/^www\./, '') : null;
  } catch {
    referrerHost = null;
  }

  const milestones = {};
  let engaged = 0;
  let lastPath = null;
  for (const e of clean_) {
    if (MILESTONES[e.name]) milestones[MILESTONES[e.name]] = 1;
    if (e.engagedMs) engaged += e.engagedMs;
    if (e.path) lastPath = e.path;
  }
  const orderNumber = clean_.find((e) => e.name === 'order_created')?.props?.order_number || null;

  let accepted = 0;

  /**
   * Retry a batch that lost a race for the write lock.
   *
   * Under concurrent traffic SQLite can return SQLITE_BUSY, and Postgres can
   * deadlock-abort a transaction. Either way the batch is recoverable and
   * dropping it would silently under-count — which is worse than a slow write,
   * because the resulting gap is invisible.
   */
  const isTransient = (err) =>
    /busy|locked|deadlock|serializ/i.test(String(err?.code || '') + String(err?.message || ''));

  const write = async () => {
    await db.transaction(async (tx) => {
      const existing = await tx.get('SELECT id FROM analytics_sessions WHERE id = ?', [sessionId]);

      if (!existing) {
        await tx.run(
          `INSERT INTO analytics_sessions (
             id, visitor_id, started_at, last_seen_at, is_new_visitor,
             source, medium, campaign, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             referrer_host, landing_path, exit_path, device, os, browser, screen_class, country,
             events, engaged_ms, saw_product, selected_size, added_to_cart, viewed_cart,
             began_checkout, clicked_whatsapp, created_order, order_number
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            visitorId,
            ts,
            ts,
            bool(batch?.isNewVisitor),
            source,
            medium,
            utm.campaign || null,
            utm.source || null,
            utm.medium || null,
            utm.campaign || null,
            utm.content || null,
            utm.term || null,
            referrerHost,
            clean(batch?.landingPath, 200) || clean_[0].path || null,
            lastPath,
            device,
            os,
            browser,
            screen,
            country,
            clean_.length,
            engaged,
            bool(milestones.saw_product),
            bool(milestones.selected_size),
            bool(milestones.added_to_cart),
            bool(milestones.viewed_cart),
            bool(milestones.began_checkout),
            bool(milestones.clicked_whatsapp),
            bool(milestones.created_order),
            orderNumber,
          ]
        );
      } else {
        // Milestones only ever go from 0 to 1: a later batch without a
        // milestone must not erase one an earlier batch recorded.
        const sets = [
          'last_seen_at = ?',
          'events = events + ?',
          'engaged_ms = engaged_ms + ?',
          'exit_path = COALESCE(?, exit_path)',
          'country = COALESCE(country, ?)',
        ];
        const params = [ts, clean_.length, engaged, lastPath, country];
        for (const column of Object.values(MILESTONES)) {
          if (milestones[column]) {
            sets.push(`${column} = 1`);
          }
        }
        if (orderNumber) {
          sets.push('order_number = COALESCE(order_number, ?)');
          params.push(orderNumber);
        }
        params.push(sessionId);
        await tx.run(`UPDATE analytics_sessions SET ${sets.join(', ')} WHERE id = ?`, params);
      }

      for (const e of clean_) {
        // ON CONFLICT DO NOTHING is spelled identically in SQLite and Postgres.
        // A retried beacon therefore cannot double-count an event.
        const r = await tx.run(
          `INSERT INTO analytics_events (
             id, visitor_id, session_id, name, path, referrer,
             utm_source, utm_medium, utm_campaign, device, os, browser, screen_class,
             country, props, order_id, source, medium, engaged_ms, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
          [
            e.id,
            visitorId,
            sessionId,
            e.name,
            e.path,
            referrer || null,
            utm.source || null,
            utm.medium || null,
            utm.campaign || null,
            device,
            os,
            browser,
            screen,
            country,
            Object.keys(e.props).length ? JSON.stringify(e.props) : null,
            e.props.order_number || null,
            source,
            medium,
            e.engagedMs,
            ts,
          ]
        );
        accepted += r.changes ? 1 : 0;
      }
    });
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      accepted = 0;
      await write();
      break;
    } catch (err) {
      if (attempt < 2 && isTransient(err)) {
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
        continue;
      }
      console.error('[analytics] ingest failed:', err.message);
      return { accepted: 0, rejected: clean_.length, error: true };
    }
  }

  return { accepted, rejected: events.length - clean_.length, duplicates: clean_.length - accepted };
}

/**
 * Record an event the SERVER is authoritative for.
 *
 * Order lifecycle events are written here and never accepted from a browser: a
 * client that could post `order_accepted` could inflate the conversion report
 * without an order ever existing.
 */
export async function recordServerEvent(name, { orderNumber, sessionId, props = {} } = {}) {
  if (!EVENTS[name]) return;
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO analytics_events (id, visitor_id, session_id, name, props, order_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        'server',
        sessionId || 'server',
        name,
        JSON.stringify({ ...props, order_number: orderNumber || null }),
        orderNumber || null,
        now(),
      ]
    );
  } catch (err) {
    // An analytics write must never roll back or block a real state change.
    console.error('[analytics] could not record server event:', err.message);
  }
}

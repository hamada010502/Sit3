/**
 * VESTIPHOBIA — analytics reporting.
 *
 * Read-only queries behind the admin login. Every one takes an explicit
 * {from, to} window so no report can quietly mean "all time" while its heading
 * says "last 7 days".
 *
 * Portability: timestamps are ISO-8601 text, which sorts chronologically, so
 * range filters are plain string comparisons. Day bucketing uses substr(x,1,10)
 * — spelled the same in SQLite and Postgres. No strftime, no date_trunc, no
 * dialect-specific date maths anywhere in this file.
 */

import { getDb, fromCents } from '../db/index.js';
import { FUNNEL_STEPS } from '../lib/analytics.js';

/* ------------------------------------------------------------- date range */

export const RANGES = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  custom: 'Custom',
};

const startOfTodayUtc = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Resolve a range key (and optional custom dates) to an inclusive window.
 * Anything unrecognised falls back to 30 days rather than to "everything" —
 * a mistyped parameter should narrow a report, not silently widen it.
 */
export function resolveRange({ range = '30d', from, to } = {}) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  if (range === 'custom' && isDate(from) && isDate(to)) {
    return {
      key: 'custom',
      label: `${from} to ${to}`,
      from: `${from}T00:00:00.000Z`,
      to: `${to}T23:59:59.999Z`,
      fromDate: from,
      toDate: to,
    };
  }

  const days = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[range] ?? 29;
  const key = { today: 'today', '7d': '7d', '30d': '30d', '90d': '90d' }[range] || '30d';
  const start = startOfTodayUtc();
  start.setUTCDate(start.getUTCDate() - days);

  return {
    key,
    label: RANGES[key],
    from: start.toISOString(),
    to: new Date().toISOString(),
    fromDate: start.toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    days: days + 1,
  };
}

const n = (v) => Number(v ?? 0);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/* ---------------------------------------------------------------- overview */

export async function overview(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const s = await db.get(
    `SELECT COUNT(*) AS sessions,
            COUNT(DISTINCT visitor_id) AS visitors,
            COALESCE(SUM(is_new_visitor), 0) AS new_visitors,
            COALESCE(SUM(engaged_ms), 0) AS engaged_ms,
            COALESCE(SUM(saw_product), 0) AS product_views,
            COALESCE(SUM(added_to_cart), 0) AS carts,
            COALESCE(SUM(began_checkout), 0) AS checkouts,
            COALESCE(SUM(created_order), 0) AS orders
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?`,
    w
  );

  const o = await db.get(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_cents), 0) AS revenue_cents,
            COALESCE(SUM(pieces), 0) AS pieces
       FROM orders
      WHERE created_at >= ? AND created_at <= ? AND status <> 'REJECTED'`,
    w
  );

  const events = await db.get(
    `SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= ? AND created_at <= ?`,
    w
  );

  const sessions = n(s?.sessions);
  const orders = n(o?.orders);

  const daily = await db.all(
    `SELECT substr(started_at, 1, 10) AS day,
            COUNT(*) AS sessions,
            COALESCE(SUM(created_order), 0) AS orders
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY substr(started_at, 1, 10)
      ORDER BY day`,
    w
  );

  const topSources = await db.all(
    `SELECT COALESCE(source, 'unknown') AS source,
            COUNT(*) AS sessions,
            COALESCE(SUM(created_order), 0) AS orders
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY COALESCE(source, 'unknown')
      ORDER BY sessions DESC
      LIMIT 8`,
    w
  );

  return {
    sessions,
    visitors: n(s?.visitors),
    newVisitors: n(s?.new_visitors),
    returningVisitors: Math.max(0, sessions - n(s?.new_visitors)),
    events: n(events?.n),
    orders,
    revenue: fromCents(n(o?.revenue_cents)),
    pieces: n(o?.pieces),
    averageOrder: orders ? fromCents(Math.round(n(o.revenue_cents) / orders)) : 0,
    // Sessions that reached an order, over all sessions. Reported as a rate,
    // not as a count dressed up as one.
    conversionRate: pct(n(s?.orders), sessions),
    cartRate: pct(n(s?.carts), sessions),
    // Average engaged (foreground) seconds per session, not wall-clock time.
    engagedSecondsPerSession: sessions ? Math.round(n(s?.engaged_ms) / sessions / 100) / 10 : 0,
    daily: daily.map((d) => ({ day: d.day, sessions: n(d.sessions), orders: n(d.orders) })),
    topSources: topSources.map((r) => ({
      source: r.source,
      sessions: n(r.sessions),
      orders: n(r.orders),
      rate: pct(n(r.orders), n(r.sessions)),
    })),
  };
}

/* ----------------------------------------------------------------- traffic */

export async function traffic(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const group = (column) =>
    db.all(
      `SELECT COALESCE(${column}, 'unknown') AS key,
              COUNT(*) AS sessions,
              COALESCE(SUM(created_order), 0) AS orders,
              COALESCE(SUM(engaged_ms), 0) AS engaged_ms
         FROM analytics_sessions
        WHERE started_at >= ? AND started_at <= ?
        GROUP BY COALESCE(${column}, 'unknown')
        ORDER BY sessions DESC
        LIMIT 25`,
      w
    );

  const [sources, mediums, landing, exits, referrers] = await Promise.all([
    group('source'),
    group('medium'),
    group('landing_path'),
    group('exit_path'),
    group('referrer_host'),
  ]);

  const newVsReturning = await db.get(
    `SELECT COALESCE(SUM(is_new_visitor), 0) AS new_sessions,
            COUNT(*) AS sessions
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?`,
    w
  );

  const shape = (rows) =>
    rows.map((r) => ({
      key: r.key,
      sessions: n(r.sessions),
      orders: n(r.orders),
      rate: pct(n(r.orders), n(r.sessions)),
      engagedSeconds: n(r.sessions) ? Math.round(n(r.engaged_ms) / n(r.sessions) / 1000) : 0,
    }));

  return {
    sources: shape(sources),
    mediums: shape(mediums),
    landing: shape(landing),
    exits: shape(exits),
    referrers: shape(referrers),
    newSessions: n(newVsReturning?.new_sessions),
    returningSessions: Math.max(0, n(newVsReturning?.sessions) - n(newVsReturning?.new_sessions)),
  };
}

/* ------------------------------------------------------------------ funnel */

export async function funnel(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const row = await db.get(
    `SELECT COUNT(*) AS sessions,
            COALESCE(SUM(saw_product), 0) AS saw_product,
            COALESCE(SUM(selected_size), 0) AS selected_size,
            COALESCE(SUM(added_to_cart), 0) AS added_to_cart,
            COALESCE(SUM(viewed_cart), 0) AS viewed_cart,
            COALESCE(SUM(began_checkout), 0) AS began_checkout,
            COALESCE(SUM(clicked_whatsapp), 0) AS clicked_whatsapp,
            COALESCE(SUM(created_order), 0) AS created_order
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?`,
    w
  );

  const top = n(row?.sessions);
  const steps = FUNNEL_STEPS.map(([column, label], i) => {
    const count = column === 'sessions' ? top : n(row?.[column]);
    return { column, label, count, ofTotal: pct(count, top), index: i };
  });

  // Drop-off is measured against the PREVIOUS step, which is the number that
  // tells you where to spend effort; the share of all visitors is kept too.
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].count;
    steps[i].fromPrevious = pct(steps[i].count, prev);
    steps[i].lost = Math.max(0, prev - steps[i].count);
  }

  // Where sessions that never ordered were last seen.
  const abandonedAt = await db.all(
    `SELECT COALESCE(exit_path, 'unknown') AS path, COUNT(*) AS sessions
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ? AND created_order = 0
      GROUP BY COALESCE(exit_path, 'unknown')
      ORDER BY sessions DESC
      LIMIT 12`,
    w
  );

  // Checkout reached, order never created: the most expensive drop there is.
  const abandonedCheckout = await db.get(
    `SELECT COUNT(*) AS n
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ? AND began_checkout = 1 AND created_order = 0`,
    w
  );

  return {
    steps,
    abandonedAt: abandonedAt.map((r) => ({ path: r.path, sessions: n(r.sessions) })),
    abandonedCheckout: n(abandonedCheckout?.n),
    whatsappClicks: n(row?.clicked_whatsapp),
  };
}

/* ---------------------------------------------------------------- products */

export async function productReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const byEvent = (name) =>
    db.all(
      `SELECT props, COUNT(*) AS n
         FROM analytics_events
        WHERE name = ? AND created_at >= ? AND created_at <= ? AND props IS NOT NULL
        GROUP BY props`,
      [name, ...w]
    );

  // props is JSON text; both engines can store it but only one can query into
  // it portably, so the grouping is finished in JavaScript. The volumes here
  // are report-sized, not request-sized.
  const tally = (rows, key) => {
    const out = new Map();
    for (const r of rows) {
      let parsed;
      try {
        parsed = JSON.parse(r.props);
      } catch {
        continue;
      }
      const k = parsed?.[key];
      if (!k) continue;
      out.set(k, (out.get(k) || 0) + n(r.n));
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([key2, count]) => ({ key: key2, count }));
  };

  const [views, sizes, adds, removes] = await Promise.all([
    byEvent('product_view'),
    byEvent('size_select'),
    byEvent('add_to_cart'),
    byEvent('remove_from_cart'),
  ]);

  const orderedProducts = await db.all(
    `SELECT oi.product_slug AS slug,
            SUM(oi.quantity) AS pieces,
            COUNT(DISTINCT o.id) AS orders,
            COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ? AND o.created_at <= ? AND o.status <> 'REJECTED'
      GROUP BY oi.product_slug
      ORDER BY pieces DESC`,
    w
  );

  const orderedSizes = await db.all(
    `SELECT oi.size AS size,
            SUM(oi.quantity) AS pieces,
            COUNT(DISTINCT o.id) AS orders
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ? AND o.created_at <= ? AND o.status <> 'REJECTED'
      GROUP BY oi.size
      ORDER BY pieces DESC`,
    w
  );

  return {
    views: tally(views, 'slug'),
    sizeSelections: tally(sizes, 'size'),
    addsToCart: tally(adds, 'slug'),
    addedSizes: tally(adds, 'size'),
    removals: tally(removes, 'slug'),
    orderedProducts: orderedProducts.map((r) => ({
      slug: r.slug,
      pieces: n(r.pieces),
      orders: n(r.orders),
      revenue: fromCents(n(r.revenue_cents)),
    })),
    orderedSizes: orderedSizes.map((r) => ({ size: r.size, pieces: n(r.pieces), orders: n(r.orders) })),
  };
}

/* ------------------------------------------------------- orders & customers */

export async function orderReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const byStatus = await db.all(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS cents
       FROM orders WHERE created_at >= ? AND created_at <= ?
      GROUP BY status`,
    w
  );

  const totals = await db.get(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_cents), 0) AS revenue_cents,
            COALESCE(SUM(discount_cents), 0) AS discount_cents,
            COALESCE(SUM(pieces), 0) AS pieces,
            COALESCE(SUM(CASE WHEN discount_percent > 0 THEN 1 ELSE 0 END), 0) AS discounted,
            COALESCE(SUM(CASE WHEN pieces >= 2 THEN 1 ELSE 0 END), 0) AS bundles,
            COALESCE(SUM(CASE WHEN shipping_free = 1 THEN 1 ELSE 0 END), 0) AS free_shipping
       FROM orders
      WHERE created_at >= ? AND created_at <= ? AND status <> 'REJECTED'`,
    w
  );

  const byDiscount = await db.all(
    `SELECT COALESCE(discount_label, 'No discount') AS label,
            COUNT(*) AS n,
            COALESCE(SUM(discount_cents), 0) AS cents
       FROM orders WHERE created_at >= ? AND created_at <= ? AND status <> 'REJECTED'
      GROUP BY COALESCE(discount_label, 'No discount')
      ORDER BY n DESC`,
    w
  );

  // Orders joined to the session that produced them, so revenue can be read by
  // acquisition channel rather than only by volume.
  const bySource = await db.all(
    `SELECT COALESCE(s.source, 'unattributed') AS source,
            COUNT(*) AS orders,
            COALESCE(SUM(o.total_cents), 0) AS cents
       FROM orders o
       LEFT JOIN analytics_sessions s ON s.order_number = o.order_number
      WHERE o.created_at >= ? AND o.created_at <= ? AND o.status <> 'REJECTED'
      GROUP BY COALESCE(s.source, 'unattributed')
      ORDER BY orders DESC`,
    w
  );

  const byCity = await db.all(
    `SELECT city, COUNT(*) AS n FROM orders
      WHERE created_at >= ? AND created_at <= ? AND status <> 'REJECTED'
      GROUP BY city ORDER BY n DESC LIMIT 15`,
    w
  );

  // Fulfilment pace, measured from the order's own event history.
  const paceRows = await db.all(
    `SELECT o.order_number, o.created_at AS placed, e.status, e.created_at AS at
       FROM orders o JOIN order_events e ON e.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND e.status IN ('ACCEPTED','SHIPPED','DELIVERED')`,
    w
  );

  const firstAt = new Map();
  for (const r of paceRows) {
    const key = `${r.order_number}:${r.status}`;
    if (!firstAt.has(key) || r.at < firstAt.get(key)) firstAt.set(key, r.at);
    firstAt.set(`${r.order_number}:placed`, r.placed);
  }
  const hoursTo = (status) => {
    const spans = [];
    for (const [key, at] of firstAt) {
      if (!key.endsWith(`:${status}`)) continue;
      const orderNumber = key.slice(0, -(status.length + 1));
      const placed = firstAt.get(`${orderNumber}:placed`);
      if (!placed) continue;
      const hours = (new Date(at) - new Date(placed)) / 3600000;
      if (Number.isFinite(hours) && hours >= 0) spans.push(hours);
    }
    if (!spans.length) return null;
    return Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10;
  };

  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, n(r.n)]));
  const placed = byStatus.reduce((sum, r) => sum + n(r.n), 0);
  const orders = n(totals?.orders);

  return {
    byStatus: byStatus.map((r) => ({
      status: r.status,
      count: n(r.n),
      revenue: fromCents(n(r.cents)),
    })),
    placed,
    orders,
    rejected: statusMap.REJECTED || 0,
    rejectionRate: pct(statusMap.REJECTED || 0, placed),
    delivered: statusMap.DELIVERED || 0,
    revenue: fromCents(n(totals?.revenue_cents)),
    discountGiven: fromCents(n(totals?.discount_cents)),
    averageOrder: orders ? fromCents(Math.round(n(totals.revenue_cents) / orders)) : 0,
    piecesPerOrder: orders ? Math.round((n(totals?.pieces) / orders) * 100) / 100 : 0,
    discountedShare: pct(n(totals?.discounted), orders),
    bundleShare: pct(n(totals?.bundles), orders),
    freeShippingShare: pct(n(totals?.free_shipping), orders),
    byDiscount: byDiscount.map((r) => ({ label: r.label, count: n(r.n), amount: fromCents(n(r.cents)) })),
    bySource: bySource.map((r) => ({
      source: r.source,
      orders: n(r.orders),
      revenue: fromCents(n(r.cents)),
    })),
    byCity: byCity.map((r) => ({ city: r.city, count: n(r.n) })),
    hoursToAccept: hoursTo('ACCEPTED'),
    hoursToShip: hoursTo('SHIPPED'),
    hoursToDeliver: hoursTo('DELIVERED'),
  };
}

export async function customerReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const created = await db.get(
    `SELECT COUNT(*) AS n FROM customers WHERE created_at >= ? AND created_at <= ?`,
    w
  );
  const totals = await db.get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN delivered_count > 0 THEN 1 ELSE 0 END), 0) AS returning_count,
            COALESCE(SUM(order_count), 0) AS orders,
            COALESCE(SUM(total_spend_cents), 0) AS spend_cents
       FROM customers`
  );

  // An order counts as "from a returning customer" when the customer had
  // already received a delivery — the same rule the discount uses, so the two
  // numbers can never disagree.
  const returningOrders = await db.get(
    `SELECT COUNT(*) AS n FROM orders
      WHERE created_at >= ? AND created_at <= ? AND discount_label LIKE 'Returning%'`,
    w
  );
  const windowOrders = await db.get(
    `SELECT COUNT(*) AS n FROM orders WHERE created_at >= ? AND created_at <= ?`,
    w
  );

  const repeat = await db.all(
    `SELECT order_count AS orders, COUNT(*) AS customers
       FROM customers GROUP BY order_count ORDER BY order_count`
  );

  const total = n(totals?.total);
  return {
    newInRange: n(created?.n),
    total,
    returning: n(totals?.returning_count),
    returningShare: pct(n(totals?.returning_count), total),
    lifetimeOrders: n(totals?.orders),
    lifetimeSpend: fromCents(n(totals?.spend_cents)),
    averageLifetimeSpend: total ? fromCents(Math.round(n(totals.spend_cents) / total)) : 0,
    returningOrders: n(returningOrders?.n),
    returningOrderShare: pct(n(returningOrders?.n), n(windowOrders?.n)),
    repeatDistribution: repeat.map((r) => ({ orders: n(r.orders), customers: n(r.customers) })),
  };
}

/* -------------------------------------------- campaigns, devices, locations */

export async function campaignReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const rows = await db.all(
    `SELECT COALESCE(utm_campaign, '(none)') AS campaign,
            COALESCE(utm_source, '(none)') AS source,
            COALESCE(utm_medium, '(none)') AS medium,
            COALESCE(utm_content, '(none)') AS content,
            COUNT(*) AS sessions,
            COALESCE(SUM(created_order), 0) AS orders
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?
        AND (utm_campaign IS NOT NULL OR utm_source IS NOT NULL)
      GROUP BY COALESCE(utm_campaign, '(none)'), COALESCE(utm_source, '(none)'),
               COALESCE(utm_medium, '(none)'), COALESCE(utm_content, '(none)')
      ORDER BY sessions DESC
      LIMIT 50`,
    w
  );

  return rows.map((r) => ({
    campaign: r.campaign,
    source: r.source,
    medium: r.medium,
    content: r.content,
    sessions: n(r.sessions),
    orders: n(r.orders),
    rate: pct(n(r.orders), n(r.sessions)),
  }));
}

export async function deviceReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const group = (column) =>
    db.all(
      `SELECT COALESCE(${column}, 'unknown') AS key,
              COUNT(*) AS sessions,
              COALESCE(SUM(created_order), 0) AS orders
         FROM analytics_sessions
        WHERE started_at >= ? AND started_at <= ?
        GROUP BY COALESCE(${column}, 'unknown')
        ORDER BY sessions DESC`,
      w
    );

  const shape = (rows) =>
    rows.map((r) => ({
      key: r.key,
      sessions: n(r.sessions),
      orders: n(r.orders),
      rate: pct(n(r.orders), n(r.sessions)),
    }));

  const [devices, oses, browsers, screens] = await Promise.all([
    group('device'),
    group('os'),
    group('browser'),
    group('screen_class'),
  ]);

  return { devices: shape(devices), oses: shape(oses), browsers: shape(browsers), screens: shape(screens) };
}

export async function locationReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const countries = await db.all(
    `SELECT COALESCE(country, 'not supplied') AS key,
            COUNT(*) AS sessions,
            COALESCE(SUM(created_order), 0) AS orders
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY COALESCE(country, 'not supplied')
      ORDER BY sessions DESC
      LIMIT 30`,
    w
  );

  const cities = await db.all(
    `SELECT city AS key, COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS cents
       FROM orders
      WHERE created_at >= ? AND created_at <= ? AND status <> 'REJECTED'
      GROUP BY city ORDER BY orders DESC LIMIT 30`,
    w
  );

  const withCountry = countries.filter((r) => r.key !== 'not supplied').length;

  return {
    countries: countries.map((r) => ({
      key: r.key,
      sessions: n(r.sessions),
      orders: n(r.orders),
    })),
    // The admin says plainly when no country data exists, rather than showing
    // an empty chart that looks like "no visitors".
    geoAvailable: withCountry > 0,
    cities: cities.map((r) => ({ key: r.key, orders: n(r.orders), revenue: fromCents(n(r.cents)) })),
  };
}

/* ------------------------------------------------------------- conversion */

export async function conversionReport(range) {
  const db = await getDb();
  const w = [range.from, range.to];

  const by = (column) =>
    db.all(
      `SELECT COALESCE(${column}, 'unknown') AS key,
              COUNT(*) AS sessions,
              COALESCE(SUM(added_to_cart), 0) AS carts,
              COALESCE(SUM(began_checkout), 0) AS checkouts,
              COALESCE(SUM(created_order), 0) AS orders
         FROM analytics_sessions
        WHERE started_at >= ? AND started_at <= ?
        GROUP BY COALESCE(${column}, 'unknown')
        HAVING COUNT(*) > 0
        ORDER BY sessions DESC
        LIMIT 20`,
      w
    );

  const shape = (rows) =>
    rows.map((r) => ({
      key: r.key,
      sessions: n(r.sessions),
      carts: n(r.carts),
      checkouts: n(r.checkouts),
      orders: n(r.orders),
      cartRate: pct(n(r.carts), n(r.sessions)),
      checkoutRate: pct(n(r.checkouts), n(r.sessions)),
      orderRate: pct(n(r.orders), n(r.sessions)),
      checkoutCompletion: pct(n(r.orders), n(r.checkouts)),
    }));

  const [bySource, byDevice, byLanding] = await Promise.all([
    by('source'),
    by('device'),
    by('landing_path'),
  ]);

  const returning = await db.all(
    `SELECT CASE WHEN is_new_visitor = 1 THEN 'new' ELSE 'returning' END AS key,
            COUNT(*) AS sessions,
            COALESCE(SUM(added_to_cart), 0) AS carts,
            COALESCE(SUM(began_checkout), 0) AS checkouts,
            COALESCE(SUM(created_order), 0) AS orders
       FROM analytics_sessions
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY CASE WHEN is_new_visitor = 1 THEN 'new' ELSE 'returning' END`,
    w
  );

  return {
    bySource: shape(bySource),
    byDevice: shape(byDevice),
    byLanding: shape(byLanding),
    byVisitorType: shape(returning),
  };
}

/* ------------------------------------------------------------ raw events */

/**
 * The raw stream, kept because aggregates cannot answer a question nobody
 * thought to ask in advance.
 */
export async function rawEvents(range, { name = '', limit = 200 } = {}) {
  const db = await getDb();
  const params = [range.from, range.to];
  let where = 'created_at >= ? AND created_at <= ?';
  if (name) {
    where += ' AND name = ?';
    params.push(String(name).slice(0, 40));
  }
  params.push(Math.min(Number(limit) || 200, 1000));

  const rows = await db.all(
    `SELECT id, name, path, props, source, medium, device, browser, session_id, engaged_ms, created_at
       FROM analytics_events
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ?`,
    params
  );

  const names = await db.all(
    `SELECT name, COUNT(*) AS n FROM analytics_events
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY name ORDER BY n DESC`,
    [range.from, range.to]
  );

  return { rows, names: names.map((r) => ({ name: r.name, count: n(r.n) })) };
}

/**
 * Delete analytics older than a retention window.
 *
 * Data that is never deleted is a liability that only grows. This is offered
 * as an explicit admin action rather than a silent background job, so nobody
 * loses a report they were about to run.
 */
export async function purgeOlderThan(days) {
  const cutoffDays = Math.max(30, Number(days) || 365);
  const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString();
  const db = await getDb();
  const events = await db.run('DELETE FROM analytics_events WHERE created_at < ?', [cutoff]);
  const sessions = await db.run('DELETE FROM analytics_sessions WHERE started_at < ?', [cutoff]);
  return { cutoff, events: events.changes, sessions: sessions.changes };
}

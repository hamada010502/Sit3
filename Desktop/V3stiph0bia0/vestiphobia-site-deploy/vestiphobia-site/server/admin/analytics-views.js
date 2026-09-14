/**
 * VESTIPHOBIA — analytics screens.
 *
 * Pure render functions. Every number shown here comes from a query in
 * server/routes/analytics.js scoped to the selected window; nothing is
 * computed twice, and no view invents a denominator.
 *
 * Where there is no data, these screens say so. An empty chart that looks like
 * a real zero is worse than a sentence explaining that nothing was collected
 * yet — the Locations screen is the clearest case: without a country header
 * from the host there is nothing to show, and it says exactly that.
 */

import { esc, money, shortDate } from './ui.js';
import { RANGES } from '../routes/analytics.js';

export const TABS = [
  ['overview', 'Overview'],
  ['traffic', 'Traffic'],
  ['funnel', 'Funnel'],
  ['products', 'Products'],
  ['customers', 'Customers'],
  ['orders', 'Orders'],
  ['campaigns', 'Campaigns'],
  ['devices', 'Devices'],
  ['locations', 'Locations'],
  ['conversion', 'Conversion'],
  ['events', 'Raw events'],
];

const empty = (msg) => `<p class="note" style="padding:16px">${esc(msg)}</p>`;
const num = (v) => esc(String(v ?? 0));
const rate = (v) => `${esc(String(v ?? 0))}%`;

/** Tab bar + date filter, shared by every analytics screen. */
export function analyticsHeader({ tab, range, extra = '' }) {
  const qs = (t) => {
    const p = new URLSearchParams({ tab: t, range: range.key });
    if (range.key === 'custom') {
      p.set('from', range.fromDate);
      p.set('to', range.toDate);
    }
    return `/admin/analytics?${p.toString()}`;
  };

  return `
<h1>Analytics</h1>
<p class="sub">First-party only. No third-party script, no ad network, and no personal
  data in any event — names, phone numbers and addresses stay in the order database,
  behind this login.</p>

<div class="toolbar" style="border-bottom:1px solid var(--line);padding-bottom:12px">
  ${TABS.map(
    ([key, label]) =>
      `<a class="btn btn--sm${key === tab ? ' btn--primary' : ''}" href="${qs(key)}">${esc(label)}</a>`
  ).join('\n  ')}
</div>

<form class="toolbar" method="get" action="/admin/analytics">
  <input type="hidden" name="tab" value="${esc(tab)}">
  <label class="sr-only" for="range">Date range</label>
  <select id="range" name="range" style="max-width:150px">
    ${Object.entries(RANGES)
      .map(
        ([key, label]) =>
          `<option value="${key}"${key === range.key ? ' selected' : ''}>${esc(label)}</option>`
      )
      .join('')}
  </select>
  <label class="sr-only" for="from">From</label>
  <input id="from" type="text" name="from" value="${esc(range.fromDate || '')}" placeholder="YYYY-MM-DD" style="max-width:140px">
  <label class="sr-only" for="to">To</label>
  <input id="to" type="text" name="to" value="${esc(range.toDate || '')}" placeholder="YYYY-MM-DD" style="max-width:140px">
  <button class="btn" type="submit">Apply</button>
  <span class="note">Showing ${esc(range.fromDate)} to ${esc(range.toDate)} (UTC)</span>
  ${extra}
</form>
`;
}

const cards = (items) => `
<div class="cards">
  ${items
    .map(
      ([label, value, note]) => `<div class="card">
    <div class="card__label">${esc(label)}</div>
    <div class="card__value">${esc(String(value))}</div>
    ${note ? `<div class="card__note">${esc(note)}</div>` : ''}
  </div>`
    )
    .join('\n  ')}
</div>`;

/** A horizontal bar table. Bars are proportional to the largest row shown. */
function barTable(rows, { keyLabel = 'Key', valueLabel = 'Sessions', extraColumns = [] } = {}) {
  if (!rows.length) return empty('Nothing recorded in this window.');
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="table-wrap">
  <table>
    <thead><tr><th>${esc(keyLabel)}</th><th>${esc(valueLabel)}</th>
      ${extraColumns.map((c) => `<th>${esc(c)}</th>`).join('')}<th style="width:30%"></th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td>${esc(r.key)}</td>
        <td class="num">${num(r.value)}</td>
        ${(r.extras || []).map((e) => `<td class="num">${esc(String(e))}</td>`).join('')}
        <td><div class="bar"><span style="width:${Math.round((r.value / max) * 100)}%"></span></div></td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>`;
}

/* --------------------------------------------------------------- overview */

export function overviewView({ data, range }) {
  const maxDay = Math.max(1, ...data.daily.map((d) => d.sessions));

  return `
${cards([
  ['Sessions', data.sessions, `${data.visitors} unique visitors`],
  ['New sessions', data.newVisitors, `${data.returningVisitors} returning`],
  ['Orders', data.orders, `${data.conversionRate}% of sessions`],
  ['Revenue', money(data.revenue), `${data.pieces} pieces`],
  ['Average order', money(data.averageOrder), ''],
  ['Reached cart', `${data.cartRate}%`, 'of sessions'],
  ['Engaged time', `${data.engagedSecondsPerSession}s`, 'average per session, foreground only'],
  ['Events', data.events, `over ${esc(range.label)}`],
])}

<h2>Sessions and orders by day</h2>
<div class="panel">
  ${
    data.daily.length
      ? data.daily
          .map(
            (d) => `<div style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <span class="mono">${esc(d.day)}</span>
      <span class="num">${num(d.sessions)} sessions · ${num(d.orders)} orders</span>
    </div>
    <div class="bar"><span style="width:${Math.round((d.sessions / maxDay) * 100)}%"></span></div>
  </div>`
          )
          .join('')
      : '<p class="note">No sessions recorded in this window.</p>'
  }
</div>

<h2>Top sources</h2>
${barTable(
  data.topSources.map((s) => ({ key: s.source, value: s.sessions, extras: [s.orders, `${s.rate}%`] })),
  { keyLabel: 'Source', extraColumns: ['Orders', 'Conversion'] }
)}
`;
}

/* ---------------------------------------------------------------- traffic */

export function trafficView({ data }) {
  const block = (title, rows, keyLabel) => `
<h2>${esc(title)}</h2>
${barTable(
  rows.map((r) => ({
    key: r.key,
    value: r.sessions,
    extras: [r.orders, `${r.rate}%`, `${r.engagedSeconds}s`],
  })),
  { keyLabel, extraColumns: ['Orders', 'Conversion', 'Avg engaged'] }
)}`;

  return `
${cards([
  ['New sessions', data.newSessions, 'first visit from this browser'],
  ['Returning sessions', data.returningSessions, ''],
])}
${block('Source', data.sources, 'Source')}
${block('Medium', data.mediums, 'Medium')}
${block('Landing page', data.landing, 'Path')}
${block('Exit page', data.exits, 'Path')}
${block('Referrer', data.referrers, 'Host')}
<p class="note">A visitor arriving with no referrer is counted as <span class="mono">direct</span>.
  Browsers strip the referrer in several ordinary cases, so some of "direct" is really
  "unknowable" — it is not inflated with a guess.</p>
`;
}

/* ----------------------------------------------------------------- funnel */

export function funnelView({ data }) {
  const top = data.steps[0]?.count || 1;

  return `
<h2>Where people stop</h2>
<div class="panel">
  ${data.steps
    .map(
      (s) => `<div style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <span>${esc(s.label)}</span>
      <span class="num">${num(s.count)} · ${rate(s.ofTotal)} of visitors${
        s.fromPrevious === undefined ? '' : ` · ${rate(s.fromPrevious)} of previous step`
      }</span>
    </div>
    <div class="bar"><span style="width:${Math.round((s.count / top) * 100)}%"></span></div>
    ${
      s.lost
        ? `<div class="note" style="margin-top:3px">${num(s.lost)} did not continue past ${esc(
            data.steps[s.index - 1].label
          )}</div>`
        : ''
    }
  </div>`
    )
    .join('')}
</div>

${cards([
  ['Abandoned checkout', data.abandonedCheckout, 'began checkout, no order'],
  ['WhatsApp handoffs', data.whatsappClicks, 'sessions that opened the message'],
])}

<h2>Last page seen, sessions with no order</h2>
${barTable(
  data.abandonedAt.map((r) => ({ key: r.path, value: r.sessions })),
  { keyLabel: 'Exit path' }
)}
`;
}

/* --------------------------------------------------------------- products */

export function productsView({ data }) {
  const list = (title, rows, keyLabel, valueLabel = 'Count') => `
<h2>${esc(title)}</h2>
${barTable(
  rows.map((r) => ({ key: r.key, value: r.count })),
  { keyLabel, valueLabel }
)}`;

  return `
${list('Product views', data.views, 'Product')}
${list('Size selections', data.sizeSelections, 'Size')}
${list('Added to cart, by product', data.addsToCart, 'Product')}
${list('Added to cart, by size', data.addedSizes, 'Size')}
${list('Removed from cart', data.removals, 'Product')}

<h2>Ordered products</h2>
${barTable(
  data.orderedProducts.map((r) => ({
    key: r.slug,
    value: r.pieces,
    extras: [r.orders, money(r.revenue)],
  })),
  { keyLabel: 'Product', valueLabel: 'Pieces', extraColumns: ['Orders', 'Revenue'] }
)}

<h2>Ordered sizes</h2>
${barTable(
  data.orderedSizes.map((r) => ({ key: r.size, value: r.pieces, extras: [r.orders] })),
  { keyLabel: 'Size', valueLabel: 'Pieces', extraColumns: ['Orders'] }
)}
<p class="note">Selections come from the storefront; ordered pieces come from the order
  database. The gap between them is the size people wanted and did not buy.</p>
`;
}

/* -------------------------------------------------------------- customers */

export function customersView({ data }) {
  return `
${cards([
  ['New customers', data.newInRange, 'in this window'],
  ['Total customers', data.total, ''],
  ['Returning', data.returning, `${data.returningShare}% have a delivered order`],
  ['Returning orders', data.returningOrders, `${data.returningOrderShare}% of orders in window`],
  ['Lifetime spend', money(data.lifetimeSpend), 'all time'],
  ['Average per customer', money(data.averageLifetimeSpend), 'all time'],
])}

<h2>Orders per customer</h2>
${barTable(
  data.repeatDistribution.map((r) => ({ key: `${r.orders} order(s)`, value: r.customers })),
  { keyLabel: 'Orders placed', valueLabel: 'Customers' }
)}
<p class="note">A customer is a normalised phone number. This screen counts people; it
  never shows their number, name or address — those are on the Customers page, one record
  at a time, so a whole customer list is never on screen at once.</p>
`;
}

/* ----------------------------------------------------------------- orders */

export function ordersView({ data }) {
  const hours = (v) => (v === null ? 'not enough data' : `${v}h`);

  return `
${cards([
  ['Orders placed', data.placed, 'including rejected'],
  ['Accepted or better', data.orders, ''],
  ['Rejected', data.rejected, `${data.rejectionRate}% of placed`],
  ['Delivered', data.delivered, ''],
  ['Revenue', money(data.revenue), ''],
  ['Average order', money(data.averageOrder), `${data.piecesPerOrder} pieces per order`],
  ['Discount given', money(data.discountGiven), `${data.discountedShare}% of orders`],
  ['Bundles', `${data.bundleShare}%`, '2+ pieces'],
  ['Free shipping', `${data.freeShippingShare}%`, 'of orders'],
  ['To accept', hours(data.hoursToAccept), 'average, order to acceptance'],
  ['To ship', hours(data.hoursToShip), 'average, order to shipment'],
  ['To deliver', hours(data.hoursToDeliver), 'average, order to delivery'],
])}

<h2>By status</h2>
${barTable(
  data.byStatus.map((r) => ({ key: r.status, value: r.count, extras: [money(r.revenue)] })),
  { keyLabel: 'Status', valueLabel: 'Orders', extraColumns: ['Value'] }
)}

<h2>By acquisition source</h2>
${barTable(
  data.bySource.map((r) => ({ key: r.source, value: r.orders, extras: [money(r.revenue)] })),
  { keyLabel: 'Source', valueLabel: 'Orders', extraColumns: ['Revenue'] }
)}
<p class="note"><span class="mono">unattributed</span> means the order could not be linked
  to a session — the visitor opted out of analytics, blocked it, or ordered from a different
  device than the one that browsed. It is not a source.</p>

<h2>Discounts used</h2>
${barTable(
  data.byDiscount.map((r) => ({ key: r.label, value: r.count, extras: [money(r.amount)] })),
  { keyLabel: 'Discount', valueLabel: 'Orders', extraColumns: ['Given'] }
)}

<h2>Delivery cities</h2>
${barTable(
  data.byCity.map((r) => ({ key: r.city, value: r.count })),
  { keyLabel: 'City', valueLabel: 'Orders' }
)}
`;
}

/* -------------------------------------------------------------- campaigns */

export function campaignsView({ rows }) {
  return `
<h2>Campaigns</h2>
${
  rows.length
    ? `<div class="table-wrap">
  <table>
    <thead><tr><th>Campaign</th><th>Source</th><th>Medium</th><th>Content</th><th>Sessions</th><th>Orders</th><th>Conversion</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td>${esc(r.campaign)}</td><td>${esc(r.source)}</td><td>${esc(r.medium)}</td>
        <td>${esc(r.content)}</td>
        <td class="num">${num(r.sessions)}</td><td class="num">${num(r.orders)}</td>
        <td class="num">${rate(r.rate)}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>`
    : empty('No campaign traffic in this window.')
}
<p class="note">Tag a link like
  <span class="mono">/shop/?utm_source=instagram&amp;utm_medium=story&amp;utm_campaign=drop-001</span>
  and it appears here. The tag is captured on the first page of the visit and stays with the
  session, so an internal click cannot overwrite where the visitor came from.</p>
`;
}

/* ---------------------------------------------------------------- devices */

export function devicesView({ data }) {
  const block = (title, rows, keyLabel) => `
<h2>${esc(title)}</h2>
${barTable(
  rows.map((r) => ({ key: r.key, value: r.sessions, extras: [r.orders, `${r.rate}%`] })),
  { keyLabel, extraColumns: ['Orders', 'Conversion'] }
)}`;

  return `
${block('Device', data.devices, 'Device')}
${block('Operating system', data.oses, 'OS')}
${block('Browser', data.browsers, 'Browser')}
${block('Screen size', data.screens, 'Class')}
<p class="note">Deliberately coarse. Enough to answer "is the mobile checkout working",
  not enough to tell two visitors apart — no version strings, no canvas or font probing,
  nothing that adds up to a fingerprint.</p>
`;
}

/* -------------------------------------------------------------- locations */

export function locationsView({ data }) {
  return `
<h2>Countries</h2>
${
  data.geoAvailable
    ? barTable(
        data.countries.map((r) => ({ key: r.key, value: r.sessions, extras: [r.orders] })),
        { keyLabel: 'Country', extraColumns: ['Orders'] }
      )
    : `<div class="panel"><p class="note">
    No country data is being collected. Nothing is broken and nothing is missing —
    this site performs no IP geolocation and bundles no location database. The column is
    filled only when the host in front of the app supplies a country header
    (<span class="mono">CF-IPCountry</span> on Cloudflare,
    <span class="mono">Fly-Client-Country</span> on Fly). Until then, delivery cities
    below are the reliable location signal.
  </p></div>`
}

<h2>Delivery cities (from orders)</h2>
${barTable(
  data.cities.map((r) => ({ key: r.key, value: r.orders, extras: [money(r.revenue)] })),
  { keyLabel: 'City', valueLabel: 'Orders', extraColumns: ['Revenue'] }
)}
`;
}

/* ------------------------------------------------------------- conversion */

export function conversionView({ data }) {
  const block = (title, rows, keyLabel) => `
<h2>${esc(title)}</h2>
${
  rows.length
    ? `<div class="table-wrap">
  <table>
    <thead><tr><th>${esc(keyLabel)}</th><th>Sessions</th><th>Cart</th><th>Checkout</th><th>Orders</th>
      <th>Cart rate</th><th>Order rate</th><th>Checkout completion</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td>${esc(r.key)}</td>
        <td class="num">${num(r.sessions)}</td><td class="num">${num(r.carts)}</td>
        <td class="num">${num(r.checkouts)}</td><td class="num">${num(r.orders)}</td>
        <td class="num">${rate(r.cartRate)}</td><td class="num">${rate(r.orderRate)}</td>
        <td class="num">${rate(r.checkoutCompletion)}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>`
    : empty('Nothing recorded in this window.')
}`;

  return `
${block('By source', data.bySource, 'Source')}
${block('By device', data.byDevice, 'Device')}
${block('New vs returning', data.byVisitorType, 'Visitor')}
${block('By landing page', data.byLanding, 'Landing path')}
<p class="note">Rates over small numbers are noise. A source with four sessions and one
  order is not a 25% channel — read these once the counts are in the hundreds.</p>
`;
}

/* ------------------------------------------------------------ raw events */

export function eventsView({ data, name, range }) {
  const qs = (n2) => {
    const p = new URLSearchParams({ tab: 'events', range: range.key });
    if (n2) p.set('name', n2);
    if (range.key === 'custom') {
      p.set('from', range.fromDate);
      p.set('to', range.toDate);
    }
    return `/admin/analytics?${p.toString()}`;
  };

  return `
<h2>Event types</h2>
<div class="toolbar">
  <a class="btn btn--sm${name ? '' : ' btn--primary'}" href="${qs('')}">All</a>
  ${data.names
    .map(
      (n2) =>
        `<a class="btn btn--sm${n2.name === name ? ' btn--primary' : ''}" href="${qs(n2.name)}">${esc(
          n2.name
        )} (${num(n2.count)})</a>`
    )
    .join('\n  ')}
</div>

<h2>Raw stream${name ? ` — ${esc(name)}` : ''}</h2>
${
  data.rows.length
    ? `<div class="table-wrap">
  <table>
    <thead><tr><th>When</th><th>Event</th><th>Path</th><th>Source</th><th>Device</th><th>Engaged</th><th>Props</th><th>Session</th></tr></thead>
    <tbody>
      ${data.rows
        .map(
          (r) => `<tr>
        <td class="num">${esc(shortDate(r.created_at))}</td>
        <td class="mono">${esc(r.name)}</td>
        <td class="mono">${esc(r.path || '—')}</td>
        <td>${esc(r.source || '—')}</td>
        <td>${esc([r.device, r.browser].filter(Boolean).join(' / ') || '—')}</td>
        <td class="num">${r.engaged_ms ? `${Math.round(Number(r.engaged_ms) / 1000)}s` : '—'}</td>
        <td class="mono">${esc(r.props || '')}</td>
        <td class="mono">${esc(String(r.session_id).slice(0, 8))}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>`
    : empty('No events in this window.')
}
<p class="note">Raw events are kept, not just counters, because an aggregate cannot answer
  a question nobody thought to ask in advance. Retention and purging are on the Settings
  page.</p>
`;
}

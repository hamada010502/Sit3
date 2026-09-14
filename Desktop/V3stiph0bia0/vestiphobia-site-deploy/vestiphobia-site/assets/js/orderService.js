/**
 * VESTIPHOBIA — order service.
 *
 * ============================================================================
 * TWO MODES, AND THE PAGE ALWAYS KNOWS WHICH ONE IT IS IN
 * ============================================================================
 * API mode (window.VESTI.ordersEndpoint is set — the default build):
 *   The server in server/ owns everything that matters. It allocates the order
 *   number, prices the cart from the catalogue, decides the discount, checks
 *   stock, and stores the order. Nothing this file sends is trusted: a total
 *   posted from here is simply never read. A copy of the confirmed order is
 *   kept in localStorage afterwards purely as a receipt, so the confirmation
 *   page can be reopened on this device without asking for a phone number.
 *
 * Local mode (ordersEndpoint is null — a standalone static deploy):
 *   There is no server, so the order is written to the customer's OWN browser
 *   and nowhere else. The brand receives it only through the WhatsApp message
 *   the customer sends. Order numbers are per-browser and can collide, and
 *   clearing site data destroys the record. This mode exists so the site can
 *   still be deployed as pure static files; it is not the intended setup.
 *
 * Which mode is active is readable at runtime via `isLocalOnly()`, and the
 * checkout says so rather than implying an order reached a server that was
 * never contacted.
 * ============================================================================
 */

const CFG = window.VESTI || {};
const ORDERS_KEY = 'vestiphobia.orders.v1';
const SEQ_KEY = 'vestiphobia.orderSeq.v1';

/* ------------------------------------------------------------- statuses */

/**
 * The confirmed status vocabulary. PENDING means "submitted, awaiting store
 * approval" — it explicitly does NOT mean paid. The older AWAITING PAYMENT /
 * PAYMENT RECEIVED wording is retired and must not come back; a QA check
 * fails the build if it reappears.
 */
export const ORDER_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  REJECTED: 'REJECTED',
};

/** Normal forward progression. REJECTED is reachable from any state. */
export const STATUS_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
];

/** Plain-language meaning, shown to the customer so PENDING is never misread. */
export const STATUS_MEANING = {
  [ORDER_STATUS.PENDING]: 'Submitted — awaiting store approval',
  [ORDER_STATUS.ACCEPTED]: 'Approved by the store',
  [ORDER_STATUS.PREPARING]: 'Being prepared',
  [ORDER_STATUS.SHIPPED]: 'Handed to the courier',
  [ORDER_STATUS.DELIVERED]: 'Received by the customer',
  [ORDER_STATUS.REJECTED]: 'Not accepted',
};

/* --------------------------------------------------------- local driver */

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    // Never wipe on a parse failure — a corrupt record is still evidence of a
    // real order. Report it and keep whatever is on disk untouched.
    console.warn('[vestiphobia] order store unreadable, leaving it intact:', err);
    return [];
  }
}

function writeAll(orders) {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    return true;
  } catch (err) {
    console.warn('[vestiphobia] could not save order locally:', err);
    return false;
  }
}

/**
 * Human-readable order id: VST-2026-0001.
 *
 * The sequence counter is per-browser, so two different customers can produce
 * the same id. That is acceptable while WhatsApp carries the order (the brand
 * reads the id off the message alongside the customer's name and phone), and
 * it is the first thing a backend must take over.
 */
function nextOrderId() {
  const prefix = CFG.orderIdPrefix || 'VST';
  const pad = CFG.orderSeqPadding || 4;
  const year = new Date().getFullYear();
  let seq = 1;
  try {
    const stored = JSON.parse(localStorage.getItem(SEQ_KEY) || 'null');
    if (stored && stored.year === year) seq = Number(stored.seq) + 1;
    localStorage.setItem(SEQ_KEY, JSON.stringify({ year, seq }));
  } catch {
    // Storage unavailable — fall back to a time-derived suffix so the id is
    // still unique-ish and readable rather than colliding on 0001.
    seq = Number(String(Date.now()).slice(-pad));
  }
  return `${prefix}-${year}-${String(seq).padStart(pad, '0')}`;
}

const localDriver = {
  name: 'local',

  async create(order) {
    const orders = readAll();
    orders.unshift(order);
    writeAll(orders);
    return order;
  },

  async get(orderId) {
    return readAll().find((o) => o.orderId === orderId) || null;
  },

  async list() {
    return readAll();
  },

  async update(orderId, patch) {
    const orders = readAll();
    const i = orders.findIndex((o) => o.orderId === orderId);
    if (i === -1) return null;
    orders[i] = { ...orders[i], ...patch, updatedAt: new Date().toISOString() };
    writeAll(orders);
    return orders[i];
  },
};

/* ----------------------------------------------------------- API driver */

/**
 * The real backend (server/index.js).
 *
 * Note what `create` sends: name, phone, city, address, email, notes, and the
 * cart as slug + size + quantity. No prices, no discount, no total. The server
 * recomputes all of it from the catalogue, so tampering with this request
 * changes nothing except which garment is ordered.
 *
 * Reading an order back requires the phone number that is on it. Order numbers
 * are sequential and therefore guessable; without that check anyone could walk
 * the range and read every customer's name and address.
 */
const apiDriver = (endpoint) => ({
  name: 'api',

  async create(input) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* a non-JSON body means the server or a proxy failed outright */
    }

    if (!res.ok) {
      const err = new Error(payload?.error || `Order could not be created (${res.status})`);
      err.status = res.status;
      err.code = payload?.code || null;
      err.fields = payload?.fields || null;
      throw err;
    }
    return payload;
  },

  async get(orderId, phone) {
    if (!phone) return null; // the server will not answer without one
    const url = `${endpoint}/${encodeURIComponent(orderId)}?phone=${encodeURIComponent(phone)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json();
    return decorate(payload.order, payload.whatsappUrl);
  },
});

const remote = CFG.ordersEndpoint ? apiDriver(CFG.ordersEndpoint) : null;
const driver = remote || localDriver;

export const driverName = driver.name;
export const isLocalOnly = () => driver.name === 'local';

/**
 * The server calls the field `status`; the pages, written first against the
 * local store, read `orderStatus`. Rather than rename it in four templates,
 * every order returned from the API is decorated with both. `whatsappUrl` is
 * attached here too — in API mode the wa.me link is built on the server, so
 * the destination number never has to be present in the page bundle.
 */
function decorate(order, whatsappUrl = null) {
  if (!order) return null;
  return { ...order, orderStatus: order.status || order.orderStatus, whatsappUrl };
}

/**
 * Receipts for orders placed in THIS browser.
 *
 * This is a convenience only: it lets the confirmation page reopen without a
 * phone challenge. The server remains the source of truth, and a receipt that
 * disagrees with it is never used to display a status.
 */
function keepReceipt(order) {
  if (!order) return;
  const all = readAll().filter((o) => o.orderId !== order.orderId);
  all.unshift(order);
  writeAll(all.slice(0, 30));
}

/* -------------------------------------------------- customer records */

const CUSTOMERS_KEY = 'vestiphobia.customers.v1';

/**
 * Phone is the internal customer key. Normalise aggressively so
 * "0955 123 456", "+963955123456" and "963-955-123-456" are one customer.
 * Syrian numbers are stored in full international form without the plus.
 */
export function normalisePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  // Local Syrian format 09XXXXXXXX -> 9639XXXXXXXX
  if (d.startsWith('0') && d.length === 10) d = '963' + d.slice(1);
  return d;
}

function readCustomers() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    console.warn('[vestiphobia] customer store unreadable, leaving it intact:', err);
    return {};
  }
}

function writeCustomers(map) {
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('[vestiphobia] could not save customer record:', err);
  }
}

/**
 * A customer is "returning" only once a PREVIOUS order of theirs reached
 * DELIVERED. PENDING / ACCEPTED / PREPARING / SHIPPED do not qualify — the
 * discount is a reward for a completed purchase, not a placed one.
 */
export async function isReturningCustomer(phone) {
  const key = normalisePhone(phone);
  if (!key) return false;

  // In API mode this question is NOT asked of the server. An endpoint that
  // answered "has this phone number ordered before?" would let anyone test a
  // number against the customer list. The server applies the returning
  // discount itself when it prices the order, from history the browser cannot
  // see — so the checkout preview simply shows the bundle discount, and the
  // confirmed total can only come out the same or lower.
  if (remote) return false;

  const orders = await driver.list();
  return orders.some(
    (o) => normalisePhone(o.customerPhone) === key && o.orderStatus === ORDER_STATUS.DELIVERED
  );
}

export async function getCustomer(phone) {
  const key = normalisePhone(phone);
  if (!key) return null;
  const orders = (await driver.list()).filter((o) => normalisePhone(o.customerPhone) === key);
  if (!orders.length) return null;
  const latest = orders[0];
  return {
    phone: key,
    name: latest.customerName,
    email: latest.customerEmail || '',
    city: latest.city,
    address: latest.address,
    orderCount: orders.length,
    totalSpend: orders.reduce((n, o) => n + (o.total || 0), 0),
    lastOrderAt: latest.createdAt,
    orders,
    hasDelivered: orders.some((o) => o.orderStatus === ORDER_STATUS.DELIVERED),
  };
}

export async function listCustomers() {
  const orders = await driver.list();
  const byPhone = new Map();
  for (const o of orders) {
    const key = normalisePhone(o.customerPhone);
    if (!key) continue;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push(o);
  }
  return [...byPhone.entries()].map(([phone, list]) => ({
    phone,
    name: list[0].customerName,
    email: list[0].customerEmail || '',
    city: list[0].city,
    address: list[0].address,
    orderCount: list.length,
    totalSpend: list.reduce((n, o) => n + (o.total || 0), 0),
    lastOrderAt: list[0].createdAt,
    hasDelivered: list.some((o) => o.orderStatus === ORDER_STATUS.DELIVERED),
  }));
}

/* ------------------------------------------------------------- public API */

/**
 * Idempotency: a fingerprint of the exact cart + customer. Two taps on
 * CONFIRM BY WHATSAPP inside the window below reuse the first order instead
 * of creating a second one for the same basket.
 */
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

function fingerprint(cart, customer) {
  const items = cart.items
    .map((i) => `${i.slug}:${i.size}:${i.qty}`)
    .sort()
    .join('|');
  return `${normalisePhone(customer.phone)}#${items}#${cart.subtotal}`;
}

/**
 * Build and persist an order.
 *
 * The status is always PENDING — "submitted, awaiting store approval". Nothing
 * in this file can advance it; only an explicit admin action does.
 *
 * The discount that applied at this moment is written into the order and never
 * recalculated afterwards, so changing a promotion later cannot rewrite the
 * price of an order that has already been placed.
 */
export async function createOrder({ cart, customer, pricing, attribution = null }) {
  // API mode: send the inputs only and let the server decide everything else.
  // It runs its own idempotency window, so a double tap cannot create a second
  // order even if two requests are genuinely in flight at once.
  if (remote) {
    const payload = await remote.create({
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email || '',
      city: customer.city,
      address: customer.address,
      notes: customer.notes || '',
      items: cart.items.map((i) => ({ slug: i.slug, size: i.size, quantity: i.qty })),
      referrer: document.referrer || null,
      utm: attribution?.utm || null,
    });
    const order = decorate(payload.order, payload.whatsappUrl);
    keepReceipt(order);
    return order;
  }

  const now = new Date().toISOString();
  const fp = fingerprint(cart, customer);

  // Duplicate-tap guard: same basket, same customer, within the window.
  const existing = (await driver.list()).find(
    (o) =>
      o.fingerprint === fp &&
      o.orderStatus === ORDER_STATUS.PENDING &&
      Date.now() - new Date(o.createdAt).getTime() < IDEMPOTENCY_WINDOW_MS
  );
  if (existing) return existing;

  const phone = normalisePhone(customer.phone);

  const order = {
    orderId: nextOrderId(),
    fingerprint: fp,
    createdAt: now,
    updatedAt: now,

    customerName: (customer.fullName || '').trim(),
    customerPhone: phone,
    customerPhoneRaw: customer.phone || '',
    customerEmail: (customer.email || '').trim(),
    city: (customer.city || '').trim(),
    address: (customer.address || '').trim(),
    notes: (customer.notes || '').trim(),

    items: cart.items.map((i) => ({
      slug: i.slug,
      name: i.name,
      shortName: i.shortName,
      size: i.size,
      quantity: i.qty,
      unitPrice: i.price,
      lineTotal: i.lineTotal,
    })),

    currency: cart.currency,
    pieces: cart.pieces,
    subtotal: pricing.subtotal,

    // Frozen at order time. Never recomputed.
    discountPercent: pricing.discountPercent,
    discountAmount: pricing.discountAmount,
    discountType: pricing.appliedDiscount?.type || null,
    discountLabel: pricing.appliedDiscount?.label || null,

    merchandiseTotal: pricing.total,
    // Shipping is quoted by the courier per region and collected on delivery,
    // so the site records no amount rather than inventing one.
    shipping: null,
    shippingLabel: pricing.freeShipping
      ? 'Free shipping (2+ pieces)'
      : 'Paid on delivery — varies by region',
    shippingFree: pricing.freeShipping,
    total: pricing.total,

    paymentMethod: CFG.paymentMethod || 'SHAM CASH — MANUAL',
    orderStatus: ORDER_STATUS.PENDING,

    // Stage 4 fills this from the analytics layer; captured here so the
    // attribution is frozen with the order.
    attribution,

    history: [
      { at: now, status: ORDER_STATUS.PENDING, note: 'Order submitted from the website' },
    ],
  };

  const saved = await driver.create(order);

  // Keep a lightweight customer index so a returning customer is recognised
  // even if their orders are later archived.
  if (phone) {
    const map = readCustomers();
    const prev = map[phone] || { orders: 0, firstSeen: now };
    map[phone] = {
      ...prev,
      name: order.customerName,
      city: order.city,
      orders: prev.orders + 1,
      lastSeen: now,
    };
    writeCustomers(map);
  }

  return saved;
}

/**
 * Read an order back.
 *
 * In API mode the local receipt is used only when no phone number is supplied
 * — that is the "I just placed this on this device" case. As soon as a phone
 * number is given, the server is asked, because the server is the only place
 * the current status lives: a receipt written at checkout still says PENDING
 * long after the order shipped.
 */
export async function getOrder(orderId, phone = null) {
  if (!remote) return driver.get(orderId);
  if (phone) {
    const fromServer = await remote.get(orderId, normalisePhone(phone));
    if (fromServer) keepReceipt(fromServer);
    return fromServer;
  }
  const receipt = readAll().find((o) => o.orderId === orderId) || null;
  if (!receipt) return null;
  // Refresh it silently with the phone already on the receipt, so a reopened
  // page shows the live status rather than the one frozen at checkout.
  const fresh = await remote.get(orderId, receipt.customerPhone).catch(() => null);
  if (fresh) keepReceipt(fresh);
  return fresh || receipt;
}

/**
 * Orders placed in this browser. In API mode this is a receipt list, not the
 * store's order book — the store's is in the admin, behind a login.
 */
export const listOrders = () => (remote ? readAll() : driver.list());

/**
 * Status changes are an admin action and happen in the admin, which is
 * server-rendered and authenticated. There is deliberately no public endpoint
 * for advancing an order, so this exists only for the standalone local mode.
 */
export async function updateOrderStatus(orderId, status, note = '') {
  if (!Object.values(ORDER_STATUS).includes(status)) {
    throw new Error(`unknown order status: ${status}`);
  }
  if (remote) {
    throw new Error('Order status is changed in the admin, not from the storefront.');
  }
  const current = await driver.get(orderId);
  if (!current) return null;
  const entry = { at: new Date().toISOString(), status, note };
  return driver.update(orderId, {
    orderStatus: status,
    history: [...(current.history || []), entry],
  });
}

/* --------------------------------------------------------- WhatsApp text */

const money = (n, currency = 'USD') =>
  `${Number.isInteger(n) ? `$${n}` : `$${Number(n).toFixed(2)}`} ${currency}`;

/**
 * The pre-filled WhatsApp message, in the owner-approved format.
 *
 * It says the customer HAS PLACED an order and is asking for payment
 * instructions. It must never state or imply that payment has been made.
 */
export function buildWhatsAppMessage(order) {
  const items = order.items
    .map((i) => `${i.name} — Size ${i.size} × ${i.quantity}`)
    .join(', ');

  const lines = [
    `Hello ${CFG.brand || 'VESTIPHOBIA'}`,
    '',
    'I just placed an order on the website.',
    '',
    `Order ID: ${order.orderId}`,
    `Name: ${order.customerName}`,
    `Phone: ${order.customerPhoneRaw || order.customerPhone}`,
    `City: ${order.city}`,
    `Address: ${order.address}`,
    `Items: ${items}`,
  ];

  if (order.discountPercent > 0) {
    lines.push(`Discount: ${order.discountLabel} (−${money(order.discountAmount, order.currency)})`);
  }

  lines.push(`Total: ${money(order.total, order.currency)}`);

  if (order.notes) lines.push(`Notes: ${order.notes}`);

  lines.push(
    '',
    'Please confirm and send Sham Cash payment instructions.'
  );

  return lines.join('\n');
}

/**
 * wa.me deep link, or null when no number is configured.
 *
 * The number lives only in this link. It is never rendered as visible text —
 * a QA check fails the build if it appears anywhere in the page copy.
 */
export function whatsappLink(order) {
  // In API mode the server builds this link, so the destination number never
  // has to be present in the page bundle at all.
  if (order?.whatsappUrl) return order.whatsappUrl;
  const number = (CFG.whatsappNumber || '').replace(/\D/g, '');
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(buildWhatsAppMessage(order))}`;
}

/** Documented fallback when the WhatsApp handoff cannot be completed. */
export function instagramFallbackUrl() {
  return CFG.instagramUrl || null;
}

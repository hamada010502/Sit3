/**
 * VESTIPHOBIA — application server.
 *
 * node:http and nothing else. Three responsibilities:
 *
 *   1. Serve the statically built storefront out of dist/.
 *   2. Serve the public API the storefront calls (catalogue, order creation,
 *      order lookup). This surface is deliberately tiny and never returns a
 *      stock quantity, another customer's data, or a secret setting.
 *   3. Serve the admin, behind a real login backed by hashed passwords and
 *      database-held sessions.
 *
 * Anything that changes state is a POST. Admin POSTs are same-origin checked
 * on top of the SameSite=Strict session cookie.
 */

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb, bool } from './db/index.js';
import { migrate } from './db/migrate.js';
import {
  SESSION_COOKIE,
  readCookie,
  getSession,
  login as authLogin,
  destroySession,
  sessionCookie,
  clearCookie,
  adminCount,
  purgeExpiredSessions,
  verifyPassword,
  setAdminPassword,
} from './lib/auth.js';
import {
  readJson,
  json,
  html,
  redirect,
  redirectPermanent,
  fail,
  securityHeaders,
  rateLimit,
  clientIp,
  isSecure,
  sameOrigin,
  audit,
} from './lib/http.js';
import { cleanText, cleanMultiline, normalisePhone, validInt } from './lib/validate.js';
import { ingest, isBot, countryFromHeaders } from './lib/analytics.js';
import { setQuantity, setManualOutOfStock, ledgerFor } from './lib/inventory.js';
import {
  createOrder,
  setOrderStatus,
  listOrders,
  orderStats,
  loadOrder,
} from './routes/orders.js';
import {
  publicCatalogue,
  adminProducts,
  createProduct,
  setProductStatus,
  updateProduct,
  updateSizeGuide,
  getProductBySlug,
  getProductImages,
  uploadProductImage,
  deleteProductImage,
  setPrimaryProductImage,
  moveProductImage,
  listAllProductImages,
  attachExistingImage,
  addProductSize,
  resolveProductRedirect,
} from './routes/products.js';
import { parseBoundary, parseMultipart, readRawBody } from './lib/multipart.js';
import { localUploadPath, storageBackend } from './lib/uploads.js';
import {
  getSettings,
  getSettingRows,
  setSetting,
  getContent,
  getContentRows,
  setContent,
  uploadSiteImage,
} from './routes/settings.js';
import { listCustomers, getCustomer, setCustomerNote, customerStats } from './routes/customers.js';
import { listOutbox, getTemplates, updateTemplate } from './routes/emails.js';

import * as reports from './routes/analytics.js';
import { resolveRange, purgeOlderThan } from './routes/analytics.js';
import * as analyticsViews from './admin/analytics-views.js';
import { isCountingDown, bypassesCountdown, countdownPage } from './lib/countdown.js';
import { site as staticSite } from '../site.config.js';
import { shell, loginPage } from './admin/ui.js';
import * as views from './admin/pages.js';
import { liveContext, liveProductContext } from './storefront.js';
import home from '../pages/home.js';
import shop from '../pages/shop.js';
import productPage from '../pages/product.js';
import { cartPage, checkoutPage, orderPage } from '../pages/checkout.js';
import {
  story,
  contact,
  shippingPolicy,
  returnsPolicy,
  privacyPolicy,
  termsPolicy,
  notFound,
} from '../pages/content.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', 'dist');
const ASSETS_DIR = join(HERE, '..', 'assets');
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const site = staticSite;

// Admin mutations accepted from one account per hour — see the throttle in
// handleAdminPost() for why uploads are counted separately and lower.
const ADMIN_WRITE_LIMIT = Number(process.env.ADMIN_WRITE_LIMIT || 300);
const ADMIN_UPLOAD_LIMIT = Number(process.env.ADMIN_UPLOAD_LIMIT || 60);

// Declared here (rather than next to the upload handlers below) because the
// file_too_large flash message in MESSAGES needs it, and MESSAGES is
// evaluated at module load — before a `const` declared further down the
// file would exist yet.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024);

/* --------------------------------------------------------------- messages */

/**
 * Flash messages travel as short codes in the query string, not as free text.
 * Reflecting arbitrary text back into a page — even escaped — invites someone
 * to craft a convincing link; a code can only ever say one of these things.
 */
const MESSAGES = {
  saved: ['ok', 'Saved.'],
  status_changed: ['ok', 'Order status updated.'],
  stock_saved: ['ok', 'Stock updated.'],
  note_saved: ['ok', 'Note saved.'],
  password_changed: ['ok', 'Password changed. Other sessions were signed out.'],
  template_saved: ['ok', 'Template saved.'],
  nothing: ['err', 'Nothing was changed.'],
  invalid: ['err', 'That value was rejected.'],
  conflict: ['err', 'Not enough stock — the order was left unchanged.'],
  forbidden: ['err', 'That request was refused (cross-origin).'],
  notfound: ['err', 'Not found.'],
  rate_limited: ['err', 'Too many changes in a short time. Wait a few minutes and try again.'],
  // Specific, common validation failures that previously all fell through to
  // the generic 'invalid' above with no way to tell them apart from the
  // admin screen. Still a fixed, known set of strings — never the route's
  // own free-text error message — for the same reason 'invalid' itself is
  // fixed text: a flash message is reachable by URL, so it can never echo
  // anything an attacker could have chosen.
  publish_needs_image: ['err', 'Cannot publish: add at least one image first.'],
  image_upload_failed: ['err', 'Could not upload that image. Check the server logs for the exact reason.'],
  image_required: ['err', 'Choose an image file before uploading.'],
  file_too_large: ['err', `That file is over the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB upload limit.`],
  name_required: ['err', 'Enter a product name.'],
  price_invalid: ['err', 'Price must be a number above zero.'],
  sizes_required: ['err', 'Enter at least one size.'],
  slug_taken: ['err', 'That URL slug is already in use — choose a different one.'],
  slug_invalid: ['err', 'Could not derive a URL slug from that value.'],
  size_required: ['err', 'Enter a size to add.'],
  size_exists: ['err', 'That size already exists on this product.'],
  image_not_found: ['err', 'That image could not be found.'],
};

const CODE_MESSAGE = {
  NO_IMAGE: 'publish_needs_image',
  NAME_REQUIRED: 'name_required',
  PRICE_INVALID: 'price_invalid',
  SIZES_REQUIRED: 'sizes_required',
  SLUG_TAKEN: 'slug_taken',
  SLUG_INVALID: 'slug_invalid',
  SIZE_REQUIRED: 'size_required',
  SIZE_EXISTS: 'size_exists',
};

/**
 * Map a route function's { ok:false, code } result to one of the flash
 * messages above, falling back to the generic 'invalid' for anything that
 * was not given a specific code. This is the one place a route's `code`
 * value is trusted to pick a message — the message text itself always comes
 * from the fixed MESSAGES table, never from the route.
 */
const failCode = (r) => (r.code && CODE_MESSAGE[r.code]) || 'invalid';

const flashFrom = (url) => {
  const code = url.searchParams.get('m');
  const entry = MESSAGES[code];
  return entry ? { type: entry[0], message: entry[1] } : null;
};

const back = (res, path, code) => redirect(res, code ? `${path}?m=${code}` : path);

/* ------------------------------------------------------------ form bodies */

const MAX_FORM = 256 * 1024;

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_FORM) throw Object.assign(new Error('Form too large'), { status: 413 });
    chunks.push(chunk);
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

/* ---------------------------------------------------------------- statics */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * Resolve a URL path inside dist/, or null.
 *
 * The normalise + prefix check is the whole traversal defence: a path that
 * escapes dist/ after normalisation is refused rather than served.
 */
function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\u0000')) return null; // NUL-byte truncation attempt
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) return null;

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/**
 * Resolve a URL path inside assets/ — the CSS/JS/images/fonts source
 * directory, served directly so a storefront edit never depends on
 * `npm run build`. Same traversal defence as resolveStatic(), a separate
 * root.
 */
function resolveAsset(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\u0000')) return null; // NUL-byte truncation attempt
  const rel = normalize(decoded.replace(/^\/assets\//, '')).replace(/^(\.\.[/\\])+/, '');
  const file = join(ASSETS_DIR, rel);
  if (!file.startsWith(ASSETS_DIR)) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/**
 * Resolve a URL path inside UPLOADS_DIR — same traversal defence as
 * resolveStatic(), a separate root. Only reached when the local-disk storage
 * backend is in use; Supabase- and S3-backed uploads are absolute URLs served
 * by the object store itself and never pass through this server.
 */
function resolveUpload(pathname) {
  if (storageBackend() !== 'local') return null;
  const rel = pathname.replace(/^\/uploads\//, '');
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\u0000')) return null;
  const file = localUploadPath(normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(localUploadPath(''))) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function serveStatic(req, res, file, secure) {
  const ext = extname(file).toLowerCase();
  const stat = statSync(file);
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }

  const immutable = /\/assets\/(img|fonts)\//.test(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : immutable ? 'public, max-age=604800' : 'public, max-age=3600',
    ...securityHeaders({ secure }),
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/* -------------------------------------------------------------- public API */

async function handleApi(req, res, url, ip) {
  const path = url.pathname;


  if (req.method === 'GET' && path === '/api/health') {
    const db = await getDb();
    return json(res, 200, { ok: true, dialect: db.dialect, uploads: storageBackend() });
  }

  if (req.method === 'GET' && path === '/api/catalogue') {
    // Availability only. publicProduct drops quantities at the source.
    return json(res, 200, { products: await publicCatalogue() }, { 'Cache-Control': 'public, max-age=30' });
  }

  if (req.method === 'GET' && path === '/api/config') {
    const settings = await getSettings(); // secret rows filtered out in the query
    const content = await getContent();
    return json(res, 200, {
      discounts: {
        bundleTiers: JSON.parse(settings['discount.bundle_tiers'] || '[]'),
        returningCustomerPercent: Number(settings['discount.returning_percent'] ?? 5),
        freeShippingMinPieces: Number(settings['shipping.free_min_pieces'] ?? 2),
      },
      deliveryEstimate: content['shipping.delivery_estimate'] || '',
      announcement: content['announcement'] || '',
    });
  }

  /**
   * Analytics ingest.
   *
   * Always answers 204, whatever happened. A browser can do nothing useful
   * with an analytics error, and an error status would only encourage a retry
   * that costs the visitor bandwidth. Rejections are counted in the server log.
   */
  if (req.method === 'POST' && path === '/api/events') {
    // Read the body BEFORE replying. Ending the response while the browser is
    // still uploading destroys the socket: the beacon arrives truncated, the
    // browser logs ERR_CONNECTION_RESET, and events vanish intermittently —
    // which is exactly how this was found.
    const body = await readJson(req).catch(() => ({}));

    res.writeHead(204, { 'Cache-Control': 'no-store', ...securityHeaders({}) });
    res.end();

    try {
      const ua = req.headers['user-agent'] || '';
      // Crawlers are not visitors. Counting them makes every rate meaningless.
      if (isBot(ua)) return;

      const limit = await rateLimit(`events:${ip}`, {
        limit: Number(process.env.EVENTS_RATE_LIMIT || 600),
        windowMs: 60 * 60 * 1000,
      });
      if (!limit.allowed) return;

      await ingest(body, {
        userAgent: ua,
        host: req.headers.host,
        country: countryFromHeaders(req.headers),
      });
    } catch (err) {
      console.error('[analytics] batch dropped:', err.message);
    }
    return;
  }

  if (req.method === 'POST' && path === '/api/orders') {
    // Ordering is the one public write, so it is the one that gets limited.
    //
    // The ceiling is per IP per hour. It has to sit above what a real shared
    // connection produces — a household, an office, or a mobile carrier behind
    // CGNAT all look like one address — while still stopping a script. Raise
    // ORDER_RATE_LIMIT if a legitimate burst is ever refused.
    const limit = await rateLimit(`order:${ip}`, {
      limit: Number(process.env.ORDER_RATE_LIMIT || 30),
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.allowed) {
      return fail(res, 429, 'Too many orders from this connection. Try again shortly.', {
        code: 'RATE_LIMITED',
      });
    }
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      fail(res, err.status || 400, err.message);
      // The rest of an oversized upload is of no interest: close the socket
      // once the refusal has actually been written.
      res.on('finish', () => req.destroy());
      return;
    }
    const result = await createOrder(body, { ip });
    if (result.status === 201 || result.status === 200) {
      result.body.whatsappUrl = await whatsappUrlFor(result.body.order);
    }
    return json(res, result.status, result.body);
  }

  /**
   * Order lookup. The order number alone is NOT enough: the caller must also
   * present the phone number on the order. Order numbers are sequential and
   * guessable, so without this check anyone could walk the range and read
   * every customer's name and address.
   */
  const lookup = path.match(/^\/api\/orders\/([A-Za-z0-9-]{1,40})$/);
  if (req.method === 'GET' && lookup) {
    const rl = await rateLimit(`lookup:${ip}`, { limit: 60, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) return fail(res, 429, 'Too many lookups. Try again shortly.');

    const phone = normalisePhone(url.searchParams.get('phone') || '');
    if (!phone) return fail(res, 400, 'Provide the phone number used on the order.');

    const db = await getDb();
    const found = await loadOrder(db, lookup[1]);
    // Same response for "no such order" and "wrong phone": telling them apart
    // confirms which order numbers exist.
    if (!found || found.order.customer_phone !== phone) {
      return fail(res, 404, 'No order matches that number and phone.');
    }
    return json(res, 200, { order: found.json, whatsappUrl: await whatsappUrlFor(found.json) });
  }

  return fail(res, 404, 'Unknown endpoint.');
}

/**
 * Build the wa.me handoff link on the server.
 *
 * The destination number lives in a settings row, never in the page bundle,
 * and is only ever emitted inside this href — it is never rendered as visible
 * text anywhere on the site.
 */
async function whatsappUrlFor(order) {
  const settings = await getSettings({ includeSecret: true });
  if (settings['whatsapp.enabled'] !== '1') return null;
  const number = String(settings['whatsapp.number'] || '').replace(/\D/g, '');
  if (!number) return null;

  const items = order.items.map((i) => `${i.name} — Size ${i.size} × ${i.quantity}`).join(', ');
  const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')} ${order.currency}`;
  const lines = [
    'Hello VESTIPHOBIA',
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
    lines.push(`Discount: ${order.discountLabel} (−${money(order.discountAmount)})`);
  }
  lines.push(`Total: ${money(order.total)}`);
  if (order.notes) lines.push(`Notes: ${order.notes}`);
  lines.push('', 'Please confirm and send Sham Cash payment instructions.');

  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/* ------------------------------------------------------------------ admin */

const render = (res, { title, current, admin, body, flash, status = 200 }) =>
  html(res, status, shell({ title, current, admin, body, flash }), securityHeaders({}));

async function handleAdmin(req, res, url, ip, session) {
  const path = url.pathname.replace(/\/+$/, '') || '/admin';
  const secure = isSecure(req);
  const flash = flashFrom(url);

  /* ---- unauthenticated: login only ---- */
  if (!session) {
    if (req.method === 'GET' && (path === '/admin/login' || path.startsWith('/admin'))) {
      return html(
        res,
        path === '/admin/login' ? 200 : 401,
        loginPage({ noAdmins: (await adminCount()) === 0 }),
        securityHeaders({ secure })
      );
    }
    if (req.method === 'POST' && path === '/admin/login') {
      if (!sameOrigin(req)) return back(res, '/admin/login', 'forbidden');

      const form = await readForm(req);
      const email = cleanText(form.email, { max: 254 }).toLowerCase();

      // Limited per IP and per address: neither a single account nor a single
      // connection can be used to grind through passwords.
      const byIp = await rateLimit(`login:ip:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
      const byEmail = await rateLimit(`login:em:${email}`, { limit: 10, windowMs: 15 * 60 * 1000 });
      if (!byIp.allowed || !byEmail.allowed) {
        return html(
          res,
          429,
          loginPage({ email, error: 'Too many attempts. Wait a few minutes and try again.' }),
          securityHeaders({ secure })
        );
      }

      const result = await authLogin(email, form.password, {
        userAgent: req.headers['user-agent'],
        ip,
      });
      if (!result.ok) {
        await audit('admin.login_failed', { entityType: 'admin', entityId: email, ip });
        return html(res, 401, loginPage({ email, error: result.error }), securityHeaders({ secure }));
      }
      await audit('admin.login', { adminId: result.admin.id, entityType: 'admin', entityId: email, ip });
      return redirect(res, '/admin', {
        'Set-Cookie': sessionCookie(result.session.token, { secure, expires: result.session.expires }),
      });
    }
    return html(res, 401, loginPage({}), securityHeaders({ secure }));
  }

  /* ---- authenticated ---- */
  const admin = session;

  if (req.method === 'POST') {
    // One check covers every admin mutation rather than each handler
    // remembering to do it.
    if (!sameOrigin(req)) return back(res, '/admin', 'forbidden');
    return handleAdminPost(req, res, path, ip, admin);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return fail(res, 405, 'Method not allowed.');
  }

  const db = await getDb();

  if (path === '/admin' || path === '/admin/login') {
    const [stats, custs, products, queued] = await Promise.all([
      orderStats(),
      customerStats(),
      adminProducts(),
      db.get(`SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'QUEUED'`),
    ]);
    const lowStock = [];
    for (const p of products) {
      for (const s of p.sizes) {
        if (s.closed || s.quantity <= 2) {
          lowStock.push({ product: p.short_name || p.name, size: s.size, quantity: s.quantity, closed: s.closed });
        }
      }
    }
    return render(res, {
      title: 'Dashboard',
      current: '/admin',
      admin,
      flash,
      body: views.dashboard({
        stats,
        customers: custs,
        lowStock,
        outbox: Number(queued?.n ?? 0),
        dbDialect: db.dialect,
      }),
    });
  }

  if (path === '/admin/analytics') {
    const range = resolveRange({
      range: url.searchParams.get('range'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });
    const tab = analyticsViews.TABS.some(([k]) => k === url.searchParams.get('tab'))
      ? url.searchParams.get('tab')
      : 'overview';

    // One query set per tab. Loading all ten reports to render one of them
    // would make the page slow for no benefit.
    let body;
    if (tab === 'traffic') body = analyticsViews.trafficView({ data: await reports.traffic(range) });
    else if (tab === 'funnel') body = analyticsViews.funnelView({ data: await reports.funnel(range) });
    else if (tab === 'products')
      body = analyticsViews.productsView({ data: await reports.productReport(range) });
    else if (tab === 'customers')
      body = analyticsViews.customersView({ data: await reports.customerReport(range) });
    else if (tab === 'orders')
      body = analyticsViews.ordersView({ data: await reports.orderReport(range) });
    else if (tab === 'campaigns')
      body = analyticsViews.campaignsView({ rows: await reports.campaignReport(range) });
    else if (tab === 'devices')
      body = analyticsViews.devicesView({ data: await reports.deviceReport(range) });
    else if (tab === 'locations')
      body = analyticsViews.locationsView({ data: await reports.locationReport(range) });
    else if (tab === 'conversion')
      body = analyticsViews.conversionView({ data: await reports.conversionReport(range) });
    else if (tab === 'events') {
      const name = cleanText(url.searchParams.get('name'), { max: 40 });
      body = analyticsViews.eventsView({
        data: await reports.rawEvents(range, { name }),
        name,
        range,
      });
    } else body = analyticsViews.overviewView({ data: await reports.overview(range), range });

    return render(res, {
      title: 'Analytics',
      current: '/admin/analytics',
      admin,
      flash,
      body: analyticsViews.analyticsHeader({ tab, range }) + body,
    });
  }

  if (path === '/admin/orders') {
    const status = url.searchParams.get('status') || '';
    const q = url.searchParams.get('q') || '';
    const { orders, counts } = await listOrders({ status, q, limit: 200 });
    return render(res, {
      title: 'Orders',
      current: '/admin/orders',
      admin,
      flash,
      body: views.ordersList({ orders, counts, status, q }),
    });
  }

  const orderMatch = path.match(/^\/admin\/orders\/([A-Za-z0-9-]{1,40})$/);
  if (orderMatch) {
    const found = await loadOrder(db, orderMatch[1]);
    if (!found) {
      return render(res, {
        title: 'Not found',
        current: '/admin/orders',
        admin,
        status: 404,
        body: views.notFoundPage(),
      });
    }
    return render(res, {
      title: found.json.orderId,
      current: '/admin/orders',
      admin,
      flash,
      body: views.orderDetail({ o: found.json, committed: bool(found.order.inventory_committed) }),
    });
  }

  if (path === '/admin/customers') {
    const q = url.searchParams.get('q') || '';
    const [customers, stats] = await Promise.all([listCustomers({ q }), customerStats()]);
    return render(res, {
      title: 'Customers',
      current: '/admin/customers',
      admin,
      flash,
      body: views.customersList({ customers, q, stats }),
    });
  }

  const custMatch = path.match(/^\/admin\/customers\/(\d{6,20})$/);
  if (custMatch) {
    const c = await getCustomer(custMatch[1]);
    if (!c) {
      return render(res, {
        title: 'Not found',
        current: '/admin/customers',
        admin,
        status: 404,
        body: views.notFoundPage(),
      });
    }
    return render(res, {
      title: c.name || 'Customer',
      current: '/admin/customers',
      admin,
      flash,
      body: views.customerDetail({ c }),
    });
  }

  if (path === '/admin/products') {
    return render(res, {
      title: 'Products',
      current: '/admin/products',
      admin,
      flash,
      body: views.productsList({ products: await adminProducts() }),
    });
  }

  if (path === '/admin/products/new') {
    return render(res, {
      title: 'New product',
      current: '/admin/products',
      admin,
      flash,
      body: views.newProductPage(),
    });
  }

  const productDetailMatch = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})$/);
  if (productDetailMatch) {
    const [p] = (await adminProducts()).filter((x) => x.slug === productDetailMatch[1]);
    if (!p) {
      return render(res, {
        title: 'Not found',
        current: '/admin/products',
        admin,
        status: 404,
        body: views.notFoundPage(),
      });
    }
    const [images, library] = await Promise.all([getProductImages(p.slug), listAllProductImages()]);
    return render(res, {
      title: p.name,
      current: '/admin/products',
      admin,
      flash,
      body: views.productDetail({
        p,
        images,
        library: library.filter((im) => im.productSlug !== p.slug),
      }),
    });
  }

  if (path === '/admin/inventory') {
    const products = await adminProducts();
    const ledger = [];
    for (const p of products) {
      for (const row of await ledgerFor(db, p.id, 40)) ledger.push(row);
    }
    ledger.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return render(res, {
      title: 'Inventory',
      current: '/admin/inventory',
      admin,
      flash,
      body: views.inventoryPage({ products, ledger: ledger.slice(0, 60) }),
    });
  }

  if (path === '/admin/content') {
    return render(res, {
      title: 'Content',
      current: '/admin/content',
      admin,
      flash,
      body: views.contentPage({ rows: await getContentRows() }),
    });
  }

  if (path === '/admin/settings') {
    return render(res, {
      title: 'Settings',
      current: '/admin/settings',
      admin,
      flash,
      body: views.settingsPage({ rows: await getSettingRows(), admin }),
    });
  }

  if (path === '/admin/emails') {
    const [templates, outbox] = await Promise.all([getTemplates(), listOutbox(50)]);
    return render(res, {
      title: 'Emails',
      current: '/admin/emails',
      admin,
      flash,
      body: views.emailsPage({ templates, outbox }),
    });
  }

  if (path === '/admin/audit') {
    const rows = await db.all(
      `SELECT l.*, a.email FROM audit_log l
       LEFT JOIN admins a ON a.id = l.admin_id
       ORDER BY l.created_at DESC LIMIT 200`
    );
    return render(res, {
      title: 'Activity log',
      current: '/admin/audit',
      admin,
      flash,
      body: views.auditPage({ rows }),
    });
  }

  return render(res, {
    title: 'Not found',
    current: '/admin',
    admin,
    status: 404,
    body: views.notFoundPage(),
  });
}

async function handleAdminPost(req, res, path, ip, admin) {
  const adminId = admin.adminId;

  // The multipart routes on the site: everything else is a plain
  // url-encoded form, parsed below. New-product is multipart too, because its
  // form carries an optional photo alongside the ordinary text fields.
  const imageUpload = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/images$/);
  const isNewProduct = path === '/admin/products/new';
  const isUpload = Boolean(imageUpload) || path === '/admin/content/hero-image' || isNewProduct;

  /**
   * Throttle, on top of the session and same-origin checks above.
   *
   * A valid session cookie is the only thing between these routes and the
   * outside world, so the ceiling answers "what happens if one is stolen":
   * a leaked token still cannot be used to grind the image pipeline (every
   * upload is resized into several variants and written to storage, which
   * costs CPU and, on Supabase/S3, money) or to fill the database overnight.
   *
   * Uploads get a tighter bucket of their own because they are the expensive
   * ones. Both ceilings sit far above real admin work — a heavy day is a few
   * dozen saves and a handful of photos — so neither is reachable by hand.
   *
   * Signing out is never limited: being throttled must not be able to trap
   * someone in a session they are trying to end.
   */
  if (path !== '/admin/logout') {
    const who = adminId || ip;
    const limit = await rateLimit(
      isUpload ? `admin:upload:${who}` : `admin:write:${who}`,
      {
        limit: isUpload ? ADMIN_UPLOAD_LIMIT : ADMIN_WRITE_LIMIT,
        windowMs: 60 * 60 * 1000,
      }
    );
    if (!limit.allowed) {
      const target = imageUpload
        ? `/admin/products/${encodeURIComponent(imageUpload[1])}`
        : path === '/admin/content/hero-image'
          ? '/admin/content'
          : isNewProduct
            ? '/admin/products/new'
            : '/admin';
      // A refused upload may still have megabytes in flight. Discard them
      // rather than destroying the socket: the browser has to be able to
      // finish its request and READ the redirect, and killing the connection
      // under it gives an EPIPE and a broken page instead of the message.
      // Draining costs only bandwidth — the expensive part (resizing every
      // variant and writing them to storage) is what this refusal skips.
      if (isUpload) req.resume();
      return back(res, target, 'rate_limited');
    }
  }

  if (imageUpload) {
    return handleProductImageUpload(req, res, imageUpload[1], adminId, ip);
  }
  if (path === '/admin/content/hero-image') {
    return handleSiteImageUpload(req, res, 'home.hero_image', adminId, ip);
  }
  if (isNewProduct) {
    return handleNewProduct(req, res, adminId, ip);
  }

  const form = await readForm(req);

  if (path === '/admin/logout') {
    await destroySession(admin.token);
    return redirect(res, '/admin/login', { 'Set-Cookie': clearCookie({ secure: isSecure(req) }) });
  }

  const statusMatch = path.match(/^\/admin\/orders\/([A-Za-z0-9-]{1,40})\/status$/);
  if (statusMatch) {
    const result = await setOrderStatus(statusMatch[1], form.status, {
      adminId,
      note: cleanText(form.note, { max: 300 }) || null,
      ip,
    });
    const code =
      result.status === 200 ? 'status_changed' : result.body?.code === 'INVENTORY_CONFLICT' ? 'conflict' : 'invalid';
    return back(res, `/admin/orders/${encodeURIComponent(statusMatch[1])}`, code);
  }

  if (path === '/admin/inventory/quantity') {
    const product = await getProductBySlug(cleanText(form.slug, { max: 120 }));
    const qty = validInt(form.quantity, { min: 0, max: 100000, label: 'Quantity' });
    if (!product || !qty.ok) return back(res, '/admin/inventory', 'invalid');

    const r = await setQuantity(await getDb(), {
      productId: product.id,
      size: cleanText(form.size, { max: 12 }).toUpperCase(),
      quantity: qty.value,
      adminId,
    });
    if (!r) return back(res, '/admin/inventory', 'invalid');
    await audit('inventory.set', {
      adminId,
      entityType: 'inventory',
      entityId: `${product.slug}:${r.size}`,
      detail: { quantity: r.quantity, delta: r.delta },
      ip,
    });
    return back(res, '/admin/inventory', 'stock_saved');
  }

  if (path === '/admin/inventory/closed') {
    const product = await getProductBySlug(cleanText(form.slug, { max: 120 }));
    if (!product) return back(res, '/admin/inventory', 'invalid');
    const size = cleanText(form.size, { max: 12 }).toUpperCase();
    await setManualOutOfStock(await getDb(), {
      productId: product.id,
      size,
      closed: form.closed === '1',
      adminId,
    });
    await audit('inventory.closed', {
      adminId,
      entityType: 'inventory',
      entityId: `${product.slug}:${size}`,
      detail: { closed: form.closed === '1' },
      ip,
    });
    return back(res, '/admin/inventory', 'stock_saved');
  }

  const prodStatus = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/status$/);
  if (prodStatus) {
    const r = await setProductStatus(prodStatus[1], form.status, { adminId, ip });
    // Back to the product's own page, not the list — the status control is
    // triggered from there, and a rejection is far more legible next to the
    // product it was about than as an unlabelled banner on a different page.
    return back(res, `/admin/products/${encodeURIComponent(prodStatus[1])}`, r.ok ? 'saved' : failCode(r));
  }

  const prodEdit = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})$/);
  if (prodEdit) {
    const fields = {};
    for (const key of [
      'name',
      'slug',
      'short_name',
      'tagline',
      'short_description',
      'fabric',
      'fit',
      'print_method',
      'badge',
      'price',
      'compare_at_price',
      'currency',
      'category',
      'gsm',
      'care_instructions',
      'description',
      'highlights',
      'details_confirmed',
      'tags',
    ]) {
      if (form[key] !== undefined) fields[key] = form[key];
    }
    // A blank slug field means "leave it alone" — it's pre-filled from the
    // current value, but an admin who clears it by hand should not
    // accidentally slugify an empty string into a rejected save.
    if (fields.slug !== undefined && !fields.slug.trim()) delete fields.slug;
    // Checkboxes are absent from the form body entirely when unchecked.
    fields.featured = form.featured === '1';
    fields.gsm_approximate = form.gsm_approximate === '1';
    const r = await updateProduct(prodEdit[1], fields, { adminId, ip });
    const target = r.ok ? r.slug : prodEdit[1];
    return back(res, `/admin/products/${encodeURIComponent(target)}`, r.ok ? 'saved' : failCode(r));
  }

  const imageAttach = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/images\/attach$/);
  if (imageAttach) {
    const imageId = cleanText(form.image_id, { max: 60 });
    const r = imageId
      ? await attachExistingImage(imageAttach[1], imageId, { adminId, ip })
      : { ok: false, code: 'IMAGE_NOT_FOUND', error: 'Choose an image to reuse.' };
    return back(
      res,
      `/admin/products/${encodeURIComponent(imageAttach[1])}`,
      r.ok ? 'saved' : imageId ? 'invalid' : 'image_not_found'
    );
  }

  const sizeAdd = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/sizes$/);
  if (sizeAdd) {
    const r = await addProductSize(sizeAdd[1], form.size, { adminId, ip });
    return back(res, `/admin/products/${encodeURIComponent(sizeAdd[1])}`, r.ok ? 'saved' : failCode(r));
  }

  const sizeGuideEdit = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/size-guide$/);
  if (sizeGuideEdit) {
    const r = await updateSizeGuide(
      sizeGuideEdit[1],
      { note: form.note, measurementsCsv: form.measurements_csv },
      { adminId, ip }
    );
    return back(res, `/admin/products/${encodeURIComponent(sizeGuideEdit[1])}`, r.ok ? 'saved' : 'invalid');
  }

  const imagePrimary = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/images\/([A-Za-z0-9-]{1,60})\/primary$/);
  if (imagePrimary) {
    const r = await setPrimaryProductImage(imagePrimary[1], imagePrimary[2], { adminId, ip });
    return back(res, `/admin/products/${encodeURIComponent(imagePrimary[1])}`, r.ok ? 'saved' : 'invalid');
  }

  const imageDelete = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/images\/([A-Za-z0-9-]{1,60})\/delete$/);
  if (imageDelete) {
    const r = await deleteProductImage(imageDelete[1], imageDelete[2], { adminId, ip });
    return back(res, `/admin/products/${encodeURIComponent(imageDelete[1])}`, r.ok ? 'saved' : 'invalid');
  }

  const imageMove = path.match(/^\/admin\/products\/([a-z0-9-]{1,120})\/images\/([A-Za-z0-9-]{1,60})\/move$/);
  if (imageMove) {
    const direction = form.direction === 'up' ? 'up' : 'down';
    const r = await moveProductImage(imageMove[1], imageMove[2], direction, { adminId, ip });
    return back(res, `/admin/products/${encodeURIComponent(imageMove[1])}`, r.ok ? 'saved' : 'invalid');
  }

  if (path === '/admin/content') {
    const r = await setContent(cleanText(form.key, { max: 120 }), form.value, { adminId, ip });
    return back(res, '/admin/content', r.ok ? 'saved' : 'invalid');
  }

  if (path === '/admin/analytics/purge') {
    // Explicit, never automatic: data that quietly disappears is as bad as
    // data that is never deleted.
    const days = validInt(form.days, { min: 30, max: 3650, label: 'Retention' });
    if (!days.ok) return back(res, '/admin/settings', 'invalid');
    const result = await purgeOlderThan(days.value);
    await audit('analytics.purge', {
      adminId,
      entityType: 'analytics',
      detail: { days: days.value, events: result.events, sessions: result.sessions },
      ip,
    });
    return back(res, '/admin/settings', 'saved');
  }

  if (path === '/admin/settings') {
    const r = await setSetting(cleanText(form.key, { max: 120 }), form.value, { adminId, ip });
    return back(res, '/admin/settings', r.ok ? 'saved' : 'invalid');
  }

  const noteMatch = path.match(/^\/admin\/customers\/(\d{6,20})\/note$/);
  if (noteMatch) {
    await setCustomerNote(noteMatch[1], cleanMultiline(form.note, { max: 4000 }), { adminId });
    await audit('customer.note', { adminId, entityType: 'customer', entityId: noteMatch[1], ip });
    return back(res, `/admin/customers/${encodeURIComponent(noteMatch[1])}`, 'note_saved');
  }

  if (path === '/admin/emails/template') {
    const r = await updateTemplate(cleanText(form.key, { max: 60 }), {
      subject: form.subject,
      body: form.body,
      enabled: form.enabled === '1',
    });
    await audit('email.template', { adminId, entityType: 'email_template', entityId: form.key, ip });
    return back(res, '/admin/emails', r.ok ? 'template_saved' : 'invalid');
  }

  if (path === '/admin/password') {
    const db = await getDb();
    const row = await db.get('SELECT password_hash FROM admins WHERE id = ?', [adminId]);
    const currentOk = row && (await verifyPassword(String(form.current || ''), row.password_hash));
    const next = String(form.next || '');

    // A wrong current password must not be enough to hijack an open session,
    // and a short new password is refused rather than quietly accepted.
    if (!currentOk || next.length < 12) {
      const rows = await getSettingRows();
      return html(
        res,
        400,
        shell({
          title: 'Settings',
          current: '/admin/settings',
          admin,
          body: views.settingsPage({
            rows,
            admin,
            passwordError: currentOk
              ? 'The new password must be at least 12 characters.'
              : 'That current password is not correct.',
          }),
        }),
        securityHeaders({})
      );
    }

    await setAdminPassword(adminId, next);
    await audit('admin.password_changed', { adminId, entityType: 'admin', entityId: admin.email, ip });
    // Every session was destroyed, this one included: sign back in.
    return redirect(res, '/admin/login?m=password_changed', {
      'Set-Cookie': clearCookie({ secure: isSecure(req) }),
    });
  }

  return back(res, '/admin', 'notfound');
}

/**
 * One of a handful of multipart routes on the site (a file upload). Parsed
 * separately from every other admin POST (readForm() assumes url-encoded,
 * which would corrupt binary file content), size-capped the same way
 * readJson() caps a JSON body.
 */
async function handleProductImageUpload(req, res, slug, adminId, ip) {
  const boundary = parseBoundary(req.headers['content-type']);
  if (!boundary) return back(res, `/admin/products/${encodeURIComponent(slug)}`, 'invalid');

  let body;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (err) {
    return back(res, `/admin/products/${encodeURIComponent(slug)}`, err.status === 413 ? 'file_too_large' : 'invalid');
  }

  const { fields, files } = parseMultipart(body, boundary);
  // The input accepts `multiple` (see admin/pages.js's imagesSection()), so
  // more than one part can share the name "file" — upload every one of them
  // in a single submit rather than making the admin repeat the form per photo.
  const uploaded = files.filter((f) => f.name === 'file' && f.data.length);
  if (!uploaded.length) {
    return back(res, `/admin/products/${encodeURIComponent(slug)}`, 'image_required');
  }

  let failed = 0;
  for (const file of uploaded) {
    // The alt text is exactly what the admin typed, for every file in the
    // drop. It used to have the upload's filename appended on a multi-file
    // drop ("Studio photo IMG_4021.jpg"), which leaked a meaningless filename
    // into the storefront's alt attributes. Photos that need distinct
    // descriptions are uploaded one at a time with their own alt text.
    const r = await uploadProductImage(slug, { buffer: file.data, alt: fields.alt, role: fields.role }, { adminId, ip });
    // uploadProductImage() already logs the real reason (bad storage
    // credential, wrong bucket, a file sharp can't decode, …) for each
    // failure — this flash just tells the admin it's worth checking the
    // server logs, without echoing that free-text reason into the URL itself.
    if (!r.ok) failed++;
  }

  const code = failed === 0 ? 'saved' : failed === uploaded.length ? 'image_upload_failed' : 'saved';
  return back(res, `/admin/products/${encodeURIComponent(slug)}`, code);
}

/**
 * New-product form. Multipart because the drag-and-drop photo box is
 * optional but lives in the same form as the ordinary text fields — creating
 * the product without one is still fine, the shop just won't list it until
 * it has at least one image, exactly as before this field existed.
 *
 * The image, when present, is uploaded in the same request right after the
 * product row is created. If that upload fails the product still exists (its
 * own errors are its own to fix from the product page's own upload form) —
 * a bad photo must never be a reason the product itself was not created.
 */
async function handleNewProduct(req, res, adminId, ip) {
  const boundary = parseBoundary(req.headers['content-type']);
  if (!boundary) return back(res, '/admin/products/new', 'invalid');

  let body;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (err) {
    return back(res, '/admin/products/new', err.status === 413 ? 'file_too_large' : 'invalid');
  }

  const { fields, files } = parseMultipart(body, boundary);
  const r = await createProduct(fields, { adminId, ip });
  if (!r.ok) return back(res, '/admin/products/new', failCode(r));

  const image = files.find((f) => f.name === 'image');
  if (image && image.data.length) {
    await uploadProductImage(
      r.slug,
      { buffer: image.data, alt: cleanText(fields.name, { max: 300 }) },
      { adminId, ip }
    );
  }

  return redirect(res, `/admin/products/${encodeURIComponent(r.slug)}?m=saved`);
}

/** A single non-product site image (currently just the homepage hero). */
async function handleSiteImageUpload(req, res, key, adminId, ip) {
  const boundary = parseBoundary(req.headers['content-type']);
  if (!boundary) return back(res, '/admin/content', 'invalid');

  let body;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (err) {
    return back(res, '/admin/content', err.status === 413 ? 'file_too_large' : 'invalid');
  }

  const { files } = parseMultipart(body, boundary);
  const file = files.find((f) => f.name === 'file');
  if (!file || !file.data.length) return back(res, '/admin/content', 'image_required');

  const r = await uploadSiteImage(key, file.data, { adminId, ip });
  // uploadSiteImage() already logs the real reason on failure — see the
  // matching comment on handleProductImageUpload().
  return back(res, '/admin/content', r.ok ? 'saved' : 'image_upload_failed');
}

/* ------------------------------------------------------------- storefront */

/**
 * Every server-rendered storefront route, keyed by pathname with the leading
 * and trailing slash stripped ('' for the homepage). Each is rendered fresh
 * per request from the live DB context — no dist/, no rebuild.
 */
const STOREFRONT_ROUTES = {
  '': (ctx) => home({ site: ctx.site, products: ctx.products, content: ctx.content }),
  shop: (ctx) => shop({ site: ctx.site, products: ctx.products, content: ctx.content }),
  story: (ctx) => story({ site: ctx.site, content: ctx.content, products: ctx.products }),
  contact: (ctx) => contact({ site: ctx.site, content: ctx.content, products: ctx.products }),
  cart: (ctx) => cartPage({ site: ctx.site, products: ctx.products, content: ctx.content }),
  checkout: (ctx) => checkoutPage({ site: ctx.site, products: ctx.products, content: ctx.content }),
  order: (ctx) => orderPage({ site: ctx.site, products: ctx.products, content: ctx.content }),
  'policies/shipping': (ctx) => shippingPolicy({ site: ctx.site, content: ctx.content, products: ctx.products }),
  'policies/returns': (ctx) => returnsPolicy({ site: ctx.site, content: ctx.content, products: ctx.products }),
  'policies/privacy': (ctx) => privacyPolicy({ site: ctx.site, content: ctx.content, products: ctx.products }),
  'policies/terms': (ctx) => termsPolicy({ site: ctx.site, content: ctx.content, products: ctx.products }),
};

/**
 * Render one storefront request. Returns { status, body } or null when the
 * pathname isn't a storefront route at all (caller falls through to assets /
 * 404).
 */
async function renderStorefront(pathname) {
  const key = pathname.replace(/^\/+/, '').replace(/\/+$/, '');

  if (key.startsWith('products/')) {
    const slug = key.slice('products/'.length);
    if (!slug || slug.includes('/')) return null;
    const ctx = await liveProductContext(slug);
    if (!ctx.product) {
      // A renamed product's old URL 301s to the new one instead of 404ing —
      // see product_redirects in schema.sql and updateProduct()'s slug
      // handling in routes/products.js.
      const target = await resolveProductRedirect(slug);
      if (target) return { status: 301, redirectTo: `/products/${target}/` };
      return { status: 404, body: notFound({ site: ctx.site, products: ctx.products }) };
    }
    return {
      status: 200,
      body: productPage(ctx.product, { site: ctx.site, content: ctx.content, allProducts: ctx.products }),
    };
  }

  const render = STOREFRONT_ROUTES[key];
  if (!render) return null;
  const ctx = await liveContext();
  return { status: 200, body: render(ctx) };
}

/* --------------------------------------------------------------- dispatch */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const ip = clientIp(req);
  // Stamped once, read by json()/html()/redirect() so every response — not
  // just the ones whose author remembered — gets HSTS when it is warranted.
  res.locals = { secure: isSecure(req) };
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return fail(res, 400, 'Bad request.');
  }

  try {
    /**
     * The launch countdown.
     *
     * Checked per request against the clock, so the site opens by itself at
     * the configured moment — no deploy, nothing to remember at midnight, and
     * a server started days earlier still opens on time. The admin, the health
     * check and the assets stay reachable so the shop can be prepared behind
     * it; the storefront and the ordering API do not, because an order placed
     * during a countdown is an order nobody is expecting.
     */
    if (isCountingDown(site.launch.opensAt) && !bypassesCountdown(url.pathname)) {
      if (url.pathname.startsWith('/api/')) {
        return fail(res, 503, 'The shop has not opened yet.', { code: 'NOT_OPEN' });
      }
      return html(
        res,
        503,
        countdownPage({
          brand: site.brand,
          opensAt: site.launch.opensAt,
          heading: site.launch.heading,
          body: site.launch.body,
          openedText: site.launch.openedText,
          instagram: site.contact.instagram,
        }),
        {
          ...securityHeaders({ secure: isSecure(req) }),
          // 503 with Retry-After is the honest status: the site exists and is
          // coming back at a known time. It also keeps search engines from
          // indexing the countdown as if it were the shop.
          'Retry-After': String(
            Math.max(1, Math.ceil((new Date(site.launch.opensAt).getTime() - Date.now()) / 1000))
          ),
        }
      );
    }

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url, ip);
    }

    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = await getSession(token);
      return await handleAdmin(req, res, url, ip, session);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (url.pathname.startsWith('/uploads/')) {
        const uploaded = resolveUpload(url.pathname);
        if (uploaded) return serveStatic(req, res, uploaded, isSecure(req));
        return fail(res, 404, 'Not found.');
      }

      if (url.pathname.startsWith('/assets/')) {
        const asset = resolveAsset(url.pathname);
        if (asset) return serveStatic(req, res, asset, isSecure(req));
        return fail(res, 404, 'Not found.');
      }

      // sitemap.xml / robots.txt / _redirects still come from the static
      // build when one exists (they are cheap, rarely-changing, and the
      // build already knows how to produce them correctly); the storefront
      // itself never depends on dist/ being present.
      if (['/sitemap.xml', '/robots.txt', '/_redirects'].includes(url.pathname)) {
        const file = resolveStatic(url.pathname);
        if (file) return serveStatic(req, res, file, isSecure(req));
        return fail(res, 404, 'Not found.');
      }

      const rendered = await renderStorefront(url.pathname);
      if (rendered) {
        if (rendered.redirectTo) return redirectPermanent(res, rendered.redirectTo);
        return html(res, rendered.status, rendered.body);
      }

      // Not a storefront route: try dist/ (legacy static export, if present),
      // then a server-rendered 404 built from live data.
      const file = resolveStatic(url.pathname);
      if (file) return serveStatic(req, res, file, isSecure(req));

      const ctx = await liveContext().catch(() => ({ site, products: [] }));
      return html(res, 404, notFound({ site: ctx.site, products: ctx.products }));
    }

    return fail(res, 405, 'Method not allowed.');
  } catch (err) {
    // The client gets nothing useful; the detail goes to the server log only.
    console.error(`[server] ${req.method} ${url.pathname} failed after ${Date.now() - started}ms:`, err);
    if (!res.headersSent) fail(res, err.status || 500, 'Something went wrong on our side.');
    else res.end();
  }
});

/* ------------------------------------------------------------------ start */

export async function start() {
  // dist/ is optional: the storefront is server-rendered from the database on
  // every request and does not depend on it. A missing dist/ only means
  // sitemap.xml/robots.txt/_redirects fall back to a 404 and there is no
  // offline static export available — never a reason the storefront can't serve.
  await migrate({ quiet: true });

  if (isCountingDown(site.launch.opensAt)) {
    const hours = (new Date(site.launch.opensAt) - Date.now()) / 3600000;
    console.log(
      `[server] COUNTDOWN ACTIVE: the storefront is closed for ${hours.toFixed(1)} more hour(s), ` +
        `until ${site.launch.opensAt}.\n` +
        '         /admin stays open so stock and content can be prepared.'
    );
  } else if (site.launch.opensAt) {
    console.log(`[server] the launch countdown passed on ${site.launch.opensAt}; the shop is open.`);
  }
  const purged = await purgeExpiredSessions();
  if (purged) console.log(`[server] purged ${purged} expired session(s)`);

  if ((await adminCount()) === 0) {
    console.warn(
      '\n[server] NO ADMIN ACCOUNT EXISTS. /admin cannot be signed into until you create one:\n' +
        '         npm run admin:create -- you@example.com "a long passphrase"\n'
    );
  }

  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  const db = await getDb();
  console.log(`[server] VESTIPHOBIA listening on http://${HOST}:${PORT}  (db: ${db.dialect})`);
  return server;
}

export { server };

// Compares two absolute, OS-native paths rather than substring-matching a
// file:// URL against a forward-slash split of argv[1] — the previous check
// only split on "/", so on Windows (backslash paths) it always returned the
// unsplit path and never matched, and the server silently never started.
//
// Windows filesystems are case-insensitive but case-PRESERVING, and the two
// paths here can come out with different casing even when they name the same
// file: import.meta.url reflects whatever casing Node's loader normalised to,
// while argv[1] is exactly what was typed at the prompt (a drive letter typed
// as "c:" instead of "C:" is enough to fail a strict ===). Comparing
// case-insensitively on win32 — and only on win32, since a case difference on
// Linux/macOS genuinely can mean two different files — is what actually fixed
// this for a real Windows run; the case-sensitive version above still failed
// there even after the "/" vs "\" bug was corrected.
const thisFile = fileURLToPath(import.meta.url);
const argvFile = process.argv[1] ? resolve(process.argv[1]) : null;
const invokedDirectly =
  argvFile !== null &&
  (process.platform === 'win32' ? thisFile.toLowerCase() === argvFile.toLowerCase() : thisFile === argvFile);
if (invokedDirectly) {
  start().catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}

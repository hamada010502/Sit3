/**
 * VESTIPHOBIA — admin screens.
 *
 * Pure render functions: data in, HTML string out. Nothing here touches the
 * database, so every screen can be rendered in a test without a server.
 *
 * Two rules hold across every screen:
 *   1. Every interpolated value goes through esc(). No exceptions.
 *   2. Anything that changes state is a POST form, never a link — a GET must
 *      never mutate, or a crawler or a prefetch can reject an order.
 */

import { esc, money, shortDate, maskPhone, statusTag } from './ui.js';
import { ORDER_STATUSES } from '../lib/validate.js';
import { STAGE_RANK, TERMINAL_STATUSES } from '../routes/orders.js';
import { bool } from '../db/index.js';

const empty = (msg) => `<div class="empty-state"><p>${esc(msg)}</p></div>`;

/* --------------------------------------------------------------- dashboard */

export function dashboard({ stats, customers, lowStock, outbox, dbDialect }) {
  const cards = [
    ['Orders', String(stats.orders), 'excluding rejected'],
    ['Revenue', money(stats.revenue), 'merchandise, shipping excluded'],
    ['Pieces sold', String(stats.pieces), ''],
    ['Average order', money(stats.averageOrder), ''],
    ['Awaiting approval', String(stats.pending), 'PENDING'],
    ['Delivered', String(stats.delivered), ''],
    ['Customers', String(customers.total), `${customers.returning} returning`],
  ];

  const maxCity = Math.max(1, ...stats.byCity.map((c) => Number(c.n)));

  return `
<h1>Dashboard</h1>
<p class="sub">Live figures from the order database (${esc(dbDialect)}).</p>

<div class="cards">
  ${cards
    .map(
      ([label, value, note]) => `<div class="card">
    <div class="card__label">${esc(label)}</div>
    <div class="card__value">${esc(value)}</div>
    ${note ? `<div class="card__note">${esc(note)}</div>` : ''}
  </div>`
    )
    .join('\n  ')}
</div>

<div class="grid2">
  <section>
    <h2>Orders by city</h2>
    <div class="panel">
      ${
        stats.byCity.length
          ? stats.byCity
              .map(
                (c) => `<div style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>${esc(c.city || 'Unknown')}</span><span class="num">${esc(String(c.n))}</span>
        </div>
        <div class="bar"><span style="width:${Math.round((Number(c.n) / maxCity) * 100)}%"></span></div>
      </div>`
              )
              .join('\n      ')
          : '<p class="note">No orders yet.</p>'
      }
    </div>
  </section>

  <section>
    <h2>Stock needing attention</h2>
    <div class="panel">
      ${
        lowStock.length
          ? `<ul class="kv">${lowStock
              .map(
                (s) =>
                  `<li><b>${esc(s.product)} · ${esc(s.size)}</b><span>${
                    s.closed ? 'closed by admin' : `${esc(String(s.quantity))} left`
                  }</span></li>`
              )
              .join('')}</ul>`
          : '<p class="note">Every size has stock.</p>'
      }
      <div class="actions"><a class="btn btn--sm" href="/admin/inventory">Manage inventory</a></div>
    </div>
  </section>
</div>

<h2>Recent orders</h2>
<div class="table-wrap">
  ${
    stats.recent.length
      ? `<table>
    <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>City</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>
      ${stats.recent
        .map(
          (o) => `<tr>
        <td><a href="/admin/orders/${esc(o.order_number)}" class="mono">${esc(o.order_number)}</a></td>
        <td class="num">${esc(shortDate(o.created_at))}</td>
        <td>${esc(o.customer_name)}</td>
        <td>${esc(o.city)}</td>
        <td class="num">${esc(money(Number(o.total_cents) / 100, o.currency))}</td>
        <td>${statusTag(o.status)}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
      : empty('No orders yet. Place a test order through the storefront checkout.')
  }
</div>

${
  outbox
    ? `<p class="note" style="margin-top:18px">${esc(String(outbox))} email(s) queued and undelivered — no provider is configured. See Emails.</p>`
    : ''
}
`;
}

/* ----------------------------------------------------------------- orders */

export function ordersList({ orders, counts, status = '', q = '' }) {
  const countMap = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
  const total = Object.values(countMap).reduce((a, b) => a + b, 0);

  return `
<h1>Orders</h1>
<p class="sub">${esc(String(total))} order(s) in the database.</p>

<form class="toolbar" method="get" action="/admin/orders">
  <label class="sr-only" for="q">Search</label>
  <input id="q" type="search" name="q" value="${esc(q)}" placeholder="Order number, phone, name or city" style="max-width:320px">
  <label class="sr-only" for="status">Status</label>
  <select id="status" name="status" style="max-width:190px">
    <option value="">All statuses (${esc(String(total))})</option>
    ${ORDER_STATUSES.map(
      (s) =>
        `<option value="${s}"${s === status ? ' selected' : ''}>${s} (${countMap[s] || 0})</option>`
    ).join('')}
  </select>
  <button class="btn" type="submit">Filter</button>
  ${status || q ? '<a class="btn" href="/admin/orders">Reset</a>' : ''}
</form>

<div class="table-wrap">
  ${
    orders.length
      ? `<table>
    <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Phone</th><th>City</th><th>Pieces</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>
      ${orders
        .map(
          (o) => `<tr>
        <td><a href="/admin/orders/${esc(o.order_number)}" class="mono">${esc(o.order_number)}</a></td>
        <td class="num">${esc(shortDate(o.created_at))}</td>
        <td>${esc(o.customer_name)}</td>
        <td class="num">${esc(maskPhone(o.customer_phone))}</td>
        <td>${esc(o.city)}</td>
        <td class="num">${esc(String(o.pieces))}</td>
        <td class="num">${esc(money(Number(o.total_cents) / 100, o.currency))}</td>
        <td>${statusTag(o.status)}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
      : empty('No orders match this filter.')
  }
</div>
<p class="note" style="margin-top:12px">Phone numbers are masked in this list. Open an order to see the full delivery details.</p>
`;
}

export function orderDetail({ o, committed }) {
  // Only the statuses the server will actually accept from here: any later
  // pipeline stage (skipping ahead is fine), plus REJECTED as a side-exit —
  // never a backward move, and never anything at all once the order is
  // DELIVERED or REJECTED, both of which are final.
  const validNext = TERMINAL_STATUSES.has(o.status)
    ? []
    : [
        ...Object.keys(STAGE_RANK).filter((s) => STAGE_RANK[s] > STAGE_RANK[o.status]),
        'REJECTED',
      ];
  const statusButtons = ORDER_STATUSES.filter((s) => validNext.includes(s))
    .map(
      (s) => `<form method="post" action="/admin/orders/${esc(o.orderId)}/status" class="inline">
      <input type="hidden" name="status" value="${s}">
      <button class="btn btn--sm${s === 'REJECTED' ? ' btn--danger' : ''}" type="submit">${s.replace('_', ' ')}</button>
    </form>`
    )
    .join('\n    ');

  return `
<h1 class="mono">${esc(o.orderId)}</h1>
<p class="sub">Placed ${esc(shortDate(o.createdAt))} · ${statusTag(o.status)}</p>

<div class="panel">
  <h3>Change status</h3>
  <p class="note">
    ACCEPTED deducts this order's pieces from stock, in one transaction — if a size no longer has
    enough, nothing is deducted and the status does not change. REJECTED returns stock that was
    already deducted. DELIVERED is what makes this customer eligible for the returning discount.
  </p>
  <div class="actions">${statusButtons}</div>
  <p class="note" style="margin-top:10px">Stock for this order is currently
    <strong>${committed ? 'deducted' : 'not deducted'}</strong>.</p>
</div>

<div class="grid2">
  <section class="panel">
    <h3>Customer</h3>
    <ul class="kv">
      <li><b>Name</b><span>${esc(o.customerName)}</span></li>
      <li><b>Phone</b><span class="mono">${esc(o.customerPhoneRaw || o.customerPhone)}</span></li>
      <li><b>Normalised</b><span class="mono">${esc(o.customerPhone)}</span></li>
      <li><b>Email</b><span>${esc(o.customerEmail || '—')}</span></li>
      <li><b>City</b><span>${esc(o.city)}</span></li>
      <li><b>Address</b><span>${esc(o.address)}</span></li>
      <li><b>Notes</b><span>${esc(o.notes || '—')}</span></li>
    </ul>
    <div class="actions">
      <a class="btn btn--sm" href="/admin/customers/${encodeURIComponent(o.customerPhone)}">Customer record</a>
    </div>
  </section>

  <section class="panel">
    <h3>Money</h3>
    <ul class="kv">
      <li><b>Pieces</b><span class="num">${esc(String(o.pieces))}</span></li>
      <li><b>Subtotal</b><span class="num">${esc(money(o.subtotal, o.currency))}</span></li>
      <li><b>Discount</b><span class="num">${
        o.discountPercent
          ? `−${esc(money(o.discountAmount, o.currency))} (${esc(o.discountLabel || '')})`
          : 'none'
      }</span></li>
      <li><b>Total</b><span class="num">${esc(money(o.total, o.currency))}</span></li>
      <li><b>Shipping</b><span>${esc(o.shippingLabel || '')}</span></li>
      <li><b>Payment</b><span>${esc(o.paymentMethod || '')}</span></li>
    </ul>
    <p class="note">Totals were computed on the server from the catalogue price at the moment the
      order was placed, and are never recalculated.</p>
  </section>
</div>

<h2>Items</h2>
<div class="table-wrap">
  <table>
    <thead><tr><th>Product</th><th>Size</th><th>Qty</th><th>Unit</th><th>Line total</th></tr></thead>
    <tbody>
      ${o.items
        .map(
          (i) => `<tr>
        <td>${esc(i.name)}</td><td>${esc(i.size)}</td>
        <td class="num">${esc(String(i.quantity))}</td>
        <td class="num">${esc(money(i.unitPrice, o.currency))}</td>
        <td class="num">${esc(money(i.lineTotal, o.currency))}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>

<h2>History</h2>
<div class="table-wrap">
  <table>
    <thead><tr><th>When</th><th>Status</th><th>Note</th></tr></thead>
    <tbody>
      ${o.history
        .map(
          (h) => `<tr><td class="num">${esc(shortDate(h.at))}</td><td>${statusTag(h.status)}</td>
        <td>${esc(h.note || '')}</td></tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>
<p style="margin-top:20px"><a class="btn" href="/admin/orders">Back to orders</a></p>
`;
}

/* -------------------------------------------------------------- customers */

export function customersList({ customers, q = '', stats }) {
  return `
<h1>Customers</h1>
<p class="sub">${esc(String(stats.total))} customer(s), ${esc(String(stats.returning))} with a delivered order.
  A customer is a phone number — there are no accounts and no passwords to leak.</p>

<form class="toolbar" method="get" action="/admin/customers">
  <label class="sr-only" for="cq">Search customers</label>
  <input id="cq" type="search" name="q" value="${esc(q)}" placeholder="Phone, name or city" style="max-width:320px">
  <button class="btn" type="submit">Search</button>
  ${q ? '<a class="btn" href="/admin/customers">Reset</a>' : ''}
</form>

<div class="table-wrap">
  ${
    customers.length
      ? `<table>
    <thead><tr><th>Phone</th><th>Name</th><th>City</th><th>Orders</th><th>Delivered</th><th>Spend</th><th>Last seen</th></tr></thead>
    <tbody>
      ${customers
        .map(
          (c) => `<tr>
        <td><a class="mono" href="/admin/customers/${encodeURIComponent(c.phone)}">${esc(maskPhone(c.phone))}</a></td>
        <td>${esc(c.name || '—')}</td>
        <td>${esc(c.latest_city || '—')}</td>
        <td class="num">${esc(String(c.order_count))}</td>
        <td class="num">${esc(String(c.delivered_count))}</td>
        <td class="num">${esc(money(Number(c.total_spend_cents) / 100))}</td>
        <td class="num">${esc(shortDate(c.updated_at))}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
      : empty('No customers yet.')
  }
</div>
`;
}

export function customerDetail({ c }) {
  return `
<h1>${esc(c.name || 'Customer')}</h1>
<p class="sub mono">${esc(c.phone)}</p>

<div class="cards">
  <div class="card"><div class="card__label">Orders</div><div class="card__value">${esc(String(c.order_count))}</div></div>
  <div class="card"><div class="card__label">Delivered</div><div class="card__value">${esc(String(c.delivered_count))}</div></div>
  <div class="card"><div class="card__label">Total spend</div><div class="card__value">${esc(money(c.totalSpend))}</div></div>
  <div class="card"><div class="card__label">Returning</div><div class="card__value">${c.isReturning ? 'Yes' : 'No'}</div>
    <div class="card__note">${c.isReturning ? 'eligible for the returning discount' : 'needs one delivered order'}</div></div>
</div>

<div class="grid2">
  <section class="panel">
    <h3>Contact</h3>
    <ul class="kv">
      <li><b>Email</b><span>${esc(c.email || '—')}</span></li>
      <li><b>Latest city</b><span>${esc(c.latest_city || '—')}</span></li>
      <li><b>Latest address</b><span>${esc(c.latest_address || '—')}</span></li>
      <li><b>First order</b><span>${esc(shortDate(c.created_at))}</span></li>
    </ul>
  </section>
  <section class="panel">
    <h3>Internal note</h3>
    <form method="post" action="/admin/customers/${encodeURIComponent(c.phone)}/note">
      <label class="field"><span class="sr-only">Note</span>
        <textarea name="note" style="min-height:90px">${esc(c.notes || '')}</textarea>
      </label>
      <button class="btn btn--primary" type="submit">Save note</button>
    </form>
  </section>
</div>

<h2>Orders</h2>
<div class="table-wrap">
  <table>
    <thead><tr><th>Order</th><th>Date</th><th>Pieces</th><th>Total</th><th>Discount</th><th>Status</th></tr></thead>
    <tbody>
      ${c.orders
        .map(
          (o) => `<tr>
        <td><a class="mono" href="/admin/orders/${esc(o.order_number)}">${esc(o.order_number)}</a></td>
        <td class="num">${esc(shortDate(o.created_at))}</td>
        <td class="num">${esc(String(o.pieces))}</td>
        <td class="num">${esc(money(Number(o.total_cents) / 100, o.currency))}</td>
        <td class="num">${o.discount_percent ? `${esc(String(o.discount_percent))}%` : '—'}</td>
        <td>${statusTag(o.status)}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>
<p style="margin-top:20px"><a class="btn" href="/admin/customers">Back to customers</a></p>
`;
}

/* --------------------------------------------------------------- products */

export function productsList({ products }) {
  return `
<h1>Products</h1>
<p class="sub">Editing a product changes the database directly. The storefront reads it on the very
  next page load — nothing to build or redeploy.</p>

<div class="actions" style="margin-bottom:16px">
  <a class="btn btn--primary btn--sm" href="/admin/products/new">+ New product</a>
</div>

${
  products.length
    ? `<div class="table-wrap">
  <table>
    <thead><tr><th>Product</th><th>Status</th><th>Price</th><th>Stock</th><th>Images</th><th></th></tr></thead>
    <tbody>
      ${products
        .map(
          (p) => `<tr>
        <td><strong>${esc(p.name)}</strong><br><span class="note mono">${esc(p.slug)}</span></td>
        <td>${statusTag(p.status)}</td>
        <td class="num">${esc(money(p.price, p.currency))}</td>
        <td class="num">${esc(String(p.totalStock))}</td>
        <td class="num">${esc(String(p.imageCount ?? 0))}</td>
        <td class="actions" style="margin:0">
          <a class="btn btn--sm" href="/admin/products/${esc(p.slug)}">Edit</a>
          ${
            ['PUBLISHED', 'SOLD_OUT'].includes(p.status)
              ? `<a class="btn btn--sm" href="/products/${esc(p.slug)}/" target="_blank" rel="noopener">View on site</a>`
              : ''
          }
        </td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</div>`
    : empty('No products yet. Create your first one above.')
}
`;
}

/* ---------------------------------------------------------- new product */

export function newProductPage() {
  return `
<p><a class="link-underline" href="/admin/products">← All products</a></p>
<h1>New product</h1>
<p class="sub">Created as a draft you can publish once it looks right. Add the rest of the
  details on the product page after it's created.</p>

<form method="post" action="/admin/products/new" enctype="multipart/form-data">
  <div class="grid2">
    <label class="field"><span>Name</span><input type="text" name="name" maxlength="200" required autofocus></label>
    <label class="field"><span>Short name (for cart lines and mobile headers)</span>
      <input type="text" name="short_name" maxlength="80"></label>
    <label class="field"><span>Price</span><input type="text" name="price" required></label>
    <label class="field"><span>Currency</span><input type="text" name="currency" value="USD" maxlength="3"></label>
  </div>

  <label class="field"><span>Photo (optional — you can also add or replace it later)</span>
    <div class="dropzone" data-dropzone>
      <span class="dropzone__hint" data-dropzone-hint>Drag and drop an image here, or click to browse</span>
      <span class="dropzone__file" data-dropzone-file hidden></span>
      <input type="file" name="image" accept="image/jpeg,image/png,image/webp" data-dropzone-input>
    </div>
  </label>
  <p class="note">Created as Draft either way — the shop only shows products with at least one photo.
    Publish it from the product page once it has one.</p>

  <label class="field"><span>Sizes (comma-separated, e.g. S, M, L, XL, XXL) — each starts at zero stock until you set real quantities in Inventory</span>
    <input type="text" name="sizes" placeholder="S, M, L, XL, XXL" required></label>

  <label class="field"><span>Short description (used in meta tags and product cards)</span>
    <input type="text" name="short_description" maxlength="500"></label>

  <label class="field"><span>Description (one paragraph per line)</span>
    <textarea rows="4" name="description"></textarea></label>

  <button class="btn btn--primary" type="submit">Create product</button>
</form>

<script>
(() => {
  const zone = document.querySelector('[data-dropzone]');
  if (!zone) return;
  const input = zone.querySelector('[data-dropzone-input]');
  const hint = zone.querySelector('[data-dropzone-hint]');
  const fileLabel = zone.querySelector('[data-dropzone-file]');

  const showFile = () => {
    const file = input.files[0];
    if (file) {
      fileLabel.textContent = file.name;
      fileLabel.hidden = false;
      hint.hidden = true;
    } else {
      fileLabel.hidden = true;
      hint.hidden = false;
    }
  };

  input.addEventListener('change', showFile);

  ['dragenter', 'dragover'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('is-drag');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag');
    })
  );
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      input.files = e.dataTransfer.files;
      showFile();
    }
  });
})();
</script>
`;
}

/* ------------------------------------------------------- product detail */

function imagesSection(slug, images, library = []) {
  return `
<h2>Images</h2>
<p class="sub">The first (primary) image is what shows on the shop grid and as the first gallery photo.
  Uploads are resized automatically into a responsive set (webp + jpeg at 400/800px and larger).
  Add multiple photos at once, or reuse one already uploaded for another product from the media
  library below instead of uploading it twice.</p>

<form method="post" action="/admin/products/${esc(slug)}/images" enctype="multipart/form-data" class="panel" data-upload-form>
  <div class="grid2">
    <label class="field"><span>Image file(s)</span>
      <div class="dropzone" data-dropzone>
        <span class="dropzone__hint" data-dropzone-hint>Drag and drop one or more images here, or click to browse</span>
        <span class="dropzone__file" data-dropzone-file hidden></span>
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp" multiple data-dropzone-input required>
      </div>
    </label>
    <label class="field"><span>Alt text (describe what's in the photo — used as a prefix if you pick more than one file)</span>
      <input type="text" name="alt" maxlength="300" required></label>
    <label class="field"><span>Role (optional)</span>
      <select name="role">
        <option value="">—</option>
        <option value="main">main</option>
        <option value="detail">detail</option>
        <option value="side">side</option>
        <option value="back">back</option>
        <option value="campaign">campaign</option>
      </select>
    </label>
  </div>
  <div class="image-preview" data-upload-preview hidden></div>
  <button class="btn btn--primary" type="submit">Upload image(s)</button>
</form>

${mediaLibrarySection(slug, library)}

${
  images.length
    ? `<div class="image-grid">
    ${images
      .map(
        (im, i) => `<figure class="image-card${im.isPrimary ? ' image-card--primary' : ''}">
      <img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy">
      <figcaption>
        ${im.isPrimary ? '<span class="tag tag--PUBLISHED">Primary</span>' : ''}
        ${im.role ? `<span class="note mono">${esc(im.role)}</span>` : ''}
        ${!im.isUpload ? '<span class="note">from the static catalogue</span>' : ''}
        <div class="actions" style="margin-top:6px">
          ${
            !im.isPrimary
              ? `<form method="post" action="/admin/products/${esc(slug)}/images/${esc(im.id)}/primary" class="inline">
                <button class="btn btn--sm" type="submit">Make primary</button>
              </form>`
              : ''
          }
          ${
            i > 0
              ? `<form method="post" action="/admin/products/${esc(slug)}/images/${esc(im.id)}/move" class="inline">
                <input type="hidden" name="direction" value="up">
                <button class="btn btn--sm" type="submit">↑</button>
              </form>`
              : ''
          }
          ${
            i < images.length - 1
              ? `<form method="post" action="/admin/products/${esc(slug)}/images/${esc(im.id)}/move" class="inline">
                <input type="hidden" name="direction" value="down">
                <button class="btn btn--sm" type="submit">↓</button>
              </form>`
              : ''
          }
          <form method="post" action="/admin/products/${esc(slug)}/images/${esc(im.id)}/delete" class="inline"
                onsubmit="return confirm('Delete this image?')">
            <button class="btn btn--sm btn--danger" type="submit">Delete</button>
          </form>
        </div>
      </figcaption>
    </figure>`
      )
      .join('\n    ')}
  </div>`
    : empty('No images yet — upload one above.')
}

<script>
(() => {
  const zone = document.querySelector('[data-upload-form] [data-dropzone]');
  if (!zone) return;
  const input = zone.querySelector('[data-dropzone-input]');
  const hint = zone.querySelector('[data-dropzone-hint]');
  const fileLabel = zone.querySelector('[data-dropzone-file]');
  const preview = document.querySelector('[data-upload-preview]');

  const showFiles = () => {
    const files = [...input.files];
    if (files.length) {
      fileLabel.textContent = files.length === 1 ? files[0].name : files.length + ' files selected';
      fileLabel.hidden = false;
      hint.hidden = true;
    } else {
      fileLabel.hidden = true;
      hint.hidden = false;
    }
    if (preview) {
      preview.innerHTML = '';
      preview.hidden = files.length === 0;
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const img = document.createElement('img');
        img.alt = '';
        img.style.cssText = 'width:84px;height:105px;object-fit:cover;border-radius:4px;border:1px solid var(--line)';
        const reader = new FileReader();
        reader.onload = (e) => { img.src = e.target.result; };
        reader.readAsDataURL(file);
        preview.appendChild(img);
      }
    }
  };

  input.addEventListener('change', showFiles);

  ['dragenter', 'dragover'].forEach((evt) =>
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('is-drag'); })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('is-drag'); })
  );
  zone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files?.length) {
      input.files = files;
      showFiles();
    }
  });
})();
</script>
`;
}

/**
 * Site-wide media library: every uploaded image on every OTHER product, with
 * a one-click "use this image" form that attaches it here — no re-upload, no
 * duplicate file in storage (see attachExistingImage() in routes/products.js).
 * A plain POST form per image, so it works with JavaScript off just like
 * everything else in this admin.
 */
function mediaLibrarySection(slug, library) {
  return `<details class="panel">
  <summary style="cursor:pointer;font-size:14px;font-weight:600">Media library — reuse a photo already uploaded (${library.length})</summary>
  ${
    library.length
      ? `<div class="image-grid" style="margin-top:14px">
    ${library
      .map(
        (im) => `<figure class="image-card">
      <img src="${esc(im.src)}" alt="${esc(im.alt)}" loading="lazy">
      <figcaption>
        <span class="note">${esc(im.productName)}</span>
        <form method="post" action="/admin/products/${esc(slug)}/images/attach" style="margin-top:6px">
          <input type="hidden" name="image_id" value="${esc(im.id)}">
          <button class="btn btn--sm" type="submit">Use this image</button>
        </form>
      </figcaption>
    </figure>`
      )
      .join('\n    ')}
  </div>`
      : `<p class="note" style="margin-top:10px">No images have been uploaded for any other product yet.</p>`
  }
</details>`;
}

export function productDetail({ p, images, library = [] }) {
  const description = (JSON.parse(p.description || '[]') || []).join('\n');
  const highlights = (JSON.parse(p.highlights || '[]') || []).join('\n');
  const detailsConfirmed = (JSON.parse(p.details_confirmed || '[]') || []).join('\n');
  const careInstructions = (JSON.parse(p.care_instructions || '[]') || []).join('\n');
  const tags = (JSON.parse(p.tags || '[]') || []).join('\n');
  const sizeGuide = JSON.parse(p.size_guide || 'null');

  return `
<p><a class="link-underline" href="/admin/products">← All products</a></p>
<h1>${esc(p.name)} ${statusTag(p.status)}</h1>
<p class="sub mono">${esc(p.slug)}
  ${
    ['PUBLISHED', 'SOLD_OUT'].includes(p.status)
      ? `— <a class="link-underline" href="/products/${esc(p.slug)}/" target="_blank" rel="noopener">View on site ↗</a>`
      : ''
  }
</p>

<div class="actions" style="margin-bottom:20px">
  ${['PUBLISHED', 'DRAFT', 'SOLD_OUT', 'HIDDEN', 'ARCHIVED']
    .filter((s) => s !== p.status)
    .map(
      (s) => `<form method="post" action="/admin/products/${esc(p.slug)}/status" class="inline">
    <input type="hidden" name="status" value="${s}">
    <button class="btn btn--sm">${s.replace('_', ' ')}</button>
  </form>`
    )
    .join('')}
</div>

${imagesSection(p.slug, images, library)}

<h2>Details</h2>
<form method="post" action="/admin/products/${esc(p.slug)}">
  <div class="grid2">
    <label class="field"><span>Name</span><input type="text" name="name" value="${esc(p.name)}" required></label>
    <label class="field"><span>URL slug (/products/&hellip;/) — changing this keeps the old link working via a redirect</span>
      <input type="text" name="slug" value="${esc(p.slug)}" pattern="[a-z0-9\\-]+" maxlength="120"></label>
    <label class="field"><span>Short name</span><input type="text" name="short_name" value="${esc(p.short_name || '')}" required></label>
    <label class="field"><span>Price</span><input type="text" name="price" value="${esc(String(p.price))}" required></label>
    <label class="field"><span>Compare-at price (optional — shows as a strike-through)</span>
      <input type="text" name="compare_at_price" value="${esc(p.compare_at_cents ? String(fromCentsLocal(p.compare_at_cents)) : '')}"></label>
    <label class="field"><span>Currency</span><input type="text" name="currency" value="${esc(p.currency)}" maxlength="3"></label>
    <label class="field"><span>Category</span><input type="text" name="category" value="${esc(p.category || '')}"></label>
    <label class="field"><span>Fabric</span><input type="text" name="fabric" value="${esc(p.fabric || '')}"></label>
    <label class="field"><span>GSM</span><input type="text" name="gsm" value="${esc(String(p.gsm ?? ''))}"></label>
    <label class="field checkbox"><input type="checkbox" name="gsm_approximate" value="1"${bool(p.gsm_approximate) ? ' checked' : ''}> <span>GSM is approximate</span></label>
    <label class="field"><span>Fit</span><input type="text" name="fit" value="${esc(p.fit || '')}"></label>
    <label class="field"><span>Print method</span><input type="text" name="print_method" value="${esc(p.print_method || '')}"></label>
    <label class="field"><span>Badge (small overlay label, e.g. "FIRST DROP")</span><input type="text" name="badge" value="${esc(p.badge || '')}"></label>
    <label class="field checkbox"><input type="checkbox" name="featured" value="1"${bool(p.featured) ? ' checked' : ''}> <span>Featured on homepage</span></label>
  </div>

  <label class="field"><span>Tagline</span><input type="text" name="tagline" value="${esc(p.tagline || '')}"></label>
  <label class="field"><span>Short description (used in meta tags and product cards)</span>
    <input type="text" name="short_description" value="${esc(p.short_description || '')}"></label>

  <label class="field"><span>Description (one paragraph per line)</span>
    <textarea rows="4" name="description">${esc(description)}</textarea></label>

  <label class="field"><span>Highlights (one per line — shown as a bullet list)</span>
    <textarea rows="4" name="highlights">${esc(highlights)}</textarea></label>

  <label class="field"><span>Confirmed details (one per line — shown under "Product details")</span>
    <textarea rows="4" name="details_confirmed">${esc(detailsConfirmed)}</textarea></label>

  <label class="field"><span>Care instructions (one per line — must match the real garment label)</span>
    <textarea rows="4" name="care_instructions">${esc(careInstructions)}</textarea></label>

  <label class="field"><span>Tags (one per line — internal grouping/search, not shown as text on the page)</span>
    <textarea rows="3" name="tags">${esc(tags)}</textarea></label>

  <button class="btn btn--primary" type="submit">Save changes</button>
</form>

${sizesSection(p)}

<h2>Size guide</h2>
${sizeGuideEditor(p.slug, sizeGuide)}
`;
}

/**
 * Sizes list, with an "add a size" form. Quantities and the closed/open flag
 * are edited from Inventory (the one place quantities are ever shown), not
 * duplicated here — this only covers which size labels exist at all.
 */
function sizesSection(p) {
  return `
<h2>Sizes</h2>
<div class="panel">
  <p class="note">${
    p.sizes.length
      ? p.sizes.map((s) => esc(s.size)).join(', ')
      : 'No sizes yet.'
  } — set quantities and open/close a size from <a class="link-underline" href="/admin/inventory">Inventory</a>.</p>
  <form method="post" action="/admin/products/${esc(p.slug)}/sizes" style="display:flex;gap:8px;align-items:flex-end;margin-top:10px">
    <label class="field" style="margin:0"><span>Add a size</span>
      <input type="text" name="size" maxlength="12" placeholder="e.g. XS or 3XL" required></label>
    <button class="btn btn--sm" type="submit">Add</button>
  </form>
</div>`;
}

/**
 * The measurements table, edited as an actual table (add/remove row and
 * column, one cell per measurement) rather than raw CSV. It still posts CSV
 * to the existing /size-guide route (parseSizeGuideCsv() in
 * routes/products.js already produces exactly the { size, ...columns } shape
 * pages/product.js's storefront table reads) — the JS below only builds that
 * CSV from the table just before submit, so the backend contract is
 * unchanged and the form still works with JavaScript disabled (as a plain
 * CSV textarea, revealed when the table can't render).
 */
function sizeGuideEditor(slug, sizeGuide) {
  const rows = Array.isArray(sizeGuide?.measurements) ? sizeGuide.measurements : [];
  const cols = rows.length ? Object.keys(rows[0]).filter((c) => c !== 'size') : ['Bust (cm)', 'Length (cm)'];
  const dataRows = rows.length ? rows : [{ size: 'S' }, { size: 'M' }, { size: 'L' }];

  return `
<form method="post" action="/admin/products/${esc(slug)}/size-guide" data-size-guide-form>
  <label class="field"><span>Note shown above the table</span>
    <input type="text" name="note" value="${esc(sizeGuide?.note || '')}"></label>

  <div class="table-wrap" data-sg-table-wrap style="margin-bottom:12px">
    <table data-sg-table>
      <thead><tr data-sg-head><th>Size</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th></th></tr></thead>
      <tbody data-sg-body>
        ${dataRows
          .map(
            (r) => `<tr>
          <td><input type="text" data-sg-size value="${esc(r.size || '')}" style="width:70px"></td>
          ${cols.map((c) => `<td><input type="text" data-sg-cell value="${esc(r[c] ?? '')}"></td>`).join('')}
          <td><button class="btn btn--sm btn--danger" type="button" data-sg-remove-row>&times;</button></td>
        </tr>`
          )
          .join('\n        ')}
      </tbody>
    </table>
  </div>
  <div class="actions" style="margin-bottom:14px">
    <button class="btn btn--sm" type="button" data-sg-add-row>+ Row (size)</button>
    <button class="btn btn--sm" type="button" data-sg-add-col>+ Column (measurement)</button>
  </div>

  <label class="field"><span>Measurements table (CSV — kept in sync with the table above; edit directly if you prefer)</span>
    <textarea rows="5" name="measurements_csv" data-sg-csv placeholder="size,Bust (cm),Length (cm)&#10;S,100,68&#10;M,104,70">${esc(sizeGuideToCsv(sizeGuide))}</textarea></label>
  <button class="btn btn--primary" type="submit">Save size guide</button>
</form>

<script>
(() => {
  const form = document.querySelector('[data-size-guide-form]');
  if (!form) return;
  const table = form.querySelector('[data-sg-table]');
  const head = form.querySelector('[data-sg-head]');
  const body = form.querySelector('[data-sg-body]');
  const csv = form.querySelector('[data-sg-csv]');

  const colCount = () => head.children.length - 2; // minus Size and the trailing action column

  function addRow(size = '') {
    const tr = document.createElement('tr');
    let html = '<td><input type="text" data-sg-size value="' + size.replace(/"/g, '&quot;') + '" style="width:70px"></td>';
    for (let i = 0; i < colCount(); i++) html += '<td><input type="text" data-sg-cell></td>';
    html += '<td><button class="btn btn--sm btn--danger" type="button" data-sg-remove-row>&times;</button></td>';
    tr.innerHTML = html;
    body.appendChild(tr);
  }

  function addCol() {
    const name = prompt('Column name, e.g. "Bust (cm)"');
    if (!name) return;
    const th = document.createElement('th');
    th.textContent = name;
    head.insertBefore(th, head.lastElementChild);
    for (const tr of body.children) {
      const td = document.createElement('td');
      td.innerHTML = '<input type="text" data-sg-cell>';
      tr.insertBefore(td, tr.lastElementChild);
    }
  }

  function syncCsv() {
    const headers = ['size'];
    for (let i = 1; i <= colCount(); i++) headers.push(head.children[i].textContent.trim());
    const lines = [headers.join(',')];
    for (const tr of body.children) {
      const size = tr.querySelector('[data-sg-size]').value.trim();
      if (!size) continue;
      const cells = [...tr.querySelectorAll('[data-sg-cell]')].map((i) => i.value.trim());
      lines.push([size, ...cells].join(','));
    }
    csv.value = lines.length > 1 ? lines.join('\\n') : '';
  }

  table.addEventListener('click', (e) => {
    if (e.target.matches('[data-sg-remove-row]')) e.target.closest('tr').remove();
  });
  form.querySelector('[data-sg-add-row]').addEventListener('click', () => addRow());
  form.querySelector('[data-sg-add-col]').addEventListener('click', addCol);
  form.addEventListener('submit', syncCsv);
})();
</script>
`;
}

function fromCentsLocal(cents) {
  return Number(cents) / 100;
}

/** Round-trip helper so the admin edits the measurement table as plain CSV. */
function sizeGuideToCsv(sizeGuide) {
  const rows = sizeGuide?.measurements;
  if (!Array.isArray(rows) || !rows.length) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => r[c]).join(','));
  return lines.join('\n');
}

/* -------------------------------------------------------------- inventory */

export function inventoryPage({ products, ledger }) {
  return `
<h1>Inventory</h1>
<p class="sub">Quantities are visible here and nowhere else. The storefront only ever shows a size as
  available or unavailable — a customer can never read a stock number from the public API.</p>

${products
  .map(
    (p) => `<section class="panel">
  <h3>${esc(p.name)} <span class="note mono">${esc(p.slug)}</span></h3>
  <div class="table-wrap" style="border:0">
    <table>
      <thead><tr><th>Size</th><th>Quantity</th><th>Set to</th><th>Closed by hand</th><th>Customer sees</th></tr></thead>
      <tbody>
        ${p.sizes
          .map(
            (s) => `<tr>
          <td><strong>${esc(s.size)}</strong></td>
          <td class="num">${esc(String(s.quantity))}</td>
          <td>
            <form method="post" action="/admin/inventory/quantity" style="display:flex;gap:6px;align-items:center">
              <input type="hidden" name="slug" value="${esc(p.slug)}">
              <input type="hidden" name="size" value="${esc(s.size)}">
              <label class="sr-only" for="q-${esc(p.slug)}-${esc(s.size)}">Quantity for ${esc(s.size)}</label>
              <input id="q-${esc(p.slug)}-${esc(s.size)}" type="number" name="quantity" min="0" max="100000" value="${esc(String(s.quantity))}">
              <button class="btn btn--sm" type="submit">Save</button>
            </form>
          </td>
          <td>
            <form method="post" action="/admin/inventory/closed">
              <input type="hidden" name="slug" value="${esc(p.slug)}">
              <input type="hidden" name="size" value="${esc(s.size)}">
              <input type="hidden" name="closed" value="${s.closed ? '0' : '1'}">
              <button class="btn btn--sm" type="submit">${s.closed ? 'Reopen' : 'Close'}</button>
            </form>
          </td>
          <td>${
            s.available
              ? '<span class="tag tag--PUBLISHED">Available</span>'
              : '<span class="tag tag--SOLD_OUT">Sold out</span>'
          }</td>
        </tr>`
          )
          .join('\n        ')}
      </tbody>
    </table>
  </div>
</section>`
  )
  .join('\n')}

<h2>Stock movements</h2>
<div class="table-wrap">
  ${
    ledger.length
      ? `<table>
    <thead><tr><th>When</th><th>Size</th><th>Change</th><th>Reason</th><th>Order</th><th>Note</th></tr></thead>
    <tbody>
      ${ledger
        .map(
          (l) => `<tr>
        <td class="num">${esc(shortDate(l.created_at))}</td>
        <td>${esc(l.size)}</td>
        <td class="num">${Number(l.delta) > 0 ? '+' : ''}${esc(String(l.delta))}</td>
        <td>${esc(l.reason)}</td>
        <td class="mono">${esc(l.order_id || '—')}</td>
        <td>${esc(l.note || '')}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
      : empty('No stock movements recorded yet.')
  }
</div>
`;
}

/* ---------------------------------------------------------------- content */

export function contentPage({ rows }) {
  const groups = [...new Set(rows.map((r) => r.group_name || 'general'))];
  return `
<h1>Content</h1>
<p class="sub">Customer-facing copy, stored as data. Changing it here cannot break the layout,
  because none of it is code. Fields marked JSON must stay valid JSON — the save is rejected otherwise.</p>

${groups
  .map(
    (g) => `<h2>${esc(g)}</h2>
${rows
  .filter((r) => (r.group_name || 'general') === g)
  .map((r) => (r.key === 'home.hero_image' ? heroImageField(r) : contentField(r)))
  .join('\n')}`
  )
  .join('\n')}
`;
}

function contentField(r) {
  return `<form class="panel" method="post" action="/admin/content">
  <input type="hidden" name="key" value="${esc(r.key)}">
  <label class="field">
    <span>${esc(r.label || r.key)} — <span class="mono">${esc(r.key)}</span>${r.kind === 'json' ? ' (JSON)' : ''}</span>
    ${
      r.kind === 'json' || String(r.value || '').length > 90
        ? `<textarea name="value">${esc(r.value || '')}</textarea>`
        : `<input type="text" name="value" value="${esc(r.value || '')}">`
    }
  </label>
  <button class="btn btn--primary btn--sm" type="submit">Save</button>
  <span class="note" style="margin-left:10px">Updated ${esc(shortDate(r.updated_at))}</span>
</form>`;
}

/** Upload widget for the homepage hero photo — an image, not a text row. */
function heroImageField(r) {
  return `<div class="panel">
  <p><span>${esc(r.label || r.key)} — <span class="mono">${esc(r.key)}</span></span></p>
  ${
    r.value
      ? `<img src="${esc(r.value)}" alt="" style="max-width:280px;display:block;margin-bottom:10px;border-radius:4px">`
      : `<p class="note">Using the built-in default image until one is uploaded here.</p>`
  }
  <form method="post" action="/admin/content/hero-image" enctype="multipart/form-data" class="inline">
    <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required>
    <button class="btn btn--primary btn--sm" type="submit">Upload</button>
  </form>
  ${
    r.value
      ? `<form method="post" action="/admin/content" class="inline" style="margin-top:6px">
    <input type="hidden" name="key" value="${esc(r.key)}">
    <input type="hidden" name="value" value="">
    <button class="btn btn--sm" type="submit">Reset to default</button>
  </form>`
      : ''
  }
  <span class="note" style="display:block;margin-top:6px">Updated ${esc(shortDate(r.updated_at))}</span>
</div>`;
}

/* --------------------------------------------------------------- settings */

export function settingsPage({ rows, admin, passwordError = null }) {
  const groups = [...new Set(rows.map((r) => r.group_name || 'general'))];
  return `
<h1>Settings</h1>
<p class="sub">Business configuration. Values marked secret are never returned by the public API —
  the Sham Cash instructions hold a payment account and exist only behind this login.</p>

${groups
  .map(
    (g) => `<h2>${esc(g)}</h2>
${rows
  .filter((r) => (r.group_name || 'general') === g)
  .map(
    (r) => `<form class="panel" method="post" action="/admin/settings">
  <input type="hidden" name="key" value="${esc(r.key)}">
  <label class="field">
    <span>${esc(r.label || r.key)} — <span class="mono">${esc(r.key)}</span>${
      Number(r.secret) ? ' · <span style="color:var(--red-ink)">secret</span>' : ''
    }</span>
    ${
      r.kind === 'markdown' || r.kind === 'json' || String(r.value || '').length > 90
        ? `<textarea name="value">${esc(r.value || '')}</textarea>`
        : `<input type="text" name="value" value="${esc(r.value || '')}">`
    }
  </label>
  <button class="btn btn--primary btn--sm" type="submit">Save</button>
</form>`
  )
  .join('\n')}`
  )
  .join('\n')}

<h2>Analytics data</h2>
<section class="panel">
  <p class="note">Raw analytics events are kept so questions nobody thought to ask in advance
    can still be answered. They contain no name, phone number, address or email — only a
    random per-browser id, a page path and a coarse device class. Deleting old events is an
    explicit action, never a silent background job.</p>
  <form method="post" action="/admin/analytics/purge">
    <label class="field"><span>Delete analytics older than (days)</span>
      <input type="number" name="days" min="30" max="3650" value="365"></label>
    <button class="btn btn--danger" type="submit">Purge older events</button>
  </form>
</section>

<h2>Your account</h2>
<section class="panel">
  <p class="note">Signed in as <span class="mono">${esc(admin.email)}</span>.
    Changing the password signs out every other session immediately.</p>
  ${passwordError ? `<p class="flash" role="alert">${esc(passwordError)}</p>` : ''}
  <form method="post" action="/admin/password">
    <label class="field"><span>Current password</span>
      <input type="password" name="current" autocomplete="current-password" required></label>
    <label class="field"><span>New password (12 characters minimum)</span>
      <input type="password" name="next" autocomplete="new-password" required minlength="12"></label>
    <button class="btn btn--primary" type="submit">Change password</button>
  </form>
</section>
`;
}

/* ----------------------------------------------------------------- emails */

export function emailsPage({ templates, outbox }) {
  return `
<h1>Emails</h1>
<p class="sub">One transactional email exists: the shipping notification. There is no marketing mail,
  by design. <strong>No provider is configured</strong>, so queued messages are stored and shown here
  but are not delivered — nothing is ever marked sent that was not actually sent.</p>

${templates
  .map(
    (t) => `<form class="panel" method="post" action="/admin/emails/template">
  <input type="hidden" name="key" value="${esc(t.key)}">
  <h3 class="mono">${esc(t.key)}</h3>
  <label class="field"><span>Subject</span><input type="text" name="subject" value="${esc(t.subject)}"></label>
  <label class="field"><span>Body</span><textarea name="body" style="min-height:200px">${esc(t.body)}</textarea></label>
  <label class="field" style="display:flex;gap:8px;align-items:center">
    <input type="checkbox" name="enabled" value="1" ${Number(t.enabled) ? 'checked' : ''} style="width:auto">
    <span style="margin:0">Enabled</span>
  </label>
  <p class="note">Placeholders: {{ORDER_ID}} {{CUSTOMER_NAME}} {{ITEMS}} {{TOTAL}} {{DELIVERY_ESTIMATE}} {{CITY}}</p>
  <button class="btn btn--primary" type="submit">Save template</button>
</form>`
  )
  .join('\n')}

<h2>Outbox</h2>
<div class="table-wrap">
  ${
    outbox.length
      ? `<table>
    <thead><tr><th>Queued</th><th>To</th><th>Subject</th><th>Order</th><th>Status</th></tr></thead>
    <tbody>
      ${outbox
        .map(
          (m) => `<tr>
        <td class="num">${esc(shortDate(m.created_at))}</td>
        <td>${esc(m.to_address)}</td>
        <td>${esc(m.subject)}</td>
        <td class="mono">${esc(m.order_id || '—')}</td>
        <td>${statusTag(m.status)}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
      : empty('Nothing queued.')
  }
</div>
`;
}

/* -------------------------------------------------------------- audit log */

export function auditPage({ rows }) {
  return `
<h1>Activity log</h1>
<p class="sub">Every state-changing admin action. Values that could contain a credential are stripped
  before writing, so this log can never become the place a password leaks. IPs are stored hashed.</p>

<div class="table-wrap">
  ${
    rows.length
      ? `<table>
    <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <td class="num">${esc(shortDate(r.created_at))}</td>
        <td>${esc(r.email || 'system')}</td>
        <td class="mono">${esc(r.action)}</td>
        <td class="mono">${esc([r.entity_type, r.entity_id].filter(Boolean).join(':') || '—')}</td>
        <td class="mono">${esc(r.detail || '')}</td>
      </tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>`
      : empty('Nothing logged yet.')
  }
</div>
`;
}

export function notFoundPage() {
  return `<h1>Not found</h1><p class="sub">That admin page does not exist.</p>
<p><a class="btn" href="/admin">Back to the dashboard</a></p>`;
}

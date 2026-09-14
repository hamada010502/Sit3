/**
 * VESTIPHOBIA — orders.
 *
 * TRUST BOUNDARY
 * The client sends only: who they are, and which slug+size+quantity they want.
 * Prices, discounts, totals and the returning-customer status are all derived
 * server-side from the catalogue and the order history. A tampered payload
 * cannot change what an order costs.
 */

import { getDb, newId, now, toCents, fromCents, bool, parseJson } from '../db/index.js';
import { priceCart } from '../../assets/js/pricing.js';
import { validOrderPayload, validEnum, ORDER_STATUSES } from '../lib/validate.js';
import { commitStock, releaseStock, InventoryConflict } from '../lib/inventory.js';
import { audit } from '../lib/http.js';
import { recordServerEvent } from '../lib/analytics.js';
import { getSettings, discountConfig } from './settings.js';
import { queueShippedEmail } from './emails.js';

/* ------------------------------------------------------------ order number */

/**
 * VST-2026-0001, allocated inside the caller's transaction.
 *
 * MAX(order_number) under a row lock, not a counter in application memory:
 * two simultaneous orders cannot receive the same number, which was the single
 * biggest flaw in the previous browser-side implementation.
 */
async function nextOrderNumber(tx, prefix = 'VST', pad = 4) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = await tx.get(
    'SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1',
    [like]
  );
  let seq = 1;
  if (row?.order_number) {
    const n = Number(String(row.order_number).split('-').pop());
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}-${year}-${String(seq).padStart(pad, '0')}`;
}

/** Same cart + same customer inside this window returns the existing order. */
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

const fingerprintOf = (phone, items, cents) =>
  `${phone}#${items.map((i) => `${i.slug}:${i.size}:${i.quantity}`).sort().join('|')}#${cents}`;

/* -------------------------------------------------------------- serialise */

export function orderToJson(order, items = [], events = []) {
  return {
    orderId: order.order_number,
    status: order.status,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    customerPhoneRaw: order.customer_phone_raw,
    customerEmail: order.customer_email,
    city: order.city,
    address: order.address,
    notes: order.notes,
    currency: order.currency,
    pieces: order.pieces,
    subtotal: fromCents(order.subtotal_cents),
    discountPercent: order.discount_percent,
    discountAmount: fromCents(order.discount_cents),
    discountLabel: order.discount_label,
    total: fromCents(order.total_cents),
    shippingFree: bool(order.shipping_free),
    shippingLabel: order.shipping_label,
    paymentMethod: order.payment_method,
    items: items.map((i) => ({
      slug: i.product_slug,
      name: i.product_name,
      size: i.size,
      quantity: i.quantity,
      unitPrice: fromCents(i.unit_price_cents),
      lineTotal: fromCents(i.line_total_cents),
    })),
    history: events.map((e) => ({ at: e.created_at, status: e.status, note: e.note })),
  };
}

export async function loadOrder(db, orderNumber) {
  const order = await db.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber]);
  if (!order) return null;
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const events = await db.all(
    'SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC',
    [order.id]
  );
  return { order, items, json: orderToJson(order, items, events) };
}

/* ------------------------------------------------------- create (public) */

export async function createOrder(body, { ip } = {}) {
  const parsed = validOrderPayload(body);
  if (!parsed.ok) return { status: 400, body: { error: 'Please check your details.', fields: parsed.errors } };

  const input = parsed.value;
  const db = await getDb();
  const settings = await getSettings();

  // Resolve every line against the live catalogue. The client's idea of price
  // is never consulted.
  const resolved = [];
  for (const line of input.items) {
    const product = await db.get(
      `SELECT id, slug, name, price_cents, currency, status
         FROM products WHERE slug = ?`,
      [line.slug]
    );
    if (!product) {
      return { status: 400, body: { error: `That product is no longer available: ${line.slug}` } };
    }
    if (product.status !== 'PUBLISHED') {
      return { status: 409, body: { error: `${product.name} is not currently on sale.` } };
    }

    const stock = await db.get(
      'SELECT quantity, manual_out_of_stock FROM inventory WHERE product_id = ? AND size = ?',
      [product.id, line.size]
    );
    if (!stock) return { status: 400, body: { error: `Size ${line.size} does not exist for ${product.name}.` } };

    // Availability is checked at order time as a courtesy to the customer.
    // It is NOT a reservation — stock is only committed when the store accepts
    // the order, which is the moment the brand actually commits to fulfilling.
    if (bool(stock.manual_out_of_stock) || Number(stock.quantity) < line.quantity) {
      return {
        status: 409,
        body: {
          error: `Size ${line.size} is no longer available in that quantity.`,
          code: 'OUT_OF_STOCK',
          size: line.size,
        },
      };
    }

    resolved.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      size: line.size,
      quantity: line.quantity,
      unitCents: product.price_cents,
      lineCents: product.price_cents * line.quantity,
      currency: product.currency,
    });
  }

  const pieces = resolved.reduce((n, i) => n + i.quantity, 0);
  const subtotalCents = resolved.reduce((n, i) => n + i.lineCents, 0);

  // Returning status is read from the order history, not from the request.
  const delivered = await db.get(
    `SELECT COUNT(*) AS n FROM orders WHERE customer_phone = ? AND status = 'DELIVERED'`,
    [input.phone]
  );
  const isReturning = Number(delivered?.n ?? 0) > 0;

  const pricing = priceCart(
    { pieces, subtotal: fromCents(subtotalCents), items: resolved.map((i) => ({ qty: i.quantity, price: fromCents(i.unitCents) })) },
    { config: discountConfig(settings), isReturning }
  );

  const fingerprint = fingerprintOf(input.phone, input.items, subtotalCents);

  try {
    return await db.transaction(async (tx) => {
      // Idempotency: a repeated tap or a mid-flight reload returns the order
      // that already exists rather than creating a second one.
      const existing = await tx.get(
        `SELECT * FROM orders
          WHERE fingerprint = ? AND status = 'PENDING' AND created_at > ?
          ORDER BY created_at DESC LIMIT 1`,
        [fingerprint, new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString()]
      );
      if (existing) {
        const items = await tx.all('SELECT * FROM order_items WHERE order_id = ?', [existing.id]);
        return { status: 200, body: { order: orderToJson(existing, items), duplicate: true } };
      }

      const ts = now();
      const orderNumber = await nextOrderNumber(
        tx,
        settings['orders.prefix'] || 'VST',
        Number(settings['orders.pad'] || 4)
      );
      const orderId = newId();

      /* customer upsert, keyed on the normalised phone */
      let customer = await tx.get('SELECT * FROM customers WHERE phone = ?', [input.phone]);
      if (!customer) {
        const cid = newId();
        await tx.run(
          `INSERT INTO customers (id, phone, phone_raw, name, email, latest_city, latest_address,
                                  order_count, total_spend_cents, delivered_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
          [cid, input.phone, input.phoneRaw, input.fullName, input.email, input.city, input.address, ts, ts]
        );
        customer = { id: cid };
      } else {
        await tx.run(
          `UPDATE customers SET name = ?, email = ?, latest_city = ?, latest_address = ?, updated_at = ?
            WHERE id = ?`,
          [input.fullName, input.email || customer.email, input.city, input.address, ts, customer.id]
        );
      }

      await tx.run(
        `INSERT INTO orders (
          id, order_number, customer_id, status,
          customer_name, customer_phone, customer_phone_raw, customer_email, city, address, notes,
          currency, pieces, subtotal_cents, discount_percent, discount_cents, discount_type,
          discount_label, total_cents, shipping_free, shipping_label, payment_method,
          fingerprint, inventory_committed, utm_source, utm_medium, utm_campaign, referrer,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          orderNumber,
          customer.id,
          input.fullName,
          input.phone,
          input.phoneRaw,
          input.email,
          input.city,
          input.address,
          input.notes,
          resolved[0].currency,
          pieces,
          subtotalCents,
          pricing.discountPercent,
          toCents(pricing.discountAmount),
          pricing.appliedDiscount?.type || null,
          pricing.appliedDiscount?.label || null,
          toCents(pricing.total),
          pricing.freeShipping ? 1 : 0,
          pricing.freeShipping ? 'Free shipping (2+ pieces)' : 'Paid on delivery — varies by region',
          settings['payment.method'] || 'SHAM CASH — MANUAL',
          fingerprint,
          input.utm.source,
          input.utm.medium,
          input.utm.campaign,
          input.referrer,
          ts,
          ts,
        ]
      );

      for (const i of resolved) {
        await tx.run(
          `INSERT INTO order_items (id, order_id, product_id, product_slug, product_name, size,
                                    quantity, unit_price_cents, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId(), orderId, i.productId, i.slug, i.name, i.size, i.quantity, i.unitCents, i.lineCents]
        );
      }

      await tx.run(
        `INSERT INTO order_events (id, order_id, status, note, created_at) VALUES (?, ?, ?, ?, ?)`,
        [newId(), orderId, 'PENDING', 'Order submitted from the website', ts]
      );

      await tx.run(
        `UPDATE customers SET order_count = order_count + 1, updated_at = ? WHERE id = ?`,
        [ts, customer.id]
      );

      const order = await tx.get('SELECT * FROM orders WHERE id = ?', [orderId]);
      const items = await tx.all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
      return { status: 201, body: { order: orderToJson(order, items) } };
    });
  } catch (err) {
    console.error('[orders] create failed:', err);
    return {
      status: 500,
      body: { error: 'We could not save your order. Nothing was sent — please try again.' },
    };
  }
}

/* --------------------------------------------------------- status changes */

// Pipeline order, used only to tell forward from backward — an order is free
// to skip ahead (PENDING straight to DELIVERED is a legitimate fast
// fulfilment, and existing behaviour relies on ACCEPTED -> DELIVERED working
// without visiting PREPARING/SHIPPED first), it just may never move backward.
export const STAGE_RANK = { PENDING: 0, ACCEPTED: 1, PREPARING: 2, SHIPPED: 3, DELIVERED: 4 };

// DELIVERED and REJECTED are final: once an order reaches either, nothing
// here may move it again. Without this, cycling a DELIVERED order back and
// through DELIVERED a second time double-counts the customer's
// delivered_count and total_spend_cents (the returning-customer discount and
// revenue reporting both read those columns), and cycling an ACCEPTED order
// through REJECTED and back to ACCEPTED double-commits its stock. Both are
// reachable from the admin UI with two ordinary clicks, not just the API.
export const TERMINAL_STATUSES = new Set(['DELIVERED', 'REJECTED']);

/**
 * Advance an order. ACCEPTED is the transition that commits stock, because
 * that is the moment the store commits to fulfilling — the whole thing runs in
 * one transaction, so a stock conflict leaves the order untouched.
 */
export async function setOrderStatus(orderNumber, nextStatus, { adminId, note, ip } = {}) {
  const check = validEnum(nextStatus, ORDER_STATUSES, 'order status');
  if (!check.ok) return { status: 400, body: { error: check.error } };
  const status = check.value;

  const db = await getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const order = await tx.get('SELECT * FROM orders WHERE order_number = ?', [orderNumber]);
      if (!order) return { status: 404, body: { error: 'Order not found.' } };
      if (order.status === status) {
        return { status: 200, body: { order: orderToJson(order), unchanged: true } };
      }
      if (TERMINAL_STATUSES.has(order.status)) {
        return {
          status: 409,
          body: {
            error: `This order is already ${order.status} and cannot be changed further.`,
            code: 'ORDER_TERMINAL',
          },
        };
      }
      if (status !== 'REJECTED' && STAGE_RANK[status] <= STAGE_RANK[order.status]) {
        return {
          status: 409,
          body: {
            error: `An order at ${order.status} cannot move backward to ${status}.`,
            code: 'INVALID_TRANSITION',
          },
        };
      }

      const items = await tx.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      const ts = now();

      // Accepting commits stock.
      if (status === 'ACCEPTED' && !bool(order.inventory_committed)) {
        await commitStock(tx, {
          orderId: order.id,
          adminId,
          items: items.map((i) => ({
            productId: i.product_id,
            size: i.size,
            quantity: i.quantity,
          })),
        });
      }

      // Rejecting an order whose stock was already committed returns it.
      if (status === 'REJECTED' && bool(order.inventory_committed)) {
        await releaseStock(tx, {
          orderId: order.id,
          adminId,
          items: items.map((i) => ({
            productId: i.product_id,
            size: i.size,
            quantity: i.quantity,
          })),
        });
      }

      await tx.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, ts, order.id]);
      await tx.run(
        'INSERT INTO order_events (id, order_id, status, note, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [newId(), order.id, status, note || null, adminId || null, ts]
      );

      // DELIVERED is what makes a customer "returning", so the counter that
      // drives the discount is maintained here and nowhere else.
      if (status === 'DELIVERED' && order.customer_id) {
        await tx.run(
          `UPDATE customers
              SET delivered_count = delivered_count + 1,
                  total_spend_cents = total_spend_cents + ?,
                  updated_at = ?
            WHERE id = ?`,
          [order.total_cents, ts, order.customer_id]
        );
      }

      const updated = await tx.get('SELECT * FROM orders WHERE id = ?', [order.id]);
      return { status: 200, body: { order: orderToJson(updated, items) }, _order: updated, _items: items };
    });

    if (result.status === 200 && result._order) {
      // Lifecycle events are recorded HERE, on the server, and are never
      // accepted from a browser: a client that could post `order_status` could
      // inflate the conversion report without an order existing.
      await recordServerEvent('order_status', {
        orderNumber,
        props: { status },
      });
      await audit('order.status', {
        adminId,
        entityType: 'order',
        entityId: orderNumber,
        detail: { to: status },
        ip,
      });
      // Email is queued OUTSIDE the transaction: a mail failure must never roll
      // back a status change the admin already made.
      if (status === 'SHIPPED') {
        await queueShippedEmail(result._order, result._items).catch((e) =>
          console.error('[orders] could not queue shipping email:', e.message)
        );
      }
      delete result._order;
      delete result._items;
    }
    return result;
  } catch (err) {
    if (err instanceof InventoryConflict) {
      return {
        status: 409,
        body: {
          error: err.message,
          code: 'INVENTORY_CONFLICT',
          conflicts: err.conflicts,
        },
      };
    }
    console.error('[orders] status change failed:', err);
    return { status: 500, body: { error: 'Could not update the order.' } };
  }
}

/* ------------------------------------------------------------ admin lists */

export async function listOrders({ status, q, limit = 100, offset = 0 } = {}) {
  const db = await getDb();
  const where = [];
  const params = [];

  if (status) {
    const check = validEnum(status, ORDER_STATUSES, 'order status');
    if (check.ok) {
      where.push('status = ?');
      params.push(check.value);
    }
  }
  if (q) {
    // LOWER() on both sides, because LIKE is case-INSENSITIVE in SQLite and
    // case-SENSITIVE in Postgres. Without it, searching "ahmad" in production
    // would find nothing while the same search worked in development — the
    // worst kind of difference, because it looks like missing data rather
    // than a broken query. LOWER() behaves identically on both engines, so
    // this stays one query rather than a dialect branch.
    const term = `%${String(q).trim().slice(0, 60).toLowerCase()}%`;
    where.push(
      '(LOWER(order_number) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(city) LIKE ?)'
    );
    params.push(term, term, term, term);
  }

  const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(Math.min(Number(limit) || 100, 500), Number(offset) || 0);

  const rows = await db.all(sql, params);
  const counts = await db.all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  return { orders: rows, counts };
}

export async function orderStats() {
  const db = await getDb();
  const totals = await db.get(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_cents), 0) AS revenue_cents,
            COALESCE(SUM(pieces), 0) AS pieces
       FROM orders WHERE status <> 'REJECTED'`
  );
  const pending = await db.get(`SELECT COUNT(*) AS n FROM orders WHERE status = 'PENDING'`);
  const delivered = await db.get(`SELECT COUNT(*) AS n FROM orders WHERE status = 'DELIVERED'`);
  const byCity = await db.all(
    `SELECT city, COUNT(*) AS n FROM orders WHERE status <> 'REJECTED'
     GROUP BY city ORDER BY n DESC LIMIT 8`
  );
  const recent = await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8');

  const orders = Number(totals?.orders ?? 0);
  const revenue = Number(totals?.revenue_cents ?? 0);
  return {
    orders,
    revenue: fromCents(revenue),
    pieces: Number(totals?.pieces ?? 0),
    pending: Number(pending?.n ?? 0),
    delivered: Number(delivered?.n ?? 0),
    averageOrder: orders ? fromCents(Math.round(revenue / orders)) : 0,
    byCity,
    recent,
  };
}

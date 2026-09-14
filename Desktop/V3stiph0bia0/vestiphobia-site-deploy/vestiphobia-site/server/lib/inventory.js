/**
 * VESTIPHOBIA — inventory.
 *
 * ===========================================================================
 * THE OVERSELLING PROBLEM
 * ===========================================================================
 * Two admins accepting orders for the last L at the same moment must not both
 * succeed. The naive version — read quantity, check it, then write — has a gap
 * between the check and the write where the other transaction can slip in.
 *
 * This module never does that. The decrement is a single conditional UPDATE:
 *
 *     UPDATE inventory SET quantity = quantity - ?
 *      WHERE product_id = ? AND size = ? AND quantity >= ?
 *
 * The row is only changed if it still holds enough stock AT THE MOMENT OF THE
 * WRITE. `changes === 0` means someone else got there first, and the whole
 * transaction rolls back. There is no read-then-write race to lose.
 *
 * Both engines make this safe: SQLite takes the write lock at BEGIN IMMEDIATE,
 * and Postgres locks the row for the duration of the UPDATE.
 * ===========================================================================
 */

import { newId, now, bool } from '../db/index.js';

/** Customers see availability, never a number. */
export function availabilityOf(row) {
  if (bool(row.manual_out_of_stock)) return 'out_of_stock';
  if (Number(row.quantity) <= 0) return 'out_of_stock';
  return 'available';
}

/**
 * Public shape for one size. Deliberately omits `quantity` — the public API
 * must never be able to leak a stock count, so it is dropped here at the
 * source rather than remembered at each call site.
 *
 * `low` is the one bit of the quantity ever exposed — "at or below the
 * configured threshold" — which is the same manufactured-scarcity signal the
 * storefront has always shown (a "LOW" badge on the size button), never the
 * count itself.
 */
export const publicSize = (row, lowStockThreshold = -1) => ({
  size: row.size,
  available: availabilityOf(row) === 'available',
  low: availabilityOf(row) === 'available' && Number(row.quantity) <= lowStockThreshold,
});

export async function sizesFor(db, productId) {
  return db.all(
    'SELECT size, quantity, manual_out_of_stock, sort_order FROM inventory WHERE product_id = ? ORDER BY sort_order',
    [productId]
  );
}

/**
 * Commit stock for an accepted order, atomically and all-or-nothing.
 *
 * Must be called INSIDE a transaction — it takes the transaction handle so it
 * cannot accidentally run outside one. If any line cannot be satisfied, it
 * throws, the caller's transaction rolls back, and no partial decrement is
 * left behind.
 *
 * @throws {InventoryConflict} when a line no longer has enough stock
 */
export class InventoryConflict extends Error {
  constructor(conflicts) {
    super(
      `Not enough stock: ${conflicts.map((c) => `${c.size} (need ${c.requested}, have ${c.available})`).join(', ')}`
    );
    this.name = 'InventoryConflict';
    this.conflicts = conflicts;
  }
}

export async function commitStock(tx, { orderId, items, adminId }) {
  const conflicts = [];
  const ts = now();

  for (const item of items) {
    // One conditional UPDATE. If the row no longer satisfies `quantity >= ?`
    // it simply does not match, and changes comes back 0.
    const res = await tx.run(
      `UPDATE inventory
          SET quantity = quantity - ?, updated_at = ?
        WHERE product_id = ? AND size = ? AND quantity >= ?`,
      [item.quantity, ts, item.productId, item.size, item.quantity]
    );

    if (res.changes === 0) {
      const row = await tx.get(
        'SELECT quantity FROM inventory WHERE product_id = ? AND size = ?',
        [item.productId, item.size]
      );
      conflicts.push({
        size: item.size,
        requested: item.quantity,
        available: row ? Number(row.quantity) : 0,
      });
      continue;
    }

    await tx.run(
      `INSERT INTO inventory_ledger (id, product_id, size, delta, reason, order_id, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), item.productId, item.size, -item.quantity, 'order_accepted', orderId, adminId || null, ts]
    );
  }

  // Any conflict fails the whole commit. Throwing rolls the caller's
  // transaction back, including the decrements that did succeed above.
  if (conflicts.length) throw new InventoryConflict(conflicts);

  await tx.run('UPDATE orders SET inventory_committed = 1, updated_at = ? WHERE id = ?', [ts, orderId]);
}

/**
 * Return stock to the shelf when an already-accepted order is rejected.
 * Guarded by `inventory_committed` so a double rejection cannot inflate stock.
 */
export async function releaseStock(tx, { orderId, items, adminId }) {
  const ts = now();
  const order = await tx.get('SELECT inventory_committed FROM orders WHERE id = ?', [orderId]);
  if (!order || !bool(order.inventory_committed)) return false;

  for (const item of items) {
    await tx.run(
      'UPDATE inventory SET quantity = quantity + ?, updated_at = ? WHERE product_id = ? AND size = ?',
      [item.quantity, ts, item.productId, item.size]
    );
    await tx.run(
      `INSERT INTO inventory_ledger (id, product_id, size, delta, reason, order_id, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), item.productId, item.size, item.quantity, 'order_rejected', orderId, adminId || null, ts]
    );
  }

  await tx.run('UPDATE orders SET inventory_committed = 0, updated_at = ? WHERE id = ?', [ts, orderId]);
  return true;
}

/** Admin: set an absolute quantity. The ledger records the delta, not the value. */
export async function setQuantity(db, { productId, size, quantity, adminId, note }) {
  const ts = now();
  const current = await db.get(
    'SELECT quantity FROM inventory WHERE product_id = ? AND size = ?',
    [productId, size]
  );
  if (!current) return null;

  const delta = Number(quantity) - Number(current.quantity);
  await db.run(
    'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ? AND size = ?',
    [Math.max(0, Number(quantity)), ts, productId, size]
  );
  if (delta !== 0) {
    await db.run(
      `INSERT INTO inventory_ledger (id, product_id, size, delta, reason, admin_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), productId, size, delta, 'manual_adjust', adminId || null, note || null, ts]
    );
  }
  return { size, quantity: Math.max(0, Number(quantity)), delta };
}

/**
 * Admin: close or reopen a size by hand.
 * Independent of quantity, so closing a size does not destroy the count and
 * reopening does not invent one.
 */
export async function setManualOutOfStock(db, { productId, size, closed, adminId }) {
  const ts = now();
  await db.run(
    'UPDATE inventory SET manual_out_of_stock = ?, updated_at = ? WHERE product_id = ? AND size = ?',
    [closed ? 1 : 0, ts, productId, size]
  );
  await db.run(
    `INSERT INTO inventory_ledger (id, product_id, size, delta, reason, admin_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      productId,
      size,
      0,
      'manual_adjust',
      adminId || null,
      closed ? 'closed by admin' : 'reopened by admin',
      ts,
    ]
  );
  return true;
}

export async function ledgerFor(db, productId, limit = 100) {
  return db.all(
    `SELECT size, delta, reason, order_id, note, created_at
       FROM inventory_ledger
      WHERE product_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [productId, limit]
  );
}

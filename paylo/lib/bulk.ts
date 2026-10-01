import { recordPriceChange, track } from './analytics-events';
import { getDb, nowIso } from './db';
import { audit } from './audit';
import { syncProductStockStatus } from './orders';
import type { Product } from './types';

export type BulkAction = 'price_set' | 'price_pct' | 'stock_set' | 'activate' | 'deactivate';
export class BulkError extends Error {}
export interface BulkResult { updated: number; skipped: { title: string; reason: 'has_variants' | 'digital' }[] }

/**
 * Bulk edits over a seller's own products, in one transaction. Orders are untouched:
 * each order froze its unit price at checkout.
 *   price_set  — products without variants only (variant prices are per-row; a flat
 *                price would erase their differences), others are reported as skipped
 *   price_pct  — base price and every variant, rounded to whole SYP, never below 1
 *   stock_set  — physical products without variants; stock status re-synced
 */
export function applyBulk(sellerId: string, sellerLabel: string, ids: string[], action: BulkAction, value: number): BulkResult {
  const db = getDb();
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) throw new BulkError('bulk_none_selected');
  if (action === 'price_set' && !(Number.isInteger(value) && value > 0)) throw new BulkError('bulk_bad_value');
  if (action === 'price_pct' && !(Number.isFinite(value) && value !== 0 && value >= -90 && value <= 500)) throw new BulkError('bulk_bad_pct');
  if (action === 'stock_set' && !(Number.isInteger(value) && value >= 0)) throw new BulkError('bulk_bad_value');

  const products = db.prepare(`SELECT * FROM products WHERE seller_id = ? AND status != 'removed' AND id IN (${unique.map(() => '?').join(',')})`)
    .all(sellerId, ...unique) as Product[];
  const hasVariants = new Set((db.prepare(`SELECT DISTINCT product_id FROM product_variants WHERE product_id IN (${unique.map(() => '?').join(',')})`)
    .all(...unique) as { product_id: string }[]).map((r) => r.product_id));
  const res: BulkResult = { updated: 0, skipped: [] };
  const priceChanges: { productId: string; variantId: string | null; oldPrice: number; newPrice: number }[] = [];
  const pct = (n: number) => Math.max(1, Math.round(n * (1 + value / 100)));

  db.transaction(() => {
    for (const p of products) {
      const v = hasVariants.has(p.id);
      if (action === 'price_set') {
        if (v) { res.skipped.push({ title: p.title, reason: 'has_variants' }); continue; }
        db.prepare('UPDATE products SET price = ?, updated_at = ? WHERE id = ?').run(value, nowIso(), p.id);
        priceChanges.push({ productId: p.id, variantId: null, oldPrice: p.price, newPrice: value });
      } else if (action === 'price_pct') {
        db.prepare('UPDATE products SET price = ?, updated_at = ? WHERE id = ?').run(pct(p.price), nowIso(), p.id);
        priceChanges.push({ productId: p.id, variantId: null, oldPrice: p.price, newPrice: pct(p.price) });
        for (const row of db.prepare('SELECT id, price FROM product_variants WHERE product_id = ?').all(p.id) as { id: string; price: number }[]) {
          db.prepare('UPDATE product_variants SET price = ? WHERE id = ?').run(pct(row.price), row.id);
          priceChanges.push({ productId: p.id, variantId: row.id, oldPrice: row.price, newPrice: pct(row.price) });
        }
      } else if (action === 'stock_set') {
        if (p.type === 'digital') { res.skipped.push({ title: p.title, reason: 'digital' }); continue; }
        if (v) { res.skipped.push({ title: p.title, reason: 'has_variants' }); continue; }
        db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(value, nowIso(), p.id);
        syncProductStockStatus(p.id);
      } else {
        const next = action === 'deactivate' ? 'inactive' : (p.type === 'digital' || p.stock > 0 ? 'active' : 'out_of_stock');
        db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), p.id);
      }
      res.updated++;
    }
  })();
  // Outside the transaction: analytics can never roll back (or be rolled back with) the update.
  for (const c of priceChanges) {
    recordPriceChange({ ...c, sellerId, source: `bulk:${action}` });
    if (!c.variantId) track('seller_product_update', { price_at_event: c.newPrice, old_price: c.oldPrice, price_changed: true, bulk: action },
      { actorType: 'seller', actorId: sellerId, sellerId, productId: c.productId });
  }
  audit('seller', sellerId, sellerLabel, 'product', sellerId, `bulk:${action}`, { value, updated: res.updated, skipped: res.skipped.length, ids: products.map((p) => p.id) });
  return res;
}

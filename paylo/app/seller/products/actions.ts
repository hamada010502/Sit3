'use server';
import { recordPriceChange, track } from '@/lib/analytics-events';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';
import { getDb, newId, newShortCode, nowIso } from '@/lib/db';
import { audit } from '@/lib/audit';
import { requireApprovedSeller } from '@/lib/guards';
import { collectionOf } from '@/lib/collections';
import { syncProductStockStatus } from '@/lib/orders';
import type { Product, ProductType } from '@/lib/types';
import { UPLOAD_DIR } from '@/lib/uploads';

const MAX_IMAGES = 5;            // v2 §4.1
const MAX_VARIANTS = 30;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function saveUpload(file: File): Promise<string | null> {
  if (!file || file.size === 0) return null;
  const ext = TYPES[file.type];
  if (!ext || file.size > MAX_BYTES) return null;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${newId()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}
async function saveImages(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) { const p = await saveUpload(f); if (p) out.push(p); }
  return out;
}

interface VariantRow { uid?: string; option1_value?: string; option2_value?: string; price?: number; stock?: number; image?: string | null }

export async function saveProductAction(productId: string | null, _prev: { error?: string } | null, formData: FormData) {
  const { seller } = requireApprovedSeller();
  const db = getDb();
  const type = (String(formData.get('type') || 'physical') === 'digital' ? 'digital' : 'physical') as ProductType;
  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim() || null;
  const digitalNote = String(formData.get('digital_note') || '').trim() || null;
  const price = parseInt(String(formData.get('price') || ''), 10);
  const option1 = String(formData.get('option1_name') || '').trim() || null;
  const option2 = String(formData.get('option2_name') || '').trim() || null;
  if (!title || !Number.isFinite(price) || price <= 0) return { error: 'product_error' };
  // Only ever one of this seller's own collections — never trust the posted id alone.
  const collectionRaw = String(formData.get('collection_id') || '');
  const collectionId = collectionRaw && collectionOf(seller.id, collectionRaw) ? collectionRaw : null;

  let variants: VariantRow[] = [];
  try { variants = JSON.parse(String(formData.get('variants') || '[]')); } catch { variants = []; }
  variants = variants
    .filter((v) => (v.option1_value || '').trim() || (v.option2_value || '').trim())
    .slice(0, MAX_VARIANTS);
  if (!option1 || type === 'digital') variants = [];

  // Stock lives on the variants when there are any, so the base field is only required without them.
  const stock = type === 'digital' || variants.length ? 0 : parseInt(String(formData.get('stock') || ''), 10);
  if (type === 'physical' && !variants.length && (!Number.isFinite(stock) || stock < 0)) return { error: 'product_error' };
  for (const v of variants) {
    if (!Number.isFinite(Number(v.price)) || Number(v.price) <= 0) return { error: 'product_error' };
    if (!Number.isFinite(Number(v.stock)) || Number(v.stock) < 0) return { error: 'product_error' };
  }

  // Variant images: a new upload wins; otherwise keep the old one only if it really was
  // one of this product's variant images (never trust a posted path).
  const priorVariantImages = new Set(productId
    ? (db.prepare('SELECT v.image_path FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.product_id = ? AND p.seller_id = ? AND v.image_path IS NOT NULL').all(productId, seller.id) as { image_path: string }[]).map((r) => r.image_path)
    : []);
  const variantImages: (string | null)[] = [];
  for (const v of variants) {
    const f = v.uid && /^[a-z0-9]{1,16}$/.test(v.uid) ? formData.get(`variant_image_${v.uid}`) : null;
    const uploaded = f instanceof File ? await saveUpload(f) : null;
    variantImages.push(uploaded ?? (v.image && priorVariantImages.has(v.image) ? v.image : null));
  }

  // Images, in the order the seller arranged them (first = cover). A kept image must already
  // belong to this product — never trust a posted path (it could be another store's upload).
  const current: string[] = productId
    ? JSON.parse((db.prepare('SELECT images FROM products WHERE id = ? AND seller_id = ?').get(productId, seller.id) as { images: string } | undefined)?.images || '[]')
    : [];
  const newFiles = formData.getAll('images').filter((x): x is File => x instanceof File && x.size > 0);
  let images: string[];
  let order: unknown;
  try { order = JSON.parse(String(formData.get('image_order') ?? 'null')); } catch { order = null; }
  if (Array.isArray(order)) {
    images = [];
    const used = new Set<number>();
    for (const tok of order.slice(0, MAX_IMAGES)) {
      if (typeof tok !== 'string') continue;
      const m = /^new:(\d+)$/.exec(tok);
      if (m) { const n = Number(m[1]); const f = newFiles[n]; used.add(n); const p = f ? await saveUpload(f) : null; if (p) images.push(p); }
      else if (current.includes(tok) && !images.includes(tok)) images.push(tok);
    }
    // Files posted without an order token (e.g. a plain file input) go after, never dropped.
    for (let n = 0; n < newFiles.length && images.length < MAX_IMAGES; n++) {
      if (!used.has(n)) { const p = await saveUpload(newFiles[n]); if (p) images.push(p); }
    }
  } else {
    // No-JS fallback: keep ticked images (validated), then append uploads.
    const keep = formData.getAll('keep_image').map(String).filter((p) => current.includes(p));
    images = [...keep, ...(await saveImages(newFiles))].slice(0, MAX_IMAGES);
  }
  // With variants, the product's own stock mirrors the sum so storefront availability stays truthful.
  const effectiveStock = variants.length ? variants.reduce((s, v) => s + Number(v.stock), 0) : stock;

  // Prices before the edit, for product_price_history (variants are re-created on save, so
  // they are matched by label).
  const before = productId ? db.prepare('SELECT price FROM products WHERE id = ? AND seller_id = ?').get(productId, seller.id) as { price: number } | undefined : undefined;
  const beforeVariants = productId ? new Map((db.prepare('SELECT label, price FROM product_variants WHERE product_id = ?').all(productId) as { label: string; price: number }[]).map((v) => [v.label, v.price])) : new Map<string, number>();

  const write = db.transaction(() => {
    let id = productId;
    if (id) {
      const existing = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(id, seller.id) as Product | undefined;
      if (!existing || existing.status === 'removed') throw new Error('not_found');
      db.prepare(`UPDATE products SET type = ?, title = ?, description = ?, price = ?, stock = ?, images = ?, digital_note = ?,
        option1_name = ?, option2_name = ?, collection_id = ?, updated_at = ? WHERE id = ?`)
        .run(type, title, description, price, effectiveStock, JSON.stringify(images), digitalNote, option1, option2, collectionId, nowIso(), id);
    } else {
      id = newId();
      db.prepare(`INSERT INTO products (id, seller_id, type, title, description, price, stock, images, digital_note, option1_name, option2_name, collection_id, short_code, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
        .run(id, seller.id, type, title, description, price, effectiveStock, JSON.stringify(images), digitalNote, option1, option2, collectionId, newShortCode(db));
    }
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
    const insV = db.prepare('INSERT INTO product_variants (id, product_id, option1_value, option2_value, label, price, stock, position, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    variants.forEach((v, i) => {
      const label = [v.option1_value, v.option2_value].filter(Boolean).join(' / ');
      insV.run(newId(), id, v.option1_value || null, v.option2_value || null, label, Number(v.price), Number(v.stock), i, variantImages[i]);
    });
    return id;
  });

  let id: string;
  try { id = write(); } catch { return { error: 'product_error' }; }
  if (type === 'digital') db.prepare("UPDATE products SET status = CASE WHEN status = 'out_of_stock' THEN 'active' ELSE status END WHERE id = ?").run(id);
  else syncProductStockStatus(id);
  audit('seller', seller.id, seller.store_name, 'product', id, productId ? 'updated' : 'created', { title, type, variants: variants.length });
  const variantPrices = variants.map((v) => ({ label: [v.option1_value, v.option2_value].filter(Boolean).join(' / '), price: Number(v.price) }));
  track(productId ? 'seller_product_update' : 'seller_product_create', {
    price_at_event: price, old_price: before?.price ?? null, price_changed: !!before && before.price !== price, type, variants: variants.length,
    variant_prices: variantPrices.map((v) => v.price), collection: !!collectionId,
  }, { actorType: 'seller', actorId: seller.id, sellerId: seller.id, productId: id });
  recordPriceChange({ productId: id, sellerId: seller.id, oldPrice: before?.price ?? null, newPrice: price, source: productId ? 'seller_edit' : 'created' });
  for (const v of variantPrices) {
    const old = beforeVariants.get(v.label);
    if (old === undefined ? !!productId : old !== v.price) recordPriceChange({ productId: id, sellerId: seller.id, oldPrice: old ?? null, newPrice: v.price, source: `variant:${v.label}` });
  }
  revalidatePath('/seller/products');
  redirect(`/seller/products/${id}?saved=1`);
}

export async function toggleProductAction(productId: string) {
  const { seller } = requireApprovedSeller();
  const db = getDb();
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(productId, seller.id) as Product | undefined;
  if (!p || p.status === 'removed') return;
  const next = p.status === 'inactive' ? (p.type === 'digital' || p.stock > 0 ? 'active' : 'out_of_stock') : 'inactive';
  db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), productId);
  audit('seller', seller.id, seller.store_name, 'product', productId, 'status:' + next);
  revalidatePath('/seller/products');
}

export async function deleteProductAction(productId: string) {
  const { seller } = requireApprovedSeller();
  const db = getDb();
  const used = db.prepare('SELECT 1 FROM orders WHERE product_id = ? LIMIT 1').get(productId);
  // Products with order history are archived, never deleted — the audit trail must stay resolvable.
  if (used) db.prepare("UPDATE products SET status = 'inactive', updated_at = ? WHERE id = ? AND seller_id = ?").run(nowIso(), productId, seller.id);
  else db.prepare('DELETE FROM products WHERE id = ? AND seller_id = ?').run(productId, seller.id);
  audit('seller', seller.id, seller.store_name, 'product', productId, used ? 'archived' : 'deleted');
  revalidatePath('/seller/products');
  redirect('/seller/products');
}

export interface BulkState { error?: string; result?: import('@/lib/bulk').BulkResult }
export async function bulkProductsAction(_prev: BulkState | null, formData: FormData): Promise<BulkState> {
  const { seller } = requireApprovedSeller();
  const { applyBulk, BulkError } = await import('@/lib/bulk');
  const action = String(formData.get('bulk_action') || '') as import('@/lib/bulk').BulkAction;
  if (!['price_set', 'price_pct', 'stock_set', 'activate', 'deactivate'].includes(action)) return { error: 'bulk_bad_value' };
  const value = Number(String(formData.get('bulk_value') || '0').replace(/[^0-9.\-]/g, ''));
  try {
    const result = applyBulk(seller.id, seller.store_name, formData.getAll('ids').map(String), action, value);
    revalidatePath('/seller/products');
    return { result };
  } catch (e) {
    if (e instanceof BulkError) return { error: e.message };
    throw e;
  }
}

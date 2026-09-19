'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';
import { getDb, newId, nowIso } from '@/lib/db';
import { audit } from '@/lib/audit';
import { requireApprovedSeller } from '@/lib/guards';
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

interface VariantRow { option1_value?: string; option2_value?: string; price?: number; stock?: number }

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

  const keep = formData.getAll('keep_image').map(String);
  const uploaded = await saveImages(formData.getAll('images').filter((x): x is File => x instanceof File));
  const images = [...keep, ...uploaded].slice(0, MAX_IMAGES);
  // With variants, the product's own stock mirrors the sum so storefront availability stays truthful.
  const effectiveStock = variants.length ? variants.reduce((s, v) => s + Number(v.stock), 0) : stock;

  const write = db.transaction(() => {
    let id = productId;
    if (id) {
      const existing = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(id, seller.id) as Product | undefined;
      if (!existing || existing.status === 'removed') throw new Error('not_found');
      db.prepare(`UPDATE products SET type = ?, title = ?, description = ?, price = ?, stock = ?, images = ?, digital_note = ?,
        option1_name = ?, option2_name = ?, updated_at = ? WHERE id = ?`)
        .run(type, title, description, price, effectiveStock, JSON.stringify(images), digitalNote, option1, option2, nowIso(), id);
    } else {
      id = newId();
      db.prepare(`INSERT INTO products (id, seller_id, type, title, description, price, stock, images, digital_note, option1_name, option2_name, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
        .run(id, seller.id, type, title, description, price, effectiveStock, JSON.stringify(images), digitalNote, option1, option2);
    }
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
    const insV = db.prepare('INSERT INTO product_variants (id, product_id, option1_value, option2_value, label, price, stock, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    variants.forEach((v, i) => {
      const label = [v.option1_value, v.option2_value].filter(Boolean).join(' / ');
      insV.run(newId(), id, v.option1_value || null, v.option2_value || null, label, Number(v.price), Number(v.stock), i);
    });
    return id;
  });

  let id: string;
  try { id = write(); } catch { return { error: 'product_error' }; }
  if (type === 'digital') db.prepare("UPDATE products SET status = CASE WHEN status = 'out_of_stock' THEN 'active' ELSE status END WHERE id = ?").run(id);
  else syncProductStockStatus(id);
  audit('seller', seller.id, seller.store_name, 'product', id, productId ? 'updated' : 'created', { title, type, variants: variants.length });
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

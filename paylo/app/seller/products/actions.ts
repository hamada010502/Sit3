'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';
import { getDb, newId, nowIso } from '@/lib/db';
import { requireApprovedSeller } from '@/lib/guards';
import type { Product } from '@/lib/types';
import { UPLOAD_DIR } from '@/lib/uploads';

const MAX_IMAGES = 6;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function saveImages(files: File[]): Promise<string[]> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const out: string[] = [];
  for (const f of files) {
    if (!f || f.size === 0) continue;
    const ext = TYPES[f.type];
    if (!ext || f.size > MAX_BYTES) continue;
    const name = `${newId()}.${ext}`;
    await fs.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await f.arrayBuffer()));
    out.push(`/uploads/${name}`);
  }
  return out;
}

export async function saveProductAction(productId: string | null, _prev: { error?: string } | null, formData: FormData) {
  const { seller } = requireApprovedSeller();
  const db = getDb();
  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim() || null;
  const price = parseInt(String(formData.get('price') || ''), 10);
  const stock = parseInt(String(formData.get('stock') || ''), 10);
  if (!title || !Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < 0) return { error: 'product_error' };

  const keep = formData.getAll('keep_image').map(String);
  const uploaded = await saveImages(formData.getAll('images').filter((x): x is File => x instanceof File));
  const images = [...keep, ...uploaded].slice(0, MAX_IMAGES);

  if (productId) {
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(productId, seller.id) as Product | undefined;
    if (!existing || existing.status === 'removed') return { error: 'product_error' };
    const status = stock === 0 ? 'out_of_stock' : existing.status === 'out_of_stock' ? 'active' : existing.status;
    db.prepare('UPDATE products SET title = ?, description = ?, price = ?, stock = ?, images = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(title, description, price, stock, JSON.stringify(images), status, nowIso(), productId);
  } else {
    productId = newId();
    db.prepare('INSERT INTO products (id, seller_id, title, description, price, stock, images, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(productId, seller.id, title, description, price, stock, JSON.stringify(images), stock === 0 ? 'out_of_stock' : 'active');
  }
  revalidatePath('/seller/products');
  redirect(`/seller/products/${productId}?saved=1`);
}

export async function toggleProductAction(productId: string) {
  const { seller } = requireApprovedSeller();
  const db = getDb();
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND seller_id = ?').get(productId, seller.id) as Product | undefined;
  if (!p || p.status === 'removed') return;
  const next = p.status === 'inactive' ? (p.stock > 0 ? 'active' : 'out_of_stock') : 'inactive';
  db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), productId);
  revalidatePath('/seller/products');
}

export async function deleteProductAction(productId: string) {
  const { seller } = requireApprovedSeller();
  const db = getDb();
  const used = db.prepare('SELECT 1 FROM orders WHERE product_id = ? LIMIT 1').get(productId);
  if (used) db.prepare("UPDATE products SET status = 'inactive', updated_at = ? WHERE id = ? AND seller_id = ?").run(nowIso(), productId, seller.id);
  else db.prepare('DELETE FROM products WHERE id = ? AND seller_id = ?').run(productId, seller.id);
  revalidatePath('/seller/products');
  redirect('/seller/products');
}

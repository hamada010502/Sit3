import { NextResponse } from 'next/server';
import { authenticate, pagination } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { Product, ProductVariant } from '@/lib/types';

export async function GET(req: Request) {
  const auth = authenticate(req);
  if ('response' in auth) return auth.response;
  const { limit, offset } = pagination(req);
  const db = getDb();
  const rows = db.prepare("SELECT * FROM products WHERE seller_id = ? AND status != 'removed' ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(auth.seller.id, limit, offset) as Product[];
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE seller_id = ?)')
    .all(auth.seller.id) as ProductVariant[];
  return NextResponse.json({
    object: 'list', limit, offset,
    data: rows.map((p) => ({
      id: p.id, type: p.type, title: p.title, description: p.description, price: p.price, stock: p.stock,
      status: p.status, currency: 'SYP', checkout_path: `/p/${p.id}`,
      images: JSON.parse(p.images) as string[],
      variants: variants.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, label: v.label, price: v.price, stock: v.stock })),
    })),
  });
}

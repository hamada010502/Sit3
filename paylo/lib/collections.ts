import { getDb, newId } from './db';
import type { Collection } from './types';

export class CollectionError extends Error {}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const sellerCollections = (sellerId: string) =>
  getDb().prepare('SELECT * FROM collections WHERE seller_id = ? ORDER BY position, name').all(sellerId) as Collection[];

export const collectionOf = (sellerId: string, id: string) =>
  getDb().prepare('SELECT * FROM collections WHERE id = ? AND seller_id = ?').get(id, sellerId) as Collection | undefined;

export function createCollection(sellerId: string, name: string): Collection {
  const clean = name.trim().slice(0, 40);
  const slug = slugify(clean);
  if (!clean || !slug) throw new CollectionError('collection_name_required');
  if (getDb().prepare('SELECT 1 FROM collections WHERE seller_id = ? AND slug = ?').get(sellerId, slug)) throw new CollectionError('collection_exists');
  const id = newId();
  const pos = (getDb().prepare('SELECT coalesce(max(position), -1) + 1 p FROM collections WHERE seller_id = ?').get(sellerId) as { p: number }).p;
  getDb().prepare('INSERT INTO collections (id, seller_id, name, slug, position) VALUES (?, ?, ?, ?, ?)').run(id, sellerId, clean, slug, pos);
  return collectionOf(sellerId, id)!;
}

/** Products stay in the store, just uncategorised (explicit, not reliant on FK pragmas). */
export function deleteCollection(sellerId: string, id: string) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE products SET collection_id = NULL WHERE collection_id = ? AND seller_id = ?').run(id, sellerId);
    db.prepare('DELETE FROM collections WHERE id = ? AND seller_id = ?').run(id, sellerId);
  })();
}

/** Collections that have at least one product a buyer can see — empty ones are hidden. */
export const visibleCollections = (sellerId: string) => getDb().prepare(`
  SELECT c.* FROM collections c WHERE c.seller_id = ?
    AND EXISTS (SELECT 1 FROM products p WHERE p.collection_id = c.id AND p.status IN ('active','out_of_stock'))
  ORDER BY c.position, c.name`).all(sellerId) as Collection[];

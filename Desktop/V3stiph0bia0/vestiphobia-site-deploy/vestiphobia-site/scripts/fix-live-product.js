/**
 * One-off cleanup for the single live product created (and then hand-edited
 * with placeholder text) through the admin while the product form was being
 * built. Run against the real database once, not on every deploy.
 *
 *   node scripts/fix-live-product.js                          (SQLite: data/vestiphobia.db)
 *   SQLITE_PATH=/tmp/x.db node scripts/fix-live-product.js     (a throwaway DB, for testing)
 *   DATABASE_URL=postgres://... node scripts/fix-live-product.js   (production)
 *
 * What it does, and nothing more:
 *   - Renames the product to name "VST00" / slug "vst00" (an old link to the
 *     previous slug keeps working — see product_redirects / updateProduct()'s
 *     slug handling in server/routes/products.js).
 *   - Replaces every copy field (fabric, description, highlights, care
 *     instructions, tagline, short description, confirmed details, fit,
 *     print method, GSM, category, tags, badge, featured, size guide) with
 *     the real, owner-supplied copy already committed in data/products.js —
 *     verbatim, never invented.
 *   - Goes through updateProduct(), the exact function the admin form itself
 *     calls, so this is not a parallel write path and everything it touches
 *     stays ordinarily editable from the admin afterwards.
 *   - Leaves price, currency, status, sizes, quantities and — most
 *     importantly — the already-uploaded images completely untouched. Images
 *     were uploaded separately through the real admin and are not part of
 *     the static catalogue's asset paths.
 *
 * Idempotent: running it again against an already-fixed row is a no-op View
 * (the slug is already "vst00", so the "already fixed" short-circuit fires).
 */

import { migrate } from '../server/db/migrate.js';
import { getDb, closeDb } from '../server/db/index.js';
import { updateProduct } from '../server/routes/products.js';
import { products as staticProducts } from '../data/products.js';

const OLD_SLUG_CANDIDATES = ['vestiphobia-001-fear-tee', 'vestiphobia-001'];
const NEW_SLUG = 'vst00';
const NEW_NAME = 'VST00';

// The one real, confirmed product entry — reused verbatim, never rewritten.
const SOURCE = staticProducts[0];
if (!SOURCE) {
  console.error('data/products.js has no products to copy from. Nothing to do.');
  process.exit(1);
}

async function main() {
  await migrate({ quiet: true });
  const db = await getDb();

  let row = await db.get('SELECT id, slug, name FROM products WHERE slug = ?', [NEW_SLUG]);
  if (row) {
    console.log(`Product is already "${NEW_NAME}" / "${NEW_SLUG}" (id ${row.id}). Nothing to change.`);
    await closeDb();
    return;
  }

  for (const candidate of OLD_SLUG_CANDIDATES) {
    row = await db.get('SELECT id, slug, name FROM products WHERE slug = ?', [candidate]);
    if (row) break;
  }
  // Fall back to "whatever the one product is" — this store only ever had
  // one at the time this script was written — rather than doing nothing
  // just because the slug drifted from the two candidates above.
  if (!row) {
    const all = await db.all('SELECT id, slug, name FROM products ORDER BY created_at LIMIT 2');
    if (all.length === 1) row = all[0];
  }
  if (!row) {
    console.error(
      'Could not find the product to fix (looked for slugs: ' +
        OLD_SLUG_CANDIDATES.join(', ') +
        `, and for exactly one product overall). Pass --slug=<slug> or fix it by hand.`
    );
    await closeDb();
    process.exit(1);
  }

  console.log(`Found product "${row.name}" (slug "${row.slug}", id ${row.id}). Applying real copy...`);

  const result = await updateProduct(row.slug, {
    name: NEW_NAME,
    slug: NEW_SLUG,
    short_name: SOURCE.shortName,
    tagline: SOURCE.tagline,
    short_description: SOURCE.shortDescription,
    description: SOURCE.description,
    highlights: SOURCE.highlights,
    details_confirmed: SOURCE.details.confirmed,
    care_instructions: SOURCE.careInstructions,
    fabric: SOURCE.fabric,
    gsm: SOURCE.gsm,
    gsm_approximate: Boolean(SOURCE.gsmApproximate),
    fit: SOURCE.fit,
    print_method: SOURCE.printMethod,
    category: SOURCE.category,
    tags: SOURCE.tags,
    badge: SOURCE.badge,
    featured: Boolean(SOURCE.featured),
    size_guide: SOURCE.sizeGuide,
  });

  if (!result.ok) {
    console.error('updateProduct() refused the change:', result.error);
    await closeDb();
    process.exit(1);
  }

  console.log(`Done. "${row.name}" (${row.slug}) is now "${NEW_NAME}" (${result.slug}).`);
  console.log(`The old URL /products/${row.slug}/ now 301-redirects to /products/${result.slug}/.`);
  await closeDb();
}

main().catch((err) => {
  console.error('fix-live-product failed:', err);
  process.exit(1);
});

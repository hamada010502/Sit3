/**
 * VESTIPHOBIA — products and the public catalogue.
 *
 * The public shape deliberately omits stock counts. `publicSize` in
 * lib/inventory.js drops the number at the source, so no route can leak it by
 * forgetting to strip it.
 */

import { getDb, newId, now, toCents, fromCents, bool, parseJson, toJson } from '../db/index.js';
import { publicSize, sizesFor } from '../lib/inventory.js';
import { validEnum, PRODUCT_STATUSES, cleanText } from '../lib/validate.js';
import { audit } from '../lib/http.js';
import { processProductImage, deleteProductImageFiles } from '../lib/uploads.js';

async function lowStockThreshold(db) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', ['inventory.low_stock_threshold']);
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : 3;
}

/** Full public product, safe to serialise to any visitor. */
export async function publicProduct(db, row, { threshold } = {}) {
  const images = await db.all(
    'SELECT id, src, alt, role, is_primary, width, height, variants FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order',
    [row.id]
  );
  const sizes = await sizesFor(db, row.id);
  const low = threshold ?? (await lowStockThreshold(db));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.short_name,
    status: row.status,
    price: fromCents(row.price_cents),
    compareAtPrice: row.compare_at_cents ? fromCents(row.compare_at_cents) : null,
    currency: row.currency,
    tagline: row.tagline,
    shortDescription: row.short_description,
    description: parseJson(row.description, []),
    highlights: parseJson(row.highlights, []),
    detailsConfirmed: parseJson(row.details_confirmed, []),
    fabric: row.fabric,
    gsm: row.gsm,
    gsmApproximate: bool(row.gsm_approximate),
    fit: row.fit,
    printMethod: row.print_method,
    careInstructions: parseJson(row.care_instructions, []),
    sizeGuide: parseJson(row.size_guide, null),
    category: row.category,
    tags: parseJson(row.tags, []),
    badge: row.badge,
    featured: bool(row.featured),
    images: images.map((im) => ({
      id: im.id,
      src: im.src,
      alt: im.alt,
      role: im.role,
      isPrimary: bool(im.is_primary),
      width: im.width ?? null,
      height: im.height ?? null,
      variants: parseJson(im.variants, null),
    })),
    // Availability only — never a quantity.
    sizes: sizes.map((s) => publicSize(s, low)),
    soldOut: sizes.every((s) => !publicSize(s, low).available),
  };
}

/** Catalogue for the storefront: PUBLISHED and SOLD_OUT only. */
export async function publicCatalogue() {
  const db = await getDb();
  const threshold = await lowStockThreshold(db);
  const rows = await db.all(
    `SELECT * FROM products WHERE status IN ('PUBLISHED','SOLD_OUT') ORDER BY sort_order, created_at`
  );
  return Promise.all(rows.map((r) => publicProduct(db, r, { threshold })));
}

export async function adminProducts() {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM products ORDER BY sort_order, created_at');
  return Promise.all(
    rows.map(async (r) => {
      const sizes = await sizesFor(db, r.id);
      const imageCount = await db.get('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [
        r.id,
      ]);
      return {
        ...r,
        price: fromCents(r.price_cents),
        // The admin DOES see quantities — that is the point of the screen.
        sizes: sizes.map((s) => ({
          size: s.size,
          quantity: Number(s.quantity),
          closed: bool(s.manual_out_of_stock),
          available: !bool(s.manual_out_of_stock) && Number(s.quantity) > 0,
        })),
        totalStock: sizes.reduce((n, s) => n + Number(s.quantity), 0),
        imageCount: Number(imageCount?.n ?? 0),
      };
    })
  );
}

export async function getProductBySlug(slug) {
  const db = await getDb();
  return db.get('SELECT * FROM products WHERE slug = ?', [slug]);
}

/** Public single product for the storefront — PUBLISHED/SOLD_OUT only, or null. */
export async function publicProductBySlug(slug) {
  const db = await getDb();
  const row = await db.get(`SELECT * FROM products WHERE slug = ? AND status IN ('PUBLISHED','SOLD_OUT')`, [
    slug,
  ]);
  if (!row) return null;
  return publicProduct(db, row);
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** First unused slug starting from the given base — base, base-2, base-3, … */
async function uniqueSlug(db, base) {
  let slug = base;
  let n = 2;
  while (await db.get('SELECT id FROM products WHERE slug = ?', [slug])) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/**
 * Create a new product with a generated id/slug, seeded at zero stock for
 * each given size — the same "honest until a real number is entered" rule
 * the seed data follows: a size is only ever `available` once the owner sets
 * a real quantity in Inventory, never invented at creation.
 */
export async function createProduct(fields, { adminId, ip } = {}) {
  const name = cleanText(fields.name, { max: 200 });
  if (!name) return { ok: false, code: 'NAME_REQUIRED', error: 'Name is required.' };

  const shortName = cleanText(fields.short_name, { max: 80 }) || name.slice(0, 80);

  const cents = toCents(fields.price);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, code: 'PRICE_INVALID', error: 'Price must be above zero.' };
  }

  const statusCheck = validEnum(fields.status || 'DRAFT', PRODUCT_STATUSES, 'status');
  if (!statusCheck.ok) return { ok: false, error: statusCheck.error };
  // A brand-new product has no images yet — the shop grid and product card
  // both require at least one (they render its primary image unconditionally)
  // — so it always starts DRAFT/HIDDEN regardless of what was requested.
  // Publish it from the product page once at least one image is uploaded.
  const status = ['PUBLISHED', 'SOLD_OUT'].includes(statusCheck.value) ? 'DRAFT' : statusCheck.value;

  const sizes = [
    ...new Set(
      String(fields.sizes || '')
        .split(/[,\n]/)
        .map((s) => cleanText(s, { max: 12 }).toUpperCase())
        .filter(Boolean)
    ),
  ];
  if (!sizes.length) return { ok: false, code: 'SIZES_REQUIRED', error: 'At least one size is required.' };

  const base = slugify(name);
  if (!base) return { ok: false, error: 'Could not derive a URL slug from that name.' };

  const db = await getDb();
  const slug = await uniqueSlug(db, base);
  const id = newId();
  const ts = now();
  // Split into paragraphs the same way updateProduct()'s JSON-array fields
  // do — cleanText() would collapse the newlines this textarea depends on.
  const descriptionParagraphs = String(fields.description || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const shortDescription = cleanText(fields.short_description, { max: 500 });

  await db.run(
    `INSERT INTO products (
      id, slug, name, short_name, status, price_cents, compare_at_cents, currency,
      tagline, short_description, description, highlights,
      fabric, gsm, gsm_approximate, fit, print_method, care_instructions, details_confirmed, size_guide,
      category, tags, badge, featured, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      name,
      shortName,
      status,
      cents,
      null,
      cleanText(fields.currency, { max: 3 }).toUpperCase() || 'USD',
      null,
      shortDescription || null,
      toJson(descriptionParagraphs),
      toJson([]),
      null,
      null,
      1,
      null,
      null,
      toJson([]),
      toJson([]),
      null,
      null,
      toJson([]),
      null,
      0,
      0,
      ts,
      ts,
    ]
  );

  let sortOrder = 0;
  for (const size of sizes) {
    await db.run(
      `INSERT INTO inventory (id, product_id, size, quantity, manual_out_of_stock, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), id, size, 0, 0, sortOrder++, ts]
    );
  }

  await audit('product.create', { adminId, entityType: 'product', entityId: slug, ip });
  return { ok: true, slug };
}

/**
 * Rebuild size_guide.measurements from a CSV pasted into a textarea — much
 * easier for a non-technical admin to edit than raw JSON, and the shape it
 * produces is exactly what the storefront's size-guide table already expects
 * (an array of { size, ...columns } rows).
 */
export function parseSizeGuideCsv(csv) {
  const lines = String(csv || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const cols = lines[0].split(',').map((c) => c.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    cols.forEach((c, i) => {
      const v = cells[i] ?? '';
      row[c] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    });
    return row;
  });
}

export async function updateSizeGuide(slug, { note, measurementsCsv }, ctx = {}) {
  const measurements = parseSizeGuideCsv(measurementsCsv);
  const value = note || measurements.length ? { note: cleanText(note, { max: 300 }), measurements } : null;
  return updateProduct(slug, { size_guide: value }, ctx);
}

export async function setProductStatus(slug, status, { adminId, ip } = {}) {
  const check = validEnum(status, PRODUCT_STATUSES, 'product status');
  if (!check.ok) return { ok: false, error: check.error };

  const db = await getDb();
  const ts = now();

  // PUBLISHED and SOLD_OUT are the two statuses the storefront actually
  // renders (publicCatalogue()'s WHERE clause) — both the shop grid and the
  // product card assume every product they're given has at least one image.
  // A product with none would 500 the whole shop grid for every visitor.
  if (['PUBLISHED', 'SOLD_OUT'].includes(check.value)) {
    const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
    if (!product) return { ok: false, error: 'Product not found.' };
    const hasImage = await db.get('SELECT id FROM product_images WHERE product_id = ? LIMIT 1', [
      product.id,
    ]);
    if (!hasImage) {
      // The admin previously only ever saw a generic "?m=invalid" for this —
      // the real reason existed right here as a string but had nowhere to
      // go. `code` lets server/index.js pick a specific flash message
      // instead of the catch-all one (see MESSAGES there); logging it here
      // means the reason is visible in the server logs even before that
      // flash message renders.
      console.warn(`[products] refused to publish ${slug}: no image uploaded yet`);
      return {
        ok: false,
        code: 'NO_IMAGE',
        error: 'Add at least one image before publishing this product.',
      };
    }
  }

  // Archiving sets a timestamp; the row is never deleted, because order
  // history references it.
  const archivedAt = check.value === 'ARCHIVED' ? ts : null;
  const r = await db.run(
    'UPDATE products SET status = ?, archived_at = ?, updated_at = ? WHERE slug = ?',
    [check.value, archivedAt, ts, slug]
  );
  if (!r.changes) return { ok: false, error: 'Product not found.' };

  await audit('product.status', {
    adminId,
    entityType: 'product',
    entityId: slug,
    detail: { to: check.value },
    ip,
  });
  return { ok: true, status: check.value };
}

/**
 * Change a product's slug, recording a redirect from the old one so an
 * existing link 301s instead of 404ing. Any redirect that already points at
 * the OLD slug is rewritten to point at the new one in the same step, so a
 * chain of renames never needs more than one hop followed at request time.
 */
async function renameSlug(db, product, newSlug, ts) {
  const clash = await db.get('SELECT id FROM products WHERE slug = ? AND id != ?', [newSlug, product.id]);
  if (clash) return { ok: false, code: 'SLUG_TAKEN', error: 'That URL slug is already used by another product.' };
  const redirectClash = await db.get('SELECT from_slug FROM product_redirects WHERE from_slug = ?', [newSlug]);
  if (redirectClash) {
    return { ok: false, code: 'SLUG_TAKEN', error: 'That URL slug was previously used and still redirects here.' };
  }

  const oldSlug = product.slug;
  await db.run('UPDATE products SET slug = ? WHERE id = ?', [newSlug, product.id]);
  await db.run(
    `INSERT INTO product_redirects (from_slug, to_slug, created_at) VALUES (?, ?, ?)
       ON CONFLICT (from_slug) DO UPDATE SET to_slug = excluded.to_slug`,
    [oldSlug, newSlug, ts]
  ).catch(async () => {
    // SQLite before 3.24 / a dialect without ON CONFLICT support: fall back
    // to delete-then-insert, which is just as correct for a single-row key.
    await db.run('DELETE FROM product_redirects WHERE from_slug = ?', [oldSlug]);
    await db.run('INSERT INTO product_redirects (from_slug, to_slug, created_at) VALUES (?, ?, ?)', [
      oldSlug,
      newSlug,
      ts,
    ]);
  });
  await db.run('UPDATE product_redirects SET to_slug = ? WHERE to_slug = ?', [newSlug, oldSlug]);
  return { ok: true };
}

/** Resolve a slug that 404'd against the redirect table — one hop, never a loop. */
export async function resolveProductRedirect(slug) {
  const db = await getDb();
  const row = await db.get('SELECT to_slug FROM product_redirects WHERE from_slug = ?', [slug]);
  return row ? row.to_slug : null;
}

/** Editable product fields. Prices are cents in, cents out. */
export async function updateProduct(slug, fields, { adminId, ip } = {}) {
  const db = await getDb();
  const product = await db.get('SELECT id, slug FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };

  const sets = [];
  const params = [];
  const allow = {
    name: (v) => cleanText(v, { max: 200 }),
    short_name: (v) => cleanText(v, { max: 80 }),
    tagline: (v) => cleanText(v, { max: 300 }),
    short_description: (v) => cleanText(v, { max: 500 }),
    fabric: (v) => cleanText(v, { max: 120 }),
    fit: (v) => cleanText(v, { max: 80 }),
    print_method: (v) => cleanText(v, { max: 120 }),
    badge: (v) => cleanText(v, { max: 60 }),
    category: (v) => cleanText(v, { max: 80 }),
    currency: (v) => cleanText(v, { max: 3 }).toUpperCase(),
  };

  if (fields.name !== undefined && !cleanText(fields.name, { max: 200 })) {
    return { ok: false, code: 'NAME_REQUIRED', error: 'Name is required.' };
  }

  for (const [key, clean] of Object.entries(allow)) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(clean(fields[key]));
    }
  }

  // Slug is handled separately (redirect bookkeeping), not through the
  // generic `allow` map above.
  let slugResult = null;
  if (fields.slug !== undefined) {
    const newSlug = slugify(fields.slug);
    if (!newSlug) return { ok: false, code: 'SLUG_INVALID', error: 'Could not derive a URL slug from that value.' };
    if (newSlug !== product.slug) {
      slugResult = await renameSlug(db, product, newSlug, now());
      if (!slugResult.ok) return slugResult;
    }
  }

  if (fields.price !== undefined) {
    const cents = toCents(fields.price);
    if (!Number.isFinite(cents) || cents <= 0) {
      return { ok: false, code: 'PRICE_INVALID', error: 'Price must be above zero.' };
    }
    sets.push('price_cents = ?');
    params.push(cents);
  }
  if (fields.compare_at_price !== undefined) {
    const raw = String(fields.compare_at_price).trim();
    if (raw === '') {
      sets.push('compare_at_cents = ?');
      params.push(null);
    } else {
      const cents = toCents(raw);
      if (!Number.isFinite(cents) || cents <= 0) {
        return { ok: false, error: 'Compare-at price must be above zero, or left blank.' };
      }
      sets.push('compare_at_cents = ?');
      params.push(cents);
    }
  }
  if (fields.gsm !== undefined) {
    sets.push('gsm = ?');
    params.push(fields.gsm === '' ? null : Number(fields.gsm));
  }
  if (fields.gsm_approximate !== undefined) {
    sets.push('gsm_approximate = ?');
    params.push(fields.gsm_approximate ? 1 : 0);
  }
  if (fields.featured !== undefined) {
    sets.push('featured = ?');
    params.push(fields.featured ? 1 : 0);
  }
  if (fields.sort_order !== undefined) {
    const n = Number(fields.sort_order);
    sets.push('sort_order = ?');
    params.push(Number.isFinite(n) ? Math.trunc(n) : 0);
  }
  for (const jsonField of ['description', 'highlights', 'care_instructions', 'details_confirmed', 'tags']) {
    if (fields[jsonField] !== undefined) {
      const arr = Array.isArray(fields[jsonField])
        ? fields[jsonField]
        : String(fields[jsonField]).split('\n').map((s) => s.trim()).filter(Boolean);
      sets.push(`${jsonField} = ?`);
      params.push(toJson(arr));
    }
  }
  // { note, measurements: [...] } — measurements is left as whatever shape the
  // admin form already sent (an array of per-size objects); only the JSON
  // encoding happens here.
  if (fields.size_guide !== undefined) {
    sets.push('size_guide = ?');
    params.push(fields.size_guide === null ? null : toJson(fields.size_guide));
  }

  if (!sets.length && !slugResult) return { ok: false, error: 'Nothing to update.' };

  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(now(), product.id);
    // product.id, not the slug the caller passed in: renameSlug() above may
    // already have changed the row's slug in the database.
    await db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  await audit('product.update', {
    adminId,
    entityType: 'product',
    entityId: product.slug,
    detail: { fields: Object.keys(fields) },
    ip,
  });
  return { ok: true, slug: slugResult ? (await db.get('SELECT slug FROM products WHERE id = ?', [product.id])).slug : product.slug };
}

/* ------------------------------------------------------------------- sizes */

/** Add a new size to a product, seeded at zero stock (see createProduct()'s comment on why). */
export async function addProductSize(slug, sizeLabel, { adminId, ip } = {}) {
  const size = cleanText(sizeLabel, { max: 12 }).toUpperCase();
  if (!size) return { ok: false, code: 'SIZE_REQUIRED', error: 'Enter a size.' };

  const db = await getDb();
  const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };

  const existing = await db.get('SELECT id FROM inventory WHERE product_id = ? AND size = ?', [
    product.id,
    size,
  ]);
  if (existing) return { ok: false, code: 'SIZE_EXISTS', error: `${size} already exists on this product.` };

  const orderRow = await db.get('SELECT MAX(sort_order) AS m FROM inventory WHERE product_id = ?', [
    product.id,
  ]);
  await db.run(
    `INSERT INTO inventory (id, product_id, size, quantity, manual_out_of_stock, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), product.id, size, 0, 0, Number(orderRow?.m ?? -1) + 1, now()]
  );

  await audit('product.size_add', { adminId, entityType: 'product', entityId: slug, detail: { size }, ip });
  return { ok: true, size };
}

/* ------------------------------------------------------------------ images */

/**
 * Site-wide media library: every uploaded image across every product, newest
 * first, for the admin's "reuse an existing photo" picker. Static-catalogue
 * images (width IS NULL — never uploaded through the admin) are excluded:
 * they have no responsive variant set and reusing one under a second product
 * slug would be reusing a file path that lives under the FIRST product's own
 * storage folder, which is confusing rather than useful.
 */
export async function listAllProductImages() {
  const db = await getDb();
  // No created_at column on product_images to sort newest-first by (ids are
  // random UUIDs, not time-ordered) — grouped by product, then upload order
  // within it, which is stable and still lets the admin scan it quickly.
  const rows = await db.all(
    `SELECT im.id, im.src, im.alt, im.role, im.is_primary, im.width, im.height, im.variants,
            p.slug AS product_slug, p.name AS product_name
       FROM product_images im
       JOIN products p ON p.id = im.product_id
      WHERE im.width IS NOT NULL
      ORDER BY p.name, im.sort_order`
  );
  return rows.map((im) => ({
    id: im.id,
    src: im.src,
    alt: im.alt,
    role: im.role,
    isPrimary: bool(im.is_primary),
    width: im.width,
    height: im.height,
    variants: parseJson(im.variants, null),
    productSlug: im.product_slug,
    productName: im.product_name,
  }));
}

/**
 * Attach an already-uploaded image (from any product, via the media library)
 * to this product as a new gallery entry — no re-upload, no new storage
 * object, just a new product_images row pointing at the same files. The
 * first image a product gets is still always primary automatically.
 */
export async function attachExistingImage(slug, sourceImageId, { adminId, ip } = {}) {
  const db = await getDb();
  const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };

  const source = await db.get('SELECT * FROM product_images WHERE id = ?', [sourceImageId]);
  if (!source) return { ok: false, error: 'That image no longer exists.' };

  const countRow = await db.get('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [
    product.id,
  ]);
  const isFirst = Number(countRow?.n ?? 0) === 0;
  const orderRow = await db.get('SELECT MAX(sort_order) AS m FROM product_images WHERE product_id = ?', [
    product.id,
  ]);
  const id = newId();

  await db.run(
    `INSERT INTO product_images (id, product_id, src, alt, role, sort_order, is_primary, width, height, variants)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      product.id,
      source.src,
      source.alt,
      source.role,
      Number(orderRow?.m ?? -1) + 1,
      isFirst ? 1 : 0,
      source.width,
      source.height,
      source.variants,
    ]
  );

  await audit('product.image_attach', {
    adminId,
    entityType: 'product',
    entityId: slug,
    detail: { imageId: id, sourceImageId },
    ip,
  });
  return { ok: true, id };
}

/** Every image on one product, admin shape (includes DB row id for the CRUD forms). */
export async function getProductImages(slug) {
  const db = await getDb();
  const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
  if (!product) return [];
  const rows = await db.all(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order',
    [product.id]
  );
  return rows.map((im) => ({
    id: im.id,
    src: im.src,
    alt: im.alt,
    role: im.role,
    isPrimary: bool(im.is_primary),
    isUpload: im.width != null,
  }));
}

/**
 * Add one uploaded image to a product: resize it into the responsive variant
 * set (server/lib/uploads.js), store the variants, and insert the row. The
 * very first image a product gets becomes primary automatically.
 */
export async function uploadProductImage(slug, { buffer, alt, role }, { adminId, ip } = {}) {
  const db = await getDb();
  const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };

  const id = newId();
  let processed;
  try {
    processed = await processProductImage(buffer, { slug, id });
  } catch (err) {
    // The admin only ever sees a generic "rejected" flash (server/index.js
    // never echoes free-text error detail back into a redirect — see the
    // comment on MESSAGES there). This is the one place the real reason
    // (a bad Supabase/S3 credential, a wrong bucket name, a network error)
    // actually gets written down, so it is not lost between here and the
    // admin's screen.
    console.error(`[products] image upload failed for ${slug}:`, err.message);
    return { ok: false, error: err.message || 'Could not process that image.' };
  }

  const countRow = await db.get('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [
    product.id,
  ]);
  const isFirst = Number(countRow?.n ?? 0) === 0;
  const orderRow = await db.get('SELECT MAX(sort_order) AS m FROM product_images WHERE product_id = ?', [
    product.id,
  ]);
  const sortOrder = Number(orderRow?.m ?? -1) + 1;
  const cleanAlt = cleanText(alt, { max: 300 });

  await db.run(
    `INSERT INTO product_images (id, product_id, src, alt, role, sort_order, is_primary, width, height, variants)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      product.id,
      processed.src,
      cleanAlt,
      role ? cleanText(role, { max: 20 }) : null,
      sortOrder,
      isFirst ? 1 : 0,
      processed.width,
      processed.height,
      toJson(processed.variants),
    ]
  );

  await audit('product.image_upload', { adminId, entityType: 'product', entityId: slug, detail: { imageId: id }, ip });
  return { ok: true, id };
}

/** Remove one image. If it was primary, the next-oldest image is promoted. */
export async function deleteProductImage(slug, imageId, { adminId, ip } = {}) {
  const db = await getDb();
  const product = await db.get('SELECT id, status FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };
  const image = await db.get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', [
    imageId,
    product.id,
  ]);
  if (!image) return { ok: false, error: 'Image not found.' };

  // A live product (PUBLISHED/SOLD_OUT) must always keep at least one image —
  // the shop grid and product card both assume every visible product has
  // one. Move it to DRAFT first to remove its last photo.
  if (['PUBLISHED', 'SOLD_OUT'].includes(product.status)) {
    const count = await db.get('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [
      product.id,
    ]);
    if (Number(count?.n ?? 0) <= 1) {
      return { ok: false, error: 'A published product must keep at least one image. Set it to Draft first.' };
    }
  }

  await db.run('DELETE FROM product_images WHERE id = ?', [imageId]);

  if (bool(image.is_primary)) {
    const next = await db.get(
      'SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1',
      [product.id]
    );
    if (next) await db.run('UPDATE product_images SET is_primary = 1 WHERE id = ?', [next.id]);
  }

  // Only admin uploads have files to remove — the static seed images live in
  // assets/images/ and are never touched here (width is only ever set by an
  // upload; the build-time seed leaves it NULL).
  //
  // A media-library reuse (attachExistingImage) shares the same stored files
  // between two rows, so the files are only removed once the LAST row that
  // points at them is gone — otherwise deleting the source photo silently
  // 404'd the copy on the other product's storefront page.
  if (image.width != null) {
    const stillUsed = await db.get('SELECT id FROM product_images WHERE src = ? LIMIT 1', [image.src]);
    if (!stillUsed) {
      await deleteProductImageFiles({ slug, id: image.id, variants: image.variants }).catch(() => {});
    }
  }

  await audit('product.image_delete', {
    adminId,
    entityType: 'product',
    entityId: slug,
    detail: { imageId },
    ip,
  });
  return { ok: true };
}

/** Make one image the primary (product-card / gallery-first) image. */
export async function setPrimaryProductImage(slug, imageId, { adminId, ip } = {}) {
  const db = await getDb();
  const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };
  const image = await db.get('SELECT id FROM product_images WHERE id = ? AND product_id = ?', [
    imageId,
    product.id,
  ]);
  if (!image) return { ok: false, error: 'Image not found.' };

  await db.run('UPDATE product_images SET is_primary = 0 WHERE product_id = ?', [product.id]);
  await db.run('UPDATE product_images SET is_primary = 1 WHERE id = ?', [imageId]);

  await audit('product.image_primary', {
    adminId,
    entityType: 'product',
    entityId: slug,
    detail: { imageId },
    ip,
  });
  return { ok: true };
}

/** Swap one image's gallery position with its neighbour. A no-op at either edge. */
export async function moveProductImage(slug, imageId, direction, { adminId, ip } = {}) {
  const db = await getDb();
  const product = await db.get('SELECT id FROM products WHERE slug = ?', [slug]);
  if (!product) return { ok: false, error: 'Product not found.' };
  const images = await db.all(
    'SELECT id, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order',
    [product.id]
  );
  const idx = images.findIndex((im) => im.id === imageId);
  if (idx === -1) return { ok: false, error: 'Image not found.' };
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= images.length) return { ok: true };

  const a = images[idx];
  const b = images[swapIdx];
  await db.run('UPDATE product_images SET sort_order = ? WHERE id = ?', [b.sort_order, a.id]);
  await db.run('UPDATE product_images SET sort_order = ? WHERE id = ?', [a.sort_order, b.id]);

  await audit('product.image_reorder', {
    adminId,
    entityType: 'product',
    entityId: slug,
    detail: { imageId, direction },
    ip,
  });
  return { ok: true };
}

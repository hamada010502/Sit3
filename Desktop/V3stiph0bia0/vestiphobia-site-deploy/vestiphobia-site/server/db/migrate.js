/**
 * VESTIPHOBIA — migrations and seed.
 *
 *   npm run db:migrate    create/upgrade the schema
 *   npm run db:seed       load the catalogue, content and settings
 *   npm run db:reset      drop the local SQLite file and rebuild from scratch
 *
 * Migrations are recorded in schema_migrations and never re-run. The same
 * runner works against Postgres — the DDL is portable and the adapter handles
 * the placeholder dialect.
 */

import { getDb, schemaSql, now, newId, toCents, toJson, closeDb } from './index.js';
import { site } from '../../site.config.js';
import { products } from '../../data/products.js';
import { createAdmin, adminCount } from '../lib/auth.js';

/**
 * Ordered migrations. The baseline is the full schema; later entries append.
 * Never edit a migration that has shipped — add a new one.
 */
const MIGRATIONS = [
  {
    version: '001_baseline',
    up: async (db) => {
      await db.exec(schemaSql());
    },
  },
  {
    /**
     * Stage 4 analytics.
     *
     * The tables and columns are also present in schema.sql, so a FRESH install
     * gets them from the baseline and this migration finds nothing to do. It
     * exists for a database created before Stage 4, and it has to be safe to
     * run in both cases — hence CREATE TABLE IF NOT EXISTS and the guarded
     * column adds.
     */
    version: '002_analytics_sessions',
    up: async (db) => {
      await db.exec(sessionsDdl());
      for (const [column, ddl] of [
        ['source', 'TEXT'],
        ['medium', 'TEXT'],
        ['engaged_ms', 'INTEGER'],
      ]) {
        await addColumnIfMissing(db, 'analytics_events', column, ddl);
      }
      await addColumnIfMissing(db, 'orders', 'analytics_session_id', 'TEXT');
    },
  },
  {
    /**
     * Live admin: product image management + the "confirmed details" bullet
     * list, which previously only existed in the static data/products.js file
     * and had no column to live in.
     */
    version: '003_live_admin_images',
    up: async (db) => {
      await addColumnIfMissing(db, 'product_images', 'is_primary', 'INTEGER NOT NULL DEFAULT 0');
      // The pixel size and the responsive variant set an upload produced
      // (webp/jpeg at a few widths). NULL for the images seeded from the
      // static catalogue, which are served through the existing build-time
      // image pipeline instead.
      await addColumnIfMissing(db, 'product_images', 'width', 'INTEGER');
      await addColumnIfMissing(db, 'product_images', 'height', 'INTEGER');
      await addColumnIfMissing(db, 'product_images', 'variants', 'TEXT');

      await addColumnIfMissing(db, 'products', 'details_confirmed', 'TEXT');

      // The very first image inserted for a product (build-time seed or an
      // early upload) becomes primary by default, so a product never ends up
      // with zero primary images.
      const rows = await db.all(
        `SELECT DISTINCT product_id FROM product_images
          WHERE product_id NOT IN (SELECT product_id FROM product_images WHERE is_primary = 1)`
      );
      for (const { product_id } of rows) {
        const first = await db.get(
          'SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1',
          [product_id]
        );
        if (first) await db.run('UPDATE product_images SET is_primary = 1 WHERE id = ?', [first.id]);
      }

      const ts = now();
      const existing = await db.get('SELECT key FROM settings WHERE key = ?', [
        'inventory.low_stock_threshold',
      ]);
      if (!existing) {
        await db.run(
          `INSERT INTO settings (key, value, kind, label, group_name, secret, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['inventory.low_stock_threshold', '3', 'number', 'Low-stock badge threshold (units)', 'inventory', 0, ts]
        );
      }
    },
  },
  {
    /**
     * Homepage hero becomes admin-editable: the image and the one-line
     * tagline under the wordmark. Empty value = the built-in default
     * (pages/home.js falls back to the same image/line it always used), so
     * a fresh row here changes nothing until the owner actually sets it.
     */
    version: '004_hero_content',
    up: async (db) => {
      const ts = now();
      for (const [key, label] of [
        ['home.hero_image', 'Homepage hero image'],
        ['home.hero_line', 'Homepage hero line (under the wordmark)'],
      ]) {
        const existing = await db.get('SELECT key FROM content WHERE key = ?', [key]);
        if (!existing) {
          await db.run(
            `INSERT INTO content (key, value, kind, label, group_name, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [key, '', 'text', label, 'home', ts]
          );
        }
      }
    },
  },
  {
    /**
     * Product-slug redirects (see schema.sql for why) — added so an already
     * migrated database gets the table without a full reset.
     */
    version: '005_product_redirects',
    up: async (db) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS product_redirects (
        from_slug   TEXT PRIMARY KEY,
        to_slug     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )`);
    },
  },
];

/** The analytics_sessions block of schema.sql, so the DDL lives in one place. */
function sessionsDdl() {
  const sql = schemaSql();
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS analytics_sessions');
  if (start === -1) throw new Error('analytics_sessions DDL missing from schema.sql');
  return sql.slice(start);
}

/**
 * ALTER TABLE ADD COLUMN is an error when the column already exists, and
 * neither engine offers a portable IF NOT EXISTS for it, so ask first.
 *
 * This is the only dialect-specific branch outside the adapter, and it is
 * confined to migrations — no request path depends on it.
 */
async function addColumnIfMissing(db, table, column, ddl) {
  let present;
  if (db.dialect === 'postgres') {
    const rows = await db.all(
      'SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?',
      [table, column]
    );
    present = rows.length > 0;
  } else {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    present = rows.some((r) => r.name === column);
  }
  if (!present) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export async function migrate({ quiet = false } = {}) {
  const db = await getDb();

  // The ledger table has to exist before it can record anything.
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (await db.all('SELECT version FROM schema_migrations')).map((r) => r.version)
  );

  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await m.up(db);
    await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
      m.version,
      now(),
    ]);
    count++;
    if (!quiet) console.log(`  applied ${m.version}`);
  }

  if (!quiet) {
    console.log(
      count ? `[db] ${count} migration(s) applied (${db.dialect})` : `[db] up to date (${db.dialect})`
    );
  }
  return count;
}

/* ------------------------------------------------------------------- seed */

/**
 * Seed is idempotent: it inserts what is missing and leaves existing rows
 * alone. Running it twice must never duplicate a product or overwrite content
 * the owner has since edited in the admin.
 */
export async function seed({ quiet = false } = {}) {
  const db = await getDb();
  const ts = now();

  /* ---- products, images, inventory ---- */
  for (const p of products) {
    const existing = await db.get('SELECT id FROM products WHERE slug = ?', [p.slug]);
    if (existing) {
      if (!quiet) console.log(`  product ${p.slug} already present, left untouched`);
      continue;
    }

    const id = newId();
    await db.run(
      `INSERT INTO products (
        id, slug, name, short_name, status, price_cents, compare_at_cents, currency,
        tagline, short_description, description, highlights,
        fabric, gsm, gsm_approximate, fit, print_method, care_instructions, details_confirmed, size_guide,
        category, tags, badge, featured, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        p.slug,
        p.name,
        p.shortName,
        'PUBLISHED',
        toCents(p.price),
        p.compareAtPrice ? toCents(p.compareAtPrice) : null,
        p.currency,
        p.tagline || null,
        p.shortDescription || null,
        toJson(p.description || []),
        toJson(p.highlights || []),
        p.fabric || null,
        p.gsm ?? null,
        p.gsmApproximate ? 1 : 0,
        p.fit || null,
        p.printMethod || null,
        toJson(p.careInstructions || []),
        toJson(p.details?.confirmed || []),
        toJson(p.sizeGuide || null),
        p.category || null,
        toJson(p.tags || []),
        p.badge || null,
        p.featured ? 1 : 0,
        0,
        ts,
        ts,
      ]
    );

    let order = 0;
    for (const im of p.images) {
      await db.run(
        `INSERT INTO product_images (id, product_id, src, alt, role, sort_order, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId(), id, im.src, im.alt, im.role || null, order, order === 0 ? 1 : 0]
      );
      order++;
    }

    // Quantities are genuinely unknown, so every size seeds at 0 AND is closed
    // by the manual flag. That is honest: the owner must set real numbers
    // before anything can be sold. It is never a silent "in stock".
    let sOrder = 0;
    for (const s of p.sizes) {
      await db.run(
        `INSERT INTO inventory (id, product_id, size, quantity, manual_out_of_stock, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId(), id, s.label, 0, 0, sOrder++, ts]
      );
    }

    if (!quiet) console.log(`  seeded product ${p.slug} (${p.sizes.length} sizes at qty 0)`);
  }

  /* ---- editable content ---- */
  const content = [
    ['announcement', site.announcement, 'text', 'Announcement bar', 'general'],
    ['brand.tagline', site.tagline, 'text', 'Brand tagline', 'general'],
    ['home.hero_image', '', 'text', 'Homepage hero image', 'home'],
    ['home.hero_line', '', 'text', 'Homepage hero line (under the wordmark)', 'home'],
    ['home.story.heading', 'why vestiphobia.', 'text', 'Homepage story heading', 'home'],
    [
      'home.story.body',
      JSON.stringify([
        'Clothing is never just clothing.',
        'We started from a simple contradiction: the fear of what we put on our bodies, and the need to express through it. Vestiphobia is an archive-driven, underground project built for people who treat garments as identity, not trend.',
        'Every piece is made with intention — weight, texture, fit, and a quiet refusal to look like everything else.',
        'This is not fashion. This is personal armor.',
      ]),
      'json',
      'Homepage story paragraphs',
      'home',
    ],
    [
      'story.body',
      JSON.stringify([
        'Clothing is never just clothing.',
        'We started from a simple contradiction: the fear of what we put on our bodies, and the need to express through it. Vestiphobia is an archive-driven, underground project built for people who treat garments as identity, not trend.',
        'Every piece is made with intention — weight, texture, fit, and a quiet refusal to look like everything else. We don’t chase seasons. We build pieces meant to be kept, worn down, and collected.',
      ]),
      'json',
      'Story page',
      'story',
    ],
    ['shipping.delivery_estimate', site.shipping.deliveryEstimate, 'text', 'Delivery estimate', 'shipping'],
    ['shipping.country_label', site.shipping.countryLabel, 'text', 'Shipping country', 'shipping'],
    [
      'shipping.fee_note',
      'Shipping fee is paid on delivery and varies by region.',
      'text',
      'Shipping fee note',
      'shipping',
    ],
    ['returns.window_days', String(site.returns.exchangeWindowDays), 'text', 'Exchange window (days)', 'returns'],
    ['contact.instagram', site.contact.instagram, 'text', 'Instagram URL', 'contact'],
    ['contact.email', site.contact.email || '', 'text', 'Support email', 'contact'],
  ];

  for (const [key, value, kind, label, group] of content) {
    const existing = await db.get('SELECT key FROM content WHERE key = ?', [key]);
    if (existing) continue;
    await db.run(
      `INSERT INTO content (key, value, kind, label, group_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, value ?? '', kind, label, group, ts]
    );
  }

  /* ---- settings ---- */
  const settings = [
    ['whatsapp.number', site.whatsapp.number, 'text', 'WhatsApp destination (digits only)', 'ordering', 0],
    ['whatsapp.enabled', site.whatsapp.enabled ? '1' : '0', 'bool', 'WhatsApp ordering enabled', 'ordering', 0],
    [
      'shamcash.instructions',
      [
        'Payment Instructions – Sham Cash',
        '',
        'Please transfer the exact total amount to the following Sham Cash number:',
        '',
        '[fill in the Sham Cash number]',
        '',
        'After transferring, send us a screenshot of the successful transfer with your Order ID.',
        '',
        'Once verified, we will mark your order as ACCEPTED and begin preparation.',
      ].join('\n'),
      'markdown',
      'Sham Cash instructions (sent manually over WhatsApp)',
      'ordering',
      // Marked secret: this template holds the payment account and must never
      // reach the public API.
      1,
    ],
    ['discount.returning_percent', String(site.discounts.returningCustomerPercent), 'number', 'Returning customer discount (%)', 'discounts', 0],
    ['discount.bundle_tiers', JSON.stringify(site.discounts.bundleTiers), 'json', 'Bundle discount tiers', 'discounts', 0],
    ['discount.max_percent', String(site.discounts.maxPercentWithoutConfirmation), 'number', 'Promotion ceiling without confirmation (%)', 'discounts', 0],
    ['shipping.free_min_pieces', String(site.shipping.freeShippingMinPieces), 'number', 'Free shipping from N pieces', 'shipping', 0],
    ['inventory.low_stock_threshold', '3', 'number', 'Low-stock badge threshold (units)', 'inventory', 0],
  ];

  for (const [key, value, kind, label, group, secret] of settings) {
    const existing = await db.get('SELECT key FROM settings WHERE key = ?', [key]);
    if (existing) continue;
    await db.run(
      `INSERT INTO settings (key, value, kind, label, group_name, secret, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [key, value ?? '', kind, label, group, secret, ts]
    );
  }

  /* ---- email template ---- */
  const tmpl = await db.get('SELECT key FROM email_templates WHERE key = ?', ['order_shipped']);
  if (!tmpl) {
    await db.run(
      `INSERT INTO email_templates (key, subject, body, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'order_shipped',
        'Your VESTIPHOBIA order {{ORDER_ID}} has shipped',
        [
          'Hello {{CUSTOMER_NAME}},',
          '',
          'Your VESTIPHOBIA order {{ORDER_ID}} is on its way.',
          '',
          'Items: {{ITEMS}}',
          'Delivery: {{DELIVERY_ESTIMATE}}',
          '',
          'The shipping fee is paid to the courier on delivery.',
          '',
          '— VESTIPHOBIA',
        ].join('\n'),
        1,
        ts,
      ]
    );
  }

  /* ---- first admin ---- */
  if ((await adminCount()) === 0) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      await createAdmin(email, password);
      if (!quiet) console.log(`  created admin ${email}`);
    } else if (!quiet) {
      console.log(
        '\n  NO ADMIN ACCOUNT EXISTS.\n' +
          '  Create one with:\n' +
          '    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD="a long passphrase" npm run db:seed\n' +
          '  or:  npm run admin:create -- you@example.com "a long passphrase"\n'
      );
    }
  }

  if (!quiet) console.log('[db] seed complete');
}

/* ------------------------------------------------------------------- CLI */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const cmd = process.argv[2] || 'migrate';
  try {
    if (cmd === 'migrate' || cmd === 'all') await migrate();
    if (cmd === 'seed' || cmd === 'all') await seed();
    await closeDb();
  } catch (err) {
    console.error('[db] failed:', err.message);
    process.exit(1);
  }
}

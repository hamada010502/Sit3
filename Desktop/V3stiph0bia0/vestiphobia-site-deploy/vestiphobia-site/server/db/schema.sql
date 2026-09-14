-- ===========================================================================
-- VESTIPHOBIA — database schema
--
-- PORTABILITY CONTRACT
-- This DDL runs unmodified on SQLite (local development) and, with the small
-- documented substitutions below, on PostgreSQL / Supabase (production).
--
--   * Primary keys are application-generated TEXT ids, never AUTOINCREMENT or
--     SERIAL, so no dialect-specific identity syntax appears anywhere.
--   * Timestamps are TEXT in ISO-8601 UTC. Postgres casts these to
--     timestamptz directly (see server/db/postgres.md).
--   * Booleans are INTEGER 0/1. Postgres accepts SMALLINT, or ALTER to
--     BOOLEAN with a USING clause after migrating.
--   * Money is INTEGER CENTS. Never a float — 0.1 + 0.2 is not 0.3, and a
--     storefront must not round differently from its own arithmetic.
--   * No SQLite-only functions, no upsert syntax that differs across engines.
--
-- Substitutions needed for Postgres (all mechanical):
--   TEXT            -> TEXT            (unchanged)
--   INTEGER         -> INTEGER / BIGINT (unchanged for these ranges)
--   AUTOINCREMENT   -> not used
--   ON CONFLICT     -> not used in DDL
-- ===========================================================================

-- --------------------------------------------------------------- migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

-- ------------------------------------------------------------------- admins
-- One shared admin account for V1. The table already carries a `role` column
-- so per-person accounts and roles can be added later without a migration of
-- the auth code path.
CREATE TABLE IF NOT EXISTS admins (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,   -- scrypt: <salt-hex>:<derivedkey-hex>
  role           TEXT NOT NULL DEFAULT 'owner',
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

-- ----------------------------------------------------------------- sessions
-- Server-side sessions. The cookie carries only an opaque random token; every
-- authorisation decision is a lookup here, never a claim the client supplies.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip_hash     TEXT               -- hashed, never the raw address
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ----------------------------------------------------------------- products
CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  short_name        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'DRAFT',
                    -- DRAFT | PUBLISHED | SOLD_OUT | HIDDEN | ARCHIVED
  price_cents       INTEGER NOT NULL,
  compare_at_cents  INTEGER,
  currency          TEXT NOT NULL DEFAULT 'USD',
  tagline           TEXT,
  short_description TEXT,
  description       TEXT,          -- JSON array of paragraphs
  highlights        TEXT,          -- JSON array
  fabric            TEXT,
  gsm               INTEGER,
  gsm_approximate   INTEGER NOT NULL DEFAULT 1,
  fit               TEXT,
  print_method      TEXT,
  care_instructions TEXT,          -- JSON array
  details_confirmed TEXT,          -- JSON array of confirmed-fact bullets
  size_guide        TEXT,          -- JSON { note, measurements[] }
  category          TEXT,
  tags              TEXT,          -- JSON array
  badge             TEXT,
  featured          INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  archived_at       TEXT           -- set, never deleted: order history depends on it
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- ----------------------------------------------------------- product images
CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  src         TEXT NOT NULL,
  alt         TEXT NOT NULL,
  role        TEXT,               -- main | detail | side | back | campaign
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  INTEGER NOT NULL DEFAULT 0,  -- exactly one per product, enforced in code
  width       INTEGER,            -- set for admin uploads; NULL for the static seed
  height      INTEGER,
  variants    TEXT                -- JSON { webp:[{w,path}], jpeg:[{w,path}] }; NULL for the static seed
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);

-- ---------------------------------------------------------------- inventory
-- Quantity per size. Customers never see the number — only available or not.
--
-- `manual_out_of_stock` lets the owner close a size while stock remains, and
-- survives quantity edits. Availability is (NOT manual_out_of_stock AND
-- quantity > 0), computed in one place: server/lib/inventory.js.
CREATE TABLE IF NOT EXISTS inventory (
  id                   TEXT PRIMARY KEY,
  product_id           TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size                 TEXT NOT NULL,
  quantity             INTEGER NOT NULL DEFAULT 0,
  manual_out_of_stock  INTEGER NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  updated_at           TEXT NOT NULL,
  UNIQUE (product_id, size)
);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);

-- Every stock movement, so a discrepancy can always be explained.
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  size        TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,      -- order_accepted | manual_adjust | restock | order_rejected
  order_id    TEXT,
  admin_id    TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_product ON inventory_ledger(product_id, size);

-- ---------------------------------------------------------------- customers
-- No customer accounts. Phone is the internal identity, stored normalised to
-- full international digits so one person is one row.
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL UNIQUE,   -- normalised, digits only
  phone_raw       TEXT,                   -- as the customer typed it
  name            TEXT,
  email           TEXT,
  latest_city     TEXT,
  latest_address  TEXT,
  order_count     INTEGER NOT NULL DEFAULT 0,
  total_spend_cents INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,                   -- internal only, never shown publicly
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- ------------------------------------------------------------------- orders
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT PRIMARY KEY,
  order_number        TEXT NOT NULL UNIQUE,   -- VST-2026-0001
  customer_id         TEXT REFERENCES customers(id),
  status              TEXT NOT NULL DEFAULT 'PENDING',
                      -- PENDING | ACCEPTED | PREPARING | SHIPPED | DELIVERED | REJECTED

  customer_name       TEXT NOT NULL,
  customer_phone      TEXT NOT NULL,
  customer_phone_raw  TEXT,
  customer_email      TEXT,
  city                TEXT NOT NULL,
  address             TEXT NOT NULL,
  notes               TEXT,

  currency            TEXT NOT NULL DEFAULT 'USD',
  pieces              INTEGER NOT NULL,
  subtotal_cents      INTEGER NOT NULL,
  -- Frozen at order time. Never recomputed when promotions change later.
  discount_percent    INTEGER NOT NULL DEFAULT 0,
  discount_cents      INTEGER NOT NULL DEFAULT 0,
  discount_type       TEXT,
  discount_label      TEXT,
  total_cents         INTEGER NOT NULL,
  -- Shipping is quoted by the courier per region and collected on delivery,
  -- so no amount is stored. The label explains that to the reader.
  shipping_free       INTEGER NOT NULL DEFAULT 0,
  shipping_label      TEXT,

  payment_method      TEXT NOT NULL DEFAULT 'SHAM CASH — MANUAL',
  -- Idempotency key: same cart + same customer within the window returns the
  -- existing order instead of creating a second one.
  fingerprint         TEXT,
  inventory_committed INTEGER NOT NULL DEFAULT 0,

  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  referrer            TEXT,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_fingerprint ON orders(fingerprint);

CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      TEXT,
  product_slug    TEXT NOT NULL,
  product_name    TEXT NOT NULL,
  size            TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  -- Price AT ORDER TIME. A later price change must not rewrite history.
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  note        TEXT,
  admin_id    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

-- --------------------------------------------------------------- promotions
CREATE TABLE IF NOT EXISTS promotions (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  code               TEXT UNIQUE,          -- NULL = automatic promotion
  percent            INTEGER NOT NULL,
  starts_at          TEXT,
  ends_at            TEXT,
  product_slugs      TEXT,                 -- JSON array; NULL = all products
  min_order_cents    INTEGER,
  max_uses           INTEGER,
  used_count         INTEGER NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 0,
  -- A percentage above the configured ceiling requires this to be set
  -- explicitly, so a mistyped 50 cannot quietly sell the drop at half price.
  over_ceiling_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);

-- ------------------------------------------------------------------ content
-- Every editable string on the site. Content is data, not code: the admin
-- edits rows here, never application source.
CREATE TABLE IF NOT EXISTS content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'text',   -- text | markdown | json | html
  label       TEXT,
  group_name  TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_group ON content(group_name);

-- ----------------------------------------------------------------- settings
-- Business configuration the admin can change: WhatsApp destination, Sham Cash
-- instructions, discount defaults, shipping copy.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'text',
  label       TEXT,
  group_name  TEXT,
  secret      INTEGER NOT NULL DEFAULT 0,   -- never exposed to the public API
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- ---------------------------------------------------------- email templates
CREATE TABLE IF NOT EXISTS email_templates (
  key         TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

-- Outbox rather than direct send: a failing mail provider must never block or
-- roll back an order status change.
CREATE TABLE IF NOT EXISTS email_outbox (
  id            TEXT PRIMARY KEY,
  to_address    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  template_key  TEXT,
  order_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'QUEUED',  -- QUEUED | SENT | FAILED
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  sent_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status);

-- --------------------------------------------------------------- audit logs
-- Every sensitive admin action. Append-only by convention.
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  detail       TEXT,          -- JSON; must never contain a password or token
  ip_hash      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_log(admin_id);

-- ------------------------------------------------------ analytics (Stage 4)
-- Raw event rows, deliberately free of PII. Customers are referenced by an
-- anonymous visitor id, never by phone, name or address.
CREATE TABLE IF NOT EXISTS analytics_events (
  id           TEXT PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  path         TEXT,
  referrer     TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  device       TEXT,
  os           TEXT,
  browser      TEXT,
  screen_class TEXT,
  country      TEXT,
  props        TEXT,          -- JSON; PII is rejected at the API boundary
  order_id     TEXT,
  source       TEXT,           -- resolved channel: direct / instagram / search / referral / campaign
  medium       TEXT,
  engaged_ms   INTEGER,        -- foreground time attributed to this event, where measurable
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(name);
CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_session ON analytics_events(session_id);

-- --------------------------------------------------------- rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

-- ------------------------------------------------- analytics: sessions
-- One row per visit. The event stream is the source of truth; this table is a
-- rolling summary of it, maintained as events arrive, so the funnel and the
-- traffic reports are a single scan instead of ten self-joins over raw events.
--
-- PII CONTRACT: nothing in this table identifies a person. No name, phone,
-- address or email, and no raw IP — visitor_id is a random value the browser
-- generates for itself, and country (when present) comes from a proxy header,
-- never from a lookup we perform.
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id             TEXT PRIMARY KEY,
  visitor_id     TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  is_new_visitor INTEGER NOT NULL DEFAULT 1,

  -- attribution, resolved once at the first event of the session
  source         TEXT,
  medium         TEXT,
  campaign       TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_content    TEXT,
  utm_term       TEXT,
  referrer_host  TEXT,

  landing_path   TEXT,
  exit_path      TEXT,

  device         TEXT,
  os             TEXT,
  browser        TEXT,
  screen_class   TEXT,
  country        TEXT,

  events         INTEGER NOT NULL DEFAULT 0,
  engaged_ms     INTEGER NOT NULL DEFAULT 0,

  -- funnel milestones, set once and never unset
  saw_product    INTEGER NOT NULL DEFAULT 0,
  selected_size  INTEGER NOT NULL DEFAULT 0,
  added_to_cart  INTEGER NOT NULL DEFAULT 0,
  viewed_cart    INTEGER NOT NULL DEFAULT 0,
  began_checkout INTEGER NOT NULL DEFAULT 0,
  clicked_whatsapp INTEGER NOT NULL DEFAULT 0,
  created_order  INTEGER NOT NULL DEFAULT 0,
  order_number   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON analytics_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON analytics_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON analytics_sessions(source);

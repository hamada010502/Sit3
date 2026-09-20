-- Paylo schema (Full Spec v2).
--
-- Two distinct order dimensions, deliberately separate:
--   orders.order_state  — commercial state: open / closed / cancelled / returned (v2 §4.2).
--                         Drives payout eligibility and the seller's filter tabs.
--   orders.status       — operational fulfilment/delivery detail within that state.
-- Allowed values and transitions are enforced by the state machine in lib/orders.ts;
-- CHECK constraints here are a second line of defence, not the source of truth.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','seller','owner')),
  name TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_recovery TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  instagram TEXT,
  phone TEXT NOT NULL,
  governorate TEXT NOT NULL,
  bio TEXT,
  about TEXT,
  logo_path TEXT,
  banner_path TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  payout_details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  review_note TEXT,
  -- KYC (v2 §6): first fraud checkpoint, gates payout eligibility
  kyc_status TEXT NOT NULL DEFAULT 'not_started' CHECK (kyc_status IN ('not_started','submitted','approved','rejected')),
  kyc_legal_name TEXT,
  kyc_national_id TEXT,
  kyc_doc_path TEXT,
  kyc_note TEXT,
  kyc_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'physical' CHECK (type IN ('physical','digital')),
  title TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  images TEXT NOT NULL DEFAULT '[]',
  digital_note TEXT,
  option1_name TEXT,
  option2_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','out_of_stock','removed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);

-- Up to two simple option types per product (v2 §4.1), materialised as concrete variants.
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option1_value TEXT,
  option2_value TEXT,
  label TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_title TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'physical',
  variant_id TEXT,
  variant_label TEXT,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  commission_rate REAL NOT NULL,
  commission_fixed INTEGER NOT NULL DEFAULT 0,
  commission_vat INTEGER NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL,
  seller_net INTEGER NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  buyer_email TEXT,
  governorate TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','bank_transfer','card')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','confirmed','collected_cod','failed','refunded')),
  fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('platform_rider','yalla_go','logistics_pickup','digital')),
  fulfillment_ref TEXT,
  tracking_number TEXT,
  pickup_location TEXT,
  order_state TEXT NOT NULL DEFAULT 'open' CHECK (order_state IN ('open','closed','cancelled','returned')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','payment_failed','confirmed','handed_off','in_transit','ready_for_pickup','delivered','disputed','refunded','cancelled')),
  pre_dispute_status TEXT,
  pre_dispute_state TEXT,
  payout_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  closed_at TEXT,
  handed_off_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,
  returned_at TEXT,
  refunded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(order_state);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SYP',
  status TEXT NOT NULL CHECK (status IN ('pending','captured','failed','refunded')),
  card_last4 TEXT,
  card_brand TEXT,
  failure_reason TEXT,
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- Bank transfer with manual/photo confirmation (v2 §3 MVP payment method)
CREATE TABLE IF NOT EXISTS bank_transfers (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reference TEXT,
  proof_path TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_proof' CHECK (status IN ('awaiting_proof','submitted','confirmed','rejected')),
  admin_note TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS address_change_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  new_address TEXT NOT NULL,
  new_governorate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL DEFAULT 'return' CHECK (kind IN ('return','not_received','other')),
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved_refund','resolved_found','resolved_dismissed')),
  liability TEXT CHECK (liability IN ('seller','logistics','platform','none')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  period_label TEXT NOT NULL,
  cutoff_at TEXT,
  order_count INTEGER NOT NULL,
  gross INTEGER NOT NULL,
  commission INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  reference TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payouts_seller ON payouts(seller_id);

-- Every notification Paylo emits, whatever the channel (v2 §6)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  recipient TEXT NOT NULL,
  event TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  transport TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Timestamped record of every state change — Paylo's evidence in a dispute (v2 §6)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('buyer','seller','admin','owner','system','api')),
  actor_id TEXT,
  actor_label TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  seller_id TEXT REFERENCES sellers(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '*',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  response_code INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint ON webhook_deliveries(endpoint_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_seller ON api_tokens(seller_id);

-- Pre-computed aggregates for the owner dashboards (see lib/analytics.ts). Populated by
-- a manual "Refresh now" action or a scheduled call to /api/internal/refresh-analytics —
-- never recomputed on a plain page load, so owner pages are cache reads, not table scans.
CREATE TABLE IF NOT EXISTS analytics_cache (
  key TEXT PRIMARY KEY,
  computed_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

-- Pre-account registration gate (separate from an existing store's lifecycle: sellers.status
-- covers pending/approved/rejected/suspended for a store that already exists; this table
-- covers the request BEFORE any users/sellers row is created). Approval materializes the
-- users+sellers rows from the fields captured here — see lib/registration.ts.
CREATE TABLE IF NOT EXISTS store_registration_requests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  national_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  instagram TEXT,
  governorate TEXT NOT NULL,
  bio TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','MORE_INFORMATION_REQUIRED','APPROVED','REJECTED')),
  admin_notes TEXT,
  info_request_note TEXT,
  duplicate_check TEXT NOT NULL DEFAULT 'clear',
  created_seller_id TEXT REFERENCES sellers(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reg_status ON store_registration_requests(status);
-- A REJECTED request releases its phone/national_id back to the pool — someone rejected for
-- a fixable reason must be able to submit again. These are the real DB-level uniqueness
-- constraints (partial: only "live" requests hold a claim), not just an app-level check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_phone_active ON store_registration_requests(phone) WHERE status != 'REJECTED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_national_id_active ON store_registration_requests(national_id) WHERE status != 'REJECTED';

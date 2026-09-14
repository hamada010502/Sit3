# Moving from SQLite to Postgres / Supabase

Local development uses SQLite. Production can use Postgres without changing
application code: set `DATABASE_URL` and the adapter in `index.js` opens
Postgres instead. This document is the runbook, including the parts that are
**not** automatic — those are listed first, because they are the ones that
cause surprises.

---

## This has actually been tested

Not reasoned about — executed. The full pre-launch suite (113 checks: the
customer journey, every size, the cart, every discount tier, the admin, XSS,
SQL injection, headers, access control, PII, mobile, 120-order stability and
the edge cases) was run against a real **PostgreSQL 16** server and passed with
zero failures, as did the same suite on SQLite.

The result that matters most: **30 separate OS processes racing to accept
orders for one remaining unit produced exactly one winner, 29 refusals, zero
errors, and stock landing on exactly 0** — the same outcome as SQLite. The
locking behaviour that prevents overselling holds on both engines.

Run it against your own staging database before launch:

```bash
npm install pg
PRELAUNCH_DATABASE_URL='postgresql://…staging…' npm run test:prelaunch
```

It refuses a URL that does not look like staging or localhost, because it
writes hundreds of test orders.

## What is genuinely automatic

- **Placeholders.** Every query in the app uses `?`. The Postgres driver
  rewrites them to `$1, $2, …`. Nothing else in the codebase knows which engine
  it is talking to.
- **The schema.** `schema.sql` uses only types both engines accept: `TEXT`,
  `INTEGER`, `REAL`. No `AUTOINCREMENT`, no `SERIAL`, no engine-specific
  defaults or upsert syntax.
- **Ids.** Application-generated UUID strings, so no identity/sequence
  differences exist to reconcile.
- **Timestamps.** ISO-8601 UTC strings, compared and sorted as text. Text
  ordering of ISO-8601 is chronological, so `ORDER BY created_at DESC` means the
  same thing on both engines.
- **Money.** Integer cents everywhere. No float, no `NUMERIC` rounding-mode
  difference to worry about.
- **Transactions and the stock decrement.** The one conditional `UPDATE …
  WHERE quantity >= ?` is safe on both: SQLite takes a write lock at
  `BEGIN IMMEDIATE`; Postgres locks the row for the duration of the update and
  re-evaluates the predicate for the second writer under READ COMMITTED. Two
  concurrent accepts of the last unit still produce exactly one winner.

## What is NOT automatic — read this part

1. ~~`LIKE` is case-sensitive in Postgres~~ — **fixed, nothing to do.**
   This used to require changing four clauses to `ILIKE` by hand. The searches
   now compare `LOWER(column) LIKE LOWER(?)`, which behaves identically on both
   engines, so admin search is case-insensitive everywhere and there is no
   migration step. Verified against a real Postgres 16: searching `racer`,
   `Racer` and `RACER` all return the same 30 orders.

2. **`npm install pg`.** The package is not a dependency until you need it. The
   adapter fails with an explicit message rather than a stack trace if it is
   missing.

3. **Data does not move by itself.** Migrating an existing SQLite file means
   exporting and importing — see "Moving existing data" below. If you switch
   before taking any real orders, skip it: `npm run db:setup` builds an empty
   production database in seconds.

4. **Supabase gives you two connection strings.** Use the right one:
   - **Direct** (port `5432`) for a long-running server — this project.
   - **Pooled / pgbouncer** (port `6543`) only for serverless functions.
     Transaction-mode pooling breaks session state; the pool in `index.js`
     assumes a normal connection.

5. **Supabase Row Level Security does not protect this app.** RLS guards
   Supabase's own auto-generated API, which this project does not use. It
   connects as the database owner with the service credentials in
   `DATABASE_URL`. Every access control that matters lives in the application:
   the admin session check, the phone check on order lookup, and the
   secret-settings filter. Do not treat "RLS is on" as a reason to relax any of
   them. **Never put the `DATABASE_URL` or the Supabase service key anywhere the
   browser can read it** — they belong in the server environment only.

---

## Switching a fresh install

```bash
npm install pg

export DATABASE_URL='postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres'

npm run db:migrate      # creates every table in Postgres
npm run db:seed         # catalogue, content, settings, email template
npm run admin:create -- you@example.com    # prompts for the password

npm run server
```

`npm run db:setup` runs migrate and seed together. Both are idempotent: running
them twice inserts nothing twice and overwrites nothing you have edited.

Confirm which engine is live:

```bash
curl -s localhost:4000/api/health
# {"ok":true,"dialect":"postgres"}
```

The dialect is also printed on startup and shown in the admin dashboard, so a
deploy that quietly fell back to SQLite is visible rather than silent.

---

## Moving existing data

Only needed if real orders already exist in the SQLite file.

```bash
# 1. Back up the SQLite database first. It is one file; copy it somewhere safe.
cp data/vestiphobia.db data/vestiphobia-$(date +%F).db.bak

# 2. Create the schema in Postgres.
DATABASE_URL='postgresql://…' npm run db:migrate

# 3. Export each table as CSV from SQLite.
sqlite3 -header -csv data/vestiphobia.db \
  "SELECT * FROM products;" > /tmp/products.csv
# …repeat for the tables that hold data you care about, in this order:
#   products, product_images, inventory, customers, orders, order_items,
#   order_events, inventory_ledger, content, settings, email_templates, admins

# 4. Import each one, in the same order (parents before children — the foreign
#    keys will reject rows whose parent is missing).
psql "$DATABASE_URL" -c "\copy products FROM '/tmp/products.csv' CSV HEADER"
```

Order matters because of the foreign keys. Skip `sessions` and `rate_limits`
entirely — sessions should be re-established by signing in again, and rate limit
buckets are transient by design.

After importing, verify counts on both sides before pointing production at the
new database:

```bash
sqlite3 data/vestiphobia.db "SELECT COUNT(*) FROM orders;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM orders;"
```

---

## Optional: native Postgres types

The app works unchanged with `TEXT` timestamps and `INTEGER` booleans. If you
later want native types for reporting convenience, this is safe and reversible
— but do it on a copy first, and note that the app's queries continue to write
ISO strings and 0/1, which Postgres will cast:

```sql
ALTER TABLE orders
  ALTER COLUMN created_at TYPE timestamptz USING created_at::timestamptz;

ALTER TABLE orders
  ALTER COLUMN inventory_committed TYPE boolean USING inventory_committed::int::boolean;
```

There is no need to do this. It buys nicer `psql` output and native date
functions, nothing the application requires.

---

## Rolling back to SQLite

Unset `DATABASE_URL`. The app reopens the local file at `SQLITE_PATH` on the
next start. Nothing else changes — which is the point of keeping the SQL
portable in the first place.

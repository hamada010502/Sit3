# VESTIPHOBIA — deployment

Exact steps, in order. Everything here has been run in development; nothing in
this file describes infrastructure that has been provisioned on your behalf. No
Supabase project, no host, no domain and no email account exists yet — those are
yours to create, and the steps that need them say so plainly.

---

## 0. What this application is

One Node process serves three things from a single origin:

| Path | What it is |
|---|---|
| `/`, `/shop/`, `/products/…`, `/story/`, `/contact/`, `/cart/`, `/checkout/`, `/order/`, `/policies/…` | the storefront, **server-rendered on every request straight from the database** — a product, price, description, image or content edit made in Admin is live on the next page load, with no build and no redeploy |
| `/assets/…` | CSS/JS/fonts/original images, served directly from the `assets/` source directory |
| `/uploads/…` | product images uploaded from Admin (local-disk storage backend only; S3-backed uploads are served straight from the object store) |
| `/api/…` | the public API the storefront calls (catalogue, order creation, order lookup) |
| `/admin` | the admin, behind a login with hashed passwords and server-side sessions |

`npm run build` still exists — it produces a standalone static export in
`dist/` (useful for an offline preview, or a fallback the server will serve
for a route it doesn't recognise) — but the live site does **not** depend on
it. Nothing in the request path for `/`, `/shop/`, a product page, or any
other storefront route reads from `dist/`.

**They must stay on one origin.** The Content-Security-Policy sets
`connect-src 'self'`, and the admin session cookie is `SameSite=Strict`. Putting
`dist/` on a static host and the API on a different domain breaks both. If you
ever must split them, that is a deliberate change to the CSP and the cookie
policy, not a configuration tweak.

Requirements: **Node 22 or newer** (the local database uses `node:sqlite`, which
arrived in 22). No other runtime dependency for local use.

---

## 1. Run it locally

```bash
npm install                 # sharp + playwright, dev only
npm run images               # optimises the static catalogue images (optional, improves LCP)
npm run db:setup            # creates the SQLite database, seeds catalogue + content
npm run admin:create -- you@example.com     # prompts for a password, no echo
npm run server              # http://localhost:4000 — storefront + API + admin, live from the DB
```

`npm run build` is **not** required to see the site. The server renders every
storefront page from the database on each request.

Then:

1. Open `http://localhost:4000/admin` and sign in.
2. Go to **Inventory** and set real quantities. **Every size is seeded at
   zero**, so nothing can be ordered until you do — that is deliberate. The site
   will never invent a stock number.
3. Go to **Settings** and fill in `shamcash.instructions` with your real Sham
   Cash number. It is marked secret and is never returned by the public API.
4. Edit a product's name, price, description or images from **Products →
   Edit**, save, and reload the storefront — the change is there immediately,
   with no rebuild.
5. Place a test order through the storefront and walk it through the admin:
   PENDING → ACCEPTED → PREPARING → SHIPPED → DELIVERED.

Useful commands:

```bash
npm run db:reset            # wipe the LOCAL database and rebuild (refuses if DATABASE_URL is set)
npm test                    # backend tests: auth, pricing, stock races, access control
npm run qa                  # full browser suite against a real server on a throwaway database
```

---

## 2. Environment

Copy `.env.example` to `.env.local` and fill it in. Nothing in it is ever sent
to the browser.

| Variable | Purpose | Notes |
|---|---|---|
| `PORT` | listen port | default 4000 |
| `HOST` | bind address | default 0.0.0.0 |
| `DATABASE_URL` | Postgres connection string | **empty = SQLite.** Set it for production. See `server/db/postgres.md` |
| `SQLITE_PATH` | local database file | default `./data/vestiphobia.db` |
| `PG_POOL_MAX` | Postgres connection pool size | default 10, only relevant when `DATABASE_URL` is set |
| `IP_SALT` | salt for hashing IPs in the audit log | set to a long random string per deployment |
| `TRUST_PROXY` | `1` only when behind a proxy you control | see the warning below |
| `ORDER_RATE_LIMIT` | orders per IP per hour | default 30 |
| `EVENTS_RATE_LIMIT` | analytics batches per IP per hour | default 600 |
| `SQLITE_BUSY_TIMEOUT_MS` | how long a write waits for the lock | default 15000 |
| `DB_TX_ATTEMPTS` | retries for a transaction that lost the lock | default 8 |
| `UPLOADS_DIR` | local-disk folder for uploaded product images | default `./data/uploads` — must be on a persistent volume in production, see §3b |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | switch uploads to Supabase Storage (recommended) | set all three to activate; see §3b. The key is a server secret — never expose it to the browser |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | switch uploads to a different S3-compatible storage | set all four to activate; see §3b. Ignored if the Supabase variables above are set |
| `S3_REGION`, `S3_PUBLIC_URL` | optional S3 tuning | default `auto`, and the endpoint host, respectively |
| `MAX_UPLOAD_BYTES` | largest accepted product image | default 8388608 (8MB) |

Node 22 can load the file directly:

```bash
node --env-file=.env.local server/index.js
```

### The `TRUST_PROXY` warning

Set it to `1` **only** when the app sits behind a reverse proxy you control
(Fly, Render, Nginx). It makes the app believe the `X-Forwarded-For` header. With
no such proxy in front, anyone can send that header themselves, give every
request a different address, and walk straight past every rate limit in the
application. Left unset, the app uses the real socket address, which cannot be
forged.

The same flag governs `X-Forwarded-Proto`, which is how the app knows a request
arrived over HTTPS when TLS was terminated at the proxy. **If your proxy
terminates TLS, you must set `TRUST_PROXY=1`** — without it the app only sees a
plain HTTP connection from the proxy, so the admin session cookie ships without
its `Secure` flag and no HSTS header is sent. A direct TLS connection to the app
itself is always recognised, flag or not.

---

## 3. Production database

Free tiers are enough to start. Follow **`server/db/postgres.md`** — it is the
complete runbook, including the two things that are not automatic (`npm install
pg`, and four `LIKE` clauses that should become `ILIKE`).

Short version for a fresh Supabase project:

```bash
npm install pg
export DATABASE_URL='postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres'
npm run db:setup
npm run admin:create -- you@example.com
```

Use the **direct** connection string (port 5432), not the pooled one (6543) —
this is a long-running server, not a serverless function.

Confirm which engine is actually live before you trust it:

```bash
curl -s https://yourdomain/api/health     # {"ok":true,"dialect":"postgres"}
```

---

## 3b. Product image storage

Images uploaded from Admin (Products → Edit → Images) need somewhere durable
to live — the same "ephemeral filesystem" problem as SQLite applies here too,
independently of which database you chose.

**Local disk (development fallback).** Zero setup — works immediately. In
production, `UPLOADS_DIR` **must** point at a persistent volume, or every
uploaded image is lost on the next redeploy. Used automatically whenever
neither backend below is configured.

**Supabase Storage (recommended production backend).** Set `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` and the app switches
automatically — no code change, no new dependency. The server talks to
Supabase's Storage REST API directly with the service role key as a bearer
token (no SDK; Node's built-in `fetch`).

1. In the Supabase dashboard: **Storage → New bucket**. Name it (e.g.
   `product-images`) and mark it **Public** — product photos are public
   content and the storefront links directly to
   `{SUPABASE_URL}/storage/v1/object/public/{bucket}/…`, which only serves
   objects in a public bucket (or via a signed URL, which this integration
   does not use).
2. Get the service role key: **Project Settings → API → service_role** (the
   *secret* key, not the `anon` public key).
3. Set the three variables:

   ```bash
   SUPABASE_URL=https://PROJECT.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...            # service_role secret — server env only
   SUPABASE_STORAGE_BUCKET=product-images
   ```

`SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase's Storage Row Level Security
entirely (the same "RLS does not protect this app" point made for the
database in `server/db/postgres.md` §5 applies here). It is read from the
server environment only, used only inside `server/lib/uploads.js`, and never
appears in an API response, an admin page, a log line, or a thrown error
message — put it in your host's secret manager, never in a file that reaches
git or the browser.

**Generic S3-compatible storage (alternative).** Set `S3_BUCKET`,
`S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` instead (signed
with hand-rolled AWS SigV4) for Cloudflare R2, AWS S3, or any other
S3-compatible provider. Used only when the Supabase variables above are not
set — Supabase takes priority if both are present.

```bash
S3_BUCKET=vestiphobia-uploads
S3_ENDPOINT=https://your-r2-account.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

Confirm which backend is active:

```bash
curl -s https://yourdomain/api/health
# {"ok":true,"dialect":"postgres","uploads":"supabase"}   # or "s3" / "local"
```

Switching backends does not migrate images already uploaded under the old
one — **existing images keep working unchanged**, since `product_images.src`
already holds each image's full URL (or local path) regardless of which
backend wrote it, and the storefront renders either kind through the same
markup. Only new uploads go to the newly configured backend. To move
existing local-disk images into Supabase Storage, write a small one-off
script that reads `data/uploads/products/**`, uploads each file to the bucket
under the same `products/{slug}/{file}` key, and updates the matching
`product_images.src` row — deliberately not included here, since it is a
one-time operation you run once and verify by hand, not something the
running server should ever do automatically.

---

## 4. Deploying

The application is a plain Node process, so any host that runs one works. What
it needs: Node 22+, a persistent `DATABASE_URL` (or a persistent disk if you
stay on SQLite), persistent image storage (§3b), and TLS termination.

**If you stay on SQLite in production, the database file must be on a disk that
survives restarts.** Most container hosts have an ephemeral filesystem: a
redeploy would silently destroy every order. Either attach a persistent volume
and point `SQLITE_PATH` at it, or use Postgres. Do not skip this decision.

The storefront itself needs no build step in production — it is rendered from
the database on every request. `npm run build` is only for the optional
`dist/` static export (an offline preview, or the fallback the server serves
for a route it does not recognise) and for `npm run images`, which generates
the responsive AVIF/WebP variants of the images in `data/products.js`'s static
seed.

### Fly.io

```bash
fly launch --no-deploy
fly volumes create vesti_data --size 1        # SQLite and/or local-disk uploads
fly secrets set DATABASE_URL='postgresql://…' IP_SALT='…' TRUST_PROXY=1
fly deploy
```

`fly.toml` needs `[[services]] internal_port = 4000` and a `[mounts]` entry
pointing at the volume. If you stay on SQLite, set `SQLITE_PATH` to a path
inside it; either way, set `UPLOADS_DIR` to a path inside it too — or skip the
volume for uploads entirely and use the S3 backend (§3b) instead.

### Render / Railway

- Build command: `npm install && npm run images`
- Start command: `npm run server`
- Environment: `DATABASE_URL`, `IP_SALT`, `TRUST_PROXY=1`, and a persistent
  disk mounted at `UPLOADS_DIR` (or the Supabase/S3 env vars from §3b)
- Health check path: `/api/health`

`npm run images` is not optional here, despite §4's "the storefront needs no
build step" — that line is about the HTML (genuinely rendered live, on every
request, from the database), not the product photos. The `<picture>` tags
for every image outside of an admin upload are driven by
`assets/images/manifest.json`, which `npm run images` writes alongside the
actual resized AVIF/WebP files it references — both are gitignored
(regenerated output, not source), so on a host that only runs `npm install`
neither exists, and if a *stale* manifest was ever committed by hand, the
page correctly finds an entry and 404s requesting a variant that was never
shipped. `npm install` alone silently ships a broken storefront; running the
image pipeline in the build step is what makes those photos exist on the
server's filesystem at all.

### A VPS

```bash
git clone … && cd vestiphobia-site
npm install --omit=dev
DATABASE_URL='…' npm run db:setup
npm run admin:create -- you@example.com
npm run server
```

Run it under systemd, and put Nginx or Caddy in front for TLS. With a proxy in
place, set `TRUST_PROXY=1`.

### After every deploy

Nothing to build. Restart the process (or let your host redeploy it) and the
storefront is already serving whatever is currently in the database — no
separate build/publish step to remember.

---

## 4b. Analytics

First-party only, on by default, and documented field by field in
**`ANALYTICS.md`** — including the complete list of what is collected and the
shorter list of what is refused. Nothing is sent to any third party.

Two things to do after deploying:

1. **Check the Locations screen.** If your host supplies a country header
   (`CF-IPCountry` on Cloudflare, `Fly-Client-Country` on Fly) it fills in by
   itself. If not, the screen says so plainly — no geolocation is performed and
   no location is guessed.
2. **Set a retention period you are comfortable with.** The default is 365 days
   and purging is a button on Admin → Settings, never a silent job.

To ship with no measurement at all, set `analytics.firstParty: false` in
`site.config.js` and rebuild.

---

## 5. Backups

**Do this before you take the first real order, not after you lose one.**

SQLite — the database is one file:

```bash
sqlite3 data/vestiphobia.db ".backup '/backups/vesti-$(date +%F).db'"
```

Use `.backup`, not `cp`: a plain copy of a live database can capture a
half-written page.

Postgres:

```bash
pg_dump "$DATABASE_URL" > /backups/vesti-$(date +%F).sql
```

Supabase's free tier includes automatic daily backups, but they are the
provider's copy, not yours. Keep your own off-site copy as well.

**Verify the restore, do not assume it.** The procedure above is executed end
to end by:

```bash
npm run test:backup
```

It builds a database with real orders, backs it up *while writes are in
flight*, destroys the original, restores, and then checks every table, the
structural integrity, the foreign keys, the money, and that the application can
read and write afterwards without colliding on an order number. Run it once
against your own environment before you take the first real order.

### What happens after infrastructure failure

| Failure | Effect | Recovery |
|---|---|---|
| The app process dies | The site is down; no data is lost — every committed order is durable | Restart it; your host should do this automatically |
| The container is replaced | On Postgres, nothing is lost. On SQLite **without a persistent volume, everything is lost** | This is why §4 insists on a volume or Postgres |
| The database file is corrupted | Orders since the last backup are at risk | Restore the latest backup; `PRAGMA integrity_check` confirms the restored file |
| The host is unreachable | The site is down. The WhatsApp threads with customers are unaffected — they live in WhatsApp | Redeploy elsewhere from the repository plus the latest backup |
| A wrong admin action | An order status changed in error | Every state change is in `order_events` and `audit_log` with a timestamp; set it back and the history shows both |

`qa/failure-test.mjs` exercises the database disappearing from under a running
server and coming back: the customer gets an honest refusal rather than a false
success, no customer details reach the log, and every order is still there
afterwards.

---

## 6. Security checklist before going public

- [ ] `npm run admin:create` used with a long passphrase; `ADMIN_PASSWORD` left
      out of `.env` so no password sits in a file.
- [ ] `IP_SALT` changed from the default.
- [ ] `TRUST_PROXY` set **only** if a proxy is genuinely in front.
- [ ] HTTPS terminated at the proxy. The session cookie is marked `Secure`
      automatically when the request arrives over HTTPS.
- [ ] `.env*` is not committed (`.gitignore` covers it, but check).
- [ ] `data/*.db` is not committed — it contains real customer phone numbers.
- [ ] `npm run qa:all` passes against the built site (see `TESTING.md`).
- [ ] `npm run audit` reports zero production vulnerabilities.
- [ ] `npm run test:backup` has been run, so the restore is verified rather
      than assumed.
- [ ] Real stock quantities entered in the admin.
- [ ] The real Sham Cash number entered in Settings, and nowhere else.

Optional hardening, worth doing when there is time: replace `'unsafe-inline'` in
the `script-src` CSP directive with a per-request nonce. The only inline script
is the runtime config block in `lib/layout.js`; a nonce there would let the
directive be tightened. It is noted rather than done because it touches the
build and the server together.

---

## 6b. The launch countdown

Before the shop opens, set an opening instant and the site shows a countdown
instead of the storefront:

```js
// site.config.js
launch: {
  opensAt: '2026-09-08T18:00:00.000Z',   // ISO-8601 UTC
  heading: 'ARRIVING',
  body: 'The first VESTIPHOBIA drop opens in',
  openedText: 'The drop is open.',
},
```

The check runs per request against the clock, so **the site opens by itself at
that moment** — no deploy, nothing to flip at midnight, and a server started
days earlier still opens on time. Verified end to end: a running server
answered 503 with the countdown, then served the storefront at 200 the instant
it passed, without a restart.

What stays reachable behind it, on purpose:

| Path | Why |
|---|---|
| `/admin` | the two days before a drop are exactly when stock and copy get finished |
| `/api/health` | so your host's health check does not report the site as down |
| `/assets/*` | so the countdown page uses the real fonts and wordmark |

Closed: the storefront and the ordering API. An order placed during a countdown
is an order nobody is expecting. The page returns 503 with `Retry-After` and is
marked `noindex`, so search engines do not index the countdown as if it were
the shop, and it states the opening time in the markup — a visitor with
JavaScript disabled still learns when to come back.

A malformed date fails **open**, with a warning in the log. A shop closed by a
typo that nobody notices is the worse failure.

---

## 7. What is deliberately not built

Saying so plainly is more useful than a surprise later.

- **Email is queued, not sent.** No provider is configured, so the shipping
  notification is written to `email_outbox` and shown in Admin → Emails with the
  exact text that would go out. Nothing is ever marked sent that was not sent.
  To enable: implement `dispatch()` in `server/routes/emails.js` with a provider
  (Resend, Postmark, SES, SMTP) and mark a row `SENT` only on a confirmed
  accept.
- **No payment gateway.** Payment is Sham Cash, arranged manually over WhatsApp.
  The site never claims a payment was received; only you can move an order past
  PENDING.
- **No customer accounts.** A customer is a phone number. There are no customer
  passwords in the system, so none can leak.
- **No analytics yet.** The `analytics_events` table exists and is unused —
  that is Stage 4.
- **The 1,000-user load test has been run locally, not against a deployment.**
  219,191 requests, 2,375 req/s, no oversold stock and no corrupted orders — but
  the load generator and the server shared one machine's CPU, with no network,
  TLS or proxy between them. Those numbers prove the logic, not your host's
  capacity. Once staging exists, run it from outside:

  ```bash
  node qa/load-test.mjs --users=1000 --base=https://staging.yourdomain.com
  ```

  See `TESTING.md` for what the local run measured and what it cannot tell you.

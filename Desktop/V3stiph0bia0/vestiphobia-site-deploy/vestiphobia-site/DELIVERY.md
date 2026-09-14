# VESTIPHOBIA — delivery summary

Stages 1 to 5 are complete. The domain is deliberately last and is not done —
it needs DNS access nobody but you has.

---

## 1. What was built

**A storefront** — static HTML rendered by `node build.js`, zero runtime
dependencies, no third-party script except Google Fonts. Six real product
photographs through an AVIF/WebP/JPEG pipeline; a phone loads ~290KB of images
above the fold.

**A backend** — `server/`, Node built-ins only. It owns order numbers, prices,
discounts, stock and status. Nothing the browser sends about money is read.

**An admin** — server-rendered at `/admin` behind scrypt-hashed passwords and
database-held sessions. Dashboard, Analytics (ten screens), Orders, Customers,
Products, Inventory, Content, Emails, Settings, Activity log.

**Analytics** — first-party only, no third party, no cookie for visitors, no
IP stored, no name or phone or address ever collected. See `ANALYTICS.md`.

**A launch countdown** — set `launch.opensAt` and the shop shows a countdown
until that instant, then opens by itself. Verified: a running server closed at
503, then served the storefront at 200 the moment it passed, with no restart.

### The rules that were kept

No fake stock. No invented shipping price. No payment gateway. No fake
reviews, discounts, founder history or location history. No marketing
automation. The WhatsApp number is never visible text — in API mode it is not
in the page bundle at all. No admin password in source. No secret in frontend
JavaScript. Email is queued and shown, never marked sent when nothing was sent.
And no external service is described here as provisioned, because none is.

---

## 2. Commits

| Commit | Stage |
|---|---|
| `5aa3b8f` | Session 1 — the storefront |
| `2d78e80` | Black UI, responsive images, WhatsApp + Sham Cash ordering |
| `1e4e10d` | Stage 1 — confirmed garment specs, the fit claim corrected |
| `6d044e6` | Stage 2 — WhatsApp order flow, discounts, confirmed content |
| `ded0d35` | Stage 3 — real backend, admin, inventory, auth |
| `7c26cbb` | Stage 4 and 5 — analytics, load testing, failure testing, hardening |
| (this one) | Launch countdown, browser baseline check, delivery summary |

Branch: `claude/new-session-c59ijd`.

---

## 3. Tests executed, and their results

Every number below is from a run against this code. Full detail in
`TESTING.md`.

| Suite | Command | Result |
|---|---|---|
| Unit + backend | `npm test` | **47 passed, 0 failed** |
| Browser | `npm run qa` | **97 passed, 0 failed** |
| Failure testing | `npm run test:failures` | **26 passed, 0 failed** |
| Inventory race | `npm run test:race` | **passed at 20, 60 and 150 concurrent processes** |
| Backup + restore | `npm run test:backup` | **14 passed, 0 failed** |
| Load, 1,000 users | `npm run load:1000` | **passed — 219,191 requests, 2,375 req/s, p99 104ms, no corruption** |
| Dependency audit | `npm run audit` | **0 vulnerabilities** |

The critical ones in one line each:

- **Overselling is impossible.** 150 processes racing for one unit: exactly one
  wins, stock lands on zero, never negative.
- **Prices cannot be tampered with.** A client posting `total: 1` gets an order
  for the real price.
- **The admin cannot be reached or driven without a session**, and a
  cross-origin POST with a valid session is still refused.
- **One customer cannot read another's order.** The phone number on the order
  is required, and a failed lookup says the same thing either way.
- **No customer PII reaches analytics.** The suites scan the analytics tables
  for their own test orders' names, phones and addresses and fail on a hit.
- **A restore was performed and verified**, not assumed.

---

## 4. Known limitations

1. **Cross-browser testing covered Chromium only.** Firefox and WebKit binaries
   cannot be installed in this build environment. Instead, the shipped CSS and
   JS are checked on every run against a documented baseline (Safari 15.4+,
   Chrome/Edge 100+, Firefox 100+), and the suite runs unchanged on those
   engines with `QA_BROWSER=firefox npm run qa` on a machine that can install
   them. Please run that before launch.
2. **The 1,000-user load test ran locally**, with the generator and the server
   sharing one CPU. It proves the logic, not your host's capacity. Re-run it
   against staging with `--base=https://staging.yourdomain.com`.
3. **Email is not delivered.** No provider is configured. Mail is queued,
   visible in Admin → Emails, and never marked sent.
4. **No geolocation.** The Locations screen fills in only if your host supplies
   a country header. It says so on the page rather than showing an empty chart.
5. **Order numbers are sequential**, so a competitor could estimate your volume.
   The phone check stops them reading the orders themselves.
6. **`shipping.flatRateUnderThreshold` stays null** by design — the courier sets
   the fee by region and it is paid on delivery, so the site quotes no number.
7. **Stock starts at zero for every size.** Nothing is sellable until you enter
   real numbers. That is deliberate.
8. **One admin role.** The `role` column exists for per-person accounts later;
   today every admin can do everything.

---

## 5. What still needs you

Nothing here has been created on your behalf. Each line is a thing only you can
do, with the reason.

| Needed | Why | Where it goes |
|---|---|---|
| A host (Fly, Render, Railway, VPS) | The app is a Node process; something must run it | `DEPLOYMENT.md` §4 |
| A database, or a persistent disk | On a container host without a volume, a redeploy destroys every order | `DEPLOYMENT.md` §3–4 |
| A domain + DNS access | The final task; see §8 | `site.config.js` → `domain` |
| The real Sham Cash number | Not in the repository, by design | Admin → Settings → `shamcash.instructions` |
| Real stock quantities | The site will never invent one | Admin → Inventory |
| A support email address | Contact page and policies say "coming soon" without it | `site.config.js` → `contact.email` |
| Legal business name and jurisdiction | Terms and Privacy show placeholders without them | `site.config.js` → `legal` |
| An email provider (optional) | To actually deliver the shipping notification | `server/routes/emails.js` → `dispatch()` |
| A newsletter provider (optional) | The form says plainly that nothing is stored | `site.config.js` → `newsletter` |

---

## 6. Deployment, in order

Full detail in `DEPLOYMENT.md`. The short path:

```bash
npm install
npm run build
npm run db:setup
npm run admin:create -- you@example.com
npm run server                      # http://localhost:4000
```

Then, for production: create the database, set the environment, deploy, and
work through the security checklist in `DEPLOYMENT.md` §6.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Empty = SQLite.** Set it to a Postgres URL for production |
| `SQLITE_PATH` | Local database file (default `./data/vestiphobia.db`) |
| `PORT` / `HOST` | Listen address (default 4000 / 0.0.0.0) |
| `IP_SALT` | Salt for hashing IPs in the audit log — change it per deployment |
| `TRUST_PROXY` | `1` **only** behind a proxy you control, or rate limiting can be bypassed |
| `ORDER_RATE_LIMIT` | Orders per IP per hour (default 30) |
| `EVENTS_RATE_LIMIT` | Analytics batches per IP per hour (default 600) |
| `SQLITE_BUSY_TIMEOUT_MS`, `DB_TX_ATTEMPTS` | Lock waiting and retries; defaults are measured |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin only. Prefer `npm run admin:create` |

### Database setup and migration

```bash
npm run db:setup        # migrate + seed, idempotent
npm run db:migrate      # schema only
npm run db:reset        # LOCAL SQLite only; refuses if DATABASE_URL is set
```

Moving to Postgres/Supabase: **`server/db/postgres.md`**. Two things are not
automatic and are called out there — `npm install pg`, and four `LIKE` clauses
that should become `ILIKE` because Postgres `LIKE` is case-sensitive.

---

## 7. Load testing against a real deployment

```bash
node qa/load-test.mjs --users=1000 --base=https://staging.yourdomain.com
```

Run it from a machine that is not the server. It drives an existing server and
touches nothing local; the database integrity checks are skipped in that mode
because it will not open your production database.

Watch for: error rate above 1%, p99 latency growing through the sustained
phase, and — most importantly — the stock numbers in the admin afterwards.

---

## 8. The domain, when you are ready

Deliberately last, and not started. When you have the domain:

1. Set `domain: 'https://vestiphobia.com'` in `site.config.js` and rebuild.
   Canonical URLs, Open Graph URLs and `sitemap.xml` appear.
2. Set `launch.opensAt` to two days ahead, as an ISO-8601 UTC instant:
   ```js
   launch: { opensAt: '2026-09-08T18:00:00.000Z', … }
   ```
   The countdown page shows until that moment; the shop then opens by itself,
   with no deploy and nothing to remember. `/admin` stays open behind it so you
   can finish stock and copy.
3. Point DNS at the host and enable HTTPS (most hosts do this for you).
4. Verify, in this order: `curl https://yourdomain/api/health` reports the
   expected dialect · the countdown renders · `/admin` signs in over HTTPS ·
   the session cookie is marked `Secure` · a test order reaches WhatsApp with
   the right number · the order appears in the admin · the analytics dashboard
   records the visit · then walk that test order to DELIVERED and reject a
   second one to confirm stock returns.
5. Re-run `npm run qa:all` against the deployed build, and the load test from
   §7.

---

## 9. One thing worth saying plainly

The most valuable output of Stage 5 was not the passing tests — it was the nine
defects the tests found, listed in `TESTING.md`. The worst of them would have
caused random, unexplainable failures under exactly the traffic a launch drop
produces, and none of them were visible by reading the code. That is the
argument for running `npm run qa:all` before each deploy rather than trusting
that nothing moved.

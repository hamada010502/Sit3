# VESTIPHOBIA — testing

Six suites. All of them run locally, none of them need a network, and every
one of them has been executed against this code — the results below are copied
from real runs, not written from intent.

```bash
npm run qa:all        # everything below except the full 1,000-user load test
```

| Command | What it does | Runtime |
|---|---|---|
| `npm test` | unit + backend tests (`node --test`) | ~15s |
| `npm run qa` | Chromium against the real server | ~3min |
| `npm run test:prelaunch` | the pre-launch audit: journey, admin, XSS, mobile | ~4min |
| `npm run test:failures` | breaks things on purpose | ~30s |
| `npm run test:race` | concurrent inventory attack | ~40s |
| `npm run test:backup` | backup, destroy, restore, verify | ~20s |
| `npm run load:quick` | 60-user load test | ~30s |
| `npm run load:1000` | **1,000-user load test** | ~2min |
| `npm run audit` | production dependency audit | instant |

---

## 1. `npm test` — 44 checks

Runs `qa/pricing.test.mjs` and `qa/server.test.mjs` against a throwaway SQLite
database.

**Auth** — a stored hash is never the password; a wrong password and an unknown
account are indistinguishable in message and comparable in timing; a forged or
expired token resolves to no session.

**Money** — the catalogue price wins over anything the client sends; a client
that posts `total: 1` gets an order for the real price; the bundle discount is
computed server-side; a placed order's total is not rewritten when the product
price later changes.

**Stock** — accepting deducts, rejecting returns, neither double-counts; an
order for more than the shelf holds is refused *before* a row is written;
**four separate OS processes racing for the last unit produce exactly one
winner**.

**Privacy** — the public catalogue carries no quantity in any form; the public
config returns no secret setting; an order can only be read with the phone
number on it, and a failed lookup answers identically whether the order exists
or the phone is wrong.

**Access control** — the admin is unreachable without a session; a
cross-origin POST with a valid session is refused; cookie flags; path
traversal; oversized bodies; malformed and injection-shaped input.

**Analytics** — unknown events dropped; non-whitelisted props dropped; phone-
and email-shaped values rejected even from allowed fields; `order_status`
refused from a browser; duplicate event ids stored once; source attribution;
milestones never erased; the analytics tables scanned for the test orders' own
names, phones and addresses.

## 2. `npm run qa` — 96 checks

Chromium driving **the real application server** — static files, public API and
admin — on a throwaway database and a port chosen at run time. It asserts
nothing about source code: every check loads a built page and interacts with
it, because "the code looks right" has already been wrong in this project.

Build and files · the black/white system and its contrast ratios computed in
the browser · responsive image selection and transfer weight on a phone ·
overflow at eight viewport widths · **touch targets and reduced motion** ·
cart persistence across pages and a reload · the full order flow through the
API · signing in to the real admin and walking an order to DELIVERED · the
returning discount applied by the server · the WhatsApp number's absence from
the bundle · a real browsing journey recording every funnel milestone ·
opt-out and Do Not Track · the shop working with every analytics request
failing · keyboard navigation, structured data, `noindex`, secret scanning,
and a scan for invented business facts.

The suite also reads the server's own log at the end and fails if the server
recorded an error, even when every browser check passed.

## 2b. `npm run test:prelaunch` — 113 checks

The audit a person would run by hand before opening the shop. Everything is
driven through the built pages or the real API.

**Journey** — Home → Shop → Product → size gate → cart → checkout → order →
WhatsApp handoff, with the handoff message checked field by field (and checked
that it never implies payment was made). Every size S–XXL ordered individually
and verified in the database.

**Cart** — add, increment, decrement, remove, the empty state, and survival
across a full reload.

**Discounts** — 1 piece (none), 2 (5%), 3 (10%), 5 (still 10%), two sizes × 1
(counts pieces, not lines), free shipping from 2, and the returning discount
proven to arrive *only* after a previous order reaches DELIVERED — not at
PENDING, ACCEPTED, PREPARING or SHIPPED. Bundle + returning does not stack.

**Admin** — anonymous refusal, wrong password, correct login, order list, the
full status walk, inventory edit with a ledger entry, closing a size by hand
without destroying its count, and stock moving **only** on acceptance
(10 → 8 on accept, 8 → 10 on reject).

**Security** — 12 XSS payloads through name, city, address and notes, checked
for *execution* in a real browser across 20 screens; 5 SQL injection payloads
including through the admin search and analytics filters; secrets and the
WhatsApp number absent from the bundle; the full header set on pages, API and
admin; HSTS present over HTTPS and absent over HTTP; cookie flags; login rate
limiting; all 11 admin routes and 4 admin mutations refused without a session;
a cross-origin POST refused even with a valid session.

**Data safety** — PII in the database and nowhere else; no IP column in
analytics at all; orders surviving refresh; recovery on another device by
phone; a wrong phone revealing nothing; a network failure mid-submit losing
neither the order nor the cart; and 12 simultaneous acceptances for one unit.

**Mobile** — 5 routes × 4 widths (320/375/390/430) for overflow and touch
targets, plus the complete checkout on a 320px phone.

**Stability** — 120 consecutive orders (2ms each, **0.0MB** memory growth),
then a real browser checkout still completing.

**Edge cases** — empty and short fields, 50,000-character inputs, a 600KB
body, WhatsApp disabled, and a genuinely locked database.

**Run against Postgres too.** By default the suite uses a throwaway SQLite
file, but it takes `PRELAUNCH_DATABASE_URL` and will run every check against a
real Postgres instead:

```bash
npm install pg
PRELAUNCH_DATABASE_URL='postgresql://…staging…' npm run test:prelaunch
```

All 113 checks were run against a real **PostgreSQL 16** server as well as
SQLite, both with zero failures — including 30 processes racing for one unit of
stock, which produced exactly one winner on both engines. It refuses a URL that
does not look like staging or localhost, because it writes hundreds of test
orders.

## 3. `npm run test:failures` — 26 checks

| Failure | Required behaviour |
|---|---|
| 14 malformed payloads | 4xx, no internals, no crash |
| malformed JSON | 400 |
| SQL injection | the orders table still exists |
| 5 simultaneous identical submits | exactly one order |
| stock conflict | refused as a conflict; the order is untouched |
| wrong password | 401, no cookie issued |
| forged / expired session | refused; the expired row is deleted |
| WhatsApp disabled | the order is still created; no dead link invented |
| no email provider | the order still ships; mail stays QUEUED, never "sent" |
| database moved away | honest refusal, no false success, no PII in the log |
| database returned | every order still present |
| read-only storage | reads work; a write is truthful about what happened |
| abandoned half-sent request | other visitors unaffected |
| 400KB body | refused, server healthy |

## 4. `npm run test:race` — the overselling test

Many independent OS processes accept orders for the same limited size at once.
Processes, not promises: `node:sqlite` is synchronous, so N "parallel" accepts
in one process would run one after another and prove nothing.

Verified at 20, 60 and 150 concurrent processes:

```
Scenario 1 — one unit of size L, everyone tries to buy it
  outcome: 1 accepted, 149 refused, 0 errored
Scenario 2 — five units of size M, everyone tries to buy one
  outcome: 5 accepted, 145 refused, 0 errored
PASSED — no overselling, no negative stock, no duplicate orders,
         and every stock movement is explained by the ledger.
```

## 5. `npm run test:backup` — restore verification

Builds a database with real orders, takes the documented backup **while writes
are in flight**, destroys the original, restores, and then verifies: every
table present, no rows lost, `PRAGMA integrity_check` clean, no orphaned order
lines, every total still adding up, the admin account intact — and finally
places a new order on the restored database and confirms the order-number
sequence continues without collision. 14 checks.

## 6. `npm run load:1000` — the 1,000-user test

1,000 virtual users through ramp-up → sustained → spike (2,000 users at once)
→ recovery, following realistic paths rather than 1,000 identical requests:
most browse, some consider, some order, and a rush cohort attacks one size.

Actual result on this development machine:

```
endpoint                   reqs  err     p50     p90     p99     max
GET page                 122461  457    18ms    75ms   104ms   873ms
POST /api/events          71614   70    30ms    79ms   366ms  6916ms
GET /api/catalogue        18075    3    73ms   159ms  1823ms 20003ms
POST /api/orders           7041    1    47ms   108ms   184ms 20127ms

Duration        : 92.3s
Requests        : 219191
Throughput      : 2374.8 req/s
Failures        : 531 (0.24%)
Orders created  : 3593
Duplicates held : 3447
Accepts         : 60 accepted, 0 refused, 0 errored
Stock removed   : 60 for 60 committed piece(s)
Checks          : no overselling, no duplicates, no corrupted orders
```

### What that number is, and what it is not

**Is:** proof that the application logic holds under real concurrency — 219,191
requests, no oversold stock, no duplicated orders, no corrupted totals, and
every accepted order matched by exactly one piece leaving the shelf.

**Is not:** a capacity figure for your host. The load generator and the server
shared one machine's CPU, with no network, no TLS and no proxy between them.
The 0.24% failures were client-side socket exhaustion in the generator, and the
20-second maximums are the generator's own timeout being hit while its 2,000
sockets queued — both artefacts of running both halves on one box.

**The real 1,000-concurrent-user test must be run against a deployed staging
environment, from outside it:**

```bash
node qa/load-test.mjs --users=1000 --base=https://staging.yourdomain.com
```

With `--base` the script drives an existing server and inspects nothing local.
Run it from a machine that is not the server, ideally from more than one.

---

## Cross-browser testing — what was and was not done

**Executed:** Chromium (Playwright), desktop and mobile emulation, at 320 /
375 / 390 / 430 / 768 / 1024 / 1440 / 1920px, with and without touch, with and
without `prefers-reduced-motion`, and with a real iOS Safari User-Agent.

**Not executed:** Firefox, WebKit/Safari and Edge. Those browser binaries
cannot be downloaded in this build environment. Saying they passed would be a
lie, so they are listed here as outstanding instead.

To run them on a machine with normal network access:

```bash
npx playwright install firefox webkit
QA_BROWSER=firefox npm run qa
QA_BROWSER=webkit npm run qa       # WebKit is the engine Safari uses
```

The engine is already switchable — no code change needed. Nothing in the suite
is Chromium-specific.

**What is done instead, and is executed:** the shipped CSS and JavaScript are
checked against a documented browser baseline on every run —
**Safari 15.4+, Chrome/Edge 100+, Firefox 100+ (March 2022)**. The check fails
the suite if a newer feature appears without a fallback: `:has()`, container
queries, `text-wrap`, subgrid, anchor positioning, `structuredClone`, array
change-by-copy methods, `Object.groupBy`, `AbortSignal.timeout`.

Two features in use do sit at the edge of that baseline, and both carry a
fallback that the check enforces:

- `svh` units on the hero, with a `vh` declaration before them — without it the
  hero collapses to the height of its text on Safari 15.3 and older.
- `crypto.randomUUID()` in the analytics tracker, behind a feature test.

That is not the same as running the suite in Safari, and it is not presented
as such. It is the strongest guarantee available without the browser.

---

## Findings this testing produced

Every one of these was a real defect, found by a test and fixed:

1. **`busy_timeout` was set after `journal_mode`.** Switching the journal to
   WAL takes the write lock, and with no busy timeout in effect yet, *opening a
   connection* failed with SQLITE_BUSY whenever another process happened to be
   writing. Under launch traffic this would have produced random, unexplained
   failures. Found at 40 concurrent processes; fixed by setting the timeout
   first, with a warning if the journal is not WAL.
2. **A transaction that lost the write lock failed the request.** Now retried
   with jittered backoff — nothing was written, so a retry is always safe.
3. **`close()` could throw** while checkpointing the write-ahead log, turning a
   *successful* order acceptance into a failed process.
4. **The analytics endpoint replied before reading the request body**,
   destroying the socket mid-upload: beacons arrived truncated, the browser
   logged `ERR_CONNECTION_RESET`, and events vanished intermittently.
5. **Funnel milestones were lost on fast navigation** because they waited for
   the batch timer or an unload beacon. Milestones now send immediately.
6. **Header and footer controls were 18–33px tall on a phone**, below the 44px
   guideline. A missed tap on Cart is a lost sale.
7. **`sharp` carried four high-severity libvips CVEs** (build-time only, never
   on the server). Upgraded to 0.35.4; `npm audit --omit=dev` is clean.
8. **An `emit()` name collision in the cart** would have silently stopped the
   cart UI updating — caught before it shipped.
9. **`svh` on the hero had no `vh` fallback**, so on Safari 15.3 and older the
   whole declaration was invalid and the hero collapsed to the height of its
   text.

Found by the pre-launch audit:

10. **A size that sold out after the last build was still offered.** The pages
    are statically built and read `data/products.js`, never the database, so
    the customer could pick a sold-out size, fill in the entire checkout, and
    only be refused at the final step. During a drop — when sizes actually do
    sell out — that was the most likely way the shop would look broken. The
    product page now asks the API on load and closes the sizes that are gone;
    it only ever removes availability, and if the request fails the page
    behaves exactly as built.
11. **JSON API responses carried no security headers at all** — no `nosniff`,
    no CSP — while the HTML routes carried the full set, because each caller
    passed them by hand. `nosniff` is the one that matters on an API: without
    it a JSON body containing attacker-supplied strings can be sniffed as HTML.
    The headers are now applied inside `json()`, `html()` and `redirect()`, so
    a new endpoint cannot ship without them, and HSTS is stamped once per
    request rather than remembered per route.
12. **Admin search found nothing on Postgres.** `LIKE` is case-insensitive in
    SQLite and case-sensitive in Postgres, so searching an order for "ahmad"
    worked in development and returned nothing in production — the worst kind
    of difference, because it looks like missing data rather than a broken
    query. Both searches now compare `LOWER(column) LIKE LOWER(?)`, identical
    on both engines. This had been documented as a manual migration step; it is
    now simply fixed.
13. **A test that failed roughly one run in seven, for a false reason.** The
    "public catalogue never leaks a stock quantity" check searched the whole
    serialised JSON for the string `42`, and the product id is a random UUID —
    **15.2% of UUIDs contain "42"**. It now walks the parsed structure and
    compares values, so it is deterministic.

## Dependency audit

```
npm audit --omit=dev   →  found 0 vulnerabilities
```

The shipped site has **zero runtime dependencies**. The server uses only Node
built-ins. `sharp` (images) and `playwright` (QA) are development-only and
never run in production. Postgres adds exactly one package, `pg`.

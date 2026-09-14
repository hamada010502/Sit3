# VESTIPHOBIA — storefront, API and admin

An underground fashion storefront. Orders are placed on the site, confirmed
with the brand over **WhatsApp**, and paid by **Sham Cash manually**. There is
no payment gateway and nothing here ever pretends there is.

Three parts, one Node process, one origin:

| Path | What it is |
|---|---|
| `/`, `/shop/`, `/products/…` | the storefront, server-rendered from the database on every request — a product or content edit in Admin is live immediately, no rebuild |
| `/api/…` | the public API: catalogue, order creation, order lookup |
| `/admin` | the admin, behind a login with hashed passwords and server-side sessions |

```bash
npm install
npm run db:setup         # create the local SQLite database, seed catalogue + content
npm run admin:create -- you@example.com    # prompts for a password, no echo
npm run server           # http://localhost:4000

npm run qa:all           # every suite below except the full 1,000-user load test
```

`npm run build` is optional — it renders a standalone static export to `dist/`
(an offline preview / fallback), but the live server does not need it.

**Node 22+** (the local database uses `node:sqlite`). Two dev dependencies:
`sharp` (image pipeline) and `playwright` (QA). The shipped site itself has zero
runtime dependencies and loads no third-party script — the only external request
is Google Fonts. Production adds exactly one package, `pg`, and only if you move
to Postgres.

Deployment, backups and the security checklist: **`DEPLOYMENT.md`**.
Moving to Postgres/Supabase: **`server/db/postgres.md`**.
What is measured, and what is refused: **`ANALYTICS.md`**.
Every suite, what it found, and the load-test numbers: **`TESTING.md`**.

---

## How ordering actually works

```
PRODUCT → CART → CHECKOUT (name, phone, city, address)
   ↓
POST /api/orders  — the SERVER prices the cart, allocates VST-2026-0001,
                    checks stock and stores the order as PENDING
   ↓
Customer taps CONFIRM BY WHATSAPP
   → wa.me opens with the full order pre-filled (link built by the server)
   ↓
Brand replies with the Sham Cash transfer details   ← by hand, off-site
   ↓
Customer transfers the money                        ← by hand, off-site
   ↓
Brand verifies the transfer                         ← by hand, off-site
   ↓
Admin sets ACCEPTED → PREPARING → SHIPPED → DELIVERED
```

Statuses: `PENDING → ACCEPTED → PREPARING → SHIPPED → DELIVERED`, plus
`REJECTED` from anywhere. PENDING means **submitted, awaiting store approval**.
It does not mean paid, and no wording in the system implies that it does.

**The website never touches money and never marks an order paid.** Only a signed-in
admin can advance an order. The WhatsApp message asks *for* payment details — it
never says payment has been made.

### What the server owns, and why it has to

Nothing the browser sends about money is read. The order request carries only
name, phone, city, address, optional email and notes, and the cart as
`slug + size + quantity`. Prices, discounts and totals are recomputed from the
catalogue. A client that posts `total: 1` gets an order for the real price.

| Concern | Where it lives | Why |
|---|---|---|
| Order numbers | `nextOrderNumber`, inside the transaction | a per-browser counter lets two customers both produce `VST-2026-0001` |
| Pricing and discounts | `routes/orders.js` + the shared pricing engine | any price the client sends is an assertion, not a fact |
| Returning-customer status | order history, server-side | an endpoint answering "has this number ordered before?" would be a lookup oracle for anyone |
| Stock | one conditional `UPDATE` | see below |
| Admin authentication | `lib/auth.js`, scrypt + DB-held sessions | any secret in frontend JavaScript is public |
| Reading someone else's order | phone check on `/api/orders/:id` | order numbers are sequential and guessable |

### The overselling problem

Two admins accepting the last L at the same moment must not both succeed. The
naive version — read the quantity, check it, then write — has a gap between the
check and the write. This code never does that. The decrement is a single
conditional statement:

```sql
UPDATE inventory SET quantity = quantity - ?
 WHERE product_id = ? AND size = ? AND quantity >= ?
```

The row changes only if it still holds enough stock **at the moment of the
write**. `changes === 0` means someone else got there first, and the whole
transaction rolls back — including any lines that had already succeeded.

`qa/server.test.mjs` proves it with four separate OS processes racing for one
remaining unit: exactly one wins, three are refused, and stock lands on zero.
Node's SQLite binding is synchronous, so four "parallel" accepts inside one
process would run one after another and prove nothing.

### Stock is never invented

Every size seeds at quantity **0**. The owner must enter real numbers in
Admin → Inventory before anything can be sold. Customers see *available* or
*sold out* and never a number: `publicSize()` drops the quantity at the source,
so no route can leak a count by forgetting to strip it.

---

## The admin

Server-rendered HTML at `/admin`. No client framework, no build step. Every
mutation is a plain `<form method="post">`, so it works with JavaScript
disabled and every state change is a real, auditable request.

Dashboard · Orders · Customers · Products · Inventory · Content · Emails ·
Settings · Activity log.

- **Passwords** are scrypt-hashed (N=32768) and compared in constant time. The
  login says the same thing for an unknown account and a wrong password, and
  spends comparable time on both, so it cannot be used to enumerate addresses.
- **Sessions** are opaque 256-bit random tokens in an `HttpOnly`,
  `SameSite=Strict` cookie, resolved against the database on every request. The
  cookie carries no claims, so nothing a client sends can grant authority.
- **CSRF**: admin POSTs are same-origin checked on top of `SameSite=Strict`. A
  request with neither `Origin` nor `Referer` is treated as untrusted.
- **Rate limits** on login (per IP *and* per email) and on order creation, held
  in the database so they survive a restart and hold across processes.
- **The activity log** strips anything credential-shaped before writing, so an
  audit trail can never become the place a password leaks. IPs are stored
  hashed with a per-deployment salt.
- **Secrets stay server-side**: settings rows flagged `secret` — the Sham Cash
  instructions, which hold the payment account — are filtered out of every
  public read in the query itself.

Create the first account with `npm run admin:create`. There is no signup page,
no password reset by email, and no way to create an admin from the browser.

---

## Customers

There are no customer accounts. A customer *is* a normalised phone number, so
`0965438999`, `+963 965 438 999` and `00963965438999` are one person and the
returning discount works. No customer passwords exist in the system, so none
can leak.

Reading an order back on another device requires the phone number on it, and a
failed lookup returns the same answer whether the order does not exist or the
phone is wrong.

---

## Analytics

First-party only. No Google Analytics, no Meta pixel, no ad network, no
session recording — events go to this site's own `/api/events` and nowhere
else. **`ANALYTICS.md`** lists every field collected; the short version:

- **Collected:** pages, product and size viewed, cart and checkout progress,
  foreground time, a coarse device class, and where the visit came from.
- **Never collected:** name, phone, address, email, or anything typed into the
  checkout. No IP is stored in analytics, not even hashed. No geolocation is
  performed. No cookie is set for visitors. Nothing is fingerprinted.

Three independent layers enforce that: the browser never reads those fields,
the server whitelists the props each event may carry, and every value is then
scanned for anything phone- or email-shaped. The test suites scan the analytics
tables for their own test orders' names and numbers and fail if any appears.

Do Not Track and Global Privacy Control are honoured, and the privacy policy
carries a working opt-out that also discards anything already queued.

Admin → Analytics has ten screens — Overview, Traffic, Funnel, Products,
Customers, Orders, Campaigns, Devices, Locations, Conversion — plus the raw
event stream, all filterable by Today / 7 / 30 / 90 days / a custom range.
Raw events are kept, not just counters, because an aggregate cannot answer a
question nobody thought to ask in advance.

Set `analytics.firstParty: false` in `site.config.js` to ship with no
measurement at all.

---

## Configuration

Two layers, and they are different in kind:

- **`site.config.js`** — build-time configuration: what the storefront is, how
  it is built, which mode it runs in. A `null` there means **owner input
  required**, and `npm run build` prints the outstanding list on every run. The
  UI renders an honest neutral state for each one rather than inventing a value.
- **The database** — everything the owner changes day to day: prices, stock,
  copy, discount rates, the Sham Cash instructions. Edited in the admin, seeded
  from `site.config.js` the first time. Changing content in the admin can never
  break the layout, because none of it is code.

### API mode

```js
api: { enabled: true, ordersEndpoint: '/api/orders' }
```

This is the default and the intended setup: the checkout posts to the backend,
which owns order numbers, prices, stock and status.

Set `enabled: false` to build a standalone static site again. Orders then live
only in the customer's own browser and reach the brand solely through the
WhatsApp message — order numbers can collide between customers, and clearing
site data destroys the record. The checkout knows which mode it is in and never
implies an order reached a server that was never contacted.

`admin.enabled` stays **false**. It belonged to the retired static prototype;
the build now throws if it is turned back on, because a passwordless admin page
must never ship again.

### The WhatsApp destination

```js
whatsapp: { enabled: true, number: '963900000000' }  // digits only, no '+'
```

Seeded into the `whatsapp.number` setting on first run and editable in
Admin → Settings afterwards. In API mode it is **not sent to the browser at
all**: the server builds the `wa.me` link and returns it with the confirmed
order. It appears in an href and is never rendered as visible copy — a QA check
fails the build if it shows up in page text or in the shipped JavaScript.

### Still outstanding

| Value | Effect while unset |
|---|---|
| `contact.email` | Contact page, support accordion and policies show "coming soon" |
| `domain` | No canonical URLs, no `sitemap.xml`, relative URLs only |
| `legal.businessName` / `.jurisdiction` / `.address` | Terms & Privacy show bracketed placeholders |
| `shipping.flatRateUnderThreshold` | Stays `null` on purpose — the courier sets the fee by region and it is paid on delivery. The site quotes no amount rather than inventing one |
| `newsletter.provider` + `.endpoint` | Form says plainly that nothing was saved |
| `social.*` | Empty accounts are hidden entirely — no dead links, no fake handles |
| Stock quantities | Every size seeds at 0 and cannot be ordered. Set real numbers in Admin → Inventory |
| `shamcash.instructions` | Ships with a bracketed placeholder for the account number. Fill it in Admin → Settings |

Product-level values live in `data/products.js` and are seeded into the
`products` table:

| Field | Effect while unset |
|---|---|
| `fabric`, `gsm` | The spec list is omitted; the "pending" note shows instead |
| `careInstructions` | The whole Care accordion is hidden |
| `sizeGuide.measurements` | Size guide explains the chart is not final |

---

## Adding a product

Append an object to `products` in `data/products.js` and rebuild. That one edit
produces the `/products/<slug>/` route, the shop card, the `Product` structured
data, the sitemap entry, the header search entry and the cart catalogue.

Supported already: `compareAtPrice` (sale), `availability: 'sold_out'`,
per-size `available: false`, `stockBySize` with a low-stock threshold, `badge`,
`featured`, `category`, `tags`, `related`.

The build **fails** on a duplicate slug, a non-positive price, no sizes, no
images, an image with no alt text, a `stockBySize` key that is not a real size,
or an image with no optimized variants. It will not silently ship a broken
catalogue.

---

## Images

`npm run images` reads `assets/images/` and `assets/brand/`, writes AVIF, WebP
and JPEG (or PNG, for transparent sources) at 400/800/1200/native widths into
`assets/images/generated/`, and records everything in `manifest.json`.
Originals are never modified or deleted. Reruns skip anything already current.

`lib/images.js` turns that manifest into real `<picture>` markup with `srcset`,
`sizes`, intrinsic `width`/`height` and lazy loading below the fold.

Measured: originals total 3.1MB; a phone now pulls ~17KB per photograph. The
brand wordmark went from a 272KB PNG — heavier than all six photographs
combined — to 25KB at the size a phone actually uses. A mobile homepage load
went from ~3MB of originals to 315KB.

**Cold builds are slow.** The first run encodes 66 variants and takes roughly
15–20 minutes; AVIF at `effort: 6` is where the time goes. Every run after that
is incremental and finishes in under a second, so it is a once-per-checkout
cost. Drop `avif.effort` to 4 in `scripts/optimize-images.js` and re-run with
`--force` if you would rather trade a few percent of file size for a much
faster cold build.

---

## Structure

```
site.config.js       build-time configuration — the only file with owner input
data/products.js     the catalogue, seeded into the database on first run
lib/layout.js        page shell: head, header, footer, cart drawer, runtime config
lib/images.js        <picture> markup from the image manifest
lib/html.js          escaping, price formatting
pages/               one module per page type (checkout/, order/, content, shop)
assets/css/site.css  the whole visual system
assets/js/store.js       cart state, drawer, menu, search, newsletter
assets/js/pricing.js     the discount engine — shared by the browser AND the server
assets/js/product.js     gallery, lightbox, size selector, add to cart
assets/js/orderService.js order model, statuses, WhatsApp message, API driver
assets/js/checkout.js    validation, order creation
assets/js/order.js       customer confirmation page and phone lookup

server/index.js          HTTP server: statics, public API, admin routing
server/db/schema.sql     19 tables, portable across SQLite and Postgres
server/db/index.js       the adapter — the only file that knows which engine
server/db/migrate.js     migrations and the idempotent seed
server/db/postgres.md    the Postgres/Supabase runbook
server/lib/auth.js       scrypt passwords, sessions, cookies
server/lib/inventory.js  the atomic stock decrement and the ledger
server/lib/http.js       security headers, rate limiting, CSRF, audit
server/lib/validate.js   every value crossing the API boundary
server/routes/           orders, products, customers, settings, emails
server/admin/            the server-rendered admin: shell + screens

scripts/optimize-images.js
scripts/create-admin.js  create or reset an admin account
scripts/db-reset.js      wipe and rebuild the LOCAL database only
qa/qa.mjs                browser suite, run against the real server
qa/server.test.mjs       backend tests incl. the four-process stock race
qa/pricing.test.mjs      discount engine unit tests
build.js                 validates config, renders dist/, writes robots + sitemap
```

---

## Design

Black ground, white text, brand red only where the photography already puts it.
Sharp corners, hairline rules, no gradients or shadows.

The colour contract is enforced, not just intended:

- `--red` (`#C41212`) is **never** body text — it is 2.6:1 on black.
- `--red-ink` (`#FF6169`) is the same red lifted to 6.0:1 so errors are legible.
- `--fg-muted` (`#A0A0A0`) at 6.9:1 is the dimmest text allowed anywhere.

The QA suite computes these contrast ratios in the browser and fails if any
drops below WCAG AA.

Nothing is communicated by colour alone: a disabled button also goes dashed, a
sold-out size is struck through, an invalid field gets a thicker edge *and* a
message.

The WhatsApp button is deliberately **not** WhatsApp green — the palette stays
black, white and the brand red. It earns prominence through size and weight.

All six photographs are portrait (~4:5), including the one named
`01_red_concrete_wide`. Layouts are built around portrait crops; the hero uses
`object-position: 50% 62%` so the figure survives on wide viewports, and above
900px the overlay copy moves to the bottom-left so it never lands on the model.

---

## QA

Six suites, ~200 checks, all executed against this code. **`TESTING.md`** has
the detail, the actual load-test numbers, and the list of defects the testing
found and fixed.

```bash
npm run qa:all      # everything except the full 1,000-user run
npm run load:1000   # the 1,000-concurrent-user test
```

| Command | Covers |
|---|---|
| `npm test` | 44 unit and backend checks: auth, pricing, stock races, privacy, access control, analytics |
| `npm run qa` | 96 browser checks against the real server — the storefront, the API and the admin |
| `npm run test:failures` | 26 deliberate failures: malformed input, duplicate submits, stock conflicts, auth failures, WhatsApp off, no mail provider, the database disappearing, read-only storage |
| `npm run test:race` | many OS processes racing for the last unit — verified to 150 |
| `npm run test:backup` | backup during writes, destroy, restore, verify row by row, then write again |
| `npm run load:1000` | 1,000 users through ramp, sustain, spike and recovery, then a database integrity check |
| `npm run audit` | production dependency audit (zero runtime dependencies, so this is short) |

The browser suite asserts nothing about source code: every check loads a built
page and interacts with it, because "the code looks correct" has already been
wrong in this project (a temporal-dead-zone bug silently emptied the cart on
every page navigation, hidden by a `catch` that swallowed it).

It also reads the server's own log at the end and fails the run if the server
recorded an error, even when every browser check passed.

`qa/fixtures/bad-config-check.mjs` temporarily swaps in a deliberately broken
catalogue to prove the build rejects it, then restores the real one and
verifies the project builds again. `qa/fixtures/accept-order.mjs` is the child
process the overselling race spawns — one accept, one line of output, so the
parent can count outcomes.

Both server-driven suites use a throwaway database and a port chosen at run
time. A fixed port cost an hour once: a server left behind by a crashed run
answered on it with stale code, and every failure after that pointed at the
wrong thing.

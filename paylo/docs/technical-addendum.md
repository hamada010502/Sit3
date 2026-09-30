# Technical addendum

Companion to the README. Covers the order state machine, payout arithmetic, webhook
contract, KYC flow, and the operations surface.

## 1. Order state machine

Authority: `TRANSITIONS` in `lib/orders.ts`. An illegal move throws `OrderError`; nothing
mutates an order outside `transition()`, which writes the row, the `order_events` row and
the audit entry in one place.

### Commercial state

| State | Meaning | Payout |
|---|---|---|
| `open` | Placed, awaiting payment or fulfilment | No |
| `closed` | Seller handed the parcel over | Eligible, subject to §2 |
| `cancelled` | Voided before fulfilment, including a pre-shipment refund | No |
| `returned` | Reversed after fulfilment | No, reversed if already counted |

### Fulfilment status

| Status | State | Enters from |
|---|---|---|
| `awaiting_payment` | open | Bank transfer or card checkout |
| `payment_failed` | cancelled | Card charge declined |
| `confirmed` | open | COD placed, or payment confirmed |
| `handed_off` | closed | Seller hand-off |
| `in_transit` | closed | Admin, courier collected |
| `ready_for_pickup` | closed | Admin, at the partner's pickup point |
| `delivered` | closed | Buyer confirmation, admin, or digital auto-delivery |
| `disputed` | keeps pre-dispute state | Buyer opens a return |
| `refunded` | cancelled or returned | Refund resolution |
| `cancelled` | cancelled | Seller or admin |

`disputed` stores `pre_dispute_status` and `pre_dispute_state`, so dismissing a return puts
the order back exactly where it was.

### Inventory

Stock is reserved when the order is placed, not when payment clears, so a pending bank
transfer cannot let someone else buy the last unit. It is released on cancellation and on a
refund that happens before shipment. Products fall to `out_of_stock` at zero and recover
when stock returns. With variants, the product's own stock mirrors the sum of its variants.

## 2. Payout arithmetic

```
commission = round(subtotal × rate / 100) + fixed_fee
vat        = round(commission × vat_rate / 100)
seller_net = subtotal − commission − vat
```

The buyer's delivery fee is charged on top of the subtotal and is not part of it: Paylo
collects it and pays the courier, so it earns no commission. All three inputs are frozen
onto the order at placement, so a later rate change never rewrites history.

**Worked example** — 80,000 SYP item, 5%, no fixed fee, no VAT, Damascus delivery 15,000:

| | |
|---|---|
| Buyer pays | 95,000 SYP |
| Commission | 4,000 SYP |
| Seller net | 76,000 SYP |
| Paylo retains | 4,000 commission + 15,000 delivery |

### Eligibility

```sql
order_state = 'closed'
AND payout_id IS NULL
AND seller.kyc_status = 'approved'
AND (
     (payment_method  = 'cod' AND payment_status = 'collected_cod' AND status = 'delivered')
  OR (payment_method != 'cod' AND payment_status = 'confirmed'
      AND (payout_eligibility = 'on_close' OR status = 'delivered'))
)
AND closed_at <= cutoff
AND NOT EXISTS (open or investigating dispute)
```

Cash on delivery deliberately requires more than Closed: the money only exists once the
courier hands it in, which an admin records on the order.

### Cycle

Weekly, cutoff Tuesday 18:00 UTC, transfer Wednesday, all configurable and computed in UTC
so the cycle does not drift with the server's timezone (`lib/payouts-schedule.ts`).
Generation is idempotent per order — `payout_id` is set under the same transaction that
creates the payout. A failed payout can be marked failed with a reason, or returned to the
pool so the next run picks the orders up again.

## 3. Webhooks

| Event | Fires when |
|---|---|
| `order.created` | Checkout completes |
| `order.updated` | Payment confirmed, in transit, ready for pickup, cancelled |
| `order.closed` | Hand-off, delivery, digital auto-delivery |
| `refund.created` | Buyer opens a return |
| `refund.updated` | Admin resolves it |
| `payout.sent` | Payout marked paid |

Signature:

```
Paylo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
Paylo-Event: order.created
```

Verify over the **raw** body before parsing, compare in constant time, and reject
timestamps outside your tolerance — the timestamp is inside the signed string precisely so
a captured delivery cannot be replayed. `verifySignature()` in `lib/webhooks.ts` is
exported for receivers and is exercised against a live receiver in the end-to-end test.

Delivery has a 4-second timeout and every attempt is recorded in `webhook_deliveries`.
Failures never propagate: a seller's broken endpoint must not fail a buyer's checkout.
A failed delivery is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours;
if the 6th attempt fails it is marked `dead`. Every retry re-sends the identical body (same
event `id`, so receivers can de-duplicate) with a fresh signature timestamp. A due delivery
is claimed with a conditional `UPDATE` before it is sent, so concurrent workers never send
it twice. Something must call `POST /api/internal/webhooks/retry` (header `x-worker-secret`
= `WEBHOOK_RETRY_SECRET`) about once a minute: `npm run worker:webhooks` on a single
server, or a cron job. Sellers see attempts, next retry time and dead deliveries on their
Developers page, with a "Retry now" button.

### Inbound courier events (auto-close)

`POST /api/logistics/events` accepts events from Paylo's rider app or the Yalla Go
integration, signed with the same `Paylo-Signature` scheme using `LOGISTICS_WEBHOOK_SECRET`
(unset = endpoint returns 501). Body: `{ "order_code", "event", "courier", "reference" }`
where `event` is `picked_up`, `in_transit` or `delivered`.

Only `platform_rider` and `yalla_go` orders are accepted. A pickup moves a `confirmed`
order to `handed_off` (which closes it) as actor `system`, so the seller never clicks
"handed off" for a courier-collected parcel; `delivered` then marks it delivered and, for
COD, records the cash as collected. Events are idempotent — a replay of a step the order
has already passed returns `{ "result": "noop" }`. Unpaid bank-transfer, disputed,
refunded and cancelled orders are refused with 409.

## 4. KYC flow

```
not_started ──► submitted ──► approved   → payouts unlocked
                         └──► rejected   → seller resubmits
```

The seller submits legal name, national ID number and a photo. An admin approves or
rejects with a note; either way the seller is emailed and the decision is audited. Payout
eligibility joins on `kyc_status = 'approved'`, so an unverified seller can trade but
accumulates only pending balance.

## 5. Two-factor

TOTP, SHA-1, 6 digits, 30-second step, ±1 step tolerance, implemented on `node:crypto` and
checked against the RFC 6238 vectors (`npm run test:totp`).

A secret is minted on first visit to Security and only activates once a live code verifies
it, so a half-finished enrolment cannot lock anyone out. Eight recovery codes are shown
once and stored as SHA-256 hashes; using one consumes it. Admin approval of a store is
refused while two-factor is off, and an admin can reset it for a locked-out seller — which
is audited.

### 5a. Store hold until two-factor is on

Stores approved through the registration review are created at approval time, so their
seller cannot have enabled 2FA beforehand. To keep 2FA mandatory (v2 §6) an approved store
whose seller has 2FA off is **held** (`isStoreLive()` in `lib/store-status.ts`, the single
definition used by the storefront, About page, product page and `checkout()`):

- buyers cannot see the store or check out (every entry point, short links included);
- `requireApprovedSeller()` sends every seller page to `/seller/security?hold=1`, which
  stays reachable along with `/seller/pending`;
- payout eligibility additionally requires `users.totp_enabled = 1`, so money already
  earned waits and is paid in the first run after 2FA is turned on.

Turning 2FA on releases the hold immediately; turning it off (or an admin 2FA reset)
re-applies it.

## 6. Audit trail

`audit_log` is append-only: actor type and label, entity type and id, action, JSON detail,
timestamp. Written on order transitions, payment events, refunds, payouts, seller and KYC
decisions, product changes, logins, and two-factor changes. Nothing updates or deletes a
row. Filterable by entity type at `/admin/audit`, and the last twelve entries for a seller
appear on their admin page.

## 7. Operations surface

`/admin/ops` is the cross-seller view the seller dashboard cannot provide (v2 §6):
transfers to confirm, paid-but-not-shipped past two days, in delivery over a week,
delivered with cash not yet recorded, failed payments, pending address changes, KYC
waiting, failed payouts. Each queue links straight to the record that resolves it, and the
page states plainly when nothing needs attention.

## 7a. Partial refunds

A partial refund returns part of the goods value while the order stays live and still
pays out. It is issued from a dispute ("Partial refund — order continues", after which the
order returns to its pre-dispute status) or from the admin order page. Every refund,
partial or full, is a row in `refunds` with its liability and its effect on the seller.

| Liability | Buyer refunded | Seller payout |
|---|---|---|
| seller | yes | `seller_net` drops by the refund **minus** the proportional commission (and VAT) returned |
| logistics / platform / none | yes | unchanged — Paylo absorbs it; logistics losses are recovered off-app |

Limits: payment must already be collected, the amount must be below the goods value still
unrefunded (the uncommissioned delivery fee is never part of it), and paid-out orders are
settled manually. A later full refund returns only what is left. Payouts pay
`sum(seller_net)`, so a seller-liable reduction reaches the actual transfer.

## 7b. Buyer text messages (SMS / WhatsApp)

Every buyer-facing order event sends a text as well as an email. Until this change no text
was ever delivered — every transport returned `logged` or `skipped` — and WhatsApp had no
call sites at all. Now:

- `SMS_TRANSPORT=http` / `WHATSAPP_TRANSPORT=http` POST `{"to","body","channel"}` as JSON
  to `SMS_HTTP_URL` / `WHATSAPP_HTTP_URL` with `Authorization: Bearer <…_HTTP_TOKEN>`.
  `log` (the default) still records without sending.
- Admin → Settings → "Buyer text messages via" picks SMS or WhatsApp. A buyer gets one
  channel, never both. It is a DB setting, so switching needs no restart.
- Each attempt is recorded in `notifications` as `sent`, `logged` or `failed: …`; a gateway
  failure never blocks the order.

WhatsApp note: business-initiated WhatsApp messages outside a 24-hour conversation window
must use pre-approved templates. A BSP relay behind `WHATSAPP_HTTP_URL` has to map these
plain-text bodies onto approved templates before WhatsApp goes live.

## 7c. New-order alerts on the seller dashboard

While any seller page is open, `NewOrderWatcher` polls `GET /api/seller/new-orders`
(session-scoped to that store, 401 otherwise) and announces each new order with an in-page
toast, a desktop notification if the seller allowed it, and an optional sale chime
(synthesised with Web Audio). Orders already there when the page loads are never
announced. The watcher only runs for a live store (2FA on). With the browser closed, Web
Push takes over (§7d).

## 7d. PWA and Web Push (Sprint A)

- **Installable app.** `app/manifest.ts` (start URL `/seller`, icons in `public/icons/`),
  `public/sw.js` registered by `components/ServiceWorker.tsx`. Navigations that fail while
  offline get `public/offline.html` (English + Arabic); nothing else is cached, so stale
  money figures are never shown.
- **Push.** `lib/push.ts` signs with VAPID (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
  `VAPID_SUBJECT`; if unset a key pair is generated once and stored in `settings`) and
  encrypts payloads (aes128gcm). Subscriptions live in `push_subscriptions`, scoped by the
  seller from the session (`/api/push/subscribe`); a 404/410 from the push service deletes
  the subscription. Every failed attempt is written to `push_failures` (and the server log)
  and shown on Admin → Operations. Each device stores the language it subscribed in, and
  its alerts are written in that language. The service worker shows a system notification only when no `/seller`
  tab is visible; otherwise it pings the open tab, which shows the toast and chime.
- **Preferences** (`/seller/settings`, "Notifications"): `notify_push`, `notify_sound`
  (now stored server-side, not per browser), `notify_email_orders`, `notify_text`, plus a
  "send test push" button. `notifyOrderPlaced()` honours all four.

## 7e. Seller UX (Sprints A–C)

- **Touch sizing.** Under `@media (pointer: coarse)` buttons, inputs and `.tap` links are at
  least 44px tall. The e2e audit checks every seller/buyer page at 390px, in English and
  Arabic, for horizontal overflow, tap targets under 40px and clipped text.
- **Empty states** (`components/EmptyState.tsx`) on products, collections, variations,
  coupons, orders (unfiltered vs filtered) and returns (open vs all).
- **Hand-off.** `HandOffForm` has labelled fields; after hand-off `HandedOffCard` shows the
  tracking number first, with copy, the buyer's tracking link, and an audited edit.
- **Product photos.** `ImageManager` supports drag-drop, several files at once, reorder
  (first photo = cover) and removal, up to 5. The server only keeps paths that already
  belong to that product, so a forged path cannot attach another store's file.
- **Commission breakdown** (`/seller/payouts`) and **post-purchase message** (shown on the
  buyer's tracking page on every later visit, with a live preview in settings).
- **Sales chart.** `lib/sales.ts` `dailySales()` sums goods value (excluding cancelled, failed-payment and refunded orders)
  per UTC day for 30 days; `components/SalesChart.tsx` is a single-series bar chart
  with per-bar tooltips and a table view.
- **Checkout.** Still two steps (details → payment). Fixed: "Continue" now validates step 1
  in the browser (same phone rule as the server), and a server-side field error returns the
  buyer to step 1 with the field focused instead of leaving it hidden on step 2.
- **Returns list** shows the refunded amount and the resulting seller net for partial
  refunds.

## 7f. Test coverage

`scripts/run-e2e.sh` builds once and runs five suites: smoke, registration, account/checkout,
parity (Shopier items 1–17 incl. returns, partial refunds, coupons, bulk updates, new-order
watcher, webhook retry/dead-letter, 2FA hold) and sprint (PWA, encrypted push delivery via a
local push service, notification prefs, 390px EN/AR audit, empty states, hand-off, photos,
sales chart, checkout fixes, offline page).

## 7g. Operations visibility

Admin → Operations adds **System health** (production config checked from the server's own
environment, values never shown, plus the retry-worker heartbeat), **Delivery** tiles (push
devices, push failures, failed email/SMS/WhatsApp, webhooks delivered/retrying/overdue/dead)
and lists of dead-letter webhooks, recent push failures and failed messages. Running it in
production: `docs/deployment.md`.

## 7h. Email / SMS / WhatsApp language

Every outgoing message is built by `lib/notify-templates.ts` from i18n keys `nt_*`, so the
Arabic and English texts are type-checked for parity like the UI (`Dict`). No English text
remains in `lib/orders.ts`, `lib/registration.ts`, `lib/customer.ts` or the admin seller
actions.

- **Buyers and registration applicants: Arabic.** They have no account setting to read.
- **Sellers: `sellers.preferred_lang`** (Settings → Notifications → "Language of my emails
  and texts", default Arabic). It is independent of the AR/EN switch used to browse the
  dashboard. On upgrade, sellers whose latest push device was English were set to English,
  so nobody's messages changed language silently.
- Amounts use `formatSYP` in the message language (Arabic digits and «ل.س» in Arabic).
- Web Push already used per-device language (§7d).

## 7i. Design note: a future `order_items` table (not built)

Orders are single-item on purpose (one product link → one order). If a cart is ever
needed, this is the shape that keeps every existing rule intact. Nothing below exists yet.

- **Table:** `order_items(id, order_id → orders, product_id, variant_id, title, variant_label,
  unit_price, quantity, line_subtotal, stock_reserved INTEGER)`. Title, label and price are
  copied at placement, like `orders.product_title` / `unit_price` today.
- **Order header keeps the money:** `orders.subtotal` becomes the sum of line subtotals;
  discount, delivery fee, commission, commission VAT and `seller_net` stay on the order and
  are still frozen at placement by `lib/fees.ts`. Payout eligibility and the ledger read
  only order-level columns, so they would not change.
- **One seller per order:** a multi-store cart splits into one order per seller at checkout,
  so seller scoping, hand-off, returns and payouts keep working per order.
- **Stock:** reserved per line inside the same checkout transaction; cancellation releases
  every line.
- **State machine:** unchanged — state lives on the order, never on a line. Partial returns
  of a single line would reuse the partial-refund path (amount ≤ that line's subtotal).
- **Migration:** backfill one `order_items` row per existing order from its product columns,
  then keep the old columns as read-only history.

## 8. Known gaps (intentional)

- **Single-item orders.** One product link → one order, by design. A cart would need an
  `order_items` table; the shape is sketched in §7i and nothing of it is built.
- **SQLite.** Correct for a pilot (v2 §7.1). Writes are serialised; the concrete trigger for
  moving to PostgreSQL is in `docs/deployment.md` §5.
- **Cash reconciliation is a single click per order,** from Admin → Operations ("Delivered,
  cash not recorded") or the order page — not a courier cash manifest.
- **No native app.** The PWA (§7d) covers install and push; see §9.
- **Buyers always get Arabic messages.** Buyers have no account setting to read; sellers
  choose their own language (`sellers.preferred_lang`, §7h).

## 8a. Open decision: when is COD cash "collected"?

`markCodCollected()` is documented as "the rider or logistics partner has handed the
collected cash to Paylo", and it is what makes a COD order payable. But `markDelivered()`
calls it automatically, so a COD order becomes payable the moment it is marked delivered —
before anyone confirms the cash reached Paylo. Two options:

1. **Keep as is:** delivery = cash collected (the courier is trusted to remit). Faster
   payouts; the Operations queue for uncollected cash stays mostly empty.
2. **Strict:** delivery no longer implies collection; COD orders wait in Operations until an
   admin confirms the cash handover, and only then enter a payout run. Safer money, but
   payouts depend on that daily admin step.

Not changed pending a decision, because it moves the moment sellers get paid.

## 9. Roadmap (not built)

- **Native mobile app.** The PWA (§7d) is shipped; a native app only if install rates or
  iOS push limits make it necessary (iOS delivers Web Push only to home-screen installs).

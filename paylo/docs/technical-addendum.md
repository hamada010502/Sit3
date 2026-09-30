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
There is no automatic retry yet — deliveries are recorded, and a replay worker is the
obvious next step.

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
(synthesised with Web Audio; the on/off choice is remembered per browser). Orders already
there when the page loads are never announced. This covers "dashboard open"; alerts with
the browser closed need Web Push (service worker + VAPID), which is on the roadmap below.

## 8. Known gaps

- **No webhook retry.** Failures are recorded, not replayed.
- **Cash reconciliation is a single click,** not a courier manifest.
- **Single-item orders.** The link-based model implies one product per order; a cart would
  need an `order_items` table.
- **SQLite.** Correct for a pilot, and v2 §7.1 explicitly defers PostgreSQL until scale
  demands it. Writes are serialised, so plan the migration before high concurrency.

## 9. Roadmap (not built)

- **Native mobile app / installable PWA.** Sellers run their store from their phones. The
  responsive web app is the current answer and is checked at 390px on every seller and buyer
  page added in the Shopier-parity work. A PWA (manifest, offline shell, Web Push for
  new-order alerts with the browser closed) is the next step; a native app only after that.

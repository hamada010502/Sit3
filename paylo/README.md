# Paylo — Your store. One link.

Link-in-bio commerce for independent sellers in Syria. A seller gets one storefront link
plus a checkout link per product, shares them on Instagram, and Paylo handles order state,
delivery coordination, and payouts.

Built against **`Paylo_Full_Spec_v2.md`**, which is the source of truth. Where the v1 draft
and the functional spec disagreed with it, v2 wins — the reconciliations are listed in
[What v2 changed](#what-v2-changed).

## Stack

- Next.js 14 (App Router, server actions), TypeScript, Tailwind
- SQLite via `better-sqlite3` — right for pilot scale; v2 §7.1 puts the move to
  PostgreSQL + Redis *before scaling past pilot*, not before launch
- Signed-cookie sessions, bcrypt passwords, hand-rolled TOTP on `node:crypto`
- Bilingual English (LTR) / Arabic (RTL), switchable, RTL-safe via CSS logical properties

## Quick start

```bash
cd paylo
npm install
cp .env.example .env     # optional; defaults work for local development
npm run db:reset         # creates the schema and seeds demo data
npm run dev              # http://localhost:3000
```

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | admin@paylo.sy | admin1234 | |
| Seller (live) | demo@paylo.sy | seller1234 | Two-factor on. TOTP secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| Seller (pending) | pending@paylo.sy | seller1234 | |

The demo seller's storefront is at `/s/lina-handmade`. The fixed TOTP secret exists so the
end-to-end test can log in; never ship a fixed secret to production.

Production: `npm run build && npm start`. Set `SESSION_SECRET`, `APP_URL`, `DATABASE_PATH`
and `UPLOAD_DIR` to durable values.

## What v2 changed

| Area | Before | Now |
|---|---|---|
| Brand | Cream/orange palette, "Link It. Get Paid." | Cherry Cola `#9A0002` on Cream Vanilla `#EFE6DE`, "Your store. One link." |
| Payment | Card via an abstracted provider | **Cash on delivery + bank transfer.** Card is built but switched off behind a phase gate |
| Order status | One delivery status | `order_state` (Open/Closed/Cancelled/Returned) over a separate fulfilment status |
| Products | No variants | Physical and digital, up to two option types, per-variant price and stock |
| Missing systems | — | Seller KYC, mandatory 2FA, operations dashboard, inventory reservation, notifications, audit trail |

The old palettes are gone from the codebase; `public/brand/` holds the current logo package.

The landing page is deliberately spare: one header, a hero, three steps, a footer. Product
cards carry abstract glyphs rather than illustrations — the product name is the meaning,
the glyph is identity. See [`docs/design-system.md`](docs/design-system.md).

## The payment phase gate

v2 §3 is the load-bearing constraint: **no bank has confirmed it will settle international
card payment for Syrian sellers**, so no card integration may be built on spec.

What that means here:

- Checkout offers **cash on delivery** and **bank transfer with receipt confirmation**.
- Card checkout exists behind `lib/payments/` but is hidden unless *both*
  `PAYMENT_CARD_ENABLED=1` and the admin `card_enabled` setting are on. The buyer never
  sees a card form before then.
- `lib/payments/qnb.ts` is a deliberate stub. When a bank confirms in writing what it
  settles, implement `charge()` and `refund()` there and flip the two switches. Nothing
  else changes.
- Commission is configurable and frozen per order, not hard-coded, because the fee model
  depends on what the settlement partner charges Paylo.

## Order state machine

`lib/orders.ts` is the single authority. Two dimensions, deliberately separate:

- **`order_state`** — the commercial state that drives payout eligibility and the seller's
  filter tabs: `open → closed`, `open → cancelled`, `closed → returned`.
- **`status`** — the operational detail inside that state.

```
awaiting_payment ──► confirmed ──► handed_off ──► in_transit ─────────┐
 (bank transfer)     (COD taken    (seller       (rider / Yalla Go)   ▼
                      or payment    hand-off)                      delivered
                      confirmed)         └──► ready_for_pickup ───────┘
                                              (logistics partner)

any post-payment status ──► disputed ──► back to previous | refunded
```

- **Hand-off is manual.** The seller clicks it; nothing closes an order automatically. The
  one exception is a digital product, which has no courier step and delivers on payment.
- **Refund before fulfilment → Cancelled. Refund after fulfilment → Returned.**
- **Stock is reserved at placement**, for every payment method, and released on cancel or a
  pre-shipment refund, so the last unit cannot be oversold.
- Invalid transitions throw; the table in `TRANSITIONS` is the whole contract.

## Payout eligibility

v2 §4.2 puts Closed orders in the payout pool. Money that has not reached Paylo cannot be
paid out, so the rule is split by method:

| Payment method | Becomes eligible when |
|---|---|
| Cash on delivery | Delivered **and** the courier's cash is recorded by an admin |
| Bank transfer / card | Payment confirmed, then Closed — or delivered, if `payout_eligibility` is set to `on_delivery` |

On top of that: seller KYC approved, no open return, not already in a payout, and closed
before the cutoff. The cycle is weekly, cutoff Tuesday 18:00 UTC, transfer Wednesday, all
admin-configurable.

## Security and evidence

- **Two-factor is mandatory.** A seller cannot be approved until TOTP is on; an admin
  approval attempt before that is refused with a message. Recovery codes are stored hashed
  and are single-use. TOTP is verified against the RFC 6238 vectors in `npm run test:totp`.
- **KYC gates payouts, not selling.** A seller can list and take orders while verification
  is pending, but nothing is released until an admin approves the documents.
- **Audit trail.** Every payment, dispatch, refund, approval and account change is appended
  to `audit_log` and never updated. This is Paylo's only evidence in a dispute, since no
  card network sits behind the platform.

## Surfaces

| URL | Who | What |
|---|---|---|
| `/` | public | Hero, how it works |
| `/s/[slug]` | buyer | Storefront: banner, logo, active products, "from" pricing for variants |
| `/p/[id]` | buyer | Two-step checkout: details, then payment method |
| `/track/[code]` | buyer | Live status, receipt upload, address change, return request, receipt confirmation |
| `/seller` | seller | Balances (available / pending / lifetime / next payout) and recent orders |
| `/seller/products` | seller | Physical and digital products, up to two option types with per-variant price and stock |
| `/seller/orders` | seller | Open / Closed / Cancelled / Returned, hand-off, tracking number, cancel, refund |
| `/seller/security` | seller | Two-factor enrolment — reachable before approval, because approval depends on it |
| `/seller/verification` | seller | KYC submission |
| `/seller/developers` | seller | Webhook endpoints with signing secrets, API tokens |
| `/admin/ops` | admin | Every queue that is stuck or waiting on Paylo |
| `/admin/sellers` | admin | Approve, suspend, review KYC, reset two-factor, remove listings |
| `/admin/orders` | admin | Confirm transfers, apply address changes, drive delivery, record cash, refund |
| `/admin/disputes` | admin | Resolve returns and record who bears the loss |
| `/admin/payouts` | admin | Run the weekly cycle, mark paid or failed, return a payout to the pool |
| `/admin/audit`, `/admin/notifications` | admin | The record, and every message sent |

## Integrations

**Webhooks** (`lib/webhooks.ts`) — `order.created`, `order.updated`, `order.closed`,
`refund.created`, `refund.updated`, `payout.sent`. Every delivery is signed:

```
Paylo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
```

Recompute the MAC over the raw body, compare in constant time, and reject timestamps
outside your tolerance. `verifySignature()` is exported so receivers can share the
implementation. A broken endpoint never fails a checkout; failures are recorded instead.

**REST API** (`/api/v1`) — bearer tokens, scoped to one store, tokens stored as SHA-256
hashes and shown once. `GET /api/v1` describes itself.

```bash
curl -H "Authorization: Bearer plo_..." http://localhost:3000/api/v1/orders?state=closed
```

**Notifications** (`lib/notify.ts`) — v2 §5.2 prefers SMS and WhatsApp over email, but no
gateway is contracted, so every channel defaults to the `log` transport: the exact message
is stored and visible under Admin → Notifications. Point `EMAIL_TRANSPORT=smtp` or
`SMS_TRANSPORT` at a provider to start sending; no calling code changes.

## Tests

```bash
npm run test:totp                                   # RFC 6238 vectors
npm run db:reset && npm run build && npm start &    # a seeded, running app
npm run test:e2e                                    # 55 assertions in a real browser
```

The end-to-end run covers the whole v2 path: application → mandatory two-factor →
approval refused without it → KYC → variants and digital products → cash-on-delivery
checkout → address change → hand-off → pickup and delivery → cash recorded → payout run →
bank transfer with receipt review → return refunded with liability → digital
auto-delivery → two-factor login → REST API → a live webhook receiver verifying the
HMAC → audit trail → Arabic RTL. Screenshots land in `e2e/shots/`.

Requires Playwright: `npm i -g playwright && npx playwright install chromium`.

## Further documentation

- [`docs/design-system.md`](docs/design-system.md) — colours, type, components, spacing, logo package
- [`docs/technical-addendum.md`](docs/technical-addendum.md) — state machine, payout maths, webhook events, KYC flow

## Open items this build does not resolve

1. **A bank that will settle card payments.** Everything downstream of it — card checkout,
   the commission percentages, payout automation — is gated and must stay gated.
2. **A real SMS/WhatsApp gateway.** The channel abstraction is there; no provider is.
3. **Delivery operations costing** — riders, Yalla Go fees, the logistics partner contract.
4. **The logistics partner itself.** `logistics_partner_name` is a placeholder setting.
5. **Domain, trademark and Instagram handle for "Paylo"** — still unverified.
6. **A reconciliation ledger for cash on delivery.** Today an admin records that the courier
   handed the cash in. At volume that needs to reconcile against courier manifests, not a
   single click.
